import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import initSqlJs, { SqlJsStatic } from 'sql.js';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../shared/schema-version';
import { DatabaseLifecycleManager } from './database-lifecycle';
import { SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS, SQLITE_V5_MIGRATIONS } from '../app/core/sqlite-gateway/schema';
import { applySchema6Bootstrap } from '../app/core/sqlite-gateway/schema-v6-migration';
import { applySchema7Bootstrap } from '../app/core/sqlite-gateway/schema-v7-migration';
import { reportFileDialogOptions } from './report-file-dialog';
import { saveReportFile } from './report-file-save';

let sqlPromise: Promise<SqlJsStatic> | undefined;

test('uses report-specific native save dialog options for Cash Flow and Balance Sheet', () => {
  const cashFlow = reportFileDialogOptions('north-statement.csv', 'CSV', 'Statement of Cash Flows');
  assert.deepEqual(cashFlow, {
    title: 'Save Statement of Cash Flows CSV',
    defaultPath: 'north-statement.csv',
    filters: [{ name: 'Statement of Cash Flows CSV', extensions: ['csv'] }],
  });
  const balanceSheet = reportFileDialogOptions('north-balance.csv', 'CSV', 'Balance Sheet');
  assert.deepEqual(balanceSheet, {
    title: 'Save Balance Sheet CSV',
    defaultPath: 'north-balance.csv',
    filters: [{ name: 'Balance Sheet CSV', extensions: ['csv'] }],
  });
  const legacy = reportFileDialogOptions('north-balance.xlsx', 'XLSX');
  assert.equal(legacy.title, 'Save Balance Sheet XLSX');
  assert.deepEqual(legacy.filters[0].extensions, ['xlsx']);
});

test('saves report bytes atomically, handles cancellation, and cleans failed temporary writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'accounting-report-save-'));
  try {
    const target = path.join(root, 'cash-flow.csv');
    const bytes = new TextEncoder().encode('Report,Statement of Cash Flows\r\n');
    const writes: string[] = [];
    const result = await saveReportFile('cash-flow.csv', bytes, 'CSV', 'Statement of Cash Flows', {
      showSaveDialog: async options => {
        assert.equal(options.title, 'Save Statement of Cash Flows CSV');
        return { canceled: false, filePath: target };
      },
      writeFile: async (filePath, fileBytes, options) => { writes.push(filePath); await writeFile(filePath, fileBytes, options); },
      rename: async (oldPath, newPath) => { await (await import('node:fs/promises')).rename(oldPath, newPath); },
      remove: async (filePath, options) => { await rm(filePath, options); },
      processId: 42,
    });
    assert.equal(result, 'SAVED');
    assert.deepEqual(new Uint8Array(await readFile(target)), bytes);
    assert.equal(writes[0], `${target}.tallystick-42.tmp`);

    let cancelledWrites = 0;
    assert.equal(await saveReportFile('cancelled.csv', bytes, 'CSV', 'Statement of Cash Flows', {
      showSaveDialog: async () => ({ canceled: true }),
      writeFile: async () => { cancelledWrites += 1; },
      rename: async () => undefined,
      remove: async () => undefined,
      processId: 42,
    }), 'CANCELLED');
    assert.equal(cancelledWrites, 0);

    const failedTarget = path.join(root, 'failed.csv');
    const failedTemporary = `${failedTarget}.tallystick-99.tmp`;
    let removed = '';
    await assert.rejects(() => saveReportFile('failed.csv', bytes, 'CSV', 'Statement of Cash Flows', {
      showSaveDialog: async () => ({ canceled: false, filePath: failedTarget }),
      writeFile: async filePath => { await writeFile(filePath, bytes); throw new Error('native write failure'); },
      rename: async () => undefined,
      remove: async filePath => { removed = filePath; await rm(filePath, { force: true }); },
      processId: 99,
    }), /native write failure/);
    assert.equal(removed, failedTemporary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function sql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: file => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file) });
  return sqlPromise;
}

