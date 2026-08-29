import {
  CASH_FLOW_ACCOUNT_TYPES,
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_TREATMENTS,
  CashFlowCashRole,
  CashFlowClassification,
  CashFlowClassificationSource,
  CashFlowClassificationStatus,
  CashFlowTreatment,
} from './cash-flow-classification';
import { AccountRole, AccountingAccountType } from './account-taxonomy';
import { DatabaseRevision, ReportCompanyIdentity, databaseRevision } from './balance-sheet.types';

export type { DatabaseRevision, ReportCompanyIdentity } from './balance-sheet.types';
export { databaseRevision } from './balance-sheet.types';
export {
  CASH_FLOW_ACCOUNT_TYPES,
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_TREATMENTS,
};
export type {
  CashFlowCashRole,
  CashFlowClassification,
  CashFlowClassificationSource,
  CashFlowClassificationStatus,
  CashFlowTreatment,
};

export const CASH_FLOW_SECTIONS = [
  'OPERATING',
  'INVESTING',
  'FINANCING',
  'CASH_RECONCILIATION',
  'NONCASH_DISCLOSURE',
] as const;
export type CashFlowSection = typeof CASH_FLOW_SECTIONS[number];

export const CASH_FLOW_REPORT_STATUSES = ['COMPLETE', 'REVIEW_REQUIRED'] as const;
export type CashFlowReportStatus = typeof CASH_FLOW_REPORT_STATUSES[number];
export type CashFlowMethod = 'INDIRECT';

export interface CashFlowQuery {
  readonly startDate: string;
  readonly endDate: string;
  readonly includeZeroRows: boolean;
}

export interface CashFlowQueryInput {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly includeZeroRows?: boolean;
}

/**
 * The single user-facing disclaimer shared by the screen and CSV output.
 * Keeping it query-based prevents period text from drifting between surfaces.
 */
export function cashFlowReportDisclaimer(query: Pick<CashFlowQuery, 'startDate' | 'endDate'>): string {
  return `Prepared from recorded transactions and account classifications for ${query.startDate} through ${query.endDate}. Supplemental noncash disclosures do not affect cash totals.`;
}

export interface CashFlowQueryDefaults {
  readonly fiscalYearStartMonth: number;
  readonly activeTaxYear: number;
}

export const CASH_FLOW_ROW_TYPES = [
  'SECTION_HEADER',
  'NET_PROFIT',
  'GROUP_HEADER',
  'ADJUSTMENT',
  'ACCOUNT_ACTIVITY',
  'SUBTOTAL',
  'TOTAL',
  'CASH_BALANCE',
  'DIFFERENCE',
  'NONCASH_DISCLOSURE',
] as const;
export type CashFlowRowType = typeof CASH_FLOW_ROW_TYPES[number];

export const CASH_FLOW_CONTRIBUTION_TYPES = [
  'PNL_SPLIT',
  'NONCASH_REVERSAL',
  'BALANCE_CHANGE',
  'CASH_TRANSACTION',
  'TRANSFER',
  'OPENING_BALANCE',
  'FORMULA',
  'NONCASH_DISCLOSURE',
  'UNCLASSIFIED',
] as const;
export type CashFlowContributionType = typeof CASH_FLOW_CONTRIBUTION_TYPES[number];

declare const cashFlowReportIdBrand: unique symbol;
declare const cashFlowRowIdBrand: unique symbol;
declare const cashFlowDetailKeyBrand: unique symbol;
declare const cashFlowWarningIdBrand: unique symbol;

export type CashFlowReportId = string & { readonly [cashFlowReportIdBrand]: true };
export type CashFlowRowId = string & { readonly [cashFlowRowIdBrand]: true };
export type CashFlowDetailKey = string & { readonly [cashFlowDetailKeyBrand]: true };
export type CashFlowWarningId = string & { readonly [cashFlowWarningIdBrand]: true };

