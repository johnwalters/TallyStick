export { CURRENT_SQLITE_SCHEMA_VERSION as CURRENT_SCHEMA_VERSION } from '../../../shared/schema-version';

export const SQLITE_MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS company (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, fiscal_year_start_month INTEGER NOT NULL, accounting_basis TEXT NOT NULL, active_tax_year INTEGER NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS financial_account (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL UNIQUE, institution_or_entity TEXT NOT NULL, opening_balance_minor TEXT NOT NULL, opening_balance_date TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE IF NOT EXISTS chart_account (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES chart_account(id), type TEXT NOT NULL, display_order INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE IF NOT EXISTS import_batch (id TEXT PRIMARY KEY, destination_account_id TEXT NOT NULL REFERENCES financial_account(id), source_kind TEXT NOT NULL, source_name TEXT NOT NULL, source_hash TEXT NOT NULL, mapping_version TEXT NOT NULL, accepted_count INTEGER NOT NULL, rejected_count INTEGER NOT NULL, skipped_count INTEGER NOT NULL, warning_count INTEGER NOT NULL, total_accepted_minor TEXT NOT NULL, committed_at_utc TEXT);`,
  `CREATE TABLE IF NOT EXISTS transaction_record (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES financial_account(id), posting_date TEXT NOT NULL, amount_minor TEXT NOT NULL, currency TEXT NOT NULL, raw_description TEXT NOT NULL, description TEXT NOT NULL, state TEXT NOT NULL, source_batch_id TEXT REFERENCES import_batch(id), exclusion_reason TEXT, transfer_match_id TEXT, created_at_utc TEXT NOT NULL, modified_at_utc TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS posting_split (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES transaction_record(id), chart_account_id TEXT NOT NULL REFERENCES chart_account(id), amount_minor TEXT NOT NULL, memo TEXT);`,
  `CREATE TABLE IF NOT EXISTS audit_event (id TEXT PRIMARY KEY, timestamp_utc TEXT NOT NULL, operation TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_json TEXT, after_json TEXT, reason TEXT, correlation_id TEXT);`,
  `ALTER TABLE financial_account ADD COLUMN last_four TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN transaction_date TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN raw_payee TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN payee TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN memo TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN reference TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN source_row_number INTEGER;`,
  `ALTER TABLE transaction_record ADD COLUMN categorization_source TEXT NOT NULL DEFAULT 'NONE';`,
  `ALTER TABLE transaction_record ADD COLUMN rule_id TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN rationale TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN posted_at_utc TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN excluded_at_utc TEXT;`,
  `ALTER TABLE transaction_record ADD COLUMN undone_at_utc TEXT;`,
  `CREATE TABLE IF NOT EXISTS transfer_match (id TEXT PRIMARY KEY, left_transaction_id TEXT NOT NULL REFERENCES transaction_record(id), right_transaction_id TEXT NOT NULL REFERENCES transaction_record(id), confidence REAL NOT NULL, rationale TEXT NOT NULL, confirmed_at_utc TEXT NOT NULL, UNIQUE(left_transaction_id), UNIQUE(right_transaction_id));`,
  `CREATE TABLE IF NOT EXISTS transaction_rule (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL, priority INTEGER NOT NULL UNIQUE, conditions_json TEXT NOT NULL, chart_account_id TEXT REFERENCES chart_account(id), payee TEXT, memo TEXT, tags_json TEXT, suggest_exclude INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE IF NOT EXISTS tax_year_settings (tax_year INTEGER PRIMARY KEY, federal_income_tax_account_ids_json TEXT NOT NULL, state_local_income_tax_account_ids_json TEXT NOT NULL, include_federal_income_tax INTEGER NOT NULL, include_state_local_income_tax INTEGER NOT NULL, confirmed_at_utc TEXT, accountant_note TEXT);`,
];

export const SQLITE_V3_MIGRATIONS: readonly string[] = [
  `ALTER TABLE chart_account ADD COLUMN account_type TEXT NOT NULL DEFAULT 'EXPENSE';`,
  `ALTER TABLE chart_account ADD COLUMN detail_type TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE chart_account ADD COLUMN description TEXT;`,
  `ALTER TABLE chart_account ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;`,
  `UPDATE chart_account SET account_type = CASE type WHEN 'ASSET' THEN 'OTHER_ASSET' WHEN 'LIABILITY' THEN 'OTHER_CURRENT_LIABILITY' WHEN 'EQUITY' THEN 'EQUITY' WHEN 'INCOME' THEN 'INCOME' WHEN 'COGS' THEN 'COGS' WHEN 'EXPENSE' THEN 'EXPENSE' WHEN 'OTHER_INCOME' THEN 'OTHER_INCOME' WHEN 'OTHER_EXPENSE' THEN 'OTHER_EXPENSE' ELSE 'EXPENSE' END;`,
];

export const SQLITE_V4_MIGRATIONS: readonly string[] = [
  `UPDATE chart_account
   SET detail_type = CASE account_type
     WHEN 'BANK' THEN 'Checking'
     WHEN 'ACCOUNTS_RECEIVABLE' THEN 'Accounts receivable'
     WHEN 'OTHER_CURRENT_ASSET' THEN 'Inventory'
     WHEN 'FIXED_ASSET' THEN 'Furniture and fixtures'
     WHEN 'OTHER_ASSET' THEN 'Goodwill'
     WHEN 'CREDIT_CARD' THEN 'Credit card'
     WHEN 'ACCOUNTS_PAYABLE' THEN 'Accounts payable'
     WHEN 'OTHER_CURRENT_LIABILITY' THEN 'Loan payable'
     WHEN 'LONG_TERM_LIABILITY' THEN 'Notes payable'
     WHEN 'EQUITY' THEN 'Owner equity'
     WHEN 'INCOME' THEN 'Sales of product income'
     WHEN 'OTHER_INCOME' THEN 'Interest earned'
     WHEN 'COGS' THEN 'Cost of labor'
     WHEN 'EXPENSE' THEN 'Advertising'
     WHEN 'OTHER_EXPENSE' THEN 'Depreciation'
     ELSE 'Other business expenses'
   END
   WHERE TRIM(detail_type) = '';`,
];

export const SQLITE_V5_MIGRATIONS: readonly string[] = [
  `ALTER TABLE financial_account ADD COLUMN detail_type TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE financial_account ADD COLUMN parent_account_id TEXT REFERENCES financial_account(id);`,
  `ALTER TABLE financial_account ADD COLUMN description TEXT;`,
  `ALTER TABLE financial_account ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;`,
  `UPDATE financial_account
   SET detail_type = CASE type
     WHEN 'BANK' THEN 'Checking'
     WHEN 'CREDIT_CARD' THEN 'Credit Card'
     WHEN 'ENTITY' THEN CASE WHEN LOWER(name) = 'amazon' THEN 'Marketplace' ELSE 'Other transactions' END
     ELSE 'Checking'
   END
   WHERE TRIM(detail_type) = '';`,
];
