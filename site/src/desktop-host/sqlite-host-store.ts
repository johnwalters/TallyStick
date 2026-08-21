import { Database, SqlJsStatic } from 'sql.js';

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
    return database;
  }

  private swapDatabase(next: Database): void {
    const previous = this.database;
    this.database = next;
    previous?.close();
  }
}
