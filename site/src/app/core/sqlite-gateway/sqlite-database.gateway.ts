import { Injectable } from '@angular/core';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { CURRENT_SCHEMA_VERSION, SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS, SQLITE_V5_MIGRATIONS } from './schema';
import { applySchema6Bootstrap, applySchema6Migration, SCHEMA_6_VERSION } from './schema-v6-migration';

@Injectable()
export class SqliteDatabaseGateway {
  private database?: Database;
  private sql?: SqlJsStatic;

  async open(bytes?: Uint8Array): Promise<void> {
    this.sql ??= await initSqlJs({ locateFile: file => `assets/${file}` });
    this.database?.close();
    const hostBytes = bytes ?? this.readHostBytes();
    this.database = hostBytes ? new this.sql.Database(hostBytes) : new this.sql.Database();
    this.enableForeignKeys();
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
    const before = this.database.export();
    this.enableForeignKeys();
    this.database.run('BEGIN');
    try {
      work();
      const foreignKeys = this.foreignKeyCheck();
      if (!foreignKeys.valid) {
        throw new Error(`SQLite foreign-key check failed: ${this.describeForeignKeyViolations(foreignKeys.violations)}.`);
      }
      this.database.run('COMMIT');
      this.persistHostSync();
    } catch (error) {
      try { this.database.run('ROLLBACK'); } catch { /* preserve the original native/bridge failure */ }
      this.restoreBytes(before);
      throw error;
    }
  }

  exportBytes(): Uint8Array {
    if (!this.database) throw new Error('SQLite database is not open.');
    const bytes = this.database.export();
    this.enableForeignKeys();
    return bytes;
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
    const bytes = this.database.export();
    // sql.js export closes the native handle and recreates it lazily with
    // connection-level PRAGMAs reset. Re-enable constraints before the next
    // renderer mutation.
    this.enableForeignKeys();
    bridge?.sqlite?.writeSync?.(bytes);
  }

  private enableForeignKeys(): void {
    this.database?.run('PRAGMA foreign_keys = ON;');
  }

  private restoreBytes(bytes: Uint8Array): void {
    if (!this.sql) throw new Error('SQLite runtime is not initialized.');
    this.database?.close();
    this.database = new this.sql.Database(bytes);
    this.enableForeignKeys();
  }

  private describeForeignKeyViolations(violations: Array<Record<string, unknown>>): string {
    return violations.map(violation => {
      const table = String(violation['table'] ?? 'unknown table');
      const rowId = String(violation['rowid'] ?? 'unknown row');
      const parent = String(violation['parent'] ?? 'unknown parent');
      return `${table} row ${rowId} references ${parent}`;
    }).join('; ');
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
        if (version < SCHEMA_6_VERSION && CURRENT_SCHEMA_VERSION >= SCHEMA_6_VERSION) {
          if (version === 0) applySchema6Bootstrap(this.database);
          else applySchema6Migration(this.database);
        }
        this.database.run('UPDATE schema_version SET version = ?', [CURRENT_SCHEMA_VERSION]);
        this.database.run('COMMIT');
      } catch (error) {
        this.database.run('ROLLBACK');
        throw error;
      }
    }
    this.enableForeignKeys();
  }
}
