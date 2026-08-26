import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Database, SqlJsStatic } from 'sql.js';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../shared/schema-version';
import { validateSchema6Database, validateSchema7Database } from '../app/core/sqlite-gateway/schema-v7-migration';

export const DEFAULT_BACKUP_TIME_ZONE = 'UTC';

export interface DatabaseLocationSettings {
  version: 1;
  currentDatabasePath?: string;
  backupDirectory?: string;
  latestVerifiedBackupPath?: string;
  latestVerifiedBackupAtUtc?: string;
  backupTimeZone?: string;
}

export interface DatabaseLocations {
  currentDatabasePath: string;
  backupDirectory?: string;
  latestVerifiedBackupPath?: string;
  latestVerifiedBackupAtUtc?: string;
  backupTimeZone: string;
}

export interface DatabaseFileOperationResult {
  operation: 'BACKUP' | 'RELOCATE' | 'RESTORE';
  path: string;
  completedAtUtc: string;
  safetyBackupPath?: string;
  restartRequired: boolean;
}

export class DatabaseLifecycleManager {
  constructor(
    private readonly sql: SqlJsStatic,
    private readonly settingsPath: string,
    private readonly defaultDatabasePath: string,
    private readonly now: () => Date = () => new Date(),
    private readonly defaultBackupTimeZone = DEFAULT_BACKUP_TIME_ZONE,
  ) {}

  async locations(): Promise<DatabaseLocations> {
    const settings = await this.readSettings();
    return {
      currentDatabasePath: settings.currentDatabasePath || this.defaultDatabasePath,
      backupDirectory: settings.backupDirectory,
      latestVerifiedBackupPath: settings.latestVerifiedBackupPath,
      latestVerifiedBackupAtUtc: settings.latestVerifiedBackupAtUtc,
      backupTimeZone: settings.backupTimeZone || this.defaultBackupTimeZone,
    };
  }

  async setBackupDirectory(directory: string): Promise<DatabaseLocations> {
    const resolved = path.resolve(directory);
    await fs.mkdir(resolved, { recursive: true });
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('The selected backup location is not a directory.');
    const settings = await this.readSettings();
    settings.backupDirectory = resolved;
    await this.writeSettings(settings);
    return this.locations();
  }

  async backup(databaseBytes: Uint8Array, reason: 'MANUAL' | 'PRE_MIGRATION' | 'PRE_RELOCATE' | 'PRE_RESTORE' = 'MANUAL'): Promise<DatabaseFileOperationResult> {
    const settings = await this.readSettings();
    // Schema-6 migration happens before the renderer can display settings, so
    // it must never depend on a user-selected backup directory. Keep this
    // safety copy under the host-controlled profile directory instead.
    const backupDirectory = settings.backupDirectory
      ?? (reason === 'PRE_MIGRATION' ? this.migrationBackupDirectory() : undefined);
    if (!backupDirectory) throw new Error('Choose a backup folder before creating a backup.');
    this.validateDatabase(databaseBytes);
    await fs.mkdir(backupDirectory, { recursive: true });
    const targetPath = await this.availableBackupPath(backupDirectory, reason, settings.backupTimeZone || this.defaultBackupTimeZone);
    await this.writeVerifiedDatabase(targetPath, databaseBytes);
    const completedAtUtc = this.now().toISOString();
    settings.latestVerifiedBackupPath = targetPath;
    settings.latestVerifiedBackupAtUtc = completedAtUtc;
    await this.writeSettings(settings);
    return { operation: 'BACKUP', path: targetPath, completedAtUtc, restartRequired: false };
  }

  async relocate(databaseBytes: Uint8Array, targetPath: string): Promise<DatabaseFileOperationResult> {
    const locations = await this.locations();
    this.requireConfiguredBackupDirectory(locations);
    const resolvedTarget = this.sqlitePath(targetPath);
    this.ensureOutsideBackupDirectory(resolvedTarget, locations.backupDirectory!);
    if (resolvedTarget === path.resolve(locations.currentDatabasePath)) throw new Error('The selected location is already the current database.');
    const safety = await this.backup(databaseBytes, 'PRE_RELOCATE');
    await this.writeVerifiedDatabase(resolvedTarget, databaseBytes);
    const settings = await this.readSettings();
    settings.currentDatabasePath = resolvedTarget;
    await this.writeSettings(settings);
    return {
      operation: 'RELOCATE', path: resolvedTarget, completedAtUtc: this.now().toISOString(),
      safetyBackupPath: safety.path, restartRequired: true,
    };
  }

  async restore(currentDatabaseBytes: Uint8Array, selectedBackupPath: string): Promise<DatabaseFileOperationResult> {
    const locations = await this.locations();
    this.requireConfiguredBackupDirectory(locations);
    const sourcePath = path.resolve(selectedBackupPath);
    const sourceBytes = new Uint8Array(await fs.readFile(sourcePath));
    this.validateDatabase(sourceBytes);
    const safety = await this.backup(currentDatabaseBytes, 'PRE_RESTORE');
    await this.writeVerifiedDatabase(locations.currentDatabasePath, sourceBytes);
    return {
      operation: 'RESTORE', path: locations.currentDatabasePath, completedAtUtc: this.now().toISOString(),
      safetyBackupPath: safety.path, restartRequired: true,
    };
  }