export interface CashFlowRow {
  readonly rowId: CashFlowRowId;
  readonly rowType: CashFlowRowType;
  readonly section: CashFlowSection;
  readonly treatment?: CashFlowTreatment;
  /** Explicit source cash role when the row represents a classified account. */
  readonly cashRole?: CashFlowCashRole;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly parentRowId?: CashFlowRowId;
  readonly label: string;
  readonly fullPath?: string;
  readonly depth: number;
  readonly amountMinor?: bigint;
  readonly detailKey?: CashFlowDetailKey;
  readonly bold: boolean;
  readonly derived: boolean;
  readonly archived: boolean;
  readonly reviewRequired: boolean;
}

export interface CashFlowContribution {
  readonly contributionId: string;
  readonly detailKey: CashFlowDetailKey;
  readonly contributionType: CashFlowContributionType;
  readonly contributionMinor: bigint;
  readonly businessDate?: string;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly accountName?: string;
  readonly chartAccountId?: string;
  readonly chartAccountPath?: string;
  readonly transactionId?: string;
  /** The other endpoint transaction for a matched transfer contribution. */
  readonly counterpartyTransactionId?: string;
  readonly splitId?: string;
  readonly transferId?: string;
  readonly sourceBatchId?: string;
  readonly payee?: string;
  readonly description?: string;
  readonly memo?: string;
  readonly openingAmountMinor?: bigint;
  readonly endingAmountMinor?: bigint;
  /** Raw Balance Sheet change before applying the working-capital sign rule. */
  readonly rawChangeMinor?: bigint;
  readonly formula?: string;
  readonly childRowId?: CashFlowRowId;
}

export interface CashFlowDisclosure {
  readonly disclosureId: string;
  readonly section: 'NONCASH_DISCLOSURE';
  readonly label: string;
  readonly amountMinor?: bigint;
  readonly detailKey?: CashFlowDetailKey;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly chartAccountId?: string;
  readonly transactionId?: string;
  readonly transferId?: string;
  readonly description?: string;
  readonly rationale: string;
}

export const CASH_FLOW_WARNING_CODES = [
  'NO_CASH_ACCOUNTS_CONFIGURED',
  'CASH_ROLE_REVIEW_REQUIRED',
  'CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED',
  'UNCLASSIFIED_CASH_ACTIVITY',
  'CASH_RECONCILIATION_DIFFERENCE',
  'SOURCE_BALANCE_SHEET_OUT_OF_BALANCE',
  'OPENING_CASH_BALANCE_WITHIN_PERIOD',
  'OPENING_BALANCE_MODE_CONFLICT',
  'UNMATCHED_CASH_TRANSFER_CANDIDATE',
  'RESTRICTED_CASH_PRESENT',
  'NONCASH_ACTIVITY_IDENTIFIED',
  'ARCHIVED_PARTICIPATING_ACCOUNT',
  'ACCOUNT_HIERARCHY_INVALID',
  'CASH_FLOW_CLASSIFICATION_INVALID',
  'EXCLUDED_MATERIAL_CASH_ACTIVITY',
  'UNSUPPORTED_CURRENCY',
] as const;
export type CashFlowWarningCode = typeof CASH_FLOW_WARNING_CODES[number];

export interface CashFlowWarning {
  readonly warningId: CashFlowWarningId;
  readonly code: CashFlowWarningCode;
  readonly message: string;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly detailKey?: CashFlowDetailKey;
  readonly references?: readonly string[];
}

export interface CashFlowReconciliation {
  readonly beginningCashMinor: bigint;
  readonly netChangeInCashMinor: bigint;
  readonly calculatedEndingCashMinor: bigint;
  readonly endingCashMinor: bigint;
  readonly differenceMinor: bigint;
  readonly restrictedCashBeginningMinor: bigint;
  readonly restrictedCashEndingMinor: bigint;
  readonly unclassifiedCashActivityMinor: bigint;
}

export interface CashFlowReport {
  readonly reportId: CashFlowReportId;
  readonly databaseRevision: DatabaseRevision;
  readonly generatedAt: string;
  readonly query: CashFlowQuery;
  readonly company: ReportCompanyIdentity;
  readonly currencyCode: string;
  readonly accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  readonly method: CashFlowMethod;
  readonly status: CashFlowReportStatus;
  readonly rows: readonly CashFlowRow[];
  readonly disclosures?: readonly CashFlowDisclosure[];
  readonly netOperatingMinor: bigint;
  readonly netInvestingMinor: bigint;
  readonly netFinancingMinor: bigint;
  readonly netChangeInCashMinor: bigint;
  readonly beginningCashMinor: bigint;
  readonly calculatedEndingCashMinor: bigint;
  readonly endingCashMinor: bigint;
  readonly differenceMinor: bigint;
  readonly restrictedCashBeginningMinor: bigint;
  readonly restrictedCashEndingMinor: bigint;
  readonly unclassifiedCashActivityMinor: bigint;
  readonly warnings: readonly CashFlowWarning[];
  readonly detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
}

