export interface LocalAccountingBridge {
  chooseAndReadFile(): Promise<{ fileName: string; content: Uint8Array } | undefined>;
  sqlite: {
    open(databasePath?: string): Promise<void>;
    execute(sql: string, params?: Array<string | number | null>): Promise<Array<Record<string, unknown>>>;
    export(databasePath: string): Promise<void>;
    readSync(): Uint8Array | undefined;
    writeSync(bytes: Uint8Array): void;
    close(): Promise<void>;
  };
  databaseLifecycle: {
    getLocations(): Promise<{
      currentDatabasePath: string;
      backupDirectory?: string;
      latestVerifiedBackupPath?: string;
      latestVerifiedBackupAtUtc?: string;
      backupTimeZone?: string;
    }>;
    chooseBackupDirectory(): Promise<{ currentDatabasePath: string; backupDirectory?: string; latestVerifiedBackupPath?: string; latestVerifiedBackupAtUtc?: string; backupTimeZone?: string } | undefined>;
    backupNow(): Promise<{ operation: 'BACKUP'; path: string; completedAtUtc: string; restartRequired: boolean }>;
    relocateCurrentDatabase(): Promise<{ operation: 'RELOCATE'; path: string; completedAtUtc: string; safetyBackupPath?: string; restartRequired: boolean } | undefined>;
    restoreDatabaseBackup(): Promise<{ operation: 'RESTORE'; path: string; completedAtUtc: string; safetyBackupPath?: string; restartRequired: boolean } | undefined>;
  };
  reportFiles: {
    save(suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML'): Promise<'SAVED' | 'CANCELLED'>;
  };
  reportPreview: { open(title: string, html: string): Promise<string>; };
}

declare global {
  interface Window {
    localAccounting?: LocalAccountingBridge;
  }
}
