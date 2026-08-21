import initSqlJs from 'sql.js';
import { SqliteHostStore } from '../../../desktop-host/sqlite-host-store';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../../../shared/schema-version';

describe('SqliteHostStore', () => {
  it('returns the latest renderer-written database after a simulated page reload', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const launchDatabase = new sql.Database();
    launchDatabase.run('CREATE TABLE activity(id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    launchDatabase.run("INSERT INTO activity VALUES ('posted-before-launch', 'POSTED')");
    const store = new SqliteHostStore(sql);
    store.open(launchDatabase.export(), '/tmp/tallystick.sqlite');

    const rendererDatabase = new sql.Database(store.exportBytes());
    rendererDatabase.run("INSERT INTO activity VALUES ('pending-after-launch', 'PENDING')");
    rendererDatabase.run("INSERT INTO activity VALUES ('match-after-launch', 'MATCHED_TRANSFER')");
    let diskBytes: Uint8Array | undefined;
    store.persistAndReplace(rendererDatabase.export(), bytes => { diskBytes = new Uint8Array(bytes); });

    const reloadedRenderer = new sql.Database(store.exportBytes());
    const states = reloadedRenderer.exec('SELECT state FROM activity ORDER BY id')[0].values.flat();
    expect(states).toEqual(['MATCHED_TRANSFER', 'PENDING', 'POSTED']);
    expect(store.exportBytes()).toEqual(diskBytes!);

    reloadedRenderer.close();
    rendererDatabase.close();
    launchDatabase.close();
    store.close();
  });

  it('keeps the prior in-memory database when the disk write fails', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const launchDatabase = new sql.Database();
    launchDatabase.run('CREATE TABLE activity(id TEXT PRIMARY KEY)');
    launchDatabase.run("INSERT INTO activity VALUES ('preserved')");
    const store = new SqliteHostStore(sql);
    store.open(launchDatabase.export(), '/tmp/tallystick.sqlite');
    const replacement = new sql.Database(store.exportBytes());
    replacement.run("INSERT INTO activity VALUES ('must-not-replace')");

    expect(() => store.persistAndReplace(replacement.export(), () => { throw new Error('disk full'); })).toThrowError('disk full');
    const retained = new sql.Database(store.exportBytes());
    expect(retained.exec('SELECT id FROM activity ORDER BY id')[0].values.flat()).toEqual(['preserved']);

    retained.close();
    replacement.close();
    launchDatabase.close();
    store.close();
  });

  it('rejects a future schema before replacing the active database', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const current = new sql.Database();
    current.run(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (${CURRENT_SQLITE_SCHEMA_VERSION});`);
    const future = new sql.Database();
    future.run(`CREATE TABLE schema_version(version INTEGER NOT NULL); INSERT INTO schema_version VALUES (${CURRENT_SQLITE_SCHEMA_VERSION + 1});`);
    const store = new SqliteHostStore(sql);
    store.open(current.export(), '/tmp/tallystick.sqlite');

    expect(() => store.persistAndReplace(future.export(), () => undefined)).toThrowError(/Unsupported SQLite schema version/);
    expect(new sql.Database(store.exportBytes()).exec('SELECT version FROM schema_version')[0].values[0][0]).toBe(CURRENT_SQLITE_SCHEMA_VERSION);

    future.close();
    current.close();
    store.close();
  });
});
