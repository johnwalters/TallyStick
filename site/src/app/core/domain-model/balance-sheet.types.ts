import {
  AccountPlacementPreview,
  AccountRole,
  AccountTypeGroupDefinition,
  AccountingAccountType,
  BalanceSheetSection,
  GetAccountPlacementPreviewCommand,
} from './account-taxonomy';

export type AccountingBasis = 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';

export interface CompanyAddressInput {
  readonly line1?: string;
  readonly line2?: string;
  readonly locality?: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly countryCode?: string;
}

export interface CompanyProfile {
  readonly companyId: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly doingBusinessAs?: string;
  readonly entityType?: string;
  readonly address?: CompanyAddressInput;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly maskedTaxIdentifier?: string;
  readonly currencyCode: string;
  readonly fiscalYearStartMonth: number;
  readonly accountingBasis: AccountingBasis;
  readonly activeTaxYear: number;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

export interface UpdateCompanyProfileCommand {
  readonly expectedModifiedAt: string;
  readonly legalName: string;
  readonly displayName?: string;
  readonly doingBusinessAs?: string;
  readonly entityType?: string;
  readonly address?: CompanyAddressInput;
  readonly phone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly taxIdentifier?: string | null;
  readonly currencyCode: string;
  readonly fiscalYearStartMonth: number;
  readonly accountingBasis: AccountingBasis;
  readonly activeTaxYear: number;
}

export interface RevealCompanyTaxIdentifierResult {
  readonly companyId: string;
  readonly taxIdentifier?: string;
}

export interface ReportCompanyIdentity {
  readonly companyId: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly doingBusinessAs?: string;
  readonly addressLines: readonly string[];
  readonly contactLines: readonly string[];
}

declare const reportIdBrand: unique symbol;
declare const databaseRevisionBrand: unique symbol;
declare const rowIdBrand: unique symbol;
declare const detailKeyBrand: unique symbol;

export type BalanceSheetReportId = string & { readonly [reportIdBrand]: true };
export type DatabaseRevision = string & { readonly [databaseRevisionBrand]: true };
export type BalanceSheetRowId = string & { readonly [rowIdBrand]: true };
export type BalanceSheetDetailKey = string & { readonly [detailKeyBrand]: true };

export const databaseRevision = (value: string): DatabaseRevision => value as DatabaseRevision;

export interface BalanceSheetQuery {
  readonly asOfDate: string;
  readonly includeZeroBalanceAccounts: boolean;
}

export interface BalanceSheetQueryInput {
  readonly asOfDate?: string;
  readonly includeZeroBalanceAccounts?: boolean;
}

export interface BalanceSheetQueryDefaults {
  readonly fiscalYearStartMonth: number;
  readonly activeTaxYear: number;
}

export type BalanceSheetRowType =
  | 'SECTION_HEADER'
  | 'GROUP_HEADER'
  | 'ACCOUNT'
  | 'SUBTOTAL'
  | 'DERIVED_EQUITY'
  | 'TOTAL'
  | 'DIFFERENCE';

export interface BalanceSheetRow {
  readonly rowId: BalanceSheetRowId;
  readonly rowType: BalanceSheetRowType;
  readonly section: BalanceSheetSection;
  readonly accountType?: AccountingAccountType;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly parentRowId?: BalanceSheetRowId;
  readonly label: string;
  readonly fullPath?: string;
  readonly depth: number;
  readonly amountMinor?: bigint;
  readonly detailKey?: BalanceSheetDetailKey;
  readonly bold: boolean;
  readonly derived: boolean;
  readonly archived: boolean;
  readonly unclassified: boolean;
}

export const BALANCE_SHEET_WARNING_CODES = [
  'UNCLASSIFIED_NONZERO_ACCOUNT',
  'BALANCE_SHEET_OUT_OF_BALANCE',
  'OPENING_BALANCE_AFTER_AS_OF',
  'ARCHIVED_NONZERO_ACCOUNT',
  'UNSUPPORTED_CURRENCY',
  'ACCOUNT_HIERARCHY_INVALID',
  'ACCOUNT_CLASSIFICATION_INVALID',
  'OPENING_BALANCE_MODE_CONFLICT',
] as const;
export type BalanceSheetWarningCode = typeof BALANCE_SHEET_WARNING_CODES[number];

export interface BalanceSheetWarning {
  readonly warningId: string;
  readonly code: BalanceSheetWarningCode;
  readonly message: string;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly detailKey?: BalanceSheetDetailKey;
}

export const BALANCE_SHEET_CONTRIBUTION_KINDS = [
  'OPENING_BALANCE',
  'POSTED_TRANSACTION',
  'POSTING_SPLIT',
  'MATCHED_TRANSFER',
  'CURRENT_EARNINGS',
  'RETAINED_EARNINGS',
] as const;
export type BalanceSheetContributionKind = typeof BALANCE_SHEET_CONTRIBUTION_KINDS[number];

export interface BalanceSheetContribution {
  readonly contributionId: string;
  readonly kind: BalanceSheetContributionKind;
  readonly businessDate: string;
  readonly financialAccountId?: string;
  readonly financialAccountName?: string;
  readonly chartAccountId?: string;
  readonly chartAccountPath?: string;
  readonly transactionId?: string;
  readonly transferMatchId?: string;
  readonly sourceBatchId?: string;
  readonly description: string;
  readonly payee?: string;
  readonly memo?: string;
  readonly storedAmountMinor?: bigint;
  readonly contributionMinor: bigint;
  readonly runningBalanceMinor?: bigint;
}

export interface FiscalPeriod {
  readonly startDate: string;
  readonly endDate: string;
}

export interface BalanceSheetReport {
  readonly reportId: BalanceSheetReportId;
  readonly databaseRevision: DatabaseRevision;
  readonly generatedAt: string;
  readonly query: BalanceSheetQuery;
  readonly company: ReportCompanyIdentity;
  readonly currencyCode: string;
  readonly accountingBasis: AccountingBasis;
  readonly fiscalPeriod: FiscalPeriod;
  readonly rows: readonly BalanceSheetRow[];
  readonly totalAssetsMinor: bigint;
  readonly totalLiabilitiesMinor: bigint;
  readonly totalEquityMinor: bigint;
  readonly totalLiabilitiesAndEquityMinor: bigint;
  readonly differenceMinor: bigint;
  readonly warnings: readonly BalanceSheetWarning[];
  readonly detailIndex: Readonly<Record<string, readonly BalanceSheetContribution[]>>;
}

export interface BalanceSheetIdentity {
  readonly reportId: BalanceSheetReportId;
  readonly databaseRevision: DatabaseRevision;
}

export interface GetBalanceSheetDetailCommand extends BalanceSheetIdentity {
  readonly detailKey: BalanceSheetDetailKey;
}

export interface BalanceSheetDetail extends GetBalanceSheetDetailCommand {
  readonly rowId: BalanceSheetRowId;
  readonly amountMinor: bigint;
  readonly contributions: readonly BalanceSheetContribution[];
}

export type BalanceSheetExportFormat = 'CSV' | 'XLSX';

export interface ExportBalanceSheetCommand {
  readonly report: BalanceSheetReport;
  readonly format: BalanceSheetExportFormat;
}

export interface BalanceSheetExportResult {
  readonly format: BalanceSheetExportFormat;
  readonly status: 'SAVED' | 'CANCELLED';
  readonly suggestedFileName: string;
}

export interface OpenBalanceSheetPrintPreviewCommand {
  readonly report: BalanceSheetReport;
}

export interface BalanceSheetPrintPreviewResult {
  readonly status: 'OPENED' | 'CANCELLED';
  readonly previewId?: string;
}

export type GetAccountTypeCatalogResult = readonly AccountTypeGroupDefinition[];
export type PreviewAccountPlacementCommand = GetAccountPlacementPreviewCommand;
export type PreviewAccountPlacementResult = AccountPlacementPreview;

export const COMPANY_FAILURE_CODES = [
  'COMPANY_PROFILE_NOT_FOUND',
  'COMPANY_PROFILE_INVALID',
  'COMPANY_PROFILE_STALE',
  'COMPANY_TAX_IDENTIFIER_REVEAL_FAILED',
] as const;
export type CompanyFailureCode = typeof COMPANY_FAILURE_CODES[number];

export const ACCOUNT_FAILURE_CODES = [
  'ACCOUNT_CLASSIFICATION_INVALID',
  'ACCOUNT_REFERENCE_CONFLICT',
  'ACCOUNT_PLACEMENT_INVALID',
] as const;
export type AccountFailureCode = typeof ACCOUNT_FAILURE_CODES[number];

export const REPORT_FAILURE_CODES = [
  'BALANCE_SHEET_NOT_IMPLEMENTED',
  'REPORT_QUERY_INVALID',
  'REPORT_GENERATION_FAILED',
  'REPORT_ID_NOT_FOUND',
  'REPORT_DETAIL_NOT_FOUND',
  'REPORT_REVISION_STALE',
] as const;
export type ReportFailureCode = typeof REPORT_FAILURE_CODES[number];

export const RECONCILIATION_FAILURE_CODES = [
  'BALANCE_SHEET_RECONCILIATION_FAILED',
  'REPORT_DETAIL_RECONCILIATION_FAILED',
] as const;
export type ReconciliationFailureCode = typeof RECONCILIATION_FAILURE_CODES[number];

export const EXPORT_FAILURE_CODES = [
  'BALANCE_SHEET_EXPORT_FAILED',
  'BALANCE_SHEET_EXPORT_FORMAT_UNSUPPORTED',
  'BALANCE_SHEET_PRINT_PREVIEW_FAILED',
] as const;
export type ExportFailureCode = typeof EXPORT_FAILURE_CODES[number];

export type BalanceSheetFailureCode =
  | CompanyFailureCode
  | AccountFailureCode
  | ReportFailureCode
  | ReconciliationFailureCode
  | ExportFailureCode;

export interface BalanceSheetFailure {
  readonly code: BalanceSheetFailureCode;
  readonly message: string;
  readonly field?: string;
  readonly accountId?: string;
  readonly detailKey?: BalanceSheetDetailKey;
  readonly retryable: boolean;
}

export type BalanceSheetContractResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BalanceSheetFailure };

