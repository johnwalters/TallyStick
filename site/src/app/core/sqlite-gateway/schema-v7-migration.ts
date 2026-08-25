import { Database } from 'sql.js';
import {
  CashFlowClassification,
  getDefaultCashFlowClassification,
  validateCashFlowClassification,
} from '../domain-model/cash-flow-classification';
import { getAccountTypeDefinition, validateAccountUse, validateDetailType } from '../domain-model/account-taxonomy';

/** The next schema after the currently released schema 6. */
export const SCHEMA_7_VERSION = 7;

/**
 * Cash Flow classifications are deliberately kept in one-to-one tables rather
 * than added as nullable columns to the legacy records.  This keeps the
 * existing ledger schema stable while giving each role a real foreign key and
 * role-specific constraints (financial accounts have a cash role; Chart
 * accounts do not).
 */
export const SQLITE_V7_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE financial_account_cash_flow_classification (
    financial_account_id TEXT PRIMARY KEY REFERENCES financial_account(id) ON DELETE CASCADE,
    cash_flow_cash_role TEXT NOT NULL CHECK (cash_flow_cash_role IN ('CASH', 'CASH_EQUIVALENT', 'RESTRICTED_CASH', 'NOT_CASH', 'REVIEW_REQUIRED')),
    cash_flow_treatment TEXT NOT NULL CHECK (cash_flow_treatment IN ('CASH_BALANCE', 'OPERATING_REVENUE_EXPENSE', 'OPERATING_ASSET', 'OPERATING_LIABILITY', 'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED')),
    cash_flow_status TEXT NOT NULL CHECK (cash_flow_status IN ('CONFIRMED', 'REVIEW_REQUIRED')),
    cash_flow_source TEXT NOT NULL CHECK (cash_flow_source IN ('DEFAULT', 'MIGRATED', 'USER')),
    cash_flow_rationale TEXT NOT NULL CHECK (length(trim(cash_flow_rationale)) > 0),
    cash_flow_modified_at_utc TEXT
  );`,
  `CREATE TABLE chart_account_cash_flow_classification (
    chart_account_id TEXT PRIMARY KEY REFERENCES chart_account(id) ON DELETE CASCADE,
    cash_flow_treatment TEXT NOT NULL CHECK (cash_flow_treatment IN ('CASH_BALANCE', 'OPERATING_REVENUE_EXPENSE', 'OPERATING_ASSET', 'OPERATING_LIABILITY', 'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED')),
    cash_flow_status TEXT NOT NULL CHECK (cash_flow_status IN ('CONFIRMED', 'REVIEW_REQUIRED')),
    cash_flow_source TEXT NOT NULL CHECK (cash_flow_source IN ('DEFAULT', 'MIGRATED', 'USER')),
    cash_flow_rationale TEXT NOT NULL CHECK (length(trim(cash_flow_rationale)) > 0),
    cash_flow_modified_at_utc TEXT
  );`,
  `CREATE INDEX idx_financial_account_cash_flow_classification
   ON financial_account_cash_flow_classification(cash_flow_cash_role, cash_flow_treatment, cash_flow_status);`,
  `CREATE INDEX idx_chart_account_cash_flow_classification
   ON chart_account_cash_flow_classification(cash_flow_treatment, cash_flow_status);`,
];

// Keep the migration vocabulary parallel to the earlier schema modules for
// callers that treat each statement list as a versioned migration bundle.
export const SQLITE_V7_MIGRATIONS = SQLITE_V7_SCHEMA_STATEMENTS;

const SCHEMA_6_REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  schema_version: ['version'],
  company: ['id', 'name', 'currency', 'fiscal_year_start_month', 'accounting_basis', 'active_tax_year'],
  company_profile: ['company_id', 'legal_name', 'display_name', 'doing_business_as', 'entity_type', 'address_line_1', 'address_line_2', 'locality', 'region', 'postal_code', 'country_code', 'phone', 'email', 'website', 'tax_identifier', 'created_at', 'modified_at'],
  financial_account: ['id', 'type', 'name', 'institution_or_entity', 'opening_balance_minor', 'opening_balance_date', 'archived', 'last_four', 'detail_type', 'parent_account_id', 'description', 'locked', 'account_type', 'classification_status', 'import_enabled', 'supported_source_kinds_json', 'opening_balance_source'],
  chart_account: ['id', 'name', 'parent_id', 'type', 'display_order', 'archived', 'account_type', 'detail_type', 'description', 'locked'],
  import_batch: ['id', 'destination_account_id', 'source_kind', 'source_name', 'source_hash', 'mapping_version', 'accepted_count', 'rejected_count', 'skipped_count', 'warning_count', 'total_accepted_minor', 'committed_at_utc'],
  transaction_record: ['id', 'account_id', 'posting_date', 'amount_minor', 'currency', 'raw_description', 'description', 'state', 'source_batch_id', 'exclusion_reason', 'transfer_match_id', 'created_at_utc', 'modified_at_utc', 'transaction_date', 'raw_payee', 'payee', 'memo', 'reference', 'source_row_number', 'categorization_source', 'rule_id', 'rationale', 'posted_at_utc', 'excluded_at_utc', 'undone_at_utc'],
  posting_split: ['id', 'transaction_id', 'chart_account_id', 'amount_minor', 'memo'],
  audit_event: ['id', 'timestamp_utc', 'operation', 'entity_type', 'entity_id', 'before_json', 'after_json', 'reason', 'correlation_id'],
  transfer_match: ['id', 'left_transaction_id', 'right_transaction_id', 'confidence', 'rationale', 'confirmed_at_utc'],
  transaction_rule: ['id', 'name', 'enabled', 'priority', 'conditions_json', 'chart_account_id', 'payee', 'memo', 'tags_json', 'suggest_exclude'],
  tax_year_settings: ['tax_year', 'federal_income_tax_account_ids_json', 'state_local_income_tax_account_ids_json', 'include_federal_income_tax', 'include_state_local_income_tax', 'confirmed_at_utc', 'accountant_note'],
};

const SCHEMA_6_REQUIRED_INDEXES: Readonly<Record<string, readonly string[]>> = {
  idx_transaction_state_date_account: ['state', 'posting_date', 'account_id'],
  idx_transaction_transfer_date_account: ['transfer_match_id', 'posting_date', 'account_id'],
  idx_posting_split_transaction_chart: ['transaction_id', 'chart_account_id'],
  idx_posting_split_chart_transaction: ['chart_account_id', 'transaction_id'],
  idx_chart_account_parent_display: ['parent_id', 'display_order'],
};

export interface Schema7MigrationOptions {
  readonly timestampUtc?: string;
  readonly correlationId?: string;
}

interface SqlRow {
  readonly [key: string]: unknown;
}

interface ClassificationTarget {
  readonly id: string;
  readonly accountType: string;
  readonly detailType: string;
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly legacyClassificationStatus?: string;
}

/**
 * Migrates a complete schema-6 database to schema 7 atomically. Repeating the
 * operation on an already migrated database is a no-op, which is important for
 * both reopen and host-recovery paths.
 */
export function migrateSchema6DatabaseTo7(database: Database, options: Schema7MigrationOptions = {}): void {
  const version = readSchemaVersion(database);
  if (version === SCHEMA_7_VERSION) return;
  if (version !== 6) throw new Error(`Schema 7 migration requires schema 6, received schema ${version}.`);

  // Reject malformed sources before BEGIN/DDL so a bad schema-6 database is
  // never partially promoted or made to look like schema 7.
  validateSchema6Source(database);
  validateMigrationTimestamp(options.timestampUtc ?? new Date().toISOString());

  database.run('PRAGMA foreign_keys = ON;');
  database.run('BEGIN');
  try {
    applySchema7Migration(database, options);
    database.run('UPDATE schema_version SET version = ?', [SCHEMA_7_VERSION]);
    database.run('COMMIT');
  } catch (error) {
    try { database.run('ROLLBACK'); } catch { /* preserve the migration failure */ }
    throw error;
  }
}

/** Short alias used by migration registries. */
export const migrateSchema6To7 = migrateSchema6DatabaseTo7;

/** Runs inside the caller's migration transaction and does not update the version. */
export function applySchema7Migration(database: Database, options: Schema7MigrationOptions = {}): void {
  const timestampUtc = options.timestampUtc ?? new Date().toISOString();
  validateMigrationTimestamp(timestampUtc);
  validateSchema6Source(database);
  const companyId = String(rows(database, 'SELECT id FROM company ORDER BY id LIMIT 1')[0]?.['id'] ?? 'database');
  const correlationId = options.correlationId ?? `schema-6-to-7:${companyId}`;
  const priorCounts = preservedCounts(database);
  const priorAuditCount = tableCount(database, 'audit_event');

  SQLITE_V7_SCHEMA_STATEMENTS.forEach(statement => database.run(statement));

  const financialAccounts = rows(database, `SELECT id, account_type, detail_type, classification_status
    FROM financial_account ORDER BY id`).map(row => ({
      id: requiredText(row, 'id', 'financial account'),
      accountType: requiredText(row, 'account_type', 'financial account'),
      detailType: requiredText(row, 'detail_type', 'financial account'),
      accountRole: 'FINANCIAL_SOURCE' as const,
      legacyClassificationStatus: optionalText(row, 'classification_status'),
    }));
  const chartAccounts = rows(database, `SELECT id, account_type, detail_type
    FROM chart_account ORDER BY id`).map(row => ({
      id: requiredText(row, 'id', 'Chart account'),
      accountType: requiredText(row, 'account_type', 'Chart account'),
      detailType: requiredText(row, 'detail_type', 'Chart account'),
      accountRole: 'CHART' as const,
    }));

  for (const target of financialAccounts) {
    const classification = migratedClassification(target);
    insertFinancialClassification(database, target.id, classification, timestampUtc);
    insertClassificationAudit(database, target, classification, timestampUtc, correlationId);
  }
  for (const target of chartAccounts) {
    const classification = migratedClassification(target);
    insertChartClassification(database, target.id, classification, timestampUtc);
    insertClassificationAudit(database, target, classification, timestampUtc, correlationId);
  }

  validateSchema7(database, priorCounts, priorAuditCount, financialAccounts.length + chartAccounts.length, timestampUtc);
  insertAudit(database, {
    id: `${correlationId}:schema`,
    timestampUtc,
    operation: 'MIGRATE_CASH_FLOW_SCHEMA_7',
    entityType: 'CashFlowSchema',
    entityId: 'schema-7',
    before: { schemaVersion: 6 },
    after: { schemaVersion: 7, financialClassificationCount: financialAccounts.length, chartClassificationCount: chartAccounts.length },
    reason: 'Create Cash Flow classifications from structural account metadata and preserve ambiguous records for review.',
    correlationId,
  });
}

function migratedClassification(target: ClassificationTarget): CashFlowClassification {
  const definition = getAccountTypeDefinition(target.accountType);
  if (!definition.ok) throw new Error(`Schema 7 account ${target.id} has an unknown account type: ${target.accountType}.`);
  const accountUse = validateAccountUse({ accountType: target.accountType, requestedRole: target.accountRole });
  if (!accountUse.ok) throw new Error(`Schema 7 account ${target.id} has an incompatible account role/type: ${accountUse.error.code}.`);
  if (target.accountRole === 'FINANCIAL_SOURCE'
    && target.legacyClassificationStatus !== undefined
    && !['CONFIRMED', 'REVIEW_REQUIRED'].includes(target.legacyClassificationStatus)) {
    throw new Error(`Schema 7 legacy classification status is invalid for ${target.id}.`);
  }
  const detailValidation = validateDetailType(target.accountType, target.detailType, true);
  if (!detailValidation.ok) throw new Error(`Schema 7 detail classification is invalid for ${target.id}: ${detailValidation.error.code}.`);

  const seeded = getDefaultCashFlowClassification({
    accountRole: target.accountRole,
    accountType: definition.value.accountType,
    detailType: target.detailType,
  });
  if (!seeded.ok) throw new Error(`Schema 7 Cash Flow classification failed for ${target.id}: ${seeded.error.code}.`);

  // Migration provenance is distinct from a newly-created account default. Do
  // not carry the legacy taxonomy status forward as Cash Flow confirmation:
  // custom and ambiguous structures remain explicitly review-required.
  let classification: CashFlowClassification = { ...seeded.value, source: 'MIGRATED', modifiedAtUtc: undefined };
  if (target.legacyClassificationStatus === 'REVIEW_REQUIRED' && classification.status === 'CONFIRMED') {
    classification = {
      ...(target.accountRole === 'FINANCIAL_SOURCE' ? { cashRole: 'REVIEW_REQUIRED' as const } : {}),
      treatment: 'REVIEW_REQUIRED',
      status: 'REVIEW_REQUIRED',
      source: 'MIGRATED',
      rationale: 'The existing schema-6 classification was marked Review required; retain that review state during Cash Flow migration.',
    };
  }
  const validated = validateCashFlowClassification({
    accountRole: target.accountRole,
    accountType: definition.value.accountType,
    detailType: target.detailType,
    classification,
  });
  if (!validated.ok) throw new Error(`Schema 7 Cash Flow classification is incompatible for ${target.id}: ${validated.error.code}.`);
  return validated.value.classification;
}

function insertFinancialClassification(database: Database, accountId: string, classification: CashFlowClassification, timestampUtc: string): void {
  if (classification.cashRole === undefined) throw new Error(`Schema 7 financial account ${accountId} is missing a cash role.`);
  database.run(`INSERT INTO financial_account_cash_flow_classification(
      financial_account_id, cash_flow_cash_role, cash_flow_treatment, cash_flow_status,
      cash_flow_source, cash_flow_rationale, cash_flow_modified_at_utc)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    accountId,
    classification.cashRole,
    classification.treatment,
    classification.status,
    classification.source,
    classification.rationale,
    timestampUtc,
  ]);
}

