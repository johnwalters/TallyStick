import { InjectionToken } from '@angular/core';
import { DatabaseFileOperationResult, DatabaseLocations } from '../application-interface/accounting.application';

interface DatabaseLifecycleBridge {
  getLocations(): Promise<Omit<DatabaseLocations, 'desktopAvailable'>>;
  chooseBackupDirectory(): Promise<Omit<DatabaseLocations, 'desktopAvailable'> | undefined>;
  backupNow(): Promise<DatabaseFileOperationResult>;
  relocateCurrentDatabase(): Promise<DatabaseFileOperationResult | undefined>;
  restoreDatabaseBackup(): Promise<DatabaseFileOperationResult | undefined>;
}

export interface DatabaseLifecycleGateway {
  getLocations(): Promise<DatabaseLocations>;
  chooseBackupDirectory(): Promise<DatabaseLocations | undefined>;
  backupNow(): Promise<DatabaseFileOperationResult>;
  relocateCurrentDatabase(): Promise<DatabaseFileOperationResult | undefined>;
  restoreDatabaseBackup(): Promise<DatabaseFileOperationResult | undefined>;
}

export class DesktopDatabaseLifecycleGateway implements DatabaseLifecycleGateway {
  async getLocations(): Promise<DatabaseLocations> {
    const bridge = this.bridge();
    if (!bridge) return { currentDatabasePath: '', desktopAvailable: false };
    return { ...(await bridge.getLocations()), desktopAvailable: true };
  }

  async chooseBackupDirectory(): Promise<DatabaseLocations | undefined> {
    const bridge = this.requireBridge();
    const result = await bridge.chooseBackupDirectory();
    return result ? { ...result, desktopAvailable: true } : undefined;
  }

  async backupNow(): Promise<DatabaseFileOperationResult> {
    return this.requireBridge().backupNow();
  }

  async relocateCurrentDatabase(): Promise<DatabaseFileOperationResult | undefined> {
    return this.requireBridge().relocateCurrentDatabase();
  }

  async restoreDatabaseBackup(): Promise<DatabaseFileOperationResult | undefined> {
    return this.requireBridge().restoreDatabaseBackup();
  }

  private requireBridge() {
    const bridge = this.bridge();
    if (!bridge) throw new Error('Database backup and restore require the desktop application.');
    return bridge;
  }

  private bridge(): DatabaseLifecycleBridge | undefined {
    return (globalThis as { localAccounting?: { databaseLifecycle?: DatabaseLifecycleBridge } }).localAccounting?.databaseLifecycle;
  }
}

export const DATABASE_LIFECYCLE_GATEWAY = new InjectionToken<DatabaseLifecycleGateway>('DATABASE_LIFECYCLE_GATEWAY', {
  providedIn: 'root', factory: () => new DesktopDatabaseLifecycleGateway(),
});