  schemaVersion(bytes: Uint8Array): number {
    let database: Database | undefined;
    try {
      database = new this.sql.Database(bytes);
      const rows = database.exec('SELECT version FROM schema_version')[0]?.values ?? [];
      if (rows.length !== 1) throw new Error(`SQLite schema_version must contain exactly one row; found ${rows.length}.`);
      return Number(rows[0]?.[0]);
    } finally {
      database?.close();
    }
  }

  validateDatabase(bytes: Uint8Array): void {
    let database: Database | undefined;
    try {
      database = new this.sql.Database(bytes);
      database.run('PRAGMA foreign_keys = ON;');
      const integrity = String(database.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] ?? 'unknown');
      if (integrity.toLowerCase() !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}.`);
      const foreignKeys = database.exec('PRAGMA foreign_key_check');
      if (foreignKeys.some(result => result.values.length)) throw new Error('SQLite foreign-key check failed.');
      const versionRows = database.exec('SELECT version FROM schema_version')[0]?.values ?? [];
      if (versionRows.length !== 1) throw new Error(`SQLite schema_version must contain exactly one row; found ${versionRows.length}.`);
      const schemaVersion = Number(versionRows[0]?.[0]);
      if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > CURRENT_SQLITE_SCHEMA_VERSION) throw new Error(`Unsupported SQLite schema version: ${schemaVersion || 'missing'}.`);
      const companyId = database.exec('SELECT id FROM company LIMIT 1')[0]?.values[0]?.[0];
      if (!companyId) throw new Error('The SQLite database does not contain a company record.');
      if (schemaVersion === 6) {
        const profileTable = database.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'company_profile'`)[0]?.values ?? [];
        if (profileTable.length !== 1) throw new Error('The schema-6 SQLite database does not contain a valid company profile.');
        const profile = database.exec('SELECT company_id, legal_name, display_name FROM company_profile LIMIT 2')[0]?.values ?? [];
        if (profile.length !== 1 || profile[0][0] !== companyId || !String(profile[0][1] ?? '').trim() || !String(profile[0][2] ?? '').trim()) {
          throw new Error('The schema-6 SQLite database does not contain a valid company profile.');
        }
        if (schemaVersion === 6) validateSchema6Database(database);
      }
      if (schemaVersion >= 7) {
        validateSchema7Database(database);
      }
    } catch (error) {
      if (error instanceof Error && /SQLite|schema|company/.test(error.message)) throw error;
      throw new Error(`Unable to validate the SQLite database: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      database?.close();
    }
  }

  private async writeVerifiedDatabase(targetPath: string, bytes: Uint8Array): Promise<void> {
    const resolvedTarget = this.sqlitePath(targetPath);
    await fs.mkdir(path.dirname(resolvedTarget), { recursive: true });
    const temporaryPath = path.join(path.dirname(resolvedTarget), `.${path.basename(resolvedTarget)}.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(temporaryPath, bytes, { flag: 'wx' });
      this.validateDatabase(new Uint8Array(await fs.readFile(temporaryPath)));
      await fs.rename(temporaryPath, resolvedTarget);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async availableBackupPath(directory: string, reason: 'MANUAL' | 'PRE_MIGRATION' | 'PRE_RELOCATE' | 'PRE_RESTORE', timeZone: string): Promise<string> {
    const stamp = this.backupStamp(this.now(), timeZone);
    const suffix = reason === 'MANUAL' ? '' : reason === 'PRE_MIGRATION' ? '-pre-migration' : reason === 'PRE_RELOCATE' ? '-pre-relocate' : '-pre-restore';
    for (let counter = 0; counter < 1000; counter += 1) {
      const collision = counter ? `-${counter + 1}` : '';
      const candidate = path.join(directory, `tallystick-${stamp}${suffix}${collision}.sqlite`);
      try { await fs.access(candidate); } catch { return candidate; }
    }
    throw new Error('Unable to create a unique backup file name.');
  }

  private backupStamp(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    const year = value('year');
    const month = value('month');
    const day = value('day');
    const hour = value('hour');
    const minute = value('minute');
    const second = value('second');
    if (![year, month, day, hour, minute, second].every(Boolean)) throw new Error(`Unable to format a backup timestamp for ${timeZone}.`);
    return `${year}-${month}-${day}-${hour}${minute}${second}`;
  }

  private async readSettings(): Promise<DatabaseLocationSettings> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf8')) as Partial<DatabaseLocationSettings>;
      if (parsed.version !== 1) throw new Error('Unsupported database settings version.');
      return { version: 1, ...parsed, backupTimeZone: parsed.backupTimeZone || this.defaultBackupTimeZone };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, backupTimeZone: this.defaultBackupTimeZone };
      throw error;
    }
  }

  private async writeSettings(settings: DatabaseLocationSettings): Promise<void> {
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    const temporaryPath = `${this.settingsPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' });
      await fs.rename(temporaryPath, this.settingsPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private sqlitePath(candidate: string): string {
    const resolved = path.resolve(candidate);
    return resolved.toLowerCase().endsWith('.sqlite') ? resolved : `${resolved}.sqlite`;
  }

  private requireConfiguredBackupDirectory(locations: DatabaseLocations): void {
    if (!locations.backupDirectory) throw new Error('Choose a backup folder before changing or restoring the current database.');
  }

  private migrationBackupDirectory(): string {
    return path.join(path.dirname(this.settingsPath), 'migration-backups');
  }

  private ensureOutsideBackupDirectory(candidate: string, backupDirectory: string): void {
    const relative = path.relative(path.resolve(backupDirectory), candidate);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('The live database cannot be stored inside the backup folder.');
    }
  }
}