export interface CashFlowReportIdentity {
  readonly reportId: CashFlowReportId;
  readonly databaseRevision: DatabaseRevision;
}

export interface GetCashFlowDetailCommand extends CashFlowReportIdentity {
  readonly detailKey: CashFlowDetailKey;
}

export interface CashFlowDetail extends GetCashFlowDetailCommand {
  readonly rowId: CashFlowRowId;
  readonly amountMinor: bigint;
  readonly contributions: readonly CashFlowContribution[];
}

export interface CashFlowClassificationTarget {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
}

export interface PreviewCashFlowClassificationCommand extends CashFlowClassificationTarget {
  readonly cashRole?: CashFlowCashRole;
  readonly treatment: CashFlowTreatment;
  /** The period used for proposed activity/report-impact feedback. */
  readonly query?: CashFlowQuery;
}

export interface CashFlowClassificationPreview {
  readonly valid: boolean;
  readonly normalized?: CashFlowClassification;
  readonly statementSection?: CashFlowSection;
  readonly statementLabel: string;
  readonly rationale: string;
  readonly query?: CashFlowQuery;
  readonly periodActivityMinor?: bigint;
  readonly reportImpactMinor?: bigint;
  readonly failures: readonly CashFlowClassificationFailure[];
}

export const CASH_FLOW_CLASSIFICATION_FAILURE_CODES = [
  'ACCOUNT_NOT_FOUND',
  'CASH_ROLE_REQUIRED',
  'CASH_ROLE_NOT_ALLOWED',
  'TREATMENT_INCOMPATIBLE',
  'RATIONALE_REQUIRED',
  'CLASSIFICATION_STALE',
] as const;
export type CashFlowClassificationFailureCode = typeof CASH_FLOW_CLASSIFICATION_FAILURE_CODES[number];

export interface CashFlowClassificationFailure {
  readonly code: CashFlowClassificationFailureCode;
  readonly message: string;
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
}

export interface SaveCashFlowClassificationCommand extends PreviewCashFlowClassificationCommand {
  readonly expectedModifiedAtUtc?: string;
  readonly userRationale: string;
}

export interface CashFlowClassificationReview {
  readonly query: CashFlowQuery;
  readonly databaseRevision: DatabaseRevision;
  readonly accounts: readonly CashFlowClassificationReviewItem[];
  readonly blockingCount: number;
  readonly warningCount: number;
  /** Present when the review was returned by a successful classification save. */
  readonly saveImpact?: CashFlowClassificationSaveImpact;
  /** Alias retained for consumers that call this result an impact report. */
  readonly impact?: CashFlowClassificationSaveImpact;
}

export const CASH_FLOW_CLASSIFICATION_REVIEW_REASON_CODES = [
  'MISSING_CLASSIFICATION',
  'INVALID_CLASSIFICATION',
  'STRUCTURE_CHANGED',
  'AMBIGUOUS_STRUCTURE',
  'CLASSIFICATION_REVIEW_REQUIRED',
  'ARCHIVED_ACCOUNT',
] as const;
export type CashFlowClassificationReviewReasonCode = typeof CASH_FLOW_CLASSIFICATION_REVIEW_REASON_CODES[number];

export interface CashFlowClassificationSaveImpact {
  readonly query: CashFlowQuery;
  readonly databaseRevision: DatabaseRevision;
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly accountPath: string;
  readonly previousClassification?: CashFlowClassification;
  readonly classification: CashFlowClassification;
  readonly affectedReports: readonly ('CASH_FLOW')[];
  readonly affectedSections: readonly CashFlowSection[];
  readonly periodActivityMinor: bigint;
  readonly reportImpactMinor: bigint;
  readonly cacheInvalidated: boolean;
}