function insertChartClassification(database: Database, accountId: string, classification: CashFlowClassification, timestampUtc: string): void {
  if (classification.cashRole !== undefined) throw new Error(`Schema 7 Chart account ${accountId} unexpectedly has a cash role.`);
  database.run(`INSERT INTO chart_account_cash_flow_classification(
      chart_account_id, cash_flow_treatment, cash_flow_status,
      cash_flow_source, cash_flow_rationale, cash_flow_modified_at_utc)
    VALUES (?, ?, ?, ?, ?, ?)`, [
    accountId,
    classification.treatment,
    classification.status,
    classification.source,
    classification.rationale,
    timestampUtc,
  ]);
}

function insertClassificationAudit(database: Database, target: ClassificationTarget, classification: CashFlowClassification, timestampUtc: string, correlationId: string): void {
  insertAudit(database, {
    id: `${correlationId}:${target.accountRole === 'FINANCIAL_SOURCE' ? 'financial' : 'chart'}:${target.id}:cash-flow`,
    timestampUtc,
    operation: 'MIGRATE_ACCOUNT_CASH_FLOW_CLASSIFICATION_SCHEMA_7',
    entityType: target.accountRole === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
    entityId: target.id,
    // Account names, institutions, payees, and other customer data are
    // intentionally absent from migration evidence. Structural fields are
    // sufficient to explain the derived result.
    before: {
      accountRole: target.accountRole,
      accountType: target.accountType,
      detailType: target.detailType,
      legacyClassificationStatus: target.legacyClassificationStatus,
    },
    after: {
      cashRole: classification.cashRole,
      treatment: classification.treatment,
      status: classification.status,
      source: classification.source,
    },
    reason: target.legacyClassificationStatus === 'REVIEW_REQUIRED'
      ? 'The existing schema-6 classification was marked Review required; preserve that review state during Cash Flow migration.'
      : classification.status === 'REVIEW_REQUIRED'
        ? 'The structural account detail is custom or ambiguous; Cash Flow review is required.'
      : 'Derive the Cash Flow classification from the structural account type and standard detail.',
    correlationId,
  });
}

