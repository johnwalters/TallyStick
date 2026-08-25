import initSqlJs, { Database } from 'sql.js';
import { ACCOUNT_TYPE_CATALOG } from '../domain-model/account-taxonomy';
import { getDefaultCashFlowClassification } from '../domain-model/cash-flow-classification';
import { SQLITE_MIGRATIONS, SQLITE_V3_MIGRATIONS, SQLITE_V4_MIGRATIONS, SQLITE_V5_MIGRATIONS } from './schema';
import { applySchema6Bootstrap } from './schema-v6-migration';
import { migrateSchema6DatabaseTo7, SCHEMA_7_VERSION } from './schema-v7-migration';
import { SqliteDatabaseGateway } from './sqlite-database.gateway';

describe('schema 7 Cash Flow migration', () => {
  it('derives structural classifications, preserves the ledger, audits evidence, and reopens idempotently', async () => {
    const database = await representativeSchema6Database();
    const before = preservationSnapshot(database);

    migrateSchema6DatabaseTo7(database, {
      timestampUtc: '2026-08-25T18:00:00.000Z',
      correlationId: 'schema-7-test',
    });

    expect(schemaVersion(database)).toBe(SCHEMA_7_VERSION);
    expect(row(database, `SELECT cash_flow_cash_role, cash_flow_treatment, cash_flow_status, cash_flow_source
      FROM financial_account_cash_flow_classification WHERE financial_account_id = ?`, ['bank-1'])).toEqual({
      cash_flow_cash_role: 'CASH', cash_flow_treatment: 'CASH_BALANCE', cash_flow_status: 'CONFIRMED', cash_flow_source: 'MIGRATED',
    });
    expect(row(database, `SELECT cash_flow_cash_role, cash_flow_treatment, cash_flow_status
      FROM financial_account_cash_flow_classification WHERE financial_account_id = ?`, ['bank-custom'])).toEqual({
      cash_flow_cash_role: 'REVIEW_REQUIRED', cash_flow_treatment: 'REVIEW_REQUIRED', cash_flow_status: 'REVIEW_REQUIRED',
    });
    expect(row(database, `SELECT cash_flow_cash_role, cash_flow_treatment
      FROM financial_account_cash_flow_classification WHERE financial_account_id = ?`, ['card-1'])).toEqual({
      cash_flow_cash_role: 'NOT_CASH', cash_flow_treatment: 'OPERATING_LIABILITY',
    });
    expect(row(database, `SELECT cash_flow_treatment, cash_flow_status
      FROM chart_account_cash_flow_classification WHERE chart_account_id = ?`, ['loan-1'])).toEqual({
      cash_flow_treatment: 'FINANCING', cash_flow_status: 'CONFIRMED',
    });
    expect(row(database, `SELECT cash_flow_treatment, cash_flow_status
      FROM chart_account_cash_flow_classification WHERE chart_account_id = ?`, ['expense-custom'])).toEqual({
      cash_flow_treatment: 'REVIEW_REQUIRED', cash_flow_status: 'REVIEW_REQUIRED',
    });

    const after = preservationSnapshot(database);
    expect(before.ledgerTotals).toEqual({ transactionMinor: '-100', splitMinor: '-100', openingMinor: '0' });
    expect(before.profitAndLossTotals).toEqual({ postedSplitMinor: '-100' });
    expect(before.balanceSheetTotals).toEqual({ endingFinancialBalanceMinor: '-100' });
    expect({ ...after, auditCount: before.auditCount }).toEqual({ ...before, auditCount: before.auditCount });
    expect(after.ledgerTotals).toEqual(before.ledgerTotals);
    expect(after.profitAndLossTotals).toEqual(before.profitAndLossTotals);
    expect(after.balanceSheetTotals).toEqual(before.balanceSheetTotals);
    expect(tableCount(database, 'financial_account_cash_flow_classification')).toBe(3);
    expect(tableCount(database, 'chart_account_cash_flow_classification')).toBe(6);
    expect(tableCount(database, 'audit_event')).toBe(before.auditCount + 3 + 6 + 1);
    expect(rows(database, `SELECT operation, entity_type, entity_id, reason
      FROM audit_event WHERE correlation_id = 'schema-7-test' ORDER BY id`)).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ operation: 'MIGRATE_ACCOUNT_CASH_FLOW_CLASSIFICATION_SCHEMA_7', entity_type: 'FinancialAccountCashFlowClassification', entity_id: 'bank-custom' }),
      jasmine.objectContaining({ operation: 'MIGRATE_ACCOUNT_CASH_FLOW_CLASSIFICATION_SCHEMA_7', entity_type: 'ChartAccountCashFlowClassification', entity_id: 'expense-custom' }),
      jasmine.objectContaining({ operation: 'MIGRATE_CASH_FLOW_SCHEMA_7', entity_type: 'CashFlowSchema', entity_id: 'schema-7' }),
    ]));
    const customAudit = row(database, `SELECT before_json, after_json, reason FROM audit_event
      WHERE correlation_id = 'schema-7-test' AND entity_id = 'bank-custom'`);
    expect(JSON.parse(String(customAudit['before_json']))).toEqual(jasmine.objectContaining({ accountType: 'BANK', detailType: 'Imported bank detail' }));
    expect(String(customAudit['reason'])).toContain('review');
    const legacyReviewAudit = row(database, `SELECT reason FROM audit_event
      WHERE correlation_id = 'schema-7-test' AND entity_id = 'bank-1'`);
    expect(legacyReviewAudit['reason']).toBe('Derive the Cash Flow classification from the structural account type and standard detail.');
    expect(rows(database, `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%cash_flow%' ORDER BY name`).map(item => item['name'])).toEqual([
      'idx_chart_account_cash_flow_classification',
      'idx_financial_account_cash_flow_classification',
    ]);
    expect(rows(database, 'PRAGMA foreign_key_check')).toEqual([]);
    expect(row(database, 'PRAGMA integrity_check')['integrity_check']).toBe('ok');
    expect(() => database.run(`INSERT INTO chart_account_cash_flow_classification(
      chart_account_id, cash_flow_treatment, cash_flow_status, cash_flow_source, cash_flow_rationale)
      VALUES ('invalid', 'NOT_A_TREATMENT', 'CONFIRMED', 'MIGRATED', 'invalid')`)).toThrow();

    const auditCount = tableCount(database, 'audit_event');
    migrateSchema6DatabaseTo7(database);
    expect(tableCount(database, 'audit_event')).toBe(auditCount);

    const reopened = new SqliteDatabaseGateway();
    await reopened.open(database.export());
    expect(reopened.schemaVersion()).toBe(SCHEMA_7_VERSION);
    expect(reopened.integrityCheck().valid).toBeTrue();
    expect(reopened.foreignKeyCheck().valid).toBeTrue();
    expect(reopened.execute(`SELECT cash_flow_treatment FROM chart_account_cash_flow_classification WHERE chart_account_id = ?`, ['loan-1'])[0]['cash_flow_treatment']).toBe('FINANCING');
    reopened.close();
  });

  it('rolls back schema objects, rows, and audit events when structural classification fails', async () => {
    const database = await representativeSchema6Database();
    const beforeAccounts = rows(database, 'SELECT * FROM financial_account ORDER BY id');
    database.run(`UPDATE chart_account SET account_type = 'UNKNOWN_TYPE' WHERE id = 'expense-custom'`);

    expect(() => migrateSchema6DatabaseTo7(database, { correlationId: 'schema-7-invalid' })).toThrowError(/unknown account type/);
    expect(schemaVersion(database)).toBe(6);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    expect(tableExists(database, 'chart_account_cash_flow_classification')).toBeFalse();
    expect(rows(database, 'SELECT * FROM financial_account ORDER BY id')).toEqual(beforeAccounts);
    expect(tableCount(database, 'audit_event')).toBe(1);
    database.close();
  });

  it('migrates every standard Chart detail and every supported financial-source detail through the taxonomy defaults', async () => {
    const database = await representativeSchema6Database();
    let sequence = 0;
    for (const definition of ACCOUNT_TYPE_CATALOG) {
      for (const detail of definition.detailTypes) {
        const id = `standard-chart-${sequence++}`;
        insertChartAccountWithAccountType(database, id, `Standard ${id}`, null, definition.accountType, definition.accountType, detail.value);
      }
    }
    for (const accountType of ['BANK', 'CREDIT_CARD', 'OTHER_CURRENT_ASSET'] as const) {
      const definition = ACCOUNT_TYPE_CATALOG.find(item => item.accountType === accountType);
      if (!definition) throw new Error(`Missing taxonomy definition for ${accountType}`);
      for (const detail of definition.detailTypes) {
        const id = `standard-financial-${sequence++}`;
        insertFinancialAccount(database, id, accountType, detail.value, 'Neutral institution', null, accountType);
      }
    }

    migrateSchema6DatabaseTo7(database, { correlationId: 'schema-7-standard-matrix' });

    for (const definition of ACCOUNT_TYPE_CATALOG) {
      for (const detail of definition.detailTypes) {
        const expected = getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: definition.accountType, detailType: detail.value });
        if (!expected.ok) throw new Error(`Unexpected default failure for ${definition.accountType}/${detail.value}: ${expected.error.code}`);
        // IDs are deterministic in insertion order; query by structural fields
        // below so the assertion remains independent of display labels.
        const actual = rows(database, `SELECT cash_flow_treatment, cash_flow_status
          FROM chart_account_cash_flow_classification c
          JOIN chart_account a ON a.id = c.chart_account_id
          WHERE a.account_type = ? AND a.detail_type = ? AND a.name LIKE 'Standard standard-chart-%'`, [definition.accountType, detail.value]);
        expect(actual.length).toBe(1);
        expect(actual.every(row => row['cash_flow_treatment'] === expected.value.treatment && row['cash_flow_status'] === expected.value.status)).toBeTrue();
      }
    }
    for (const accountType of ['BANK', 'CREDIT_CARD', 'OTHER_CURRENT_ASSET'] as const) {
      const definition = ACCOUNT_TYPE_CATALOG.find(item => item.accountType === accountType);
      if (!definition) throw new Error(`Missing taxonomy definition for ${accountType}`);
      for (const detail of definition.detailTypes) {
        const expected = getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType, detailType: detail.value });
        if (!expected.ok) throw new Error(`Unexpected financial default failure for ${accountType}/${detail.value}: ${expected.error.code}`);
        const actual = rows(database, `SELECT c.cash_flow_cash_role, c.cash_flow_treatment, c.cash_flow_status
          FROM financial_account_cash_flow_classification c
          JOIN financial_account a ON a.id = c.financial_account_id
          WHERE a.account_type = ? AND a.detail_type = ? AND a.name LIKE 'standard-financial-%'`, [accountType, detail.value]);
        expect(actual.length).toBe(1);
        expect(actual.every(row => row['cash_flow_cash_role'] === (expected.value.cashRole ?? null)
          && row['cash_flow_treatment'] === expected.value.treatment
          && row['cash_flow_status'] === expected.value.status)).toBeTrue();
      }
    }
    database.close();
  });

  it('rejects known account types that are incompatible with the financial-source role', async () => {
    for (const [accountType, detailType] of [
      ['EQUITY', 'Owner equity'],
      ['INCOME', 'Sales of product income'],
      ['EXPENSE', 'Advertising'],
    ] as const) {
      const database = await representativeSchema6Database();
      insertFinancialAccount(database, `financial-${accountType.toLowerCase()}`, 'BANK', detailType, 'Neutral institution', null, accountType);

      expect(() => migrateSchema6DatabaseTo7(database, { correlationId: `schema-7-role-mismatch-${accountType}` }))
        .toThrowError(/incompatible account role\/type: ACCOUNT_ROLE_TYPE_MISMATCH/);
      expect(schemaVersion(database)).toBe(6);
      expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
      expect(tableCount(database, 'audit_event')).toBe(1);
      database.close();
    }
  });

  it('rejects incomplete schema-6 sources before creating schema-7 objects', async () => {
    const database = await representativeSchema6Database();
    database.run('DROP TABLE tax_year_settings');

    expect(() => migrateSchema6DatabaseTo7(database)).toThrowError(/missing required schema-6 table.*tax_year_settings/);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    expect(schemaVersion(database)).toBe(6);
    database.close();
  });

  it('rejects schema-6 sources with a missing required column', async () => {
    const database = await representativeSchema6Database();
    database.run('ALTER TABLE tax_year_settings RENAME TO tax_year_settings_broken');
    database.run(`CREATE TABLE tax_year_settings (
      tax_year INTEGER PRIMARY KEY, federal_income_tax_account_ids_json TEXT NOT NULL,
      state_local_income_tax_account_ids_json TEXT NOT NULL, include_federal_income_tax INTEGER NOT NULL,
      include_state_local_income_tax INTEGER NOT NULL, confirmed_at_utc TEXT, accountant_note TEXT
    )`);
    database.run(`INSERT INTO tax_year_settings(tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
      include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc, accountant_note)
      SELECT tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
      include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc, NULL FROM tax_year_settings_broken`);
    // Recreate the intentionally malformed table without accountant_note.
    database.run('ALTER TABLE tax_year_settings RENAME TO tax_year_settings_with_extra');
    database.run(`CREATE TABLE tax_year_settings (
      tax_year INTEGER PRIMARY KEY, federal_income_tax_account_ids_json TEXT NOT NULL,
      state_local_income_tax_account_ids_json TEXT NOT NULL, include_federal_income_tax INTEGER NOT NULL,
      include_state_local_income_tax INTEGER NOT NULL, confirmed_at_utc TEXT
    )`);
    database.run(`INSERT INTO tax_year_settings(tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
      include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc)
      SELECT tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
      include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc FROM tax_year_settings_with_extra`);
    database.run('DROP TABLE tax_year_settings_with_extra');
    database.run('DROP TABLE tax_year_settings_broken');

    expect(() => migrateSchema6DatabaseTo7(database)).toThrowError(/missing required schema-6 column.*tax_year_settings\.accountant_note/);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    database.close();
  });

  it('rejects schema-6 sources with a missing or malformed required index', async () => {
    const database = await representativeSchema6Database();
    database.run('DROP INDEX idx_chart_account_parent_display');

    expect(() => migrateSchema6DatabaseTo7(database)).toThrowError(/missing or has an invalid schema-6 index.*idx_chart_account_parent_display/);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    database.close();
  });

  it('rejects duplicate schema-version rows and invalid company profile cardinality', async () => {
    const duplicateVersion = await representativeSchema6Database();
    duplicateVersion.run('INSERT INTO schema_version(version) VALUES (6)');
    expect(() => migrateSchema6DatabaseTo7(duplicateVersion)).toThrowError(/exactly one schema-version row/);
    expect(tableExists(duplicateVersion, 'financial_account_cash_flow_classification')).toBeFalse();
    duplicateVersion.close();

    const missingProfile = await representativeSchema6Database();
    missingProfile.run('DELETE FROM company_profile');
    expect(() => migrateSchema6DatabaseTo7(missingProfile)).toThrowError(/exactly one company_profile row/);
    expect(tableExists(missingProfile, 'financial_account_cash_flow_classification')).toBeFalse();
    missingProfile.close();
  });

  it('rejects non-ISO-UTC migration timestamps without changing the source', async () => {
    const database = await representativeSchema6Database();
    expect(() => migrateSchema6DatabaseTo7(database, { timestampUtc: 'not-a-date' })).toThrowError(/canonical ISO UTC/);
    expect(schemaVersion(database)).toBe(6);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    expect(tableCount(database, 'audit_event')).toBe(1);
    database.close();
  });

  it('rolls back a migration-time constraint failure, not just a post-commit validation failure', async () => {
    const database = await representativeSchema6Database();
    database.run(`INSERT INTO audit_event(id, timestamp_utc, operation, entity_type, entity_id, after_json, reason, correlation_id)
      VALUES ('schema-7-constraint:financial:bank-1:cash-flow', '2026-01-01T00:00:00.000Z', 'PREEXISTING', 'Test', 'bank-1', '{}', 'Collision', 'prior')`);

    expect(() => migrateSchema6DatabaseTo7(database, {
      correlationId: 'schema-7-constraint', timestampUtc: '2026-08-25T18:00:00.000Z',
    })).toThrow();
    expect(schemaVersion(database)).toBe(6);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    expect(tableCount(database, 'audit_event')).toBe(2);
    database.close();
  });

  it('rolls back a hierarchy cycle detected after classifications were created', async () => {
    const database = await representativeSchema6Database();
    database.run(`UPDATE chart_account SET parent_id = 'expense-child' WHERE id = 'expense-parent'`);
    database.run(`UPDATE chart_account SET parent_id = 'expense-parent' WHERE id = 'expense-child'`);

    expect(() => migrateSchema6DatabaseTo7(database, { correlationId: 'schema-7-cycle' })).toThrowError(/hierarchy contains a cycle/);
    expect(schemaVersion(database)).toBe(6);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    expect(tableCount(database, 'audit_event')).toBe(1);
    database.close();
  });

  it('rejects invalid schema-6 classification metadata before committing schema 7', async () => {
    const database = await representativeSchema6Database();
    database.run(`UPDATE financial_account SET classification_status = 'LEGACY_UNKNOWN' WHERE id = 'bank-1'`);

    expect(() => migrateSchema6DatabaseTo7(database, { correlationId: 'schema-7-status' })).toThrowError(/legacy classification status is invalid/);
    expect(schemaVersion(database)).toBe(6);
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    database.close();
  });

  it('retains a legacy review-required status even when the structural detail has a default', async () => {
    const database = await representativeSchema6Database();
    database.run(`UPDATE financial_account SET classification_status = 'REVIEW_REQUIRED' WHERE id = 'bank-1'`);

    migrateSchema6DatabaseTo7(database, { correlationId: 'schema-7-review-state' });
    expect(row(database, `SELECT cash_flow_cash_role, cash_flow_treatment, cash_flow_status
      FROM financial_account_cash_flow_classification WHERE financial_account_id = ?`, ['bank-1'])).toEqual({
      cash_flow_cash_role: 'REVIEW_REQUIRED', cash_flow_treatment: 'REVIEW_REQUIRED', cash_flow_status: 'REVIEW_REQUIRED',
    });
    expect(row(database, `SELECT reason FROM audit_event WHERE correlation_id = 'schema-7-review-state' AND entity_id = 'bank-1'`)).toEqual({
      reason: 'The existing schema-6 classification was marked Review required; preserve that review state during Cash Flow migration.',
    });
    database.close();
  });

  it('rejects incompatible source versions without changing the source database', async () => {
    const database = await representativeSchema6Database();
    database.run('UPDATE schema_version SET version = 5');

    expect(() => migrateSchema6DatabaseTo7(database)).toThrowError('Schema 7 migration requires schema 6, received schema 5.');
    expect(tableExists(database, 'financial_account_cash_flow_classification')).toBeFalse();
    database.close();
  });
});

