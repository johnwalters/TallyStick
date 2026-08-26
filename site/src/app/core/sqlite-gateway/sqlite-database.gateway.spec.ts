import { SqliteDatabaseGateway } from './sqlite-database.gateway';
import initSqlJs from 'sql.js';
import { SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS } from './schema';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../../../shared/schema-version';

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
    expect(gateway.execute('PRAGMA foreign_keys')[0]['foreign_keys']).toBe(1);
    expect(gateway.schemaVersion()).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    gateway.close();
  });

  it('reopens an already-migrated database without replaying ALTER statements', async () => {
    const first = new SqliteDatabaseGateway();
    await first.open();
    const bytes = first.exportBytes();
    const second = new SqliteDatabaseGateway();
    await second.open(bytes);
    expect(second.schemaVersion()).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    expect(second.integrityCheck().valid).toBeTrue();
    second.close();
    first.close();
  });

  it('migrates a representative schema-v2 chart to enhanced chart fields with a valid detail type', async () => {
    const legacy = await databaseAtVersion(2);
    legacy.run(`
      INSERT INTO company VALUES ('company-v2', 'Schema Two Company', 'USD', 1, 'CASH', 2026);
      INSERT INTO chart_account VALUES ('legacy-expense', 'Legacy expense', NULL, 'EXPENSE', 1, 0);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    const migrated = gateway.execute('SELECT account_type, detail_type, description, locked FROM chart_account WHERE id = ?', ['legacy-expense'])[0];
    expect(gateway.schemaVersion()).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    expect(migrated['account_type']).toBe('EXPENSE');
    expect(migrated['detail_type']).toBe('Advertising');
    expect(migrated['description']).toBeNull();
    expect(migrated['locked']).toBe(0);
    gateway.close();
  });

  it('repairs blank detail types when reopening a schema-v3 chart', async () => {
    const legacy = await databaseAtVersion(3);
    legacy.run(`
      INSERT INTO company VALUES ('company-v3', 'Schema Three Company', 'USD', 1, 'CASH', 2026);
      INSERT INTO chart_account VALUES ('legacy-asset', 'Amazon', NULL, 'ASSET', 1, 0, 'OTHER_ASSET', '', NULL, 0);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    expect(gateway.schemaVersion()).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    expect(gateway.execute('SELECT detail_type FROM chart_account WHERE id = ?', ['legacy-asset'])[0]['detail_type']).toBe('Goodwill');
    gateway.close();
  });

  it('migrates schema-v4 financial accounts to editable detail, hierarchy, description, and lock fields', async () => {
    const legacy = await databaseAtVersion(4);
    legacy.run(`
      INSERT INTO company VALUES ('company-v4', 'Schema Four Company', 'USD', 1, 'CASH', 2026);
      INSERT INTO financial_account VALUES ('legacy-bank', 'BANK', 'Legacy Checking', 'BofA', '1000', '2026-01-01', 0, '0001');
      INSERT INTO financial_account VALUES ('legacy-card', 'CREDIT_CARD', 'Legacy Card', 'Amex', '0', '2026-01-01', 0, '0002');
      INSERT INTO financial_account VALUES ('legacy-amazon', 'ENTITY', 'Amazon', 'Amazon', '0', '2026-01-01', 0, NULL);
    `);
    const bytes = legacy.export();
    legacy.close();

    const gateway = new SqliteDatabaseGateway();
    await gateway.open(bytes);
    expect(gateway.schemaVersion()).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-bank'])[0]['detail_type']).toBe('Checking');
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-card'])[0]['detail_type']).toBe('Credit Card');
    expect(gateway.execute('SELECT detail_type FROM financial_account WHERE id = ?', ['legacy-amazon'])[0]['detail_type']).toBe('Marketplace clearing');
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
      gateway.transaction(() => {
        gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date, account_type, detail_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ['bridge-account', 'BANK', 'Bridge Bank', 'Test', '0', '2026-01-01', 'BANK', 'Checking']);
        gateway.execute(`INSERT INTO financial_account_cash_flow_classification(
          financial_account_id, cash_flow_cash_role, cash_flow_treatment, cash_flow_status,
          cash_flow_source, cash_flow_rationale)
          VALUES (?, ?, ?, ?, ?, ?)`, ['bridge-account', 'CASH', 'CASH_BALANCE', 'CONFIRMED', 'DEFAULT', 'The standard bank detail is a cash balance.']);
      });
      expect(gateway.execute('PRAGMA foreign_keys')[0]['foreign_keys']).toBe(1);
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

  it('restores renderer state when the desktop host rejects a committed image', async () => {
    const bridge = (globalThis as { localAccounting?: unknown }).localAccounting;
    let rejectWrites = false;
    (globalThis as { localAccounting?: unknown }).localAccounting = {
      sqlite: {
        writeSync: () => { if (rejectWrites) throw new Error('host rejected image'); },
      },
    };
    try {
      const gateway = new SqliteDatabaseGateway();
      await gateway.open();
      gateway.execute('INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year) VALUES (?, ?, ?, ?, ?, ?)', ['rollback-company', 'Rollback Company', 'USD', 1, 'CASH', 2026]);
      rejectWrites = true;
      expect(() => gateway.transaction(() => gateway.execute('INSERT INTO financial_account(id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date) VALUES (?, ?, ?, ?, ?, ?)', ['rejected-account', 'BANK', 'Rejected Bank', 'Test', '0', '2026-01-01']))).toThrowError('host rejected image');
      expect(gateway.execute('SELECT COUNT(*) AS count FROM financial_account')[0]['count']).toBe(0);
      expect(gateway.execute('PRAGMA foreign_keys')[0]['foreign_keys']).toBe(1);
      gateway.close();
    } finally {
      (globalThis as { localAccounting?: unknown }).localAccounting = bridge;
    }
  });
});

async function databaseAtVersion(version: 2 | 3 | 4) {
  const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
  const database = new sql.Database();
  database.run(SQLITE_MIGRATIONS[0]);
  database.run('INSERT INTO schema_version(version) VALUES (0)');
  database.run(SQLITE_MIGRATIONS[1]);
  SQLITE_MIGRATIONS.slice(2).forEach(statement => database.run(statement));
  if (version >= 3) SQLITE_V3_MIGRATIONS.forEach(statement => database.run(statement));
  if (version >= 4) SQLITE_V4_MIGRATIONS.forEach(statement => database.run(statement));
  database.run('UPDATE schema_version SET version = ?', [version]);
  database.run('PRAGMA foreign_keys = ON;');
  return database;
}
