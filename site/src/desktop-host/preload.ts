import { contextBridge, ipcRenderer } from 'electron';
import { LocalAccountingBridge } from './bridge/local-bridge.types';

type SyncWriteResult = { ok: true } | { ok: false; error: string };

const bridge: LocalAccountingBridge = {
  chooseAndReadFile: () => ipcRenderer.invoke('file:choose-and-read'),
  sqlite: {
    open: (databasePath?: string) => ipcRenderer.invoke('sqlite:open', databasePath),
    execute: (sql, params = []) => ipcRenderer.invoke('sqlite:execute', sql, params),
    export: (databasePath: string) => ipcRenderer.invoke('sqlite:export', databasePath),
    readSync: () => ipcRenderer.sendSync('sqlite:read-sync') as Uint8Array | undefined,
    writeSync: (bytes: Uint8Array) => {
      const result = ipcRenderer.sendSync('sqlite:write-sync', bytes) as SyncWriteResult;
      if (!result.ok) throw new Error(result.error);
    },
    close: () => ipcRenderer.invoke('sqlite:close'),
  },
  databaseLifecycle: {
    getLocations: () => ipcRenderer.invoke('database-lifecycle:get-locations'),
    chooseBackupDirectory: () => ipcRenderer.invoke('database-lifecycle:choose-backup-directory'),
    backupNow: () => ipcRenderer.invoke('database-lifecycle:backup-now'),
    relocateCurrentDatabase: () => ipcRenderer.invoke('database-lifecycle:relocate'),
    restoreDatabaseBackup: () => ipcRenderer.invoke('database-lifecycle:restore'),
  },
  reportFiles: {
    save: (suggestedFileName, bytes, fileType) => ipcRenderer.invoke('report-file:save', suggestedFileName, bytes, fileType),
  },
  reportPreview: { open: (title, html) => ipcRenderer.invoke('report-preview:open', title, html) },
};

contextBridge.exposeInMainWorld('localAccounting', bridge);
