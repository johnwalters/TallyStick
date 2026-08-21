import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import initSqlJs, { SqlJsStatic } from 'sql.js';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../shared/schema-version';
import { DatabaseLifecycleManager } from './database-lifecycle';

let sqlPromise: Promise<SqlJsStatic> | undefined;

function sql(): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: file => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file) });
  return sqlPromise;
}

async function databaseBytes(companyId: string, schemaVersion = CURRENT_SQLITE_SCHEMA_VERSION): Promise<Uint8Array> {
  const database = new (await sql()).Database();
  database.run(`PRAGMA foreign_keys = ON; CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (${schemaVersion}); CREATE TABLE company(id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
  database.run('INSERT INTO company(id, name) VALUES (?, ?)', [companyId, `Company ${companyId}`]);
  if (schemaVersion === CURRENT_SQLITE_SCHEMA_VERSION && schemaVersion >= 6) {
    database.run(`CREATE TABLE company_profile (
      company_id TEXT PRIMARY KEY REFERENCES company(id), legal_name TEXT NOT NULL, display_name TEXT NOT NULL,
      tax_identifier TEXT, created_at TEXT NOT NULL, modified_at TEXT NOT NULL
    )`);
    database.run(`INSERT INTO company_profile(company_id, legal_name, display_name, tax_identifier, created_at, modified_at)
      VALUES (?, ?, ?, ?, ?, ?)`, [companyId, `Company ${companyId}`, `Display ${companyId}`, '99-9999999', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
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
    const database = new (await sql()).Database();
    database.run(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (${CURRENT_SQLITE_SCHEMA_VERSION}); CREATE TABLE company(id TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO company VALUES ('incomplete', 'Incomplete');`);
    const bytes = database.export();
    database.close();
    await assert.rejects(() => setup.manager.backup(bytes), /valid company profile/);
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