async function databaseBytes(companyId: string, schemaVersion = CURRENT_SQLITE_SCHEMA_VERSION): Promise<Uint8Array> {
  const database = new (await sql()).Database();
  database.run('PRAGMA foreign_keys = ON;');
  if (schemaVersion >= 6 && schemaVersion <= CURRENT_SQLITE_SCHEMA_VERSION) {
    database.run(SQLITE_MIGRATIONS[0]);
    database.run('INSERT INTO schema_version(version) VALUES (0)');
    database.run(SQLITE_MIGRATIONS[1]);
    SQLITE_MIGRATIONS.slice(2).forEach(statement => database.run(statement));
    SQLITE_V3_MIGRATIONS.forEach(statement => database.run(statement));
    SQLITE_V4_MIGRATIONS.forEach(statement => database.run(statement));
    SQLITE_V5_MIGRATIONS.forEach(statement => database.run(statement));
    applySchema6Bootstrap(database);
    database.run('UPDATE schema_version SET version = ?', [6]);
    if (schemaVersion === CURRENT_SQLITE_SCHEMA_VERSION) {
      applySchema7Bootstrap(database);
      database.run('UPDATE schema_version SET version = ?', [CURRENT_SQLITE_SCHEMA_VERSION]);
    }
    database.run(`INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year)
      VALUES (?, ?, 'USD', 1, 'CASH', 2026)`, [companyId, `Company ${companyId}`]);
    database.run(`INSERT INTO company_profile(company_id, legal_name, display_name, created_at, modified_at)
      VALUES (?, ?, ?, ?, ?)`, [companyId, `Company ${companyId}`, `Display ${companyId}`, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
  } else {
    database.run(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (${schemaVersion}); CREATE TABLE company(id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
    database.run('INSERT INTO company(id, name) VALUES (?, ?)', [companyId, `Company ${companyId}`]);
  }
  const bytes = database.export();
  database.close();
  return bytes;
}

async function companyId(bytes: Uint8Array): Promise<string> {
  const database = new (await sql()).Database(bytes);
  const value = String(database.exec('SELECT id FROM company LIMIT 1')[0]?.values[0]?.[0]);
  database.close();
  return value;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'accounting-database-lifecycle-'));
  const activePath = path.join(root, 'active', 'tallystick.sqlite');
  const settingsPath = path.join(root, 'profile', 'database-locations.json');
  const backupDirectory = path.join(root, 'backups');
  const manager = new DatabaseLifecycleManager(await sql(), settingsPath, activePath, () => new Date('2026-08-11T17:04:05.000Z'));
  await manager.setBackupDirectory(backupDirectory);
  return { root, activePath, settingsPath, backupDirectory, manager };
}

test('creates and records a timestamped verified SQLite backup from live bytes', async () => {
  const setup = await fixture();
  try {
    const bytes = await databaseBytes('live-company');
    const result = await setup.manager.backup(bytes);
    assert.match(path.basename(result.path), /^tallystick-2026-08-11-170405\.sqlite$/);
    assert.equal(await companyId(new Uint8Array(await readFile(result.path))), 'live-company');
    const locations = await setup.manager.locations();
    assert.equal(locations.latestVerifiedBackupPath, result.path);
    assert.equal(locations.latestVerifiedBackupAtUtc, '2026-08-11T17:04:05.000Z');
    assert.equal(locations.backupTimeZone, 'UTC');
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('uses the configured UTC default for backup filenames and audit timestamps', async () => {
  const setup = await fixture();
  try {
    const manager = new DatabaseLifecycleManager(
      await sql(), setup.settingsPath, setup.activePath,
      () => new Date('2026-01-15T18:04:05.000Z'),
    );
    const result = await manager.backup(await databaseBytes('winter-company'));
    assert.match(path.basename(result.path), /^tallystick-2026-01-15-180405\.sqlite$/);
    assert.equal(result.completedAtUtc, '2026-01-15T18:04:05.000Z');
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('creates a host-controlled pre-migration backup when no backup folder is configured', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'accounting-unconfigured-migration-'));
  try {
    const settingsPath = path.join(root, 'profile', 'database-locations.json');
    const activePath = path.join(root, 'active', 'tallystick.sqlite');
    const manager = new DatabaseLifecycleManager(await sql(), settingsPath, activePath, () => new Date('2026-08-11T17:04:05.000Z'));
    const source = await databaseBytes('schema-six-unconfigured', 6);
    const result = await manager.backup(source, 'PRE_MIGRATION');
    assert.match(result.path, /profile\/migration-backups\/tallystick-2026-08-11-170405-pre-migration\.sqlite$/);
    assert.equal(await companyId(new Uint8Array(await readFile(result.path))), 'schema-six-unconfigured');
    assert.equal((await manager.locations()).backupDirectory, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('does not allow a failed pre-migration backup to proceed with the live schema-6 bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'accounting-failed-migration-backup-'));
  try {
    const settingsPath = path.join(root, 'profile', 'database-locations.json');
    const activePath = path.join(root, 'active', 'tallystick.sqlite');
    const migrationBackupDirectory = path.join(root, 'profile', 'migration-backups');
    await mkdir(path.dirname(activePath), { recursive: true });
    await mkdir(path.dirname(migrationBackupDirectory), { recursive: true });
    const source = await databaseBytes('schema-six-backup-failure', 6);
    await writeFile(activePath, source);
    // A file at the host-controlled backup path makes mkdir fail before any
    // migration can be activated. This simulates an injected disk/path error.
    await writeFile(migrationBackupDirectory, 'not a directory');
    const manager = new DatabaseLifecycleManager(await sql(), settingsPath, activePath, () => new Date('2026-08-11T17:04:05.000Z'));

    await assert.rejects(() => manager.backup(source, 'PRE_MIGRATION'), /EEXIST|ENOTDIR|not a directory/i);
    assert.deepEqual([...await readFile(activePath)], [...source]);
    assert.equal(await companyId(new Uint8Array(await readFile(activePath))), 'schema-six-backup-failure');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('accepts the current schema and rejects a future unsupported schema', async () => {
  const setup = await fixture();
  try {
    await setup.manager.backup(await databaseBytes('pre-migration-schema', 5));
    await setup.manager.backup(await databaseBytes('current-schema', CURRENT_SQLITE_SCHEMA_VERSION));
    await assert.rejects(
      async () => setup.manager.backup(await databaseBytes('future-schema', CURRENT_SQLITE_SCHEMA_VERSION + 1)),
      new RegExp(`Unsupported SQLite schema version: ${CURRENT_SQLITE_SCHEMA_VERSION + 1}`),
    );
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('rejects an incomplete schema-6 profile before writing a backup', async () => {
  const setup = await fixture();
  try {
    const database = new (await sql()).Database(await databaseBytes('incomplete'));
    database.run('DELETE FROM company_profile');
    const bytes = database.export();
    database.close();
    await assert.rejects(() => setup.manager.backup(bytes), /company_profile|valid company profile/);
    assert.deepEqual(await readdir(setup.backupDirectory), []);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('relocates current bytes only after a verified safety backup and persists the new path', async () => {
  const setup = await fixture();
  try {
    const bytes = await databaseBytes('relocated-company');
    const target = path.join(setup.root, 'new-books', 'company-books.sqlite');
    const result = await setup.manager.relocate(bytes, target);
    assert.equal(result.path, target);
    assert.ok(result.safetyBackupPath);
    assert.equal(await companyId(new Uint8Array(await readFile(target))), 'relocated-company');
    assert.equal((await setup.manager.locations()).currentDatabasePath, target);
    assert.equal(await companyId(new Uint8Array(await readFile(result.safetyBackupPath!))), 'relocated-company');
    const reopenedManager = new DatabaseLifecycleManager(await sql(), setup.settingsPath, setup.activePath);
    assert.equal((await reopenedManager.locations()).currentDatabasePath, target);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('restores a validated copy, preserves the selected backup, and safety-backs up current books', async () => {
  const setup = await fixture();
  try {
    const current = await databaseBytes('current-company');
    const restored = await databaseBytes('restored-company');
    await mkdir(path.dirname(setup.activePath), { recursive: true });
    await writeFile(setup.activePath, current);
    const selectedBackup = path.join(setup.backupDirectory, 'selected.sqlite');
    await writeFile(selectedBackup, restored);
    const selectedBefore = await readFile(selectedBackup);

    const result = await setup.manager.restore(current, selectedBackup);

    assert.equal(await companyId(new Uint8Array(await readFile(setup.activePath))), 'restored-company');
    assert.deepEqual(await readFile(selectedBackup), selectedBefore);
    assert.equal(await companyId(new Uint8Array(await readFile(result.safetyBackupPath!))), 'current-company');
    assert.equal((await setup.manager.locations()).currentDatabasePath, setup.activePath);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('rejects a corrupt restore before backup or activation and preserves active books and settings', async () => {
  const setup = await fixture();
  try {
    const current = await databaseBytes('safe-company');
    await mkdir(path.dirname(setup.activePath), { recursive: true });
    await writeFile(setup.activePath, current);
    const corrupt = path.join(setup.backupDirectory, 'corrupt.sqlite');
    await writeFile(corrupt, 'not a sqlite database');
    const settingsBefore = await readFile(setup.settingsPath);

    await assert.rejects(() => setup.manager.restore(current, corrupt), /validate|SQLite|database/i);

    assert.equal(await companyId(new Uint8Array(await readFile(setup.activePath))), 'safe-company');
    assert.deepEqual(await readFile(setup.settingsPath), settingsBefore);
    const files = await readdir(setup.backupDirectory);
    assert.deepEqual(files, ['corrupt.sqlite']);
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});

test('rejects every missing schema-7 table before restore backup or activation', async () => {
  const requiredTables = [
    'company_profile', 'financial_account', 'chart_account', 'import_batch',
    'transaction_record', 'posting_split', 'audit_event', 'transfer_match',
    'transaction_rule', 'tax_year_settings',
    'financial_account_cash_flow_classification', 'chart_account_cash_flow_classification',
  ];
  for (const table of requiredTables) {
    const setup = await fixture();
    try {
      const current = await databaseBytes(`safe-${table}`);
      await mkdir(path.dirname(setup.activePath), { recursive: true });
      await writeFile(setup.activePath, current);
      const broken = new (await sql()).Database(current);
      broken.run(`DROP TABLE ${table}`);
      const selected = path.join(setup.backupDirectory, `${table}.sqlite`);
      await writeFile(selected, broken.export());
      broken.close();

      await assert.rejects(() => setup.manager.restore(current, selected), /Schema 7 database is missing required table/);
      assert.equal(await companyId(new Uint8Array(await readFile(setup.activePath))), `safe-${table}`);
      assert.deepEqual(await readdir(setup.backupDirectory), [`${table}.sqlite`]);
    } finally { await rm(setup.root, { recursive: true, force: true }); }
  }
});

test('rejects damaged schema-7 columns, indexes, constraints, and foreign keys before activation', async () => {
  const cases: Array<{ name: string; damage: (database: import('sql.js').Database) => void; message: RegExp }> = [
    {
      name: 'duplicate-version',
      damage: database => database.run('INSERT INTO schema_version(version) VALUES (7)'),
      message: /schema_version must contain exactly one row/,
    },
    {
      name: 'column',
      damage: database => {
        database.run('ALTER TABLE tax_year_settings RENAME TO tax_year_settings_damaged');
        database.run(`CREATE TABLE tax_year_settings (
          tax_year INTEGER PRIMARY KEY, federal_income_tax_account_ids_json TEXT NOT NULL,
          state_local_income_tax_account_ids_json TEXT NOT NULL, include_federal_income_tax INTEGER NOT NULL,
          include_state_local_income_tax INTEGER NOT NULL, confirmed_at_utc TEXT
        )`);
        database.run('DROP TABLE tax_year_settings_damaged');
      },
      message: /missing required column tax_year_settings\.accountant_note/,
    },
    {
      name: 'index',
      damage: database => database.run('DROP INDEX idx_transaction_state_date_account'),
      message: /missing required index idx_transaction_state_date_account/,
    },
    {
      name: 'constraint',
      damage: database => {
        database.run('DROP INDEX idx_financial_account_cash_flow_classification');
        database.run('ALTER TABLE financial_account_cash_flow_classification RENAME TO damaged_classification');
        database.run(`CREATE TABLE financial_account_cash_flow_classification (
          financial_account_id TEXT PRIMARY KEY REFERENCES financial_account(id) ON DELETE CASCADE,
          cash_flow_cash_role TEXT, cash_flow_treatment TEXT NOT NULL,
          cash_flow_status TEXT NOT NULL, cash_flow_source TEXT NOT NULL,
          cash_flow_rationale TEXT NOT NULL, cash_flow_modified_at_utc TEXT
        )`);
        database.run('DROP TABLE damaged_classification');
        database.run('CREATE INDEX idx_financial_account_cash_flow_classification ON financial_account_cash_flow_classification(cash_flow_cash_role, cash_flow_treatment, cash_flow_status)');
      },
      message: /requires financial_account_cash_flow_classification\.cash_flow_cash_role to be NOT NULL/,
    },
    {
      name: 'foreign key',
      damage: database => {
        database.run('ALTER TABLE company_profile RENAME TO damaged_profile');
        database.run(`CREATE TABLE company_profile (
          company_id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, display_name TEXT NOT NULL,
          doing_business_as TEXT, entity_type TEXT, address_line_1 TEXT, address_line_2 TEXT,
          locality TEXT, region TEXT, postal_code TEXT, country_code TEXT, phone TEXT, email TEXT,
          website TEXT, tax_identifier TEXT, created_at TEXT NOT NULL, modified_at TEXT NOT NULL
        )`);
        database.run('INSERT INTO company_profile SELECT * FROM damaged_profile');
        database.run('DROP TABLE damaged_profile');
      },
      message: /missing foreign key company_profile\.company_id/,
    },
  ];
  for (const item of cases) {
    const setup = await fixture();
    try {
      const current = await databaseBytes(`safe-damaged-${item.name}`);
      await mkdir(path.dirname(setup.activePath), { recursive: true });
      await writeFile(setup.activePath, current);
      const broken = new (await sql()).Database(current);
      item.damage(broken);
      const selected = path.join(setup.backupDirectory, `${item.name}.sqlite`);
      await writeFile(selected, broken.export());
      broken.close();
      await assert.rejects(() => setup.manager.restore(current, selected), item.message);
      assert.equal(await companyId(new Uint8Array(await readFile(setup.activePath))), `safe-damaged-${item.name}`);
      assert.deepEqual(await readdir(setup.backupDirectory), [`${item.name}.sqlite`]);
    } finally { await rm(setup.root, { recursive: true, force: true }); }
  }
});

test('does not create a migration backup or activate malformed schema-6 input', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'accounting-migration-failure-'));
  try {
    const settingsPath = path.join(root, 'profile', 'database-locations.json');
    const activePath = path.join(root, 'active', 'tallystick.sqlite');
    const manager = new DatabaseLifecycleManager(await sql(), settingsPath, activePath, () => new Date('2026-08-11T17:04:05.000Z'));
    const malformed = new (await sql()).Database(await databaseBytes('migration-failure', 6));
    malformed.run('DELETE FROM company_profile');
    await assert.rejects(() => manager.backup(malformed.export(), 'PRE_MIGRATION'), /valid company profile/);
    await assert.rejects(() => readFile(path.join(root, 'profile', 'migration-backups')), /ENOENT/);
    malformed.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses to place the live database inside the backup folder', async () => {
  const setup = await fixture();
  try {
    const bytes = await databaseBytes('company');
    await assert.rejects(
      () => setup.manager.relocate(bytes, path.join(setup.backupDirectory, 'live.sqlite')),
      /inside the backup folder/,
    );
  } finally { await rm(setup.root, { recursive: true, force: true }); }
});