function validateSchema7(
  database: Database,
  priorCounts: Readonly<Record<string, number>>,
  priorAuditCount: number,
  expectedClassificationAuditCount: number,
  timestampUtc: string,
): void {
  const integrity = String(rows(database, 'PRAGMA integrity_check')[0]?.['integrity_check'] ?? 'unknown');
  if (integrity.toLowerCase() !== 'ok') throw new Error(`Schema 7 integrity check failed: ${integrity}.`);
  const foreignKeyViolations = rows(database, 'PRAGMA foreign_key_check');
  if (foreignKeyViolations.length > 0) throw new Error(`Schema 7 foreign-key check found ${foreignKeyViolations.length} violation(s).`);

  const afterCounts = preservedCounts(database);
  for (const table of Object.keys(priorCounts)) {
    if (afterCounts[table] !== priorCounts[table]) throw new Error(`Schema 7 changed ${table} record count.`);
  }

  const financial = rows(database, `SELECT f.id, f.account_type, f.detail_type,
      c.cash_flow_cash_role, c.cash_flow_treatment, c.cash_flow_status,
      c.cash_flow_source, c.cash_flow_rationale
    FROM financial_account f
    JOIN financial_account_cash_flow_classification c ON c.financial_account_id = f.id`);
  if (financial.length !== tableCount(database, 'financial_account')) throw new Error('Schema 7 did not classify every financial account.');
  for (const row of financial) validatePersistedClassification(row, 'FINANCIAL_SOURCE');

  const chart = rows(database, `SELECT a.id, a.account_type, a.detail_type,
      c.cash_flow_treatment, c.cash_flow_status, c.cash_flow_source, c.cash_flow_rationale
    FROM chart_account a
    JOIN chart_account_cash_flow_classification c ON c.chart_account_id = a.id`);
  if (chart.length !== tableCount(database, 'chart_account')) throw new Error('Schema 7 did not classify every Chart account.');
  for (const row of chart) validatePersistedClassification(row, 'CHART');

  const auditCount = tableCount(database, 'audit_event');
  if (auditCount !== priorAuditCount + expectedClassificationAuditCount) {
    // The schema summary event is inserted after this validation. Keep this
    // check at N+rows so a failed validation cannot hide missing row evidence.
    throw new Error('Schema 7 migration audit-event count is incomplete.');
  }
  validateMigrationTimestamp(timestampUtc);
  validateNoCycles(database, 'financial_account', 'parent_account_id');
  validateNoCycles(database, 'chart_account', 'parent_id');
}