async function representativeSchema6Database(): Promise<Database> {
  const sql = await initSqlJs({ locateFile: file => `assets/${file}` });
  const database = new sql.Database();
  database.run('PRAGMA foreign_keys = ON;');
  database.run(SQLITE_MIGRATIONS[0]);
  database.run('INSERT INTO schema_version(version) VALUES (0)');
  database.run(SQLITE_MIGRATIONS[1]);
  SQLITE_MIGRATIONS.slice(2).forEach(statement => database.run(statement));
  SQLITE_V3_MIGRATIONS.forEach(statement => database.run(statement));
  SQLITE_V4_MIGRATIONS.forEach(statement => database.run(statement));
  SQLITE_V5_MIGRATIONS.forEach(statement => database.run(statement));
  applySchema6Bootstrap(database);
  database.run('UPDATE schema_version SET version = 6');

  database.run(`INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year)
    VALUES ('company-1', 'Neutral Workshop LLC', 'USD', 1, 'CASH', 2026)`);
  database.run(`INSERT INTO company_profile(company_id, legal_name, display_name, created_at, modified_at)
    VALUES ('company-1', 'Neutral Workshop LLC', 'Neutral Workshop LLC', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
  insertFinancialAccount(database, 'bank-1', 'BANK', 'Checking', 'Neutral Bank', null);
  insertFinancialAccount(database, 'bank-custom', 'BANK', 'Imported bank detail', 'Neutral Bank', null);
  insertFinancialAccount(database, 'card-1', 'CREDIT_CARD', 'Credit Card', 'Neutral Card', null);
  insertChartAccount(database, 'expense-parent', 'Operating Expenses', null, 'EXPENSE', 'Other business expenses');
  insertChartAccount(database, 'expense-child', 'Office Expenses', 'expense-parent', 'EXPENSE', 'Office expenses');
  insertChartAccount(database, 'expense-custom', 'Imported expense', null, 'EXPENSE', 'Imported expense detail');
  insertChartAccount(database, 'loan-1', 'Loan payable', null, 'LIABILITY', 'Loan payable');
  insertChartAccount(database, 'owner-1', 'Owner draw', null, 'EQUITY', 'Owner draw');
  insertChartAccount(database, 'income-1', 'Sales', null, 'INCOME', 'Sales of product income');

  database.run(`INSERT INTO import_batch(id, destination_account_id, source_kind, source_name, source_hash, mapping_version,
    accepted_count, rejected_count, skipped_count, warning_count, total_accepted_minor, committed_at_utc)
    VALUES ('batch-1', 'bank-1', 'CSV', 'neutral.csv', 'hash', 'mapping', 1, 0, 0, 0, '-100', '2026-01-02T00:00:00.000Z')`);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, source_batch_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES ('transaction-1', 'bank-1', '2026-01-02', '-100', 'USD', 'SUPPLIES', 'Supplies', 'POSTED', 'batch-1', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'MANUAL')`);
  database.run(`INSERT INTO posting_split(id, transaction_id, chart_account_id, amount_minor, memo)
    VALUES ('split-1', 'transaction-1', 'expense-child', '-100', 'Preserved')`);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, transfer_match_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES ('transfer-left', 'bank-1', '2026-01-03', '-50', 'USD', 'TRANSFER', 'Transfer', 'MATCHED_TRANSFER', 'transfer-1', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'TRANSFER')`);
  database.run(`INSERT INTO transaction_record(id, account_id, posting_date, amount_minor, currency, raw_description, description,
    state, transfer_match_id, created_at_utc, modified_at_utc, categorization_source)
    VALUES ('transfer-right', 'card-1', '2026-01-03', '50', 'USD', 'TRANSFER', 'Transfer', 'MATCHED_TRANSFER', 'transfer-1', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', 'TRANSFER')`);
  database.run(`INSERT INTO transfer_match(id, left_transaction_id, right_transaction_id, confidence, rationale, confirmed_at_utc)
    VALUES ('transfer-1', 'transfer-left', 'transfer-right', 1, 'Exact match', '2026-01-03T00:00:00.000Z')`);
  database.run(`INSERT INTO transaction_rule(id, name, enabled, priority, conditions_json, chart_account_id, payee, memo, tags_json, suggest_exclude)
    VALUES ('rule-1', 'Neutral rule', 1, 1, '[]', 'expense-child', 'Neutral supplier', 'Preserved rule', '[]', 0)`);
  database.run(`INSERT INTO tax_year_settings(tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json,
    include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc, accountant_note)
    VALUES (2026, '[]', '["expense-child"]', 0, 1, '2026-01-01T00:00:00.000Z', 'Preserved settings')`);
  database.run(`INSERT INTO audit_event(id, timestamp_utc, operation, entity_type, entity_id, after_json, reason, correlation_id)
    VALUES ('prior-audit', '2026-01-01T00:00:00.000Z', 'CREATE', 'Company', 'company-1', '{}', 'Prior history', 'prior')`);
  return database;
}

function insertFinancialAccount(database: Database, id: string, type: string, detailType: string, institution: string, parentId: string | null, accountType = type): void {
  database.run(`INSERT INTO financial_account(id, type, account_type, classification_status, import_enabled,
    supported_source_kinds_json, opening_balance_source, detail_type, name, institution_or_entity,
    opening_balance_minor, opening_balance_date, archived, parent_account_id, locked)
    VALUES (?, ?, ?, 'CONFIRMED', 1, '["CSV"]', 'DERIVED_EQUITY', ?, ?, ?, '0', '2025-12-31', 0, ?, 0)`, [id, type, accountType, detailType, id, institution, parentId]);
}

function insertChartAccount(database: Database, id: string, name: string, parentId: string | null, type: string, detailType: string): void {
  insertChartAccountWithAccountType(database, id, name, parentId, type, type === 'LIABILITY' ? 'OTHER_CURRENT_LIABILITY' : type, detailType);
}

function insertChartAccountWithAccountType(database: Database, id: string, name: string, parentId: string | null, type: string, accountType: string, detailType: string): void {
  database.run(`INSERT INTO chart_account(id, name, parent_id, type, account_type, detail_type, description, display_order, archived, locked)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 0)`, [id, name, parentId, type, accountType, detailType, Number(id.endsWith('child')) ? 2 : id === 'expense-child' ? 2 : 1]);
}

function preservationSnapshot(database: Database) {
  return {
    companies: rows(database, 'SELECT * FROM company ORDER BY id'),
    companyProfile: rows(database, 'SELECT * FROM company_profile ORDER BY company_id'),
    accounts: rows(database, 'SELECT * FROM financial_account ORDER BY id'),
    charts: rows(database, 'SELECT * FROM chart_account ORDER BY id'),
    batches: rows(database, 'SELECT * FROM import_batch ORDER BY id'),
    transactions: rows(database, 'SELECT * FROM transaction_record ORDER BY id'),
    splits: rows(database, 'SELECT * FROM posting_split ORDER BY id'),
    transfers: rows(database, 'SELECT * FROM transfer_match ORDER BY id'),
    rules: rows(database, 'SELECT * FROM transaction_rule ORDER BY id'),
    taxSettings: rows(database, 'SELECT * FROM tax_year_settings ORDER BY tax_year'),
    audit: rows(database, `SELECT * FROM audit_event WHERE id = 'prior-audit'`),
    auditCount: tableCount(database, 'audit_event'),
    ledgerTotals: financialLedgerTotals(database),
    profitAndLossTotals: { postedSplitMinor: totalMinor(rows(database, `SELECT p.amount_minor FROM posting_split p JOIN transaction_record t ON t.id = p.transaction_id WHERE t.state = 'POSTED'`)) },
    balanceSheetTotals: { endingFinancialBalanceMinor: endingFinancialBalanceMinor(database) },
  };
}

function financialLedgerTotals(database: Database) {
  return {
    transactionMinor: totalMinor(rows(database, 'SELECT amount_minor FROM transaction_record')),
    splitMinor: totalMinor(rows(database, 'SELECT amount_minor FROM posting_split')),
    openingMinor: totalMinor(rows(database, 'SELECT opening_balance_minor FROM financial_account')),
  };
}

function endingFinancialBalanceMinor(database: Database): string {
  const total = new Map<string, bigint>(rows(database, 'SELECT id, opening_balance_minor FROM financial_account').map(row => [String(row['id']), BigInt(String(row['opening_balance_minor'] ?? '0'))]));
  for (const row of rows(database, `SELECT account_id, amount_minor FROM transaction_record WHERE state IN ('POSTED', 'MATCHED_TRANSFER')`)) {
    const accountId = String(row['account_id']);
    total.set(accountId, (total.get(accountId) ?? 0n) + BigInt(String(row['amount_minor'] ?? '0')));
  }
  return [...total.values()].reduce((sum, value) => sum + value, 0n).toString();
}

function totalMinor(rowsToSum: Array<Record<string, unknown>>): string {
  return rowsToSum.reduce((sum, row) => sum + BigInt(String(row['amount_minor'] ?? row['opening_balance_minor'] ?? '0')), 0n).toString();
}

function schemaVersion(database: Database): number {
  return Number(row(database, 'SELECT version FROM schema_version')['version']);
}

function tableCount(database: Database, table: string): number {
  return Number(row(database, `SELECT COUNT(*) AS count FROM ${table}`)['count']);
}

function tableExists(database: Database, table: string): boolean {
  return rows(database, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length === 1;
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