export class BalanceSheetContractError extends Error {
  override readonly name = 'BalanceSheetContractError';

  constructor(readonly failure: BalanceSheetFailure) {
    super(failure.message);
  }

  get code(): BalanceSheetFailureCode {
    return this.failure.code;
  }
}

export type SyntheticBalanceSheetRowKey =
  | 'SECTION_ASSETS'
  | 'SECTION_LIABILITIES'
  | 'SECTION_EQUITY'
  | 'CURRENT_EARNINGS'
  | 'RETAINED_EARNINGS'
  | 'OPENING_BALANCE_EQUITY'
  | 'UNCLASSIFIED'
  | 'TOTAL_ASSETS'
  | 'TOTAL_LIABILITIES'
  | 'TOTAL_EQUITY'
  | 'TOTAL_LIABILITIES_AND_EQUITY'
  | 'DIFFERENCE';

export function accountBalanceSheetRowId(role: AccountRole, accountId: string): BalanceSheetRowId {
  return `ACCOUNT:${role}:${encodeURIComponent(accountId)}` as BalanceSheetRowId;
}

export function accountTypeBalanceSheetRowId(accountType: AccountingAccountType, asOfDate: string): BalanceSheetRowId {
  return `ACCOUNT_TYPE:${accountType}:${asOfDate}` as BalanceSheetRowId;
}

