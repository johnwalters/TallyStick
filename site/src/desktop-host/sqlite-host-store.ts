import { Database, SqlJsStatic } from 'sql.js';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../shared/schema-version';
import { validateSchema7Database } from '../app/core/sqlite-gateway/schema-v7-migration';
import { SCHEMA_8_VERSION, validateSchema8Database } from '../app/core/sqlite-gateway/schema-v8-migration';

/**
 * Owns the Electron process's authoritative in-memory SQLite image.
 * Renderer writes must update both the disk file and this image so a page
 * reload cannot resurrect the database state captured at application launch.
 */
export class SqliteHostStore {
  private database?: Database;
  private selectedPath?: string;

  constructor(private readonly sql: SqlJsStatic) {}

  open(bytes: Uint8Array | undefined, selectedPath: string): void {
    const next = this.createDatabase(bytes);
    this.swapDatabase(next);
    this.selectedPath = selectedPath;
  }

  persistAndReplace(bytes: Uint8Array, persist: (validatedBytes: Uint8Array) => void): void {
    const next = this.createDatabase(bytes);
    try {
      persist(bytes);
    } catch (error) {
      next.close();
      throw error;
    }
    this.swapDatabase(next);
  }

  requireDatabase(): Database {
    if (!this.database) throw new Error('SQLite database is not open.');
    return this.database;
  }

  requirePath(): string {
    if (!this.selectedPath) throw new Error('No database path is available.');
    return this.selectedPath;
  }

  exportBytes(): Uint8Array | undefined {
    return this.database?.export();
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.selectedPath = undefined;
  }

  private createDatabase(bytes?: Uint8Array): Database {
    const database = bytes ? new this.sql.Database(bytes) : new this.sql.Database();
    database.run('PRAGMA foreign_keys = ON;');
    const integrity = database.exec('PRAGMA integrity_check');
    const result = String(integrity[0]?.values[0]?.[0] ?? 'unknown');
    if (result.toLowerCase() !== 'ok') {
      database.close();
      throw new Error(`SQLite integrity check failed: ${result}.`);
    }
    const versionTable = database.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`);
    if (versionTable[0]?.values.length) {
      const versionRows = database.exec('SELECT version FROM schema_version')[0]?.values ?? [];
      if (versionRows.length !== 1) {
        database.close();
        throw new Error(`SQLite schema_version must contain exactly one row; found ${versionRows.length}.`);
      }
      const version = Number(versionRows[0]?.[0]);
      if (!Number.isInteger(version) || version < 1 || version > CURRENT_SQLITE_SCHEMA_VERSION) {
        database.close();
        throw new Error(`Unsupported SQLite schema version: ${version || 'missing'}.`);
      }
      const foreignKeys = database.exec('PRAGMA foreign_key_check');
      if (foreignKeys.some(item => item.values.length)) {
        database.close();
        throw new Error('SQLite foreign-key check failed.');
      }
      if (version === 7) validateSchema7Database(database);
      if (version === SCHEMA_8_VERSION) validateSchema8Database(database);
    }
    return database;
  }

  private swapDatabase(next: Database): void {
    const previous = this.database;
    this.database = next;
    previous?.close();
  }
}
