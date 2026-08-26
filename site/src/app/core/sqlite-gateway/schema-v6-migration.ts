import { Database } from 'sql.js';
import { validateDetailType, validateImportCapability } from '../domain-model/account-taxonomy';

export const SCHEMA_6_VERSION = 6;

export const SQLITE_V6_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE company_profile (
    company_id TEXT PRIMARY KEY REFERENCES company(id),
    legal_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    doing_business_as TEXT,
    entity_type TEXT,
    address_line_1 TEXT,
    address_line_2 TEXT,
    locality TEXT,
    region TEXT,
    postal_code TEXT,
    country_code TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    tax_identifier TEXT,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL
  );`,
  `ALTER TABLE financial_account ADD COLUMN account_type TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE financial_account ADD COLUMN classification_status TEXT NOT NULL DEFAULT 'CONFIRMED';`,
  `ALTER TABLE financial_account ADD COLUMN import_enabled INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE financial_account ADD COLUMN supported_source_kinds_json TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE financial_account ADD COLUMN opening_balance_source TEXT NOT NULL DEFAULT 'DERIVED_EQUITY';`,
  `CREATE INDEX idx_transaction_state_date_account ON transaction_record(state, posting_date, account_id);`,
  `CREATE INDEX idx_transaction_transfer_date_account ON transaction_record(transfer_match_id, posting_date, account_id);`,
  `CREATE INDEX idx_posting_split_transaction_chart ON posting_split(transaction_id, chart_account_id);`,
  `CREATE INDEX idx_posting_split_chart_transaction ON posting_split(chart_account_id, transaction_id);`,
  `CREATE INDEX idx_chart_account_parent_display ON chart_account(parent_id, display_order);`,
];

const PRESERVED_TABLES = [
  'company',
  'financial_account',
  'chart_account',
  'import_batch',
  'transaction_record',
  'posting_split',
  'transfer_match',
  'transaction_rule',
  'tax_year_settings',
] as const;

interface MigrationOptions {
  readonly timestampUtc?: string;
  readonly correlationId?: string;
}

interface SqlRow {
  readonly [key: string]: unknown;
}

interface LegacyAccountRow extends SqlRow {
  readonly id: string;
  readonly type: string;
  readonly detail_type: string;
}

/**
 * Migrates a complete schema-5 database in one transaction. The application
 * now advances schema-6 files through the registered schema-7 migration on
 * reopen; this entry point remains available for focused schema-6 migration
 * tests and intermediate migration callers.
 */
export function migrateSchema5DatabaseTo6(database: Database, options: MigrationOptions = {}): void {
  const version = readSchemaVersion(database);
  if (version === SCHEMA_6_VERSION) return;
  if (version !== 5) throw new Error(`Schema 6 migration requires schema 5, received schema ${version}.`);
  database.run('BEGIN');
  try {
    applySchema6Migration(database, options);
    database.run('UPDATE schema_version SET version = ?', [SCHEMA_6_VERSION]);
    database.run('COMMIT');
  } catch (error) {
    try { database.run('ROLLBACK'); } catch { /* preserve the migration failure */ }
    throw error;
  }
}

/** Runs inside the gateway's existing all-version migration transaction. */
export function applySchema6Migration(database: Database, options: MigrationOptions = {}): void {
  const beforeCounts = recordCounts(database, PRESERVED_TABLES);
  const existingAuditCount = tableCount(database, 'audit_event');
  const timestampUtc = options.timestampUtc ?? new Date().toISOString();
  const companyRows = rows(database, 'SELECT id, name FROM company ORDER BY id');
  if (companyRows.length !== 1) throw new Error(`Schema 6 requires exactly one company row; found ${companyRows.length}.`);
  const companyId = String(companyRows[0]['id']);
  const companyName = String(companyRows[0]['name']).trim();
  if (!companyName) throw new Error('Schema 6 company legal name cannot be blank.');
  const correlationId = options.correlationId ?? `schema-5-to-6:${companyId}`;

  SQLITE_V6_SCHEMA_STATEMENTS.forEach(sql => database.run(sql));
  database.run(
    `INSERT INTO company_profile(company_id, legal_name, display_name, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?)`,
    [companyId, companyName, companyName, timestampUtc, timestampUtc],
  );
  insertAudit(database, {
    id: `${correlationId}:company-profile`,
    timestampUtc,
    operation: 'MIGRATE_COMPANY_PROFILE_SCHEMA_6',
    entityType: 'CompanyProfile',
    entityId: companyId,
    before: { companyId, name: companyName },
    after: { companyId, legalName: companyName, displayName: companyName },
    reason: 'Seed schema-6 Company Settings from the existing company row.',
    correlationId,
  });

  const legacyAccounts = rows(database, 'SELECT id, type, detail_type FROM financial_account ORDER BY id') as unknown as LegacyAccountRow[];
  for (const account of legacyAccounts) migrateAccount(database, account, timestampUtc, correlationId);

  validateSchema6(database, beforeCounts, existingAuditCount, legacyAccounts.length + 1);
}

/** Creates schema-6 metadata for a brand-new, empty database before seeding. */
export function applySchema6Bootstrap(database: Database): void {
  const populatedTables = PRESERVED_TABLES.filter(table => tableCount(database, table) > 0);
  if (populatedTables.length > 0 || tableCount(database, 'audit_event') > 0) {
    throw new Error(`Schema 6 bootstrap requires an empty database; found data in ${populatedTables.join(', ') || 'audit_event'}.`);
  }
  SQLITE_V6_SCHEMA_STATEMENTS.forEach(sql => database.run(sql));
}

function migrateAccount(database: Database, account: LegacyAccountRow, timestampUtc: string, correlationId: string): void {
  const id = String(account.id);
  const legacyType = String(account.type);
  const legacyDetailType = String(account.detail_type ?? '').trim();
  if (!legacyDetailType) throw new Error(`Financial account ${id} has a blank schema-5 detail type.`);

  let accountType: 'BANK' | 'CREDIT_CARD' | 'OTHER_CURRENT_ASSET';
  let detailType: string;
  let classificationStatus: 'CONFIRMED' | 'REVIEW_REQUIRED' = 'CONFIRMED';
  let supportedSourceKinds: readonly string[];
  let warning: string | undefined;

  if (legacyType === 'BANK') {
    accountType = 'BANK';
    detailType = legacyDetailType;
    supportedSourceKinds = ['CSV', 'EXCEL', 'QBO_OFX'];
  } else if (legacyType === 'CREDIT_CARD') {
    accountType = 'CREDIT_CARD';
    detailType = 'Credit Card';
    supportedSourceKinds = ['CSV', 'EXCEL', 'QBO_OFX'];
  } else if (legacyType === 'ENTITY') {
    accountType = 'OTHER_CURRENT_ASSET';
    supportedSourceKinds = ['CSV', 'EXCEL', 'AMAZON'];
    if (['Marketplace', 'Marketplace clearing'].includes(legacyDetailType)) {
      detailType = 'Marketplace clearing';
    } else if (legacyDetailType === 'Clearing account') {
      detailType = 'Clearing account';
    } else {
      detailType = 'Clearing account';
      classificationStatus = 'REVIEW_REQUIRED';
      warning = `Legacy Entity detail type "${legacyDetailType}" requires classification review.`;
    }
  } else {
    throw new Error(`Unsupported schema-5 financial account type ${legacyType} for account ${id}.`);
  }

  database.run(
    `UPDATE financial_account
     SET account_type = ?, detail_type = ?, classification_status = ?, import_enabled = 1,
         supported_source_kinds_json = ?, opening_balance_source = 'DERIVED_EQUITY'
     WHERE id = ?`,
    [accountType, detailType, classificationStatus, JSON.stringify(supportedSourceKinds), id],
  );
  insertAudit(database, {
    id: `${correlationId}:financial-account:${id}`,
    timestampUtc,
    operation: 'MIGRATE_FINANCIAL_ACCOUNT_CLASSIFICATION_SCHEMA_6',
    entityType: 'FinancialAccount',
    entityId: id,
    before: { type: legacyType, detailType: legacyDetailType },
    after: { accountType, detailType, classificationStatus, importEnabled: true, supportedSourceKinds, openingBalanceSource: 'DERIVED_EQUITY' },
    reason: warning ?? 'Map the legacy structural type and detail metadata to the generic account taxonomy.',
    correlationId,
  });
}

function validateSchema6(
  database: Database,
  beforeCounts: Readonly<Record<string, number>>,
  existingAuditCount: number,
  expectedMigrationAuditCount: number,
): void {
  const integrityMessage = String(rows(database, 'PRAGMA integrity_check')[0]?.['integrity_check'] ?? 'unknown');
  if (integrityMessage.toLowerCase() !== 'ok') throw new Error(`Schema 6 integrity check failed: ${integrityMessage}.`);
  const foreignKeyViolations = rows(database, 'PRAGMA foreign_key_check');
  if (foreignKeyViolations.length > 0) throw new Error(`Schema 6 foreign-key check found ${foreignKeyViolations.length} violation(s).`);

  const afterCounts = recordCounts(database, PRESERVED_TABLES);
  for (const table of PRESERVED_TABLES) {
    if (afterCounts[table] !== beforeCounts[table]) throw new Error(`Schema 6 changed ${table} record count.`);
  }
  if (tableCount(database, 'audit_event') !== existingAuditCount + expectedMigrationAuditCount) {
    throw new Error('Schema 6 migration audit-event count is incomplete.');
  }

  const profiles = rows(database, 'SELECT company_id, legal_name, display_name FROM company_profile');
  if (profiles.length !== 1 || !String(profiles[0]['legal_name']).trim() || !String(profiles[0]['display_name']).trim()) {
    throw new Error('Schema 6 company profile is incomplete.');
  }

  const accounts = rows(database, `SELECT id, type, account_type, detail_type, classification_status,
    import_enabled, supported_source_kinds_json, opening_balance_source FROM financial_account`);
  for (const account of accounts) validateAccountClassification(account);
  validateNoCycles(database, 'financial_account', 'parent_account_id');
  validateNoCycles(database, 'chart_account', 'parent_id');
}

function validateAccountClassification(account: SqlRow): void {
  const id = String(account['id']);
  const legacyType = String(account['type']);
  const accountType = String(account['account_type']);
  const detailType = String(account['detail_type']);
  const expectedType = legacyType === 'BANK' ? 'BANK' : legacyType === 'CREDIT_CARD' ? 'CREDIT_CARD' : legacyType === 'ENTITY' ? 'OTHER_CURRENT_ASSET' : undefined;
  if (!expectedType || accountType !== expectedType) throw new Error(`Schema 6 account classification mismatch for ${id}.`);
  const detailValidation = validateDetailType(accountType, detailType, true);
  if (!detailValidation.ok) throw new Error(`Schema 6 detail classification is invalid for ${id}: ${detailValidation.error.code}.`);
  if (!['CONFIRMED', 'REVIEW_REQUIRED'].includes(String(account['classification_status']))) throw new Error(`Schema 6 classification status is invalid for ${id}.`);
  if (String(account['opening_balance_source']) !== 'DERIVED_EQUITY') throw new Error(`Schema 6 opening balance source is invalid for ${id}.`);
  let sourceKinds: unknown;
  try { sourceKinds = JSON.parse(String(account['supported_source_kinds_json'])); } catch { throw new Error(`Schema 6 import source metadata is invalid JSON for ${id}.`); }
  if (!Array.isArray(sourceKinds)) throw new Error(`Schema 6 import source metadata is not an array for ${id}.`);
  const importValidation = validateImportCapability({
    accountType,
    detailType,
    role: 'FINANCIAL_SOURCE',
    capability: { enabled: Number(account['import_enabled']) === 1, supportedSourceKinds: sourceKinds as never[] },
  });
  if (!importValidation.ok) throw new Error(`Schema 6 import classification is invalid for ${id}: ${importValidation.error.code}.`);
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
      if (visited.has(cursor)) throw new Error(`Schema 6 ${table} hierarchy contains a cycle at ${cursor}.`);
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
  database.run(
    `INSERT INTO audit_event(id, timestamp_utc, operation, entity_type, entity_id, before_json, after_json, reason, correlation_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, event.timestampUtc, event.operation, event.entityType, event.entityId, JSON.stringify(event.before), JSON.stringify(event.after), event.reason, event.correlationId],
  );
}

function readSchemaVersion(database: Database): number {
  return Number(rows(database, 'SELECT version FROM schema_version LIMIT 1')[0]?.['version'] ?? 0);
}

function recordCounts(database: Database, tables: readonly string[]): Readonly<Record<string, number>> {
  return Object.fromEntries(tables.map(table => [table, tableCount(database, table)]));
}

function tableCount(database: Database, table: string): number {
  return Number(rows(database, `SELECT COUNT(*) AS count FROM ${table}`)[0]?.['count'] ?? 0);
}

function rows(database: Database, sql: string): SqlRow[] {
  const result = database.exec(sql)[0];
  if (!result) return [];
  return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
}
