import { SqliteDatabaseGateway } from './sqlite-database.gateway';
import initSqlJs from 'sql.js';

describe('SqliteDatabaseGateway', () => {
  it('opens, migrates, executes, transactions, and exports SQLite', async () => {
    const gateway = new SqliteDatabaseGateway();
    await gateway.open();
    gateway.execute('INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year) VALUES (?, ?, ?, ?, ?, ?)', ['c1', 'Test Company', 'USD', 1, 'CASH', 2026]);
    expect(gateway.execute('SELECT name FROM company WHERE id = ?', ['c1'])[0]['name']).toBe('Test Company');
    expect(gateway.exportBytes().byteLength).toBeGreaterThan(0);
    gateway.transaction(() => gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['a1', 'BANK', 'Test Bank', 'Test', '0', '2026-01-01']));
    expect(gateway.execute('SELECT COUNT(*) AS count FROM financial_account')[0]['count']).toBe(1);
    expect(gateway.integrityCheck().valid).toBeTrue();
    expect(gateway.foreignKeyCheck().valid).toBeTrue();
    expect(gateway.schemaVersion()).toBe(5);
    gateway.close();
  });

  it('reopens an already-migrated database without replaying ALTER statements', async () => {
    const first = new SqliteDatabaseGateway();
    await first.open();
    const bytes = first.exportBytes();
    const second = new SqliteDatabaseGateway();
    await second.open(bytes);
    expect(second.schemaVersion()).toBe(5);
    expect(second.integrityCheck().valid).toBeTrue();
    second.close();
    first.close();
  });

  it('migrates a representative schema-v2 chart to enhanced chart fields with a valid detail type', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const legacy = new sql.Database();
    legacy.run(`
      CREATE TABLE schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (2);
      CREATE TABLE financial_account (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL UNIQUE, institution_or_entity TEXT NOT NULL, opening_balance_minor TEXT NOT NULL, opening_balance_date TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, last_four TEXT);
      CREATE TABLE chart_account (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL, display_order INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      INSERT INTO chart_account VALUES ('legacy-expense', 'Legacy expense', NULL, 'EXPENSE', 1, 0);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    const migrated = gateway.execute('SELECT account_type, detail_type, description, locked FROM chart_account WHERE id = ?', ['legacy-expense'])[0];
    expect(gateway.schemaVersion()).toBe(5);
    expect(migrated['account_type']).toBe('EXPENSE');
    expect(migrated['detail_type']).toBe('Advertising');
    expect(migrated['description']).toBeNull();
    expect(migrated['locked']).toBe(0);
    gateway.close();
  });

  it('repairs blank detail types when reopening a schema-v3 chart', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const legacy = new sql.Database();
    legacy.run(`
      CREATE TABLE schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (3);
      CREATE TABLE financial_account (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL UNIQUE, institution_or_entity TEXT NOT NULL, opening_balance_minor TEXT NOT NULL, opening_balance_date TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, last_four TEXT);
      CREATE TABLE chart_account (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, type TEXT NOT NULL,
        display_order INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        account_type TEXT NOT NULL DEFAULT 'EXPENSE', detail_type TEXT NOT NULL DEFAULT '',
        description TEXT, locked INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO chart_account VALUES ('legacy-asset', 'Amazon', NULL, 'ASSET', 1, 0, 'OTHER_ASSET', '', NULL, 0);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    expect(gateway.schemaVersion()).toBe(5);
    expect(gateway.execute('SELECT detail_type FROM chart_account WHERE id = ?', ['legacy-asset'])[0]['detail_type']).toBe('Goodwill');
    gateway.close();
  });

  it('migrates schema-v4 financial accounts to editable detail, hierarchy, description, and lock fields', async () => {
    const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
    const legacy = new sql.Database();
    legacy.run(`
      CREATE TABLE schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version VALUES (4);
      CREATE TABLE financial_account (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL UNIQUE,
        institution_or_entity TEXT NOT NULL, opening_balance_minor TEXT NOT NULL,
        opening_balance_date TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, last_four TEXT
      );
      INSERT INTO financial_account VALUES ('legacy-bank', 'BANK', 'Legacy Checking', 'BofA', '1000', '2026-01-01', 0, '0001');
      INSERT INTO financial_account VALUES ('legacy-card', 'CREDIT_CARD', 'Legacy Card', 'Amex', '0', '2026-01-01', 0, '0002');
      INSERT INTO financial_account VALUES ('legacy-amazon', 'ENTITY', 'Amazon', 'Amazon', '0', '2026-01-01', 0, NULL);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    expect(gateway.schemaVersion()).toBe(5);
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-bank'])[0]['detail_type']).toBe('Checking');
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-card'])[0]['detail_type']).toBe('Credit Card');
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-amazon'])[0]['detail_type']).toBe('Marketplace');
    const columns = gateway.execute('PRAGMA table_info(financial_account)').map(row => row['name']);
    expect(columns).toEqual(jasmine.arrayContaining(['detail_type', 'parent_account_id', 'description', 'locked']));
    gateway.close();
  });

  it('uses the narrow local bridge for startup reads and successful writes', async () => {
    let stored: Uint8Array | undefined;
    const bridge = (globalThis as { localAccounting?: unknown }).localAccounting;
    (globalThis as { localAccounting?: unknown }).localAccounting = { sqlite: { readSync: () => stored, writeSync: (bytes: Uint8Array) => { stored = bytes; } } };
    try {
      const gateway = new SqliteDatabaseGateway();
      await gateway.open();
      gateway.execute('INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year) VALUES (?, ?, ?, ?, ?, ?)', ['bridge-company', 'Bridge Company', 'USD', 1, 'CASH', 2026]);
      gateway.transaction(() => gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['bridge-account', 'BANK', 'Bridge Bank', 'Test', '0', '2026-01-01']));
      expect(stored?.byteLength ?? 0).toBeGreaterThan(0);
      const reopened = new SqliteDatabaseGateway();
      await reopened.open(stored);
      expect(reopened.execute('SELECT name FROM financial_account')[0]['name']).toBe('Bridge Bank');
      reopened.close();
      gateway.close();
    } finally {
      (globalThis as { localAccounting?: unknown }).localAccounting = bridge;
    }
  });

  it('enforces foreign keys, uniqueness, and transaction rollback', async () => {
    const gateway = new SqliteDatabaseGateway();
    await gateway.open();
    gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['constraint-account', 'BANK', 'Constraint Bank', 'Test', '0', '2026-01-01']);
    expect(() => gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['constraint-account-2', 'BANK', 'Constraint Bank', 'Test', '0', '2026-01-01'])).toThrow();
    expect(() => gateway.execute('INSERT INTO import_batch(id, destination_account_id, source_kind, source_name, source_hash, mapping_version, accepted_count, rejected_count, skipped_count, warning_count, total_accepted_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ['bad-batch', 'missing-account', 'CSV', 'bad.csv', 'hash', 'v1', 0, 0, 0, 0, '0'])).toThrow();
    expect(() => gateway.transaction(() => { gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['rollback-account', 'BANK', 'Rollback Bank', 'Test', '0', '2026-01-01']); throw new Error('rollback'); })).toThrowError('rollback');
    expect(gateway.execute('SELECT COUNT(*) AS count FROM financial_account WHERE id = ?', ['rollback-account'])[0]['count']).toBe(0);
    gateway.close();
  });
});
