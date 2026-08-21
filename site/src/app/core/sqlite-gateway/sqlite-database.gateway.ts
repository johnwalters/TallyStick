import { Injectable } from '@angular/core';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { CURRENT_SCHEMA_VERSION, SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS, SQLITE_V5_MIGRATIONS } from './schema';

@Injectable()
export class SqliteDatabaseGateway {
  private database?: Database;
  private sql?: SqlJsStatic;

  async open(bytes?: Uint8Array): Promise<void> {
    this.sql ??= await initSqlJs({ locateFile: file => `assets/${file}` });
    this.database?.close();
    const hostBytes = bytes ?? this.readHostBytes();
    this.database = hostBytes ? new this.sql.Database(hostBytes) : new this.sql.Database();
    this.database.run('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.persistHostSync();
  }

  execute(sql: string, params: Array<string | number | bigint | null> = []): Array<Record<string, unknown>> {
    if (!this.database) throw new Error('SQLite database is not open.');
    const statement = this.database.prepare(sql);
    try {
      statement.bind(params.map(value => typeof value === 'bigint' ? value.toString() : value));
      const rows: Array<Record<string, unknown>> = [];
      while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      statement.free();
    }
  }

  transaction(work: () => void): void {
    if (!this.database) throw new Error('SQLite database is not open.');
    this.database.run('BEGIN');
    try {
      work();
      this.database.run('COMMIT');
      // sql.js export finalizes an active transaction, so export only after
      // COMMIT. A host-write failure is surfaced to the caller; the database
      // transaction itself has already committed and can be retried safely.
      this.persistHostSync();
    } catch (error) {
      try { this.database.run('ROLLBACK'); } catch { /* preserve the original native/bridge failure */ }
      throw error;
    }
  }

  exportBytes(): Uint8Array {
    if (!this.database) throw new Error('SQLite database is not open.');
    return this.database.export();
  }

  integrityCheck(): { valid: boolean; message: string } {
    const result = this.execute('PRAGMA integrity_check');
    const message = String(result[0]?.['integrity_check'] ?? 'unknown');
    return { valid: message.toLowerCase() === 'ok', message };
  }

  foreignKeyCheck(): { valid: boolean; violations: Array<Record<string, unknown>> } {
    const violations = this.execute('PRAGMA foreign_key_check');
    return { valid: violations.length === 0, violations };
  }

  schemaVersion(): number {
    const result = this.execute('SELECT version FROM schema_version LIMIT 1');
    return Number(result[0]?.['version'] ?? 0);
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
  }

  private readHostBytes(): Uint8Array | undefined {
    const bridge = (globalThis as { localAccounting?: { sqlite?: { readSync?: () => Uint8Array | undefined } } }).localAccounting;
    return bridge?.sqlite?.readSync?.();
  }

  private persistHostSync(): void {
    if (!this.database) return;
    const bridge = (globalThis as { localAccounting?: { sqlite?: { writeSync?: (bytes: Uint8Array) => void } } }).localAccounting;
    bridge?.sqlite?.writeSync?.(this.database.export());
  }

  private migrate(): void {
    if (!this.database) return;
    this.database.run(SQLITE_MIGRATIONS[0]);
    const versionRow = this.database.exec('SELECT version FROM schema_version LIMIT 1');
    const current = versionRow[0]?.values[0]?.[0] as number | undefined;
    if (current === undefined) this.database.run('INSERT INTO schema_version(version) VALUES (0)');
    const version = current ?? 0;
    if (version < CURRENT_SCHEMA_VERSION) {
      this.database.run('BEGIN');
      try {
        // Migration 1 creates the base tables. Migration 2 adds the fields
        // required by the application model. Keeping these phases explicit
        // makes reopening an already-migrated file idempotent.
        if (version < 1) this.database.run(SQLITE_MIGRATIONS[1]);
        if (version < 2) SQLITE_MIGRATIONS.slice(2).forEach(sql => this.database!.run(sql));
        if (version < 3) SQLITE_V3_MIGRATIONS.forEach(sql => this.database!.run(sql));
        if (version < 4) SQLITE_V4_MIGRATIONS.forEach(sql => this.database!.run(sql));
        if (version < 5) SQLITE_V5_MIGRATIONS.forEach(sql => this.database!.run(sql));
        this.database.run('UPDATE schema_version SET version = ?', [CURRENT_SCHEMA_VERSION]);
        this.database.run('COMMIT');
      } catch (error) {
        this.database.run('ROLLBACK');
        throw error;
      }
    }
    this.database.run('PRAGMA foreign_keys = ON;');
  }
}
