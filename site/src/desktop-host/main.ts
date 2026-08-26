import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { DatabaseLifecycleManager } from './database-lifecycle';
import { SqliteHostStore } from './sqlite-host-store';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../shared/schema-version';

// Electron's accelerated compositor produces blank first frames on the target
// macOS build. This bookkeeping UI does not need GPU acceleration, so use the
// stable software-rendered path.
app.disableHardwareAcceleration();

// Rename the application without moving the existing Accounting user-data
// directory, which contains the configured live SQLite database location.
const existingUserDataPath = app.getPath('userData');
app.setName('TallyStick');
app.setPath('userData', existingUserDataPath);

const desktopSmokeMode = process.env['ACCOUNTING_DESKTOP_SMOKE'] === '1';
const desktopSmokeUserData = desktopSmokeMode ? mkdtempSync(path.join(tmpdir(), 'accounting-desktop-smoke-')) : undefined;
if (desktopSmokeUserData) app.setPath('userData', desktopSmokeUserData);

let sql: SqlJsStatic | undefined;
let databaseStore: SqliteHostStore | undefined;
let databaseLifecycle: DatabaseLifecycleManager | undefined;
let mainWindow: BrowserWindow | undefined;

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') template.push({ role: 'appMenu' });
  template.push(
    {
      label: 'File',
      submenu: [
        {
          id: 'print-report',
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            if (focusedWindow) void focusedWindow.webContents.print({ printBackground: true });
          },
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The compiled desktop host lives in dist/desktop-host. Resolve resources from
// that stable location so launching Electron does not depend on process.cwd().
const siteRoot = path.resolve(__dirname, '..', '..');
const rendererIndexPath = path.join(__dirname, '..', 'tallystick', 'browser', 'index.html');
const sqlJsDirectory = path.join(siteRoot, 'node_modules', 'sql.js', 'dist');

async function openDatabase(requestedPath?: string): Promise<void> {
  sql ??= await initSqlJs({ locateFile: file => path.join(sqlJsDirectory, file) });
  databaseLifecycle ??= new DatabaseLifecycleManager(
    sql,
    path.join(app.getPath('userData'), 'database-locations.json'),
    path.join(app.getPath('userData'), 'tallystick.sqlite'),
  );
  const selectedPath = requestedPath ?? (await databaseLifecycle.locations()).currentDatabasePath;
  let bytes: Uint8Array | undefined;
  try { bytes = new Uint8Array(await fs.readFile(selectedPath)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (bytes) {
    databaseLifecycle.validateDatabase(bytes);
    if (databaseLifecycle.schemaVersion(bytes) < CURRENT_SQLITE_SCHEMA_VERSION) {
      await databaseLifecycle.backup(bytes, 'PRE_MIGRATION');
    }
  }
  databaseStore ??= new SqliteHostStore(sql);
  databaseStore.open(bytes, selectedPath);
}

function requireDatabaseLifecycle(): DatabaseLifecycleManager {
  if (!databaseLifecycle) throw new Error('Database lifecycle service is not available.');
  return databaseLifecycle;
}

function requireDatabaseBytes(): Uint8Array {
  const bytes = databaseStore?.exportBytes();
  if (!bytes) throw new Error('SQLite database is not open.');
  return bytes;
}

function scheduleRestart(): void {
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 350);
}

function requireDatabase(): Database {
  if (!databaseStore) throw new Error('SQLite database is not open.');
  return databaseStore.requireDatabase();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'TallyStick',
    show: false,
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
    mainWindow?.focus();
  });
  mainWindow.once('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Accounting renderer failed to load (${errorCode}): ${errorDescription} — ${validatedURL}`);
  });
  await mainWindow.loadFile(rendererIndexPath);
}

async function runDesktopSmoke(): Promise<void> {
  if (!mainWindow) throw new Error('The Accounting desktop window was not created.');
  const deadline = Date.now() + 10000;
  let result: { title?: string; windowTitle?: string; appName?: string; financialAccountEditor?: boolean; chartWorkspace?: boolean; chartTable?: boolean; chartEditor?: boolean; rulesWorkspace?: boolean; rulesTable?: boolean; ruleEditor?: boolean; reportWorkspace?: boolean; summaryButton?: boolean; detailButton?: boolean; scheduleBasisButton?: boolean; unadjustedBasisButton?: boolean; scheduleBasisActive?: boolean; detailTable?: boolean; dataWorkspace?: boolean; databasePath?: boolean; backupCreated?: boolean; printMenu?: boolean; printAccelerator?: boolean } | undefined;
  while (Date.now() < deadline) {
    result = await mainWindow.webContents.executeJavaScript(`(async () => {
      const buttons = [...document.querySelectorAll('button')];
      const chartWorkspaceButton = buttons.find(button => button.textContent?.trim() === 'Chart of Accounts');
      const rulesWorkspaceButton = buttons.find(button => button.textContent?.trim() === 'Rules');
      const reportsWorkspaceButton = buttons.find(button => button.textContent?.trim() === 'Profit & Loss');
      const balanceSheetWorkspaceButton = buttons.find(button => button.textContent?.trim() === 'Balance Sheet');
      const dataWorkspaceButton = buttons.find(button => button.textContent?.trim() === 'Backups');
      if (!chartWorkspaceButton || !rulesWorkspaceButton || !reportsWorkspaceButton || !balanceSheetWorkspaceButton || !dataWorkspaceButton) return { ready: false };
      const addFinancialAccountButton = buttons.find(button => button.textContent?.trim() === 'Add account');
      if (!addFinancialAccountButton) return { ready: false };
      addFinancialAccountButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const financialAccountEditor = Boolean(document.querySelector('.generic-account-editor-panel'));
      const closeFinancialAccountButton = document.querySelector('[aria-label="Close account editor"]');
      if (!financialAccountEditor || !closeFinancialAccountButton) return { ready: false };
      closeFinancialAccountButton.click();
      chartWorkspaceButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const newAccountButton = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'New account');
      const chartWorkspace = Boolean(document.querySelector('.chart-workspace'));
      const chartTable = Boolean(document.querySelector('.chart-table'));
      if (!chartWorkspace || !chartTable || !newAccountButton) return { ready: false };
      newAccountButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const chartEditor = Boolean(document.querySelector('.generic-account-editor-panel'));
      const closeAccountButton = document.querySelector('[aria-label="Close account editor"]');
      if (!chartEditor || !closeAccountButton) return { ready: false };
      closeAccountButton.click();
      rulesWorkspaceButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const newRuleButton = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'New rule');
      const rulesWorkspace = Boolean(document.querySelector('.rules-workspace'));
      const rulesTable = Boolean(document.querySelector('.rules-table'));
      if (!rulesWorkspace || !rulesTable || !newRuleButton) return { ready: false };
      newRuleButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const ruleEditor = Boolean(document.querySelector('.rule-editor-panel'));
      const closeRuleButton = document.querySelector('[aria-label="Close rule editor"]');
      if (!ruleEditor || !closeRuleButton) return { ready: false };
      closeRuleButton.click();
      reportsWorkspaceButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const reportButtons = [...document.querySelectorAll('button')];
      const summaryButton = reportButtons.find(button => button.textContent?.trim() === 'P/L Summary');
      const detailButton = reportButtons.find(button => button.textContent?.trim() === 'P/L Detail');
      const scheduleBasisButton = reportButtons.find(button => button.textContent?.trim() === 'Schedule C-ready');
      const unadjustedBasisButton = reportButtons.find(button => button.textContent?.trim() === 'Unadjusted P/L');
      if (!document.querySelector('.report-workspace') || !summaryButton || !detailButton || !scheduleBasisButton || !unadjustedBasisButton) return { ready: false };
      unadjustedBasisButton.click();
      scheduleBasisButton.click();
      const scheduleBasisActive = scheduleBasisButton.classList.contains('active-report-basis');
      detailButton.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const reportWorkspace = Boolean(document.querySelector('.report-workspace'));
      const detailTable = Boolean(document.querySelector('.detail-table'));
      balanceSheetWorkspaceButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const balanceButtons = [...document.querySelectorAll('button')];
      const firstBalanceAmount = document.querySelector('.balance-sheet-amount');
      if (!document.querySelector('.balance-sheet-workspace') || !document.querySelector('.balance-sheet-table') || !document.querySelector('.balance-sheet-totals') || !firstBalanceAmount || !balanceButtons.some(button => button.textContent?.trim() === 'Export CSV') || !balanceButtons.some(button => button.textContent?.trim() === 'Export XLSX') || !balanceButtons.some(button => button.textContent?.trim() === 'Print preview')) return { ready: false };
      firstBalanceAmount.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const balanceDetailClose = document.querySelector('[aria-label="Close Balance Sheet detail"]');
      if (!document.querySelector('.balance-sheet-detail') || !balanceDetailClose) return { ready: false };
      balanceDetailClose.click();
      dataWorkspaceButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const backupButton = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Back Up Now');
      if (!document.querySelector('.data-safety-workspace') || !backupButton) return { ready: false };
      backupButton.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const dataText = document.querySelector('.data-safety-workspace')?.textContent ?? '';
      return {
        ready: true,
        title: document.querySelector('h1')?.textContent?.trim(),
        financialAccountEditor,
        chartWorkspace,
        chartTable,
        chartEditor,
        rulesWorkspace,
        rulesTable,
        ruleEditor,
        reportWorkspace,
        summaryButton: Boolean(summaryButton),
        detailButton: Boolean(detailButton),
        scheduleBasisButton: Boolean(scheduleBasisButton),
        unadjustedBasisButton: Boolean(unadjustedBasisButton),
        scheduleBasisActive,
        detailTable,
        dataWorkspace: Boolean(document.querySelector('.data-safety-workspace')),
        databasePath: dataText.includes('tallystick.sqlite'),
        backupCreated: dataText.includes('Latest verified backup') && dataText.includes('.sqlite'),
      };
    })()`);
    if ((result as { ready?: boolean })?.ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const printMenuItem = Menu.getApplicationMenu()?.getMenuItemById('print-report');
  if (result) {
    result.windowTitle = mainWindow.getTitle();
    result.appName = app.getName();
    result.printMenu = Boolean(printMenuItem);
    result.printAccelerator = printMenuItem?.accelerator === 'CmdOrCtrl+P';
  }
  if (!result?.title || result.windowTitle !== 'TallyStick' || result.appName !== 'TallyStick' || !result.financialAccountEditor || !result.chartWorkspace || !result.chartTable || !result.chartEditor || !result.rulesWorkspace || !result.rulesTable || !result.ruleEditor || !result.reportWorkspace || !result.summaryButton || !result.detailButton || !result.scheduleBasisButton || !result.unadjustedBasisButton || !result.scheduleBasisActive || !result.detailTable || !result.dataWorkspace || !result.databasePath || !result.backupCreated || !result.printMenu || !result.printAccelerator) {
    throw new Error(`Desktop report smoke failed: ${JSON.stringify(result ?? {})}`);
  }
  console.log(`Desktop report smoke passed: ${JSON.stringify(result)}`);
}

ipcMain.handle('file:choose-and-read', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Accounting sources', extensions: ['csv', 'xls', 'xlsx', 'qbo', 'ofx'] }] });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const selectedPath = result.filePaths[0];
  return { fileName: path.basename(selectedPath), content: new Uint8Array(await fs.readFile(selectedPath)) };
});

ipcMain.handle('sqlite:open', (_event, requestedPath?: string) => openDatabase(requestedPath));
ipcMain.handle('sqlite:execute', (_event, sql: string, params: Array<string | number | null> = []) => {
  const statement = requireDatabase().prepare(sql);
  try {
    statement.bind(params);
    const rows: Array<Record<string, unknown>> = [];
    while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
    return rows;
  } finally { statement.free(); }
});
ipcMain.handle('sqlite:export', async (_event, requestedPath: string) => {
  if (!databaseStore) throw new Error('SQLite database is not open.');
  const target = requestedPath || databaseStore.requirePath();
  await fs.writeFile(target, requireDatabase().export());
});
ipcMain.on('sqlite:read-sync', event => {
  event.returnValue = databaseStore?.exportBytes();
});
ipcMain.on('sqlite:write-sync', (event, bytes: Uint8Array) => {
  try {
    if (!databaseStore) throw new Error('SQLite database is not open.');
    const target = databaseStore.requirePath();
    databaseStore.persistAndReplace(bytes, validatedBytes => writeFileSync(target, Buffer.from(validatedBytes)));
    event.returnValue = { ok: true };
  } catch (error) {
    event.returnValue = { ok: false, error: error instanceof Error ? error.message : 'Unable to write SQLite database.' };
  }
});
ipcMain.handle('sqlite:close', () => { databaseStore?.close(); databaseStore = undefined; });
ipcMain.handle('database-lifecycle:get-locations', () => requireDatabaseLifecycle().locations());
ipcMain.handle('database-lifecycle:choose-backup-directory', async () => {
  const current = await requireDatabaseLifecycle().locations();
  const result = await dialog.showOpenDialog({
    title: 'Choose Accounting backup folder',
    defaultPath: current.backupDirectory,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return undefined;
  return requireDatabaseLifecycle().setBackupDirectory(result.filePaths[0]);
});
ipcMain.handle('database-lifecycle:backup-now', () => requireDatabaseLifecycle().backup(requireDatabaseBytes()));
ipcMain.handle('database-lifecycle:relocate', async () => {
  const current = await requireDatabaseLifecycle().locations();
  const result = await dialog.showSaveDialog({
    title: 'Choose current Accounting database location',
    defaultPath: current.currentDatabasePath,
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  });
  if (result.canceled || !result.filePath) return undefined;
  const bytes = requireDatabaseBytes();
  const operation = await requireDatabaseLifecycle().relocate(bytes, result.filePath);
  databaseStore?.open(bytes, operation.path);
  if (!desktopSmokeMode) scheduleRestart();
  return operation;
});
ipcMain.handle('database-lifecycle:restore', async () => {
  const current = await requireDatabaseLifecycle().locations();
  const result = await dialog.showOpenDialog({
    title: 'Choose Accounting database backup to restore',
    defaultPath: current.backupDirectory,
    properties: ['openFile'],
    filters: [{ name: 'SQLite database backup', extensions: ['sqlite'] }],
  });
  if (result.canceled || !result.filePaths[0]) return undefined;
  const operation = await requireDatabaseLifecycle().restore(requireDatabaseBytes(), result.filePaths[0]);
  const restoredBytes = new Uint8Array(await fs.readFile(operation.path));
  databaseStore?.open(restoredBytes, operation.path);
  if (!desktopSmokeMode) scheduleRestart();
  return operation;
});
ipcMain.handle('report-file:save', async (_event, suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML') => {
  const extensions = fileType === 'CSV' ? ['csv'] : fileType === 'XLSX' ? ['xlsx'] : ['html'];
  const result = await dialog.showSaveDialog({ title: `Save Balance Sheet ${fileType}`, defaultPath: suggestedFileName, filters: [{ name: `Balance Sheet ${fileType}`, extensions }] });
  if (result.canceled || !result.filePath) return 'CANCELLED';
  const temporaryPath = `${result.filePath}.tallystick-${process.pid}.tmp`;
  try { await fs.writeFile(temporaryPath, bytes, { flag: 'wx' }); await fs.rename(temporaryPath, result.filePath); }
  catch (error) { await fs.rm(temporaryPath, { force: true }); throw error; }
  return 'SAVED';
});
ipcMain.handle('report-preview:open', async (_event, title: string, html: string) => {
  const preview = new BrowserWindow({ title, width: 1000, height: 800, parent: mainWindow, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  return `preview-${preview.id}`;
});
void app.whenReady().then(async () => {
  await openDatabase();
  if (desktopSmokeUserData) await requireDatabaseLifecycle().setBackupDirectory(path.join(desktopSmokeUserData, 'backups'));
  installApplicationMenu();
  await createWindow();
  if (desktopSmokeMode) {
    try {
      await runDesktopSmoke();
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
    return;
  }
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { if (desktopSmokeUserData) rmSync(desktopSmokeUserData, { recursive: true, force: true }); });