export interface CashFlowClassificationReviewItem {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly accountPath: string;
  readonly accountType: AccountingAccountType | string;
  readonly detailType: string;
  readonly archived?: boolean;
  readonly reviewReasons?: readonly CashFlowClassificationReviewReasonCode[];
  readonly currentClassification?: CashFlowClassification;
  readonly suggestedClassification?: CashFlowClassification;
  readonly cashRole?: CashFlowCashRole;
  readonly treatment: CashFlowTreatment;
  readonly status: CashFlowClassificationStatus;
  readonly source: CashFlowClassificationSource;
  readonly rationale: string;
  readonly openingAmountMinor: bigint;
  readonly endingAmountMinor: bigint;
  readonly periodActivityMinor: bigint;
  readonly reportImpactMinor: bigint;
}

export interface CashFlowClassificationExchangeRow {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly accountPath: string;
  readonly accountType: AccountingAccountType;
  readonly detailType: string;
  readonly cashRole?: CashFlowCashRole;
  readonly treatment: CashFlowTreatment;
  readonly status: CashFlowClassificationStatus;
  readonly source: CashFlowClassificationSource;
  readonly rationale: string;
  /** Optimistic-concurrency token for direct editor entry and round trips. */
  readonly modifiedAtUtc?: string;
}

/**
 * Raw spreadsheet values are intentionally permissive. Preview must be able to
 * report missing IDs, legacy path candidates, and unknown enum values before a
 * row is converted to the strict exchange contract above.
 */
export interface CashFlowClassificationImportRow {
  readonly accountRole?: string;
  readonly accountId?: string;
  readonly accountPath?: string;
  readonly accountType?: string;
  readonly detailType?: string;
  readonly cashRole?: string;
  readonly treatment?: string;
  readonly status?: string;
  readonly source?: string;
  readonly rationale?: string;
}

export type RawCashFlowClassificationImportRow = CashFlowClassificationImportRow;

export const CASH_FLOW_CLASSIFICATION_IMPORT_ISSUE_CODES = [
  'ACCOUNT_NOT_FOUND',
  'AMBIGUOUS_ACCOUNT_PATH',
  'MISSING_ACCOUNT_REFERENCE',
  'ARCHIVED_ACCOUNT',
  'UNKNOWN_ACCOUNT_ROLE',
  'UNKNOWN_ACCOUNT_TYPE',
  'UNKNOWN_CASH_ROLE',
  'UNKNOWN_TREATMENT',
  'UNKNOWN_STATUS',
  'UNKNOWN_SOURCE',
  'INCOMPATIBLE_CLASSIFICATION',
  'RATIONALE_REQUIRED',
  'CLASSIFICATION_STALE',
] as const;
export type CashFlowClassificationImportIssueCode = typeof CASH_FLOW_CLASSIFICATION_IMPORT_ISSUE_CODES[number];

export interface CashFlowClassificationImportIssue {
  readonly rowNumber: number;
  readonly code: CashFlowClassificationImportIssueCode;
  readonly message: string;
  readonly field?: string;
  readonly accountRole?: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId?: string;
}

export interface CashFlowClassificationImportPreview {
  readonly previewId: string;
  readonly databaseRevision: DatabaseRevision;
  readonly rows: readonly CashFlowClassificationExchangeRow[];
  readonly issues: readonly CashFlowClassificationImportIssue[];
  readonly validRowCount: number;
  readonly blockedRowCount: number;
}

export interface PreviewCashFlowClassificationImportCommand {
  readonly databaseRevision: DatabaseRevision;
  readonly rows: readonly CashFlowClassificationImportRow[];
}

export interface CommitCashFlowClassificationImportCommand {
  readonly previewId: string;
  readonly databaseRevision: DatabaseRevision;
}

export interface CashFlowClassificationImportCommitResult {
  readonly databaseRevision: DatabaseRevision;
  readonly appliedRowCount: number;
  readonly review: CashFlowClassificationReview;
}

export interface ExportCashFlowClassificationsCommand {
  readonly databaseRevision: DatabaseRevision;
}

