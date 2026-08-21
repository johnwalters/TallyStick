import initSqlJs, { Database } from 'sql.js';
import { SqliteDatabaseGateway } from './sqlite-database.gateway';
import { SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS, SQLITE_V5_MIGRATIONS } from './schema';
import { migrateSchema5DatabaseTo6, SCHEMA_6_VERSION } from './schema-v6-migration';

describe('schema 6 migration', () => {
  it('migrates and reopens a representative schema-5 database idempotently without ledger drift', async () => {
    const database = await representativeSchema5Database();
    const before = preservationSnapshot(database);

    migrateSchema5DatabaseTo6(database, { timestampUtc: '2026-08-21T21:00:00.000Z', correlationId: 'migration-test' });

    expect(schemaVersion(database)).toBe(SCHEMA_6_VERSION);
    expect(row(database, 'SELECT legal_name, display_name FROM company_profile WHERE company_id = ?', ['company-1'])).toEqual({
      legal_name: 'Northstar Workshop LLC',
      display_name: 'Northstar Workshop LLC',
    });
    expect(columns(database, 'company_profile')).toEqual([
      'company_id', 'legal_name', 'display_name', 'doing_business_as', 'entity_type', 'address_line_1', 'address_line_2',
      'locality', 'region', 'postal_code', 'country_code', 'phone', 'email', 'website', 'tax_identifier', 'created_at', 'modified_at',
    ]);
    expect(columns(database, 'financial_account')).toEqual(jasmine.arrayContaining([
      'type', 'account_type', 'classification_status', 'import_enabled', 'supported_source_kinds_json', 'opening_balance_source',
    ]));
    expect(row(database, 'SELECT account_type, detail_type, classification_status, import_enabled, supported_source_kinds_json, opening_balance_source FROM financial_account WHERE id = ?', ['bank-1'])).toEqual({
      account_type: 'BANK',
      detail_type: 'Money Market',
      classification_status: 'CONFIRMED',
      import_enabled: 1,
      supported_source_kinds_json: '["CSV","EXCEL","QBO_OFX"]',
      opening_balance_source: 'DERIVED_EQUITY',
    });
    expect(row(database, 'SELECT account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['card-1'])).toEqual({
      account_type: 'CREDIT_CARD', detail_type: 'Credit Card', classification_status: 'CONFIRMED',
    });
    expect(row(database, 'SELECT account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['entity-metadata'])).toEqual({
      account_type: 'OTHER_CURRENT_ASSET', detail_type: 'Marketplace clearing', classification_status: 'CONFIRMED',
    });
    expect(row(database, 'SELECT account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['entity-ambiguous'])).toEqual({
      account_type: 'OTHER_CURRENT_ASSET', detail_type: 'Clearing account', classification_status: 'REVIEW_REQUIRED',
    });
    expect(row(database, 'SELECT account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['entity-clearing'])).toEqual({
      account_type: 'OTHER_CURRENT_ASSET', detail_type: 'Clearing account', classification_status: 'CONFIRMED',
    });

    const after = preservationSnapshot(database);
    expect(after.recordCounts).toEqual(before.recordCounts);
    expect(after.ledgerTotals).toEqual(before.ledgerTotals);
    expect(after.reportTotals).toEqual(before.reportTotals);
    expect(after.relationships).toEqual(before.relationships);
    expect(after.accountState).toEqual(before.accountState);
    expect(after.companySettings).toEqual(before.companySettings);
    expect(after.priorAudit).toEqual(before.priorAudit);

    const migrationAudit = rows(database, `SELECT operation, entity_id, before_json, after_json, reason, correlation_id
      FROM audit_event WHERE correlation_id = 'migration-test' ORDER BY id`);
    expect(migrationAudit.length).toBe(6);
    expect(migrationAudit.every(event => event['correlation_id'] === 'migration-test')).toBeTrue();
    const ambiguousAudit = migrationAudit.find(event => event['entity_id'] === 'entity-ambiguous')!;
    expect(JSON.parse(String(ambiguousAudit['before_json']))).toEqual({ type: 'ENTITY', detailType: 'Other transactions' });
    expect(JSON.parse(String(ambiguousAudit['after_json']))).toEqual(jasmine.objectContaining({ accountType: 'OTHER_CURRENT_ASSET', classificationStatus: 'REVIEW_REQUIRED' }));
    expect(String(ambiguousAudit['reason'])).toContain('requires classification review');

    const indexes = rows(database, `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`).map(item => item['name']);
    expect(indexes).toEqual(jasmine.arrayContaining([
      'idx_transaction_state_date_account',
      'idx_transaction_transfer_date_account',
      'idx_posting_split_transaction_chart',
      'idx_posting_split_chart_transaction',
      'idx_chart_account_parent_display',
    ]));
    expect(rows(database, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(row(database, 'PRAGMA integrity_check')['integrity_check']).toBe('ok');

    const auditCount = tableCount(database, 'audit_event');
    migrateSchema5DatabaseTo6(database);
    expect(tableCount(database, 'audit_event')).toBe(auditCount);

    const migratedBytes = database.export();
    database.close();
    const reopened = new SqliteDatabaseGateway();
    await reopened.open(migratedBytes);
    expect(reopened.schemaVersion()).toBe(SCHEMA_6_VERSION);
    expect(reopened.integrityCheck().valid).toBeTrue();
    expect(reopened.foreignKeyCheck().valid).toBeTrue();
    expect(reopened.execute('SELECT classification_status FROM financial_account WHERE id = ?', ['entity-ambiguous'])[0]['classification_status']).toBe('REVIEW_REQUIRED');
    reopened.close();
  });

  it('uses structural type and detail metadata rather than account names', async () => {
    const database = await representativeSchema5Database();

    migrateSchema5DatabaseTo6(database, { correlationId: 'name-independence' });

    expect(row(database, 'SELECT name, account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['bank-1'])).toEqual({
      name: 'Marketplace', account_type: 'BANK', detail_type: 'Money Market', classification_status: 'CONFIRMED',
    });
    expect(row(database, 'SELECT name, account_type, detail_type, classification_status FROM financial_account WHERE id = ?', ['entity-ambiguous'])).toEqual({
      name: 'Checking', account_type: 'OTHER_CURRENT_ASSET', detail_type: 'Clearing account', classification_status: 'REVIEW_REQUIRED',
    });
    database.close();
  });

  it('rolls back every schema and data change when hierarchy validation fails', async () => {
    const database = await representativeSchema5Database();
    database.run(`UPDATE financial_account SET parent_account_id = 'entity-ambiguous' WHERE id = 'bank-1'`);
    database.run(`UPDATE financial_account SET parent_account_id = 'bank-1' WHERE id = 'entity-ambiguous'`);
    const beforeAuditCount = tableCount(database, 'audit_event');
    const beforeAccounts = rows(database, 'SELECT * FROM financial_account ORDER BY id');

    expect(() => migrateSchema5DatabaseTo6(database, { correlationId: 'must-rollback' })).toThrowError(/hierarchy contains a cycle/);

    expect(schemaVersion(database)).toBe(5);
    expect(tableExists(database, 'company_profile')).toBeFalse();
    expect(columns(database, 'financial_account')).not.toContain('account_type');
    expect(tableCount(database, 'audit_event')).toBe(beforeAuditCount);
    expect(rows(database, 'SELECT * FROM financial_account ORDER BY id')).toEqual(beforeAccounts);
    expect(rows(database, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_transaction_state_date_account'`)).toEqual([]);
    database.close();
  });

  it('rejects incompatible source versions without modifying them', async () => {
    const database = await representativeSchema5Database();
    database.run('UPDATE schema_version SET version = 4');

    expect(() => migrateSchema5DatabaseTo6(database)).toThrowError('Schema 6 migration requires schema 5, received schema 4.');
    expect(schemaVersion(database)).toBe(4);
    expect(tableExists(database, 'company_profile')).toBeFalse();
    database.close();
  });
});

async function representativeSchema5Database(): Promise<Database> {
  const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
  const database = new sql.Database();
  database.run('PRAGMA foreign_keys = ON;');
  database.run(SQLITE_MIGRATIONS[0]);
  database.run('INSERT INTO schema_version(version) VALUES (0)');
  database.run('BEGIN');
  try {
    database.run(SQLITE_MIGRATIONS[1]);
    SQLITE_MIGRATIONS.slice(2).forEach(statement => database.run(statement));
    SQLITE_V3_MIGRATIONS.forEach(statement => database.run(statement));
    SQLITE_V4_MIGRATIONS.forEach(statement => database.run(statement));
    SQLITE_V5_MIGRATIONS.forEach(statement => database.run(statement));
    database.run('UPDATE schema_version SET version = 5');
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    database.close();
    throw error;
  }
  database.run(`INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year)
    VALUES (?, ?, ?, ?, ?, ?)`, ['company-1', 'Northstar Workshop LLC', 'USD', 7, 'ACCRUAL', 2026]);
  database.run(`INSERT INTO financial_account(id, type, detail_type, name, institution_or_entity, opening_balance_minor,
    opening_balance_date, archived, last_four, parent_account_id, description, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['bank-1', 'BANK', 'Money Market', 'Marketplace', 'Neutral Institution', '12345', '2025-12-31', 0, '1234', null, 'Operating funds', 1]);
  database.run(`INSERT INTO financial_account(id, type, detail_type, name, institution_or_entity, opening_balance_minor,
    opening_balance_date, archived, last_four, parent_account_id, description, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['card-1', 'CREDIT_CARD', 'Credit card', 'Copper Lantern', 'Neutral Card', '-2500', '2025-12-31', 1, '9876', null, 'Archived card', 0]);
  database.run(`INSERT INTO financial_account(id, type, detail_type, name, institution_or_entity, opening_balance_minor,
    opening_balance_date, archived, parent_account_id, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['entity-metadata', 'ENTITY', 'Marketplace', 'Unrelated Name', 'Neutral Platform', '5000', '2025-12-31', 0, null, 0]);
  database.run(`INSERT INTO financial_account(id, type, detail_type, name, institution_or_entity, opening_balance_minor,
    opening_balance_date, archived, parent_account_id, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['entity-ambiguous', 'ENTITY', 'Other transactions', 'Checking', 'Neutral Processor', '7500', '2025-12-31', 0, null, 0]);
  database.run(`INSERT INTO financial_account(id, type, detail_type, name, institution_or_entity, opening_balance_minor,
    opening_balance_date, archived, parent_account_id, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['entity-clearing', 'ENTITY', 'Clearing account', 'Inventory', 'Neutral Clearing', '0', '2025-12-31', 0, null, 0]);
  database.run(`INSERT INTO chart_account(id, name, parent_id, type, display_order, archived, account_type, detail_type, description, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['expense-parent', 'Operating Expenses', null, 'EXPENSE', 1, 0, 'EXPENSE', 'Other business expenses', 'Parent', 1]);
  database.run(`INSERT INTO chart_account(id, name, parent_id, type, display_order, archived, account_type, detail_type, description, locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['expense-child', 'Office Expense', 'expense-parent', 'EXPENSE', 2, 0, 'EXPENSE', 'Office expenses', 'Child', 0]);
  database.run(`INSERT INTO import_batch(id, destination_account_id, source_kind, source_name, source_hash, mapping_version,
    accepted_count, rejected_count, skipped_count, warning_count, total_accepted_minor, committed_at_utc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['batch-1', 'entity-metadata', 'AMAZON', 'neutral.csv', 'hash-1', 'mapping-v1', 1, 0, 0, 0, '-250', '2026-01-15T00:00:00.000Z']);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, source_batch_id, transfer_match_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['posted-1', 'entity-metadata', '2026-01-15', '-250', 'USD', 'SUPPLIES', 'Supplies', 'POSTED', 'batch-1', null, '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z', 'MANUAL']);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, transfer_match_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['transfer-left', 'bank-1', '2026-02-01', '-1000', 'USD', 'TRANSFER', 'Transfer', 'MATCHED_TRANSFER', 'transfer-1', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'TRANSFER']);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, transfer_match_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['transfer-right', 'card-1', '2026-02-01', '1000', 'USD', 'TRANSFER', 'Transfer', 'MATCHED_TRANSFER', 'transfer-1', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', 'TRANSFER']);
  database.run(`INSERT INTO posting_split(id, transaction_id, chart_account_id, amount_minor, memo)
    VALUES (?, ?, ?, ?, ?)`, ['split-1', 'posted-1', 'expense-child', '-250', 'Preserved memo']);
  database.run(`INSERT INTO transfer_match(id, left_transaction_id, right_transaction_id, confidence, rationale, confirmed_at_utc)
    VALUES (?, ?, ?, ?, ?, ?)`, ['transfer-1', 'transfer-left', 'transfer-right', 1, 'Exact match', '2026-02-01T00:00:00.000Z']);
  database.run(`INSERT INTO transaction_rule(id, name, enabled, priority, conditions_json, chart_account_id, payee, memo, tags_json, suggest_exclude)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['rule-1', 'Office rule', 1, 1, '[]', 'expense-child', 'Supplier', 'Rule memo', '["office"]', 0]);
  database.run(`INSERT INTO tax_year_settings(tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
    include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc, accountant_note)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [2026, '[]', '["expense-child"]', 0, 1, '2026-01-01T00:00:00.000Z', 'Preserved note']);
  database.run(`INSERT INTO audit_event(id, timestamp_utc, operation, entity_type, entity_id, before_json, after_json, reason, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ['prior-audit', '2026-01-01T00:00:00.000Z', 'CREATE', 'Company', 'company-1', null, '{}', 'Existing history', 'prior-correlation']);
  return database;
}

function preservationSnapshot(database: Database) {
  return {
    recordCounts: Object.fromEntries(['company', 'financial_account', 'chart_account', 'import_batch', 'transaction_record', 'posting_split', 'transfer_match', 'transaction_rule', 'tax_year_settings'].map(table => [table, tableCount(database, table)])),
    ledgerTotals: {
      opening: rows(database, 'SELECT id, opening_balance_minor FROM financial_account ORDER BY id'),
      transactions: rows(database, 'SELECT id, amount_minor, state FROM transaction_record ORDER BY id'),
      splits: rows(database, 'SELECT id, amount_minor FROM posting_split ORDER BY id'),
    },
    reportTotals: {
      openingBalanceMinor: sumTextMinor(rows(database, 'SELECT opening_balance_minor AS amount_minor FROM financial_account')),
      includedSourceActivityMinor: sumTextMinor(rows(database, `SELECT amount_minor FROM transaction_record WHERE state IN ('POSTED', 'MATCHED_TRANSFER')`)),
      postedSplitMinor: sumTextMinor(rows(database, `SELECT posting_split.amount_minor
        FROM posting_split JOIN transaction_record ON transaction_record.id = posting_split.transaction_id
        WHERE transaction_record.state = 'POSTED'`)),
    },
    relationships: {
      parents: rows(database, 'SELECT id, parent_account_id FROM financial_account ORDER BY id'),
      chartParents: rows(database, 'SELECT id, parent_id FROM chart_account ORDER BY id'),
      transactions: rows(database, 'SELECT id, account_id, source_batch_id, transfer_match_id FROM transaction_record ORDER BY id'),
      splits: rows(database, 'SELECT id, transaction_id, chart_account_id FROM posting_split ORDER BY id'),
      transfers: rows(database, 'SELECT id, left_transaction_id, right_transaction_id FROM transfer_match ORDER BY id'),
      rules: rows(database, 'SELECT id, chart_account_id FROM transaction_rule ORDER BY id'),
      batches: rows(database, 'SELECT id, destination_account_id, mapping_version FROM import_batch ORDER BY id'),
    },
    accountState: rows(database, `SELECT id, type, name, institution_or_entity, opening_balance_minor, opening_balance_date,
      archived, last_four, parent_account_id, description, locked FROM financial_account ORDER BY id`),
    companySettings: rows(database, 'SELECT * FROM company ORDER BY id'),
    priorAudit: rows(database, `SELECT * FROM audit_event WHERE id = 'prior-audit'`),
  };
}

function sumTextMinor(items: Array<Record<string, unknown>>): bigint {
  return items.reduce((total, item) => total + BigInt(String(item['amount_minor'])), 0n);
}

function schemaVersion(database: Database): number {
  return Number(row(database, 'SELECT version FROM schema_version')['version']);
}

function tableCount(database: Database, table: string): number {
  return Number(row(database, `SELECT COUNT(*) AS count FROM ${table}`)['count']);
}

function tableExists(database: Database, table: string): boolean {
  return rows(database, 'SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', table]).length === 1;
}

function columns(database: Database, table: string): unknown[] {
  return rows(database, `PRAGMA table_info(${table})`).map(item => item['name']);
}

function row(database: Database, sql: string, params: unknown[] = []): Record<string, unknown> {
  return rows(database, sql, params)[0] ?? {};
}

function rows(database: Database, sql: string, params: unknown[] = []): Array<Record<string, unknown>> {
  const statement = database.prepare(sql);
  try {
    statement.bind(params as never[]);
    const result: Array<Record<string, unknown>> = [];
    while (statement.step()) result.push(statement.getAsObject() as Record<string, unknown>);
    return result;
  } finally {
    statement.free();
  }
}
