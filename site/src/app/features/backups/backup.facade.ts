import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication, BackupValidationReport, DatabaseFileOperationResult, DatabaseLocations } from '../../core/application-interface/accounting.application';

@Injectable({ providedIn: 'root' })
export class BackupFacade {
  readonly lastPayload = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly lastVerification = signal<{ valid: boolean; reason?: string } | undefined>(undefined);
  readonly validation = signal<BackupValidationReport | undefined>(undefined);
  readonly locations = signal<DatabaseLocations>({ currentDatabasePath: '', desktopAvailable: false });
  readonly lastOperation = signal<DatabaseFileOperationResult | undefined>(undefined);
  readonly busy = signal(false);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  exportAll(): string | undefined {
    try {
      this.error.set(undefined);
      const payload = this.application.exportAllData();
      this.lastPayload.set(payload);
      return payload;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to export data.');
      return undefined;
    }
  }

  restore(payload: string): boolean {
    try {
      this.error.set(undefined);
      this.application.importAllData(payload);
      return true;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to restore data.');
      return false;
    }
  }

  verify(bundle: string): boolean {
    try {
      this.error.set(undefined);
      const result = this.application.verifyBackupBundle(bundle);
      this.lastVerification.set(result);
      return result.valid;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to verify backup.');
      return false;
    }
  }

  validate(bundle: string): BackupValidationReport | undefined {
    try { this.error.set(undefined); const result = this.application.validateBackupBundle(bundle); this.validation.set(result); return result; }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Unable to validate backup.'); return undefined; }
  }

  async loadLocations(): Promise<DatabaseLocations> {
    try {
      this.error.set(undefined);
      const locations = await this.application.getDatabaseLocations();
      this.locations.set(locations);
      return locations;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to read database locations.');
      return this.locations();
    }
  }

  async chooseBackupDirectory(): Promise<DatabaseLocations | undefined> {
    return this.run(async () => {
      const locations = await this.application.chooseBackupDirectory();
      if (locations) this.locations.set(locations);
      return locations;
    });
  }

  async backupNow(): Promise<DatabaseFileOperationResult | undefined> {
    return this.runOperation(() => this.application.backupDatabaseNow());
  }

  async relocateCurrentDatabase(): Promise<DatabaseFileOperationResult | undefined> {
    return this.runOperation(() => this.application.relocateCurrentDatabase());
  }

  async restoreDatabaseBackup(): Promise<DatabaseFileOperationResult | undefined> {
    return this.runOperation(() => this.application.restoreDatabaseBackup());
  }

  private async runOperation(operation: () => Promise<DatabaseFileOperationResult | undefined>): Promise<DatabaseFileOperationResult | undefined> {
    return this.run(async () => {
      const result = await operation();
      if (result) {
        this.lastOperation.set(result);
        await this.loadLocations();
      }
      return result;
    });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    this.error.set(undefined);
    try { return await operation(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Database operation failed.'); return undefined; }
    finally { this.busy.set(false); }
  }
}