export function syntheticBalanceSheetRowId(key: SyntheticBalanceSheetRowKey, asOfDate: string): BalanceSheetRowId {
  return `SYNTHETIC:${key}:${asOfDate}` as BalanceSheetRowId;
}

export function balanceSheetDetailKey(rowId: BalanceSheetRowId): BalanceSheetDetailKey {
  return `DETAIL:${rowId}` as BalanceSheetDetailKey;
}

export function balanceSheetReportId(revision: DatabaseRevision, query: BalanceSheetQuery): BalanceSheetReportId {
  return `BALANCE_SHEET:${encodeURIComponent(revision)}:${query.asOfDate}:${query.includeZeroBalanceAccounts ? 'WITH_ZERO' : 'NONZERO'}` as BalanceSheetReportId;
}

export function normalizeBalanceSheetQuery(
  input: BalanceSheetQueryInput,
  defaults: BalanceSheetQueryDefaults,
): BalanceSheetContractResult<BalanceSheetQuery> {
  if (!Number.isInteger(defaults.fiscalYearStartMonth) || defaults.fiscalYearStartMonth < 1 || defaults.fiscalYearStartMonth > 12) {
    return invalidQuery('fiscalYearStartMonth', 'Fiscal-year start month must be from 1 through 12.');
  }
  if (!Number.isInteger(defaults.activeTaxYear) || defaults.activeTaxYear < 1000 || defaults.activeTaxYear > 9999) {
    return invalidQuery('activeTaxYear', 'Active tax year must contain four digits.');
  }
  const asOfDate = input.asOfDate?.trim() || fiscalPeriodEnd(defaults);
  if (!isBusinessDate(asOfDate)) return invalidQuery('asOfDate', 'Balance Sheet as-of date must be a valid YYYY-MM-DD date.');
  return { ok: true, value: { asOfDate, includeZeroBalanceAccounts: input.includeZeroBalanceAccounts ?? false } };
}

