import {
  ACCOUNT_FAILURE_CODES,
  BALANCE_SHEET_WARNING_CODES,
  BalanceSheetDetail,
  BalanceSheetReport,
  COMPANY_FAILURE_CODES,
  EXPORT_FAILURE_CODES,
  RECONCILIATION_FAILURE_CODES,
  REPORT_FAILURE_CODES,
  accountBalanceSheetRowId,
  accountTypeBalanceSheetRowId,
  balanceSheetDetailKey,
  balanceSheetShortcutDate,
  balanceSheetReportId,
  databaseRevision,
  freezeBalanceSheetReport,
  normalizeBalanceSheetQuery,
  reportCompanyIdentity,
  syntheticBalanceSheetRowId,
  validateBalanceSheetDetail,
  validateReportIdentity,
} from './balance-sheet.types';

describe('Balance Sheet public contracts', () => {
  it('normalizes default as-of dates for calendar, non-calendar, and leap-year fiscal periods', () => {
    expect(normalizeBalanceSheetQuery({}, { fiscalYearStartMonth: 1, activeTaxYear: 2026 })).toEqual({
      ok: true,
      value: { asOfDate: '2026-12-31', includeZeroBalanceAccounts: false },
    });
    expect(normalizeBalanceSheetQuery({}, { fiscalYearStartMonth: 7, activeTaxYear: 2026 })).toEqual({
      ok: true,
      value: { asOfDate: '2026-06-30', includeZeroBalanceAccounts: false },
    });
    expect(normalizeBalanceSheetQuery({}, { fiscalYearStartMonth: 3, activeTaxYear: 2024 })).toEqual({
      ok: true,
      value: { asOfDate: '2024-02-29', includeZeroBalanceAccounts: false },
    });
    expect(normalizeBalanceSheetQuery({ asOfDate: '2026-02-30' }, { fiscalYearStartMonth: 1, activeTaxYear: 2026 })).toEqual(
      jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'REPORT_QUERY_INVALID', field: 'asOfDate' }) }),
    );
  });

  it('calculates deterministic date shortcuts across month, year, and leap boundaries', () => {
    const defaults = { fiscalYearStartMonth: 7, activeTaxYear: 2026 };
    expect(balanceSheetShortcutDate('TODAY', '2024-03-12', defaults)).toEqual({ ok: true, value: '2024-03-12' });
    expect(balanceSheetShortcutDate('PREVIOUS_MONTH_END', '2024-03-12', defaults)).toEqual({ ok: true, value: '2024-02-29' });
    expect(balanceSheetShortcutDate('PREVIOUS_MONTH_END', '2026-01-12', defaults)).toEqual({ ok: true, value: '2025-12-31' });
    expect(balanceSheetShortcutDate('CURRENT_MONTH_END', '2026-04-12', defaults)).toEqual({ ok: true, value: '2026-04-30' });
    expect(balanceSheetShortcutDate('FISCAL_YEAR_END', '2026-08-12', defaults)).toEqual({ ok: true, value: '2027-06-30' });
  });

  it('builds stable semantic identities without display labels', () => {
    const query = { asOfDate: '2026-12-31', includeZeroBalanceAccounts: false };
    const revision = databaseRevision('sqlite-change-42');
    const accountRowId = accountBalanceSheetRowId('FINANCIAL_SOURCE', 'account/id');

    expect(accountRowId).toBe('ACCOUNT:FINANCIAL_SOURCE:account%2Fid');
    expect(accountTypeBalanceSheetRowId('OTHER_CURRENT_ASSET', query.asOfDate)).toBe('ACCOUNT_TYPE:OTHER_CURRENT_ASSET:2026-12-31');
    expect(syntheticBalanceSheetRowId('CURRENT_EARNINGS', query.asOfDate)).toBe('SYNTHETIC:CURRENT_EARNINGS:2026-12-31');
    expect(balanceSheetDetailKey(accountRowId)).toBe('DETAIL:ACCOUNT:FINANCIAL_SOURCE:account%2Fid');
    expect(balanceSheetReportId(revision, query)).toBe('BALANCE_SHEET:sqlite-change-42:2026-12-31:NONZERO');
  });

  it('deep-freezes one immutable report snapshot and retains bigint money', () => {
    const report = freezeBalanceSheetReport(reportFixture());

    expect(Object.isFrozen(report)).toBeTrue();
    expect(Object.isFrozen(report.query)).toBeTrue();
    expect(Object.isFrozen(report.company.addressLines)).toBeTrue();
    expect(Object.isFrozen(report.rows)).toBeTrue();
    expect(Object.isFrozen(report.rows[0])).toBeTrue();
    expect(Object.isFrozen(report.warnings)).toBeTrue();
    expect(Object.isFrozen(report.detailIndex)).toBeTrue();
    expect(Object.isFrozen(report.detailIndex[report.rows[0].detailKey!])).toBeTrue();
    expect(typeof report.totalAssetsMinor).toBe('bigint');
    expect(typeof report.rows[0].amountMinor).toBe('bigint');
    expect(typeof report.detailIndex[report.rows[0].detailKey!][0].contributionMinor).toBe('bigint');
  });

  it('rejects stale report identities with a typed refreshable failure', () => {
    const report = reportFixture();
    const result = validateReportIdentity(report, {
      reportId: report.reportId,
      databaseRevision: databaseRevision('new-revision'),
    });

    expect(result).toEqual(jasmine.objectContaining({
      ok: false,
      error: jasmine.objectContaining({ code: 'REPORT_REVISION_STALE', retryable: true }),
    }));
  });

  it('accepts exact detail and rejects a partial contribution set', () => {
    const report = reportFixture();
    const row = report.rows[0];
    const detail: BalanceSheetDetail = {
      reportId: report.reportId,
      databaseRevision: report.databaseRevision,
      rowId: row.rowId,
      detailKey: row.detailKey!,
      amountMinor: row.amountMinor!,
      contributions: report.detailIndex[row.detailKey!],
    };
    expect(validateBalanceSheetDetail(detail).ok).toBeTrue();
    expect(validateBalanceSheetDetail({ ...detail, amountMinor: detail.amountMinor + 1n })).toEqual(jasmine.objectContaining({
      ok: false,
      error: jasmine.objectContaining({ code: 'REPORT_DETAIL_RECONCILIATION_FAILED', retryable: false }),
    }));
  });

  it('publishes complete typed warning and failure-code families', () => {
    expect(BALANCE_SHEET_WARNING_CODES.length).toBe(8);
    expect(COMPANY_FAILURE_CODES).toContain('COMPANY_PROFILE_STALE');
    expect(ACCOUNT_FAILURE_CODES).toContain('ACCOUNT_REFERENCE_CONFLICT');
    expect(REPORT_FAILURE_CODES).toContain('REPORT_REVISION_STALE');
    expect(RECONCILIATION_FAILURE_CODES).toContain('REPORT_DETAIL_RECONCILIATION_FAILED');
    expect(EXPORT_FAILURE_CODES).toContain('BALANCE_SHEET_EXPORT_FAILED');
  });

  it('formats reusable report identity without tax data or blank optional lines', () => {
    const identity = reportCompanyIdentity({
      companyId: 'company-1', legalName: 'Copper Lantern Studio LLC', displayName: 'Copper Lantern Studio',
      doingBusinessAs: 'Copper Lantern', address: { line1: '44 Example Way', locality: 'Portland', region: 'OR', postalCode: '97205', countryCode: 'US' },
      email: 'books@copper-lantern.example', maskedTaxIdentifier: '•••• 6789', currencyCode: 'USD',
      fiscalYearStartMonth: 1, accountingBasis: 'CASH', activeTaxYear: 2026,
      createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-08-21T20:00:00.000Z',
    });

    expect(identity.addressLines).toEqual(['44 Example Way', 'Portland, OR 97205', 'US']);
    expect(identity.contactLines).toEqual(['books@copper-lantern.example']);
    expect(JSON.stringify(identity)).not.toContain('tax');
    expect(JSON.stringify(identity)).not.toContain('6789');
    expect(Object.isFrozen(identity)).toBeTrue();
  });
});