export interface CashFlowClassificationExportResult {
  readonly databaseRevision: DatabaseRevision;
  readonly rows: readonly CashFlowClassificationExchangeRow[];
}

export type CashFlowExportFormat = 'CSV' | 'XLSX';

export interface ExportCashFlowCommand extends CashFlowReportIdentity {
  readonly format: CashFlowExportFormat;
}

export type CashFlowExportResult =
  | {
      readonly format: 'CSV';
      readonly status: 'SAVED';
      readonly path: string;
      readonly completedAtUtc: string;
      readonly rowCount: number;
      /** The exact immutable CSV bytes represented as text. */
      readonly content: string;
      readonly suggestedFileName: string;
    }
  | {
      readonly format: 'CSV';
      readonly status: 'DOWNLOAD_READY';
      readonly rowCount: number;
      /** Browser callers download this exact immutable CSV content. */
      readonly content: string;
      readonly suggestedFileName: string;
    }
  | {
      readonly format: 'CSV';
      readonly status: 'CANCELLED';
      readonly rowCount: number;
    };

export interface OpenCashFlowPrintPreviewCommand extends CashFlowReportIdentity {}

export interface CashFlowPrintPreviewResult {
  readonly opened: boolean;
  readonly title: string;
}

export const CASH_FLOW_FAILURE_CODES = [
  'CASH_FLOW_NOT_IMPLEMENTED',
  'INVALID_CASH_FLOW_DATE_RANGE',
  'CASH_FLOW_REPORT_GENERATION_FAILED',
  'CASH_FLOW_REPORT_REVISION_STALE',
  'CASH_FLOW_DETAIL_NOT_FOUND',
  'CASH_FLOW_DETAIL_RECONCILIATION_FAILED',
  'CASH_FLOW_CLASSIFICATION_INVALID',
  'CASH_FLOW_CLASSIFICATION_STALE',
  'CASH_FLOW_EXPORT_FAILED',
  'CASH_FLOW_EXPORT_CANCELLED',
  'CASH_FLOW_PRINT_PREVIEW_FAILED',
  'UNSUPPORTED_CURRENCY',
] as const;
export type CashFlowFailureCode = typeof CASH_FLOW_FAILURE_CODES[number];

export interface CashFlowFailure {
  readonly code: CashFlowFailureCode;
  readonly message: string;
  readonly field?: string;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly detailKey?: CashFlowDetailKey;
  readonly reportId?: CashFlowReportId;
  readonly databaseRevision?: DatabaseRevision;
  readonly retryable: boolean;
}

export type CashFlowContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CashFlowFailure };

export class CashFlowContractError extends Error {
  override readonly name = 'CashFlowContractError';

  constructor(readonly failure: CashFlowFailure) {
    super(failure.message);
  }

  get code(): CashFlowFailureCode {
    return this.failure.code;
  }
}

export interface CashFlowClassificationCompatibility {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountType: AccountingAccountType;
  readonly permittedCashRoles: readonly CashFlowCashRole[];
  readonly permittedTreatments: readonly CashFlowTreatment[];
}

export interface CashFlowClassificationDefault {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountType: AccountingAccountType;
  readonly detailType: string;
  readonly classification: CashFlowClassification;
}

export interface CashFlowClassificationCatalog {
  readonly cashRoles: readonly CashFlowCashRole[];
  readonly treatments: readonly CashFlowTreatment[];
  readonly sections: readonly CashFlowSection[];
  readonly statuses: readonly CashFlowClassificationStatus[];
  readonly sources: readonly CashFlowClassificationSource[];
  readonly compatibility: readonly CashFlowClassificationCompatibility[];
  readonly labels: Readonly<{
    cashRoles: Readonly<Record<CashFlowCashRole, string>>;
    treatments: Readonly<Record<CashFlowTreatment, string>>;
    sections: Readonly<Record<CashFlowSection, string>>;
  }>;
  readonly defaults: readonly CashFlowClassificationDefault[];
  readonly method: CashFlowMethod;
}

export const CASH_FLOW_CONTRACT_VERSION = '1';

