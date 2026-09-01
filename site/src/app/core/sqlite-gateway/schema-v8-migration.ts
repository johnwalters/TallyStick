import { Database } from 'sql.js';
import { SCHEMA_7_VERSION, validateSchema7Database } from './schema-v7-migration';

/**
 * Schema 8 records the historical review metadata that was written while the
 * matched-payment review prototype was active. The current product no longer
 * presents a separate Cash Flow review step, but existing local databases
 * must remain readable. The nullable columns are therefore retained as an
 * audited compatibility boundary rather than discarded or rewritten.
 */
export const SCHEMA_8_VERSION = 8;

export const SQLITE_V8_SCHEMA_STATEMENTS: readonly string[] = [
  'ALTER TABLE transfer_match ADD COLUMN settlement_review_decision TEXT;',
  'ALTER TABLE transfer_match ADD COLUMN settlement_review_rationale TEXT;',
  'ALTER TABLE transfer_match ADD COLUMN settlement_reviewed_at_utc TEXT;',
  'ALTER TABLE transfer_match ADD COLUMN settlement_review_left_modified_at_utc TEXT;',
  'ALTER TABLE transfer_match ADD COLUMN settlement_review_right_modified_at_utc TEXT;',
];

export function applySchema8Bootstrap(database: Database): void {
  SQLITE_V8_SCHEMA_STATEMENTS.forEach(statement => database.run(statement));
}

export function applySchema8Migration(database: Database): void {
  validateSchema7Database(database);
  applySchema8Bootstrap(database);
}

/** Validates schema 8 without interpreting its retired compatibility fields. */
export function validateSchema8Database(database: Database): void {
  validateSchema7Database(database, SCHEMA_8_VERSION);
  const columns = new Set((database.exec('PRAGMA table_info(transfer_match)')[0]?.values ?? [])
    .map(row => String(row[1])));
  for (const column of [
    'settlement_review_decision',
    'settlement_review_rationale',
    'settlement_reviewed_at_utc',
    'settlement_review_left_modified_at_utc',
    'settlement_review_right_modified_at_utc',
  ]) {
    if (!columns.has(column)) throw new Error(`Schema 8 database is missing required column transfer_match.${column}.`);
  }
}