function reportFixture(): BalanceSheetReport {
  const query = { asOfDate: '2026-12-31', includeZeroBalanceAccounts: false };
  const revision = databaseRevision('sqlite-change-42');
  const rowId = accountBalanceSheetRowId('FINANCIAL_SOURCE', 'checking-1');
  const detailKey = balanceSheetDetailKey(rowId);
  return {
    reportId: balanceSheetReportId(revision, query),
    databaseRevision: revision,
    generatedAt: '2026-08-21T20:00:00.000Z',
    query,
    company: {
      companyId: 'company-1',
      legalName: 'Northstar Workshop LLC',
      displayName: 'Northstar Workshop',
      addressLines: ['100 Example Avenue', 'Portland, OR 97205'],
      contactLines: ['hello@example.test'],
    },
    currencyCode: 'USD',
    accountingBasis: 'CASH',
    fiscalPeriod: { startDate: '2026-01-01', endDate: '2026-12-31' },
    rows: [{
      rowId,
      rowType: 'ACCOUNT',
      section: 'ASSETS',
      accountType: 'BANK',
      accountRole: 'FINANCIAL_SOURCE',
      accountId: 'checking-1',
      label: 'Operating Checking',
      fullPath: 'Assets > Bank > Operating Checking',
      depth: 2,
      amountMinor: 12_345n,
      detailKey,
      bold: false,
      derived: false,
      archived: false,
      unclassified: false,
    }],
    totalAssetsMinor: 12_345n,
    totalLiabilitiesMinor: 0n,
    totalEquityMinor: 12_345n,
    totalLiabilitiesAndEquityMinor: 12_345n,
    differenceMinor: 0n,
    warnings: [],
    detailIndex: {
      [detailKey]: [{
        contributionId: 'opening:checking-1',
        kind: 'OPENING_BALANCE',
        businessDate: '2026-01-01',
        financialAccountId: 'checking-1',
        description: 'Opening balance',
        storedAmountMinor: 12_345n,
        contributionMinor: 12_345n,
        runningBalanceMinor: 12_345n,
      }],
    },
  };
}