export function validateReportIdentity(
  report: BalanceSheetIdentity,
  request: BalanceSheetIdentity,
): BalanceSheetContractResult<BalanceSheetIdentity> {
  if (report.reportId !== request.reportId || report.databaseRevision !== request.databaseRevision) {
    return {
      ok: false,
      error: {
        code: 'REPORT_REVISION_STALE',
        message: 'The Balance Sheet no longer matches the active database revision. Regenerate the report.',
        retryable: true,
      },
    };
  }
  return { ok: true, value: request };
}

export function validateBalanceSheetDetail(detail: BalanceSheetDetail): BalanceSheetContractResult<BalanceSheetDetail> {
  const contributionTotal = detail.contributions.reduce((total, contribution) => total + contribution.contributionMinor, 0n);
  if (contributionTotal !== detail.amountMinor) {
    return {
      ok: false,
      error: {
        code: 'REPORT_DETAIL_RECONCILIATION_FAILED',
        message: 'Balance Sheet detail does not reconcile to its selected report row.',
        detailKey: detail.detailKey,
        retryable: false,
      },
    };
  }
  return { ok: true, value: detail };
}

export function freezeBalanceSheetReport(report: BalanceSheetReport): BalanceSheetReport {
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
    fiscalPeriod: Object.freeze({ ...report.fiscalPeriod }),
    rows: Object.freeze(report.rows.map(row => Object.freeze({ ...row }))),
    warnings: Object.freeze(report.warnings.map(warning => Object.freeze({ ...warning }))),
    detailIndex: Object.freeze(frozenDetails),
  });
}

function invalidQuery(field: string, message: string): BalanceSheetContractResult<BalanceSheetQuery> {
  return { ok: false, error: { code: 'REPORT_QUERY_INVALID', message, field, retryable: false } };
}

function fiscalPeriodEnd(defaults: BalanceSheetQueryDefaults): string {
  const endMonth = defaults.fiscalYearStartMonth === 1 ? 12 : defaults.fiscalYearStartMonth - 1;
  const endYear = defaults.activeTaxYear;
  const endDay = daysInMonth(endYear, endMonth);
  return `${endYear.toString().padStart(4, '0')}-${endMonth.toString().padStart(2, '0')}-${endDay.toString().padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isBusinessDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}
