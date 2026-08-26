import {
  CASH_FLOW_ACCOUNT_TYPES,
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_CLASSIFICATION_IMPORT_ISSUE_CODES,
  CASH_FLOW_CLASSIFICATION_FAILURE_CODES,
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_CONTRIBUTION_TYPES,
  CASH_FLOW_FAILURE_CODES,
  CASH_FLOW_REPORT_STATUSES,
  CASH_FLOW_ROW_TYPES,
  CASH_FLOW_SECTIONS,
  CASH_FLOW_TREATMENTS,
  CASH_FLOW_WARNING_CODES,
  CashFlowClassificationImportRow,
  CashFlowDetail,
  CashFlowReport,
  cashFlowAccountRowId,
  cashFlowDetailKey,
  cashFlowReportId,
  cashFlowSyntheticRowId,
  cashFlowWarningId,
  databaseRevision,
  freezeCashFlowClassificationReview,
  freezeCashFlowReport,
  normalizeCashFlowQuery,
  validateCashFlowDetail,
  validateCashFlowReportIdentity,
} from './cash-flow.types';

describe('Cash Flow public contracts', () => {
  it('publishes exhaustive section, row, contribution, warning, and failure families', () => {
    expect(CASH_FLOW_ACCOUNT_TYPES).toEqual([
      'BANK', 'ACCOUNTS_RECEIVABLE', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'OTHER_ASSET',
      'CREDIT_CARD', 'ACCOUNTS_PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY',
      'EQUITY', 'INCOME', 'OTHER_INCOME', 'COGS', 'EXPENSE', 'OTHER_EXPENSE',
    ]);
    expect(CASH_FLOW_CASH_ROLES).toEqual(['CASH', 'CASH_EQUIVALENT', 'RESTRICTED_CASH', 'NOT_CASH', 'REVIEW_REQUIRED']);
    expect(CASH_FLOW_TREATMENTS).toEqual([
      'CASH_BALANCE', 'OPERATING_REVENUE_EXPENSE', 'OPERATING_ASSET', 'OPERATING_LIABILITY',
      'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED',
    ]);
    expect(CASH_FLOW_CLASSIFICATION_STATUSES).toEqual(['CONFIRMED', 'REVIEW_REQUIRED']);
    expect(CASH_FLOW_CLASSIFICATION_SOURCES).toEqual(['DEFAULT', 'MIGRATED', 'USER']);
    expect(CASH_FLOW_SECTIONS).toEqual(['OPERATING', 'INVESTING', 'FINANCING', 'CASH_RECONCILIATION', 'NONCASH_DISCLOSURE']);
    expect(CASH_FLOW_REPORT_STATUSES).toEqual(['COMPLETE', 'REVIEW_REQUIRED']);
    expect(CASH_FLOW_ROW_TYPES).toEqual([
      'SECTION_HEADER', 'NET_PROFIT', 'GROUP_HEADER', 'ADJUSTMENT', 'ACCOUNT_ACTIVITY',
      'SUBTOTAL', 'TOTAL', 'CASH_BALANCE', 'DIFFERENCE', 'NONCASH_DISCLOSURE',
    ]);
    expect(CASH_FLOW_CONTRIBUTION_TYPES).toEqual([
      'PNL_SPLIT', 'NONCASH_REVERSAL', 'BALANCE_CHANGE', 'CASH_TRANSACTION', 'TRANSFER',
      'OPENING_BALANCE', 'FORMULA', 'NONCASH_DISCLOSURE', 'UNCLASSIFIED',
    ]);
    expect(CASH_FLOW_WARNING_CODES).toEqual([
      'NO_CASH_ACCOUNTS_CONFIGURED', 'CASH_ROLE_REVIEW_REQUIRED', 'CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED',
      'UNCLASSIFIED_CASH_ACTIVITY', 'CASH_RECONCILIATION_DIFFERENCE', 'SOURCE_BALANCE_SHEET_OUT_OF_BALANCE',
      'OPENING_CASH_BALANCE_WITHIN_PERIOD', 'OPENING_BALANCE_MODE_CONFLICT', 'UNMATCHED_CASH_TRANSFER_CANDIDATE',
      'RESTRICTED_CASH_PRESENT', 'NONCASH_ACTIVITY_IDENTIFIED', 'ARCHIVED_PARTICIPATING_ACCOUNT',
      'ACCOUNT_HIERARCHY_INVALID', 'CASH_FLOW_CLASSIFICATION_INVALID', 'EXCLUDED_MATERIAL_CASH_ACTIVITY', 'UNSUPPORTED_CURRENCY',
    ]);
    expect(CASH_FLOW_CLASSIFICATION_FAILURE_CODES).toEqual([
      'ACCOUNT_NOT_FOUND', 'CASH_ROLE_REQUIRED', 'CASH_ROLE_NOT_ALLOWED', 'TREATMENT_INCOMPATIBLE', 'RATIONALE_REQUIRED', 'CLASSIFICATION_STALE',
    ]);
    expect(CASH_FLOW_FAILURE_CODES).toEqual([
      'CASH_FLOW_NOT_IMPLEMENTED', 'INVALID_CASH_FLOW_DATE_RANGE', 'CASH_FLOW_REPORT_GENERATION_FAILED', 'CASH_FLOW_REPORT_REVISION_STALE',
      'CASH_FLOW_DETAIL_NOT_FOUND', 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED', 'CASH_FLOW_CLASSIFICATION_INVALID',
      'CASH_FLOW_CLASSIFICATION_STALE', 'CASH_FLOW_EXPORT_FAILED', 'CASH_FLOW_EXPORT_CANCELLED',
      'CASH_FLOW_PRINT_PREVIEW_FAILED', 'UNSUPPORTED_CURRENCY',
    ]);
    expect(CASH_FLOW_CLASSIFICATION_IMPORT_ISSUE_CODES).toEqual([
      'ACCOUNT_NOT_FOUND', 'AMBIGUOUS_ACCOUNT_PATH', 'MISSING_ACCOUNT_REFERENCE', 'ARCHIVED_ACCOUNT',
      'UNKNOWN_ACCOUNT_ROLE', 'UNKNOWN_ACCOUNT_TYPE', 'UNKNOWN_CASH_ROLE', 'UNKNOWN_TREATMENT',
      'UNKNOWN_STATUS', 'UNKNOWN_SOURCE', 'INCOMPATIBLE_CLASSIFICATION', 'RATIONALE_REQUIRED', 'CLASSIFICATION_STALE',
    ]);
  });

  it('accepts raw exchange rows that preserve preview-time failure cases', () => {
    const missingId: CashFlowClassificationImportRow = {
      accountPath: 'Assets > Bank > Checking', accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      cashRole: 'CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'MIGRATED', rationale: 'Imported legacy row.',
    };
    const unknownEnums: CashFlowClassificationImportRow = {
      accountId: 'source-1', accountPath: 'Assets > Bank > Checking', accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      cashRole: 'MYSTERY_CASH_ROLE', treatment: 'MYSTERY_TREATMENT', status: 'MYSTERY_STATUS', source: 'MYSTERY_SOURCE', rationale: '',
    };
    expect(missingId.accountId).toBeUndefined();
    expect(unknownEnums.cashRole).toBe('MYSTERY_CASH_ROLE');
  });

  it('normalizes fiscal-year defaults and rejects invalid or reversed date ranges', () => {
    expect(normalizeCashFlowQuery({}, { fiscalYearStartMonth: 1, activeTaxYear: 2026 })).toEqual({
      ok: true, value: { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false },
    });
    expect(normalizeCashFlowQuery({}, { fiscalYearStartMonth: 7, activeTaxYear: 2026 })).toEqual({
      ok: true, value: { startDate: '2025-07-01', endDate: '2026-06-30', includeZeroRows: false },
    });
    expect(normalizeCashFlowQuery({}, { fiscalYearStartMonth: 3, activeTaxYear: 2024 })).toEqual({
      ok: true, value: { startDate: '2023-03-01', endDate: '2024-02-29', includeZeroRows: false },
    });
    expect(normalizeCashFlowQuery({ startDate: '2026-02-30', endDate: '2026-03-01' }, { fiscalYearStartMonth: 1, activeTaxYear: 2026 })).toEqual(jasmine.objectContaining({
      ok: false, error: jasmine.objectContaining({ code: 'INVALID_CASH_FLOW_DATE_RANGE', field: 'startDate', retryable: false }),
    }));
    expect(normalizeCashFlowQuery({ startDate: '2026-04-01', endDate: '2026-03-31' }, { fiscalYearStartMonth: 1, activeTaxYear: 2026 })).toEqual(jasmine.objectContaining({
      ok: false, error: jasmine.objectContaining({ code: 'INVALID_CASH_FLOW_DATE_RANGE', field: 'dateRange' }),
    }));
  });

  it('builds semantic IDs from revision, section, role, and stable IDs rather than labels', () => {
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
    const revision = databaseRevision('sqlite-change-42');
    const account = cashFlowAccountRowId('OPERATING', 'FINANCIAL_SOURCE', 'account/id');
    const synthetic = cashFlowSyntheticRowId('NET_OPERATING', query);

    expect(account).toBe('ACCOUNT:OPERATING:FINANCIAL_SOURCE:account%2Fid');
    expect(synthetic).toBe('SYNTHETIC:NET_OPERATING:2026-01-01:2026-12-31');
    expect(cashFlowDetailKey(account)).toBe('DETAIL:ACCOUNT:OPERATING:FINANCIAL_SOURCE:account%2Fid');
    expect(cashFlowReportId(revision, query)).toBe('CASH_FLOW:sqlite-change-42:2026-01-01:2026-12-31:NONZERO:INDIRECT:v1');
    expect(cashFlowReportId(revision, { ...query, includeZeroRows: true })).not.toBe(cashFlowReportId(revision, query));
    expect(cashFlowWarningId('UNCLASSIFIED_CASH_ACTIVITY', ['z', 'a'], query)).toBe(cashFlowWarningId('UNCLASSIFIED_CASH_ACTIVITY', ['a', 'z'], query));
  });

  it('deep-freezes report rows, warnings, contributions, disclosures, and metadata while retaining bigint money', () => {
    const report = freezeCashFlowReport(reportFixture());
    const row = report.rows[0];
    const contributions = report.detailIndex[row.detailKey!];

    expect(Object.isFrozen(report)).toBeTrue();
    expect(Object.isFrozen(report.query)).toBeTrue();
    expect(Object.isFrozen(report.company.addressLines)).toBeTrue();
    expect(Object.isFrozen(report.rows)).toBeTrue();
    expect(Object.isFrozen(row)).toBeTrue();
    expect(Object.isFrozen(report.disclosures)).toBeTrue();
    expect(Object.isFrozen(report.warnings)).toBeTrue();
    expect(Object.isFrozen(report.warnings[0].references)).toBeTrue();
    expect(Object.isFrozen(report.detailIndex)).toBeTrue();
    expect(Object.isFrozen(contributions)).toBeTrue();
    expect(Object.isFrozen(contributions[0])).toBeTrue();
    expect(typeof report.beginningCashMinor).toBe('bigint');
    expect(typeof row.amountMinor).toBe('bigint');
    expect(typeof contributions[0].contributionMinor).toBe('bigint');
  });

  it('rejects stale report identities and non-reconciling or mismatched detail contributions', () => {
    const report = reportFixture();
    const stale = validateCashFlowReportIdentity(report, {
      reportId: report.reportId,
      databaseRevision: databaseRevision('new-revision'),
    });
    expect(stale).toEqual(jasmine.objectContaining({
      ok: false, error: jasmine.objectContaining({ code: 'CASH_FLOW_REPORT_REVISION_STALE', retryable: true }),
    }));

    const row = report.rows[0];
    const detail: CashFlowDetail = {
      reportId: report.reportId,
      databaseRevision: report.databaseRevision,
      rowId: row.rowId,
      detailKey: row.detailKey!,
      amountMinor: row.amountMinor!,
      contributions: report.detailIndex[row.detailKey!],
    };
    expect(validateCashFlowDetail(detail).ok).toBeTrue();
    expect(validateCashFlowDetail({ ...detail, amountMinor: detail.amountMinor + 1n })).toEqual(jasmine.objectContaining({
      ok: false, error: jasmine.objectContaining({ code: 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED', retryable: false }),
    }));
    expect(validateCashFlowDetail({
      ...detail,
      contributions: [{ ...detail.contributions[0], detailKey: cashFlowDetailKey(cashFlowSyntheticRowId('DIFFERENCE', report.query)) }],
    })).toEqual(jasmine.objectContaining({
      ok: false, error: jasmine.objectContaining({ code: 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED' }),
    }));
  });

  it('freezes classification review state without exposing mutable arrays', () => {
    const review = freezeCashFlowClassificationReview({
      query: { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false },
      databaseRevision: databaseRevision('sqlite-change-42'),
      accounts: [{
        accountRole: 'CHART', accountId: 'chart-1', accountPath: 'Expenses > Review', accountType: 'EXPENSE', detailType: 'Custom detail',
        treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', source: 'MIGRATED', rationale: 'Needs review.',
        openingAmountMinor: 0n, endingAmountMinor: -125n, periodActivityMinor: -125n, reportImpactMinor: 0n,
      }],
      blockingCount: 1,
      warningCount: 0,
    });
    expect(Object.isFrozen(review)).toBeTrue();
    expect(Object.isFrozen(review.query)).toBeTrue();
    expect(Object.isFrozen(review.accounts)).toBeTrue();
    expect(Object.isFrozen(review.accounts[0])).toBeTrue();
  });
});

function reportFixture(): CashFlowReport {
  const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
  const revision = databaseRevision('sqlite-change-42');
  const rowId = cashFlowAccountRowId('OPERATING', 'FINANCIAL_SOURCE', 'checking-1');
  const detailKey = cashFlowDetailKey(rowId);
  return {
    reportId: cashFlowReportId(revision, query),
    databaseRevision: revision,
    generatedAt: '2026-08-25T00:00:00.000Z',
    query,
    company: {
      companyId: 'company-1', legalName: 'Northstar Workshop LLC', displayName: 'Northstar Workshop',
      addressLines: ['100 Example Avenue', 'Portland, OR 97205'], contactLines: ['hello@example.test'],
    },
    currencyCode: 'USD', accountingBasis: 'CASH', method: 'INDIRECT', status: 'COMPLETE',
    rows: [{
      rowId, rowType: 'ACCOUNT_ACTIVITY', section: 'OPERATING', treatment: 'OPERATING_ASSET',
      accountRole: 'FINANCIAL_SOURCE', accountId: 'checking-1', label: 'Operating Checking',
      fullPath: 'Assets > Bank > Operating Checking', depth: 1, amountMinor: 12_345n, detailKey,
      bold: false, derived: false, archived: false, reviewRequired: false,
    }],
    disclosures: [{ disclosureId: 'disclosure-1', section: 'NONCASH_DISCLOSURE', label: 'Noncash activity', amountMinor: 0n, rationale: 'No identifiable noncash activity.' }],
    netOperatingMinor: 12_345n, netInvestingMinor: 0n, netFinancingMinor: 0n, netChangeInCashMinor: 12_345n,
    beginningCashMinor: 0n, calculatedEndingCashMinor: 12_345n, endingCashMinor: 12_345n, differenceMinor: 0n,
    restrictedCashBeginningMinor: 0n, restrictedCashEndingMinor: 0n, unclassifiedCashActivityMinor: 0n,
    warnings: [{ warningId: 'WARNING:ARCHIVED_PARTICIPATING_ACCOUNT:checking-1:2026-01-01:2026-12-31' as never, code: 'ARCHIVED_PARTICIPATING_ACCOUNT', message: 'Archived account retained.', accountId: 'checking-1', references: ['checking-1'] }],
    detailIndex: { [detailKey]: [{ contributionId: 'opening:checking-1', detailKey, contributionType: 'CASH_TRANSACTION', businessDate: '2026-01-01', accountRole: 'FINANCIAL_SOURCE', accountId: 'checking-1', description: 'Opening activity', contributionMinor: 12_345n }] },
  };
}