export function normalizeCashFlowQuery(
  input: CashFlowQueryInput,
  defaults: CashFlowQueryDefaults,
): CashFlowContractResult<CashFlowQuery> {
  if (!Number.isInteger(defaults.fiscalYearStartMonth) || defaults.fiscalYearStartMonth < 1 || defaults.fiscalYearStartMonth > 12) {
    return invalidQuery('fiscalYearStartMonth', 'Fiscal-year start month must be from 1 through 12.');
  }
  if (!Number.isInteger(defaults.activeTaxYear) || defaults.activeTaxYear < 1000 || defaults.activeTaxYear > 9999) {
    return invalidQuery('activeTaxYear', 'Active tax year must contain four digits.');
  }
  const defaultEnd = fiscalPeriodEnd(defaults);
  const defaultStart = fiscalPeriodStart(defaults);
  const startDate = input.startDate?.trim() || defaultStart;
  const endDate = input.endDate?.trim() || defaultEnd;
  if (!isBusinessDate(startDate)) return invalidQuery('startDate', 'Cash Flow start date must be a valid YYYY-MM-DD date.');
  if (!isBusinessDate(endDate)) return invalidQuery('endDate', 'Cash Flow end date must be a valid YYYY-MM-DD date.');
  if (startDate > endDate) return invalidQuery('dateRange', 'Cash Flow start date must be on or before the end date.');
  return { ok: true, value: { startDate, endDate, includeZeroRows: input.includeZeroRows ?? false } };
}

export function cashFlowReportId(revision: DatabaseRevision, query: CashFlowQuery): CashFlowReportId {
  // Row visibility is presentation-only. Both views must share one stable
  // report identity so detail/revision checks cannot be bypassed by toggling
  // the zero-row filter.
  return `CASH_FLOW:${revision}:${query.startDate}:${query.endDate}:INDIRECT:v${CASH_FLOW_CONTRACT_VERSION}` as CashFlowReportId;
}

export function cashFlowAccountRowId(section: CashFlowSection, role: AccountRole, accountId: string): CashFlowRowId {
  return `ACCOUNT:${section}:${role}:${encodeURIComponent(accountId)}` as CashFlowRowId;
}

export type CashFlowSyntheticRowKey =
  | 'SECTION_OPERATING'
  | 'SECTION_INVESTING'
  | 'SECTION_FINANCING'
  | 'SECTION_CASH_RECONCILIATION'
  | 'SECTION_NONCASH_DISCLOSURE'
  | 'NET_PROFIT'
  | 'NET_OPERATING'
  | 'NET_INVESTING'
  | 'NET_FINANCING'
  | 'NET_CHANGE_IN_CASH'
  | 'BEGINNING_CASH'
  | 'CALCULATED_ENDING_CASH'
  | 'ENDING_CASH'
  | 'DIFFERENCE';

export function cashFlowSyntheticRowId(key: CashFlowSyntheticRowKey, query: CashFlowQuery): CashFlowRowId {
  return `SYNTHETIC:${key}:${query.startDate}:${query.endDate}` as CashFlowRowId;
}

export function cashFlowDetailKey(rowId: CashFlowRowId): CashFlowDetailKey {
  return `DETAIL:${rowId}` as CashFlowDetailKey;
}

export function cashFlowWarningId(code: CashFlowWarningCode, references: readonly string[], query: CashFlowQuery): CashFlowWarningId {
  return `WARNING:${code}:${references.slice().sort().map(encodeURIComponent).join(',')}:${query.startDate}:${query.endDate}` as CashFlowWarningId;
}

export function validateCashFlowReportIdentity(
  report: CashFlowReportIdentity,
  request: CashFlowReportIdentity,
): CashFlowContractResult<CashFlowReportIdentity> {
  if (report.reportId !== request.reportId || report.databaseRevision !== request.databaseRevision) {
    return {
      ok: false,
      error: {
        code: 'CASH_FLOW_REPORT_REVISION_STALE',
        message: 'The Statement of Cash Flows no longer matches the active database revision. Regenerate the report.',
        reportId: request.reportId,
        databaseRevision: request.databaseRevision,
        retryable: true,
      },
    };
  }
  return { ok: true, value: request };
}