function validatePersistedClassification(row: SqlRow, accountRole: 'FINANCIAL_SOURCE' | 'CHART'): void {
  const accountType = requiredText(row, 'account_type', 'classification');
  const detailType = requiredText(row, 'detail_type', 'classification');
  const classification: CashFlowClassification = {
    ...(row['cash_flow_cash_role'] === null || row['cash_flow_cash_role'] === undefined ? {} : { cashRole: String(row['cash_flow_cash_role']) as CashFlowClassification['cashRole'] }),
    treatment: String(row['cash_flow_treatment']) as CashFlowClassification['treatment'],
    status: String(row['cash_flow_status']) as CashFlowClassification['status'],
    source: String(row['cash_flow_source']) as CashFlowClassification['source'],
    rationale: String(row['cash_flow_rationale']),
  };
  if (accountRole === 'FINANCIAL_SOURCE' && classification.cashRole === undefined) throw new Error(`Schema 7 financial account ${String(row['id'])} is missing a cash role.`);
  if (accountRole === 'CHART' && classification.cashRole !== undefined) throw new Error(`Schema 7 Chart account ${String(row['id'])} has a cash role.`);
  const validated = validateCashFlowClassification({ accountRole, accountType, detailType, classification });
  if (!validated.ok) throw new Error(`Schema 7 classification validation failed for ${String(row['id'])}: ${validated.error.code}.`);
}