export function validateCashFlowDetail(detail: CashFlowDetail): CashFlowContractResult<CashFlowDetail> {
  const hasMismatchedKey = detail.contributions.some(contribution => contribution.detailKey !== detail.detailKey);
  const contributionTotal = detail.contributions.reduce((total, contribution) => total + contribution.contributionMinor, 0n);
  if (hasMismatchedKey || contributionTotal !== detail.amountMinor) {
    return {
      ok: false,
      error: {
        code: 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED',
        message: 'Cash Flow detail does not reconcile to its selected report row.',
        detailKey: detail.detailKey,
        reportId: detail.reportId,
        databaseRevision: detail.databaseRevision,
        retryable: false,
      },
    };
  }
  return { ok: true, value: detail };
}

export function freezeCashFlowReport(report: CashFlowReport): CashFlowReport {
  const frozenDetails = Object.fromEntries(Object.entries(report.detailIndex).map(([key, contributions]) => [
    key,
    Object.freeze(contributions.map(contribution => Object.freeze({ ...contribution }))),
  ]));
  return Object.freeze({
    ...report,
    query: Object.freeze({ ...report.query }),
    company: Object.freeze({
      ...report.company,
      addressLines: Object.freeze([...report.company.addressLines]),
      contactLines: Object.freeze([...report.company.contactLines]),
    }),
    rows: Object.freeze(report.rows.map(row => Object.freeze({ ...row }))),
    disclosures: report.disclosures ? Object.freeze(report.disclosures.map(disclosure => Object.freeze({ ...disclosure }))) : undefined,
    warnings: Object.freeze(report.warnings.map(warning => Object.freeze({ ...warning, references: warning.references ? Object.freeze([...warning.references]) : undefined }))),
    detailIndex: Object.freeze(frozenDetails),
  });
}

export function freezeCashFlowClassificationReview(review: CashFlowClassificationReview): CashFlowClassificationReview {
  const freezeClassification = (classification: CashFlowClassification | undefined): CashFlowClassification | undefined => {
    if (!classification) return undefined;
    return Object.freeze({ ...classification });
  };
  const frozenImpact = review.saveImpact ?? review.impact
    ? Object.freeze({
      ...(review.saveImpact ?? review.impact)!,
      query: Object.freeze({ ...(review.saveImpact ?? review.impact)!.query }),
      previousClassification: freezeClassification((review.saveImpact ?? review.impact)!.previousClassification),
      classification: freezeClassification((review.saveImpact ?? review.impact)!.classification)!,
      affectedReports: Object.freeze([...((review.saveImpact ?? review.impact)!.affectedReports)]),
      affectedSections: Object.freeze([...((review.saveImpact ?? review.impact)!.affectedSections)]),
    })
    : undefined;
  return Object.freeze({
    ...review,
    query: Object.freeze({ ...review.query }),
    ...(frozenImpact ? { saveImpact: frozenImpact, impact: frozenImpact } : {}),
    accounts: Object.freeze(review.accounts.map(account => Object.freeze({
      ...account,
      reviewReasons: Object.freeze([...(account.reviewReasons ?? [])]),
      currentClassification: freezeClassification(account.currentClassification),
      suggestedClassification: freezeClassification(account.suggestedClassification),
    }))),
  });
}

function invalidQuery(field: string, message: string): CashFlowContractResult<CashFlowQuery> {
  return {
    ok: false,
    error: { code: 'INVALID_CASH_FLOW_DATE_RANGE', message, field, retryable: false },
  };
}

function fiscalPeriodStart(defaults: CashFlowQueryDefaults): string {
  const year = defaults.fiscalYearStartMonth === 1 ? defaults.activeTaxYear : defaults.activeTaxYear - 1;
  return `${year.toString().padStart(4, '0')}-${defaults.fiscalYearStartMonth.toString().padStart(2, '0')}-01`;
}

function fiscalPeriodEnd(defaults: CashFlowQueryDefaults): string {
  const endMonth = defaults.fiscalYearStartMonth === 1 ? 12 : defaults.fiscalYearStartMonth - 1;
  return `${defaults.activeTaxYear.toString().padStart(4, '0')}-${endMonth.toString().padStart(2, '0')}-${daysInMonth(defaults.activeTaxYear, endMonth).toString().padStart(2, '0')}`;
}

function isBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