function validateNoCycles(database: Database, table: 'financial_account' | 'chart_account', parentColumn: 'parent_account_id' | 'parent_id'): void {
  const graph = new Map(rows(database, `SELECT id, ${parentColumn} AS parent_id FROM ${table}`).map(row => [
    String(row['id']),
    row['parent_id'] === null || row['parent_id'] === undefined ? undefined : String(row['parent_id']),
  ]));
  for (const id of graph.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor) {
      if (visited.has(cursor)) throw new Error(`Schema 7 ${table} hierarchy contains a cycle at ${cursor}.`);
      visited.add(cursor);
      cursor = graph.get(cursor);
    }
  }
}

function insertAudit(database: Database, event: {
  readonly id: string;
  readonly timestampUtc: string;
  readonly operation: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly correlationId: string;
}): void {
  database.run(`INSERT INTO audit_event(
      id, timestamp_utc, operation, entity_type, entity_id,
      before_json, after_json, reason, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    event.id,
    event.timestampUtc,
    event.operation,
    event.entityType,
    event.entityId,
    JSON.stringify(event.before),
    JSON.stringify(event.after),
    event.reason,
    event.correlationId,
  ]);
}

function readSchemaVersion(database: Database): number {
  if (!tableExists(database, 'schema_version')) throw new Error('Schema 7 source is missing required table schema_version.');
  const versions = rows(database, 'SELECT version FROM schema_version');
  if (versions.length !== 1) throw new Error(`Schema 7 source requires exactly one schema-version row; found ${versions.length}.`);
  const version = Number(versions[0]['version']);
  if (!Number.isInteger(version)) throw new Error('Schema 7 source schema-version row must contain an integer version.');
  return version;
}

function preservedCounts(database: Database): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.keys(SCHEMA_6_REQUIRED_COLUMNS)
    .filter(table => table !== 'schema_version' && table !== 'audit_event')
    .map(table => [table, tableCount(database, table)]));
}

function validateSchema6Source(database: Database): void {
  const missingTables = Object.keys(SCHEMA_6_REQUIRED_COLUMNS).filter(table => !tableExists(database, table));
  if (missingTables.length > 0) {
    throw new Error(`Schema 7 source is missing required schema-6 table(s): ${missingTables.join(', ')}.`);
  }

  const missingColumns: string[] = [];
  for (const [table, columns] of Object.entries(SCHEMA_6_REQUIRED_COLUMNS)) {
    const actual = new Set(rows(database, `PRAGMA table_info(${table})`).map(row => String(row['name'])));
    for (const column of columns) if (!actual.has(column)) missingColumns.push(`${table}.${column}`);
  }
  if (missingColumns.length > 0) {
    throw new Error(`Schema 7 source is missing required schema-6 column(s): ${missingColumns.join(', ')}.`);
  }

  const missingIndexes: string[] = [];
  for (const [index, columns] of Object.entries(SCHEMA_6_REQUIRED_INDEXES)) {
    const indexExists = rows(database, `SELECT name FROM sqlite_master WHERE type = 'index' AND name = '${index}'`).length > 0;
    if (!indexExists) {
      missingIndexes.push(index);
      continue;
    }
    const actual = rows(database, `PRAGMA index_info(${index})`)
      .sort((left, right) => Number(left['seqno']) - Number(right['seqno']))
      .map(row => String(row['name']));
    if (actual.length !== columns.length || actual.some((column, position) => column !== columns[position])) missingIndexes.push(index);
  }
  if (missingIndexes.length > 0) {
    throw new Error(`Schema 7 source is missing or has an invalid schema-6 index: ${missingIndexes.join(', ')}.`);
  }

  const schemaVersionRows = rows(database, 'SELECT version FROM schema_version');
  if (schemaVersionRows.length !== 1 || Number(schemaVersionRows[0]['version']) !== 6) {
    throw new Error(`Schema 7 source requires exactly one schema-6 version row; found ${schemaVersionRows.length}.`);
  }
  const companies = rows(database, 'SELECT id, name FROM company');
  if (companies.length !== 1) throw new Error(`Schema 7 source requires exactly one company row; found ${companies.length}.`);
  const companyId = requiredText(companies[0], 'id', 'company');
  requiredText(companies[0], 'name', 'company');
  const profiles = rows(database, 'SELECT company_id, legal_name, display_name FROM company_profile');
  if (profiles.length !== 1) throw new Error(`Schema 7 source requires exactly one company_profile row; found ${profiles.length}.`);
  if (String(profiles[0]['company_id'] ?? '') !== companyId) throw new Error('Schema 7 company_profile must reference the sole company row.');
  requiredText(profiles[0], 'legal_name', 'company_profile');
  requiredText(profiles[0], 'display_name', 'company_profile');
}

function validateMigrationTimestamp(timestampUtc: string): void {
  if (!timestampUtc.trim() || Number.isNaN(Date.parse(timestampUtc)) || new Date(timestampUtc).toISOString() !== timestampUtc) {
    throw new Error('Schema 7 migration timestamp must be a canonical ISO UTC timestamp.');
  }
}

function requiredText(row: SqlRow, column: string, entity: string): string {
  const value = String(row[column] ?? '').trim();
  if (!value) throw new Error(`Schema 7 ${entity} ${column} cannot be blank.`);
  return value;
}

function optionalText(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return value === null || value === undefined ? undefined : String(value);
}

function rows(database: Database, sql: string): SqlRow[] {
  const result = database.exec(sql)[0];
  if (!result) return [];
  return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
}

function tableExists(database: Database, table: string): boolean {
  return rows(database, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0;
}

function tableCount(database: Database, table: string): number {
  return Number(rows(database, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.['count'] ?? 0);
}
