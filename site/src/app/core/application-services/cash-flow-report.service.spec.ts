import { TestBed } from '@angular/core/testing';
import Papa from 'papaparse';
import { ChartAccount, FinancialAccount, Transaction, money } from '../domain-model/accounting.types';
import { CashFlowClassification } from '../domain-model/cash-flow-classification';
import { CashFlowContribution, CashFlowContractError, CashFlowReport } from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { BalanceSheetReportService } from './balance-sheet-report.service';
import { assertCashFlowDetailAmount, CashFlowReportService, dayBeforeBusinessDate } from './cash-flow-report.service';
import { calculateUnadjustedNetProfit } from './profit-loss-calculation';
import { cashFlowCsv, cashFlowPrintHtml, cashFlowPrintModel, cashFlowXlsx, cashFlowXlsxDecimalNumber } from './cash-flow-output.service';
import * as XLSX from 'xlsx';

describe('CashFlowReportService query and cash balances', () => {
  let repository: InMemoryAccountingRepository;
  let service: CashFlowReportService;
  let balanceSheets: BalanceSheetReportService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InMemoryAccountingRepository,
        CashFlowReportService,
        BalanceSheetReportService,
        { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
      ],
    });
    repository = TestBed.inject(InMemoryAccountingRepository);
    service = TestBed.inject(CashFlowReportService);
    balanceSheets = TestBed.inject(BalanceSheetReportService);
    repository.company = {
      id: 'company-cash-flow', name: 'Northstar Workshop LLC', currency: 'USD', fiscalYearStartMonth: 1,
      accountingBasis: 'CASH', activeTaxYear: 2026,
    };
    repository.accounts.clear();
    repository.transactions.clear();
    repository.transfers.clear();
    repository.cashFlowClassifications.clear();
    repository.audit.length = 0;
  });

  it('normalizes the active fiscal year and returns one immutable revision-consistent snapshot', () => {
    repository.company = { ...repository.company, fiscalYearStartMonth: 7, activeTaxYear: 2026 };
    const read = spyOn(repository, 'readCashFlowSnapshot').and.callThrough();

    const report = service.getCashFlowReport({});

    expect(report.query).toEqual({ startDate: '2025-07-01', endDate: '2026-06-30', includeZeroRows: false });
    expect(read).toHaveBeenCalledOnceWith('2026-06-30');
    expect(report.databaseRevision).toBe(repository.getDatabaseRevision());
    expect(report.beginningCashMinor).toBe(0n);
    expect(report.endingCashMinor).toBe(0n);
    expect(report.warnings.map(warning => warning.code)).toContain('NO_CASH_ACCOUNTS_CONFIGURED');
    expect(Object.isFrozen(report)).toBeTrue();
    expect(Object.isFrozen(report.rows)).toBeTrue();
    expect(Object.isFrozen(report.query)).toBeTrue();
  });

  it('returns the cached immutable report for an unchanged query and invalidates it on revision change', () => {
    const read = spyOn(repository, 'readCashFlowSnapshot').and.callThrough();
    const query = { startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false };
    const first = service.getCashFlowReport(query);
    const repeated = service.getCashFlowReport({ ...query });
    expect(repeated).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);

    const withZeroRows = service.getCashFlowReport({ ...query, includeZeroRows: true });
    expect(withZeroRows).not.toBe(first);
    expect(withZeroRows.reportId).toBe(first.reportId);
    expect(read).toHaveBeenCalledTimes(2);

    repository.company = { ...repository.company, name: 'Revision changed' };
    const refreshed = service.getCashFlowReport(query);
    expect(refreshed).not.toBe(first);
    expect(refreshed.databaseRevision).not.toBe(first.databaseRevision);
    expect(read).toHaveBeenCalledTimes(3);
    expect(first.company.displayName).not.toBe(refreshed.company.displayName);
  });

  it('returns exact row detail and rejects it after the report revision becomes stale', () => {
    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const row = report.rows.find(candidate => candidate.amountMinor !== undefined && candidate.detailKey)!;
    const detail = service.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: row.detailKey! });
    expect(detail.rowId).toBe(row.rowId);
    expect(detail.amountMinor).toBe(row.amountMinor!);
    expect(detail.contributions).toEqual(report.detailIndex[row.detailKey!]);
    expect(detail.contributions.reduce((sum, item) => sum + item.contributionMinor, 0n)).toBe(detail.amountMinor);
    expect(Object.isFrozen(detail)).toBeTrue();

    repository.company = { ...repository.company, name: 'Changed after detail read' };
    expect(() => service.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: row.detailKey! }))
      .toThrowError(CashFlowContractError);
    try {
      service.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: row.detailKey! });
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_REVISION_STALE');
      expect((error as CashFlowContractError).failure.retryable).toBeTrue();
    }
  });

  it('raises the typed reconciliation failure with report and detail identity for mismatched detail', () => {
    addAccount('cash', 'Operating Checking', 0n, '2025-12-01', 'CASH');
    const income = addChartAccount('detail-income', 'Detail Income', 'INCOME', 'Sales of product income');
    addTransaction('detail-guard-transaction', 'cash', '2026-01-02', 25n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 25n }]);
    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const row = report.rows.find(candidate => candidate.rowType === 'NET_PROFIT')!;
    const original = report.detailIndex[row.detailKey!]!;
    const mismatched = original.map((contribution, index) => index === 0
      ? { ...contribution, contributionMinor: contribution.contributionMinor + 1n }
      : contribution);

    expect(() => assertCashFlowDetailAmount(row, mismatched, { reportId: report.reportId, databaseRevision: report.databaseRevision }))
      .toThrowError(CashFlowContractError);
    try {
      assertCashFlowDetailAmount(row, mismatched, { reportId: report.reportId, databaseRevision: report.databaseRevision });
      fail('Expected a typed Cash Flow detail reconciliation failure.');
    } catch (error) {
      const failure = (error as CashFlowContractError).failure;
      expect(failure.code).toBe('CASH_FLOW_DETAIL_RECONCILIATION_FAILED');
      expect(failure.reportId).toBe(report.reportId);
      expect(failure.databaseRevision).toBe(report.databaseRevision);
      expect(failure.detailKey).toBe(row.detailKey);
      expect(failure.retryable).toBeFalse();
    }

    // Corrupt the cached detail through the service boundary as a second
    // guard: callers must receive the typed failure and never a partial list.
    const cachedReports = (service as unknown as {
      reportsById: Map<string, typeof report>;
    }).reportsById;
    const corruptedReport = Object.freeze({
      ...report,
      detailIndex: Object.freeze({ ...report.detailIndex, [row.detailKey!]: Object.freeze(mismatched) }),
    }) as typeof report;
    cachedReports.set(report.reportId, corruptedReport);
    expect(() => service.getCashFlowDetail({
      reportId: report.reportId,
      databaseRevision: report.databaseRevision,
      detailKey: row.detailKey!,
    })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: row.detailKey! });
      fail('Expected corrupted detail to be rejected.');
    } catch (error) {
      const failure = (error as CashFlowContractError).failure;
      expect(failure.code).toBe('CASH_FLOW_DETAIL_RECONCILIATION_FAILED');
      expect(failure.reportId).toBe(report.reportId);
      expect(failure.detailKey).toBe(row.detailKey);
      expect(failure.retryable).toBeFalse();
    }
  });

  it('matches Balance Sheet source balances while excluding Pending and Excluded activity', () => {
    addAccount('checking', 'Operating Checking', 1_000n, '2025-12-01', 'CASH');
    addAccount('money-market', 'Money Market', 500n, '2025-12-01', 'CASH_EQUIVALENT');
    addAccount('restricted', 'Restricted Reserve', 700n, '2025-12-01', 'RESTRICTED_CASH');
    addTransaction('before', 'checking', '2025-12-31', 200n, 'POSTED');
    addTransaction('start', 'checking', '2026-01-01', 300n, 'POSTED');
    addTransaction('pending', 'checking', '2026-01-02', 9_000n, 'PENDING');
    addTransaction('excluded', 'checking', '2026-01-03', 8_000n, 'EXCLUDED');
    addTransaction('restricted-change', 'restricted', '2026-01-04', 100n, 'POSTED');

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const opening = balanceSheets.readFinancialSourceBalances({ asOfDate: '2025-12-31', includeZeroBalanceAccounts: true });
    const ending = balanceSheets.readFinancialSourceBalances({ asOfDate: '2026-01-31', includeZeroBalanceAccounts: true });
    const unrestricted = new Set(['checking', 'money-market']);
    const expectedOpening = opening.balances.reduce((sum, row) => sum + (unrestricted.has(row.account.id) ? row.amountMinor : 0n), 0n);
    const expectedEnding = ending.balances.reduce((sum, row) => sum + (unrestricted.has(row.account.id) ? row.amountMinor : 0n), 0n);

    expect(report.beginningCashMinor).toBe(1_700n);
    expect(report.endingCashMinor).toBe(2_000n);
    expect(report.beginningCashMinor).toBe(expectedOpening);
    expect(report.endingCashMinor).toBe(expectedEnding);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(1_700n);
    expect(report.differenceMinor).toBe(-300n);
    expect(report.restrictedCashBeginningMinor).toBe(700n);
    expect(report.restrictedCashEndingMinor).toBe(800n);
    expect(report.warnings.map(warning => warning.code)).toContain('RESTRICTED_CASH_PRESENT');
    expect(report.warnings.map(warning => warning.code)).not.toContain('SOURCE_BALANCE_SHEET_OUT_OF_BALANCE');
    expect(report.databaseRevision).toBe(opening.databaseRevision);
    expect(report.databaseRevision).toBe(ending.databaseRevision);
    expect(report.rows.find(row => row.rowId.includes('BEGINNING_CASH'))?.amountMinor).toBe(1_700n);
    expect(report.rows.find(row => row.rowId.includes('ENDING_CASH'))?.amountMinor).toBe(2_000n);
  });

  it('includes explicit unrestricted and restricted cash roles while review is required', () => {
    addAccount('review-cash', 'Review Checking', 1_000n, '2025-12-01', 'CASH');
    addAccount('review-restricted', 'Review Reserve', 600n, '2025-12-01', 'RESTRICTED_CASH');
    markReviewRequired('review-cash');
    markReviewRequired('review-restricted');
    addTransaction('review-cash-change', 'review-cash', '2026-01-05', 125n, 'POSTED');
    addTransaction('review-restricted-change', 'review-restricted', '2026-01-06', 75n, 'POSTED');

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const beginning = balanceSheets.readFinancialSourceBalances({ asOfDate: '2025-12-31', includeZeroBalanceAccounts: true });
    const ending = balanceSheets.readFinancialSourceBalances({ asOfDate: '2026-01-31', includeZeroBalanceAccounts: true });
    const amountFor = (snapshot: { balances: readonly { account: FinancialAccount; amountMinor: bigint }[] }, ids: readonly string[]) =>
      snapshot.balances.reduce((sum, balance) => sum + (ids.includes(balance.account.id) ? balance.amountMinor : 0n), 0n);

    expect(report.beginningCashMinor).toBe(amountFor(beginning, ['review-cash']));
    expect(report.endingCashMinor).toBe(amountFor(ending, ['review-cash']));
    expect(report.restrictedCashBeginningMinor).toBe(amountFor(beginning, ['review-restricted']));
    expect(report.restrictedCashEndingMinor).toBe(amountFor(ending, ['review-restricted']));
    expect(report.beginningCashMinor).toBe(1_000n);
    expect(report.endingCashMinor).toBe(1_125n);
    expect(report.restrictedCashBeginningMinor).toBe(600n);
    expect(report.restrictedCashEndingMinor).toBe(675n);
    expect(report.warnings.filter(warning => warning.code === 'CASH_ROLE_REVIEW_REQUIRED').map(warning => warning.accountId).sort())
      .toEqual(['review-cash', 'review-restricted']);
  });

  it('rejects a nonzero unsplit Posted cash transaction', () => {
    addAccount('cash', 'Operating Checking', 0n, '2025-12-01', 'CASH');
    addTransaction('unsplit-cash', 'cash', '2026-01-02', 125n, 'POSTED', undefined, [], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' }))
      .toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' });
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_GENERATION_FAILED');
    }
  });

  it('rejects mismatched all-Operating and all-Excluded cash splits', () => {
    addAccount('cash', 'Operating Checking', 0n, '2025-12-01', 'CASH');
    const expense = addChartAccount('expense', 'Operating expense', 'EXPENSE', 'Other business expenses');
    const excluded = addChartAccount('excluded', 'Excluded asset', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(expense.id, expense.accountType, expense.detailType, 'OPERATING_REVENUE_EXPENSE');
    addChartClassification(excluded.id, excluded.accountType, excluded.detailType, 'EXCLUDED');
    addTransaction('operating-mismatch', 'cash', '2026-01-02', -100n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -50n }], false);
    expect(() => service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' })).toThrowError(CashFlowContractError);

    repository.transactions.delete('operating-mismatch');
    addTransaction('excluded-mismatch', 'cash', '2026-01-03', -100n, 'POSTED', undefined, [{ chartAccountId: excluded.id, amountMinor: -50n }], false);
    expect(() => service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' })).toThrowError(CashFlowContractError);
  });

  it('retains invalid confirmed Chart classifications as unclassified cash activity', () => {
    addAccount('cash', 'Operating Checking', 0n, '2025-12-01', 'CASH');
    const missingChart = addChartAccount('missing-chart-classification', 'Removed equipment', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(missingChart.id, missingChart.accountType, missingChart.detailType, 'INVESTING');
    repository.chartAccounts.delete(missingChart.id);
    addTransaction('missing-chart-cash', 'cash', '2026-01-02', -80n, 'POSTED', undefined, [{ chartAccountId: missingChart.id, amountMinor: -80n }], false);
    const mismatchedChart = addChartAccount('mismatched-chart-classification', 'Mismatched equipment', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(mismatchedChart.id, mismatchedChart.accountType, mismatchedChart.detailType, 'INVESTING');
    const mismatchedClassification = repository.cashFlowClassifications.get(`CHART:${mismatchedChart.id}`)!;
    repository.cashFlowClassifications.set(`CHART:${mismatchedChart.id}`, { ...mismatchedClassification, accountId: 'foreign-chart-id' });
    addTransaction('mismatched-chart-cash', 'cash', '2026-01-03', -40n, 'POSTED', undefined, [{ chartAccountId: mismatchedChart.id, amountMinor: -40n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.unclassifiedCashActivityMinor).toBe(-120n);
    expect(report.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    expect(report.detailIndex[report.rows.find(row => row.rowType === 'TOTAL' && row.section === 'CASH_RECONCILIATION')?.detailKey ?? '']).toBeDefined();
  });

  it('matches unadjusted P/L exactly and reverses noncash depreciation and gains once', () => {
    addAccount('cash', 'Operating Checking', 1_000n, '2025-12-01', 'CASH');
    addAccount('card', 'Operating Card', 0n, '2025-12-01', 'NOT_CASH', false, 'CREDIT_CARD');
    const income = addChartAccount('income', 'Sales', 'INCOME', 'Sales of product income');
    const depreciation = addChartAccount('depreciation', 'Depreciation', 'OTHER_EXPENSE', 'Depreciation');
    const gain = addChartAccount('gain', 'Asset gain', 'OTHER_INCOME', 'Other investment income');
    addChartClassification(depreciation.id, depreciation.accountType, depreciation.detailType, 'NONCASH_PNL_ADJUSTMENT');
    addChartClassification(gain.id, gain.accountType, gain.detailType, 'NONCASH_PNL_ADJUSTMENT');
    addTransaction('cash-sale', 'cash', '2026-01-05', 200n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 200n }]);
    addTransaction('depreciation-charge', 'card', '2026-01-06', -60n, 'POSTED', undefined, [{ chartAccountId: depreciation.id, amountMinor: -60n }]);
    addTransaction('gain', 'card', '2026-01-07', 25n, 'POSTED', undefined, [{ chartAccountId: gain.id, amountMinor: 25n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const netProfit = report.rows.find(row => row.rowType === 'NET_PROFIT');
    const depreciationRow = report.rows.find(row => row.rowType === 'ADJUSTMENT' && row.accountId === depreciation.id);
    const gainRow = report.rows.find(row => row.rowType === 'ADJUSTMENT' && row.accountId === gain.id);
    const operating = report.rows.find(row => row.rowId === 'SYNTHETIC:NET_OPERATING:2026-01-01:2026-01-31');

    expect(netProfit?.amountMinor).toBe(165n);
    expect(netProfit?.amountMinor).toBe(calculateUnadjustedNetProfit([...repository.transactions.values()], [...repository.chartAccounts.values()], '2026-01-01', '2026-01-31'));
    expect(depreciationRow?.amountMinor).toBe(60n);
    expect(gainRow?.amountMinor).toBe(-25n);
    expect(operating?.amountMinor).toBe(200n);
    expect(report.netOperatingMinor).toBe(200n);
    expect(report.netChangeInCashMinor).toBe(200n);
    expect(report.endingCashMinor).toBe(1_200n);
    expect(sumDetail(report, netProfit?.detailKey)).toBe(165n);
    expect(sumDetail(report, depreciationRow?.detailKey)).toBe(60n);
    expect(sumDetail(report, gainRow?.detailKey)).toBe(-25n);
    expect(sumDetail(report, operating?.detailKey)).toBe(200n);
    expect(report.detailIndex[depreciationRow!.detailKey!][0].formula).toBe('-1 × period P/L contribution');
    expect(report.rows.filter(row => row.rowType === 'ADJUSTMENT').map(row => row.accountId)).toEqual([depreciation.id, gain.id]);
  });

  it('excludes Pending and Excluded P/L activity and supports deterministic zero rows', () => {
    addAccount('cash', 'Operating Checking', 0n, '2026-01-01', 'CASH');
    const depreciation = addChartAccount('zero-depreciation', 'Zero depreciation', 'OTHER_EXPENSE', 'Depreciation');
    const active = addChartAccount('active-depreciation', 'Active depreciation', 'OTHER_EXPENSE', 'Depreciation');
    addChartClassification(depreciation.id, depreciation.accountType, depreciation.detailType, 'NONCASH_PNL_ADJUSTMENT');
    addChartClassification(active.id, active.accountType, active.detailType, 'NONCASH_PNL_ADJUSTMENT');
    addTransaction('pending', 'cash', '2026-01-02', -100n, 'PENDING', undefined, [{ chartAccountId: depreciation.id, amountMinor: -100n }]);
    addTransaction('excluded', 'cash', '2026-01-03', -100n, 'EXCLUDED', undefined, [{ chartAccountId: depreciation.id, amountMinor: -100n }]);
    addTransaction('posted', 'cash', '2026-01-04', -10n, 'POSTED', undefined, [{ chartAccountId: active.id, amountMinor: -10n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const zeroHidden = report.rows.find(row => row.accountId === depreciation.id && row.rowType === 'ADJUSTMENT');
    expect(zeroHidden).toBeUndefined();
    expect(report.rows.find(row => row.accountId === active.id && row.rowType === 'ADJUSTMENT')?.amountMinor).toBe(10n);
    expect(report.rows.find(row => row.rowType === 'NET_PROFIT')?.amountMinor).toBe(-10n);

    const withZeroRows = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    expect(withZeroRows.rows.find(row => row.accountId === depreciation.id && row.rowType === 'ADJUSTMENT')?.amountMinor).toBe(0n);
    expect(withZeroRows.rows.filter(row => row.rowType === 'ADJUSTMENT').map(row => row.accountId)).toEqual([depreciation.id, active.id]);
    expect(withZeroRows.reportId).toBe(report.reportId);
  });

  it('keeps offsetting posted noncash provenance when zero-valued rows are hidden', () => {
    addAccount('cash', 'Operating Checking', 0n, '2026-01-01', 'CASH');
    const noncash = addChartAccount('offsetting-noncash', 'Offsetting noncash', 'OTHER_EXPENSE', 'Depreciation');
    addChartClassification(noncash.id, noncash.accountType, noncash.detailType, 'NONCASH_PNL_ADJUSTMENT');
    addTransaction('offset-plus', 'cash', '2026-01-02', 30n, 'POSTED', undefined, [{ chartAccountId: noncash.id, amountMinor: 30n }]);
    addTransaction('offset-minus', 'cash', '2026-01-03', -30n, 'POSTED', undefined, [{ chartAccountId: noncash.id, amountMinor: -30n }]);

    const hidden = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const shown = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const hiddenAdjustment = hidden.rows.find(row => row.rowType === 'ADJUSTMENT' && row.accountId === noncash.id);
    const shownAdjustment = shown.rows.find(row => row.rowType === 'ADJUSTMENT' && row.accountId === noncash.id)!;
    const hiddenNetProfit = hidden.rows.find(row => row.rowType === 'NET_PROFIT')!;
    const shownNetProfit = shown.rows.find(row => row.rowType === 'NET_PROFIT')!;
    const hiddenOperating = hidden.rows.find(row => row.rowType === 'TOTAL' && row.section === 'OPERATING')!;
    const shownOperating = shown.rows.find(row => row.rowType === 'TOTAL' && row.section === 'OPERATING')!;
    const adjustmentDetail = hidden.detailIndex[shownAdjustment.detailKey!];
    const shownAdjustmentDetail = shown.detailIndex[shownAdjustment.detailKey!];
    const hiddenOperatingDetail = hidden.detailIndex[hiddenOperating.detailKey!];
    const shownOperatingDetail = shown.detailIndex[shownOperating.detailKey!];

    expect(hiddenAdjustment).toBeUndefined();
    expect(shownAdjustment.amountMinor).toBe(0n);
    expect(hiddenNetProfit.amountMinor).toBe(0n);
    expect(shownNetProfit.amountMinor).toBe(hiddenNetProfit.amountMinor!);
    expect(hiddenOperating.amountMinor).toBe(0n);
    expect(shownOperating.amountMinor).toBe(hiddenOperating.amountMinor!);
    expect(hidden.detailIndex[shownAdjustment.detailKey!]).toBeDefined();
    expect(adjustmentDetail).toEqual(shownAdjustmentDetail);
    expect(adjustmentDetail.map(contribution => [contribution.transactionId, contribution.contributionMinor])).toEqual([
      ['offset-plus', -30n], ['offset-minus', 30n],
    ]);
    expect(hiddenOperatingDetail).toEqual(shownOperatingDetail);
    expect(hiddenOperatingDetail.map(contribution => contribution.contributionId)).toEqual([
      'pnl:offset-plus:offset-plus:offsetting-noncash',
      'pnl:offset-minus:offset-minus:offsetting-noncash',
      'noncash-reversal:offset-plus:offset-plus:offsetting-noncash',
      'noncash-reversal:offset-minus:offset-minus:offsetting-noncash',
    ]);
    expect(hiddenOperatingDetail.filter(contribution => contribution.contributionType === 'PNL_SPLIT').map(contribution => contribution.contributionMinor)).toEqual([30n, -30n]);
    expect(hiddenOperatingDetail.filter(contribution => contribution.contributionType === 'NONCASH_REVERSAL').map(contribution => contribution.contributionMinor)).toEqual([-30n, 30n]);
    expect(sumDetail(hidden, hiddenNetProfit.detailKey)).toBe(hiddenNetProfit.amountMinor!);
    expect(sumDetail(hidden, hiddenOperating.detailKey)).toBe(hiddenOperating.amountMinor!);
    expect(sumDetail(hidden, shownAdjustment.detailKey)).toBe(shownAdjustment.amountMinor!);
    expect(sumDetail(shown, shownNetProfit.detailKey)).toBe(shownNetProfit.amountMinor!);
    expect(sumDetail(shown, shownOperating.detailKey)).toBe(shownOperating.amountMinor!);
    expect(sumDetail(shown, shownAdjustment.detailKey)).toBe(shownAdjustment.amountMinor!);
  });

  it('calculates operating asset and liability changes from natural-sign Balance Sheet amounts', () => {
    addAccount('cash', 'Main cash', 10_000n, '2025-12-01', 'CASH');
    addAccount('clearing', 'Unusual source name', 500n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Marketplace clearing');
    const receivable = addChartAccount('ar', 'Receivables control', 'ACCOUNTS_RECEIVABLE', 'Accounts receivable');
    const payable = addChartAccount('ap', 'Supplier obligations', 'ACCOUNTS_PAYABLE', 'Accounts payable');
    addChartClassification(receivable.id, receivable.accountType, receivable.detailType, 'OPERATING_ASSET');
    addChartClassification(payable.id, payable.accountType, payable.detailType, 'OPERATING_LIABILITY');
    const clearingClassification = repository.cashFlowClassifications.get('FINANCIAL_SOURCE:clearing')!;
    repository.cashFlowClassifications.set('FINANCIAL_SOURCE:clearing', { ...clearingClassification, treatment: 'OPERATING_ASSET', cashRole: 'NOT_CASH' });
    addTransaction('clearing-decrease', 'clearing', '2026-01-04', -100n, 'POSTED');
    addTransaction('ar-increase', 'cash', '2026-01-05', 0n, 'POSTED', undefined, [{ chartAccountId: receivable.id, amountMinor: -200n }]);
    addTransaction('ap-increase', 'cash', '2026-01-06', 0n, 'POSTED', undefined, [{ chartAccountId: payable.id, amountMinor: 300n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const arRow = report.rows.find(row => row.accountId === receivable.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const apRow = report.rows.find(row => row.accountId === payable.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const clearingRow = report.rows.find(row => row.accountId === 'clearing' && row.rowType === 'ACCOUNT_ACTIVITY')!;
    expect(clearingRow.accountRole).toBe('FINANCIAL_SOURCE');
    expect(clearingRow.amountMinor).toBe(100n);
    expect(arRow.amountMinor).toBe(-200n);
    expect(apRow.amountMinor).toBe(300n);
    expect(report.netOperatingMinor).toBe(200n);
    expect(report.rows.map(row => row.label)).toContain('Operating assets');
    expect(report.rows.map(row => row.label)).toContain('Operating liabilities');
    expect(report.detailIndex[arRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([['ar-increase', -200n]]);
    expect(report.detailIndex[apRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([['ap-increase', 300n]]);
    expect(report.detailIndex[arRow.detailKey!][0].openingAmountMinor).toBe(0n);
    expect(report.detailIndex[arRow.detailKey!][0].endingAmountMinor).toBe(200n);
    expect(report.detailIndex[arRow.detailKey!][0].rawChangeMinor).toBe(200n);
    expect(report.detailIndex[arRow.detailKey!][0].formula).toBe('Opening - Ending');
    expect(sumDetail(report, arRow.detailKey)).toBe(arRow.amountMinor!);
    expect(sumDetail(report, apRow.detailKey)).toBe(apRow.amountMinor!);
    expect(sumDetail(report, clearingRow.detailKey)).toBe(clearingRow.amountMinor!);
    expect(report.detailIndex[clearingRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([
      [undefined, 500n], [undefined, -500n], ['clearing-decrease', 100n],
    ]);
  });

  it('preserves parent direct activity and child hierarchy without double counting', () => {
    addAccount('cash', 'Main cash', 0n, '2026-01-01', 'CASH');
    const parent = addChartAccount('current-assets', 'Current assets', 'OTHER_CURRENT_ASSET', 'Other current assets');
    const child = addChartAccount('inventory', 'Warehouse inventory', 'OTHER_CURRENT_ASSET', 'Inventory', { parentId: parent.id });
    addChartClassification(parent.id, parent.accountType, parent.detailType, 'OPERATING_ASSET');
    addChartClassification(child.id, child.accountType, child.detailType, 'OPERATING_ASSET');
    addTransaction('parent-activity', 'cash', '2026-01-02', 0n, 'POSTED', undefined, [{ chartAccountId: parent.id, amountMinor: -50n }]);
    addTransaction('child-activity', 'cash', '2026-01-03', 0n, 'POSTED', undefined, [{ chartAccountId: child.id, amountMinor: -75n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const parentRow = report.rows.find(row => row.rowType === 'ACCOUNT_ACTIVITY' && row.accountId === parent.id)!;
    const childRow = report.rows.find(row => row.rowType === 'ACCOUNT_ACTIVITY' && row.accountId === child.id)!;
    const subtotal = report.rows.find(row => row.rowType === 'SUBTOTAL' && row.accountId === parent.id)!;
    expect(parentRow.amountMinor).toBe(-50n);
    expect(childRow.amountMinor).toBe(-75n);
    expect(childRow.parentRowId).toBe(parentRow.rowId);
    expect(subtotal.amountMinor).toBe(-125n);
    expect(sumDetail(report, subtotal.detailKey)).toBe(-125n);
    expect(report.detailIndex[subtotal.detailKey!].map(item => item.transactionId)).toEqual(['parent-activity', 'child-activity']);
    const operatingDetails = report.detailIndex[report.rows.find(row => row.rowType === 'TOTAL' && row.section === 'OPERATING')!.detailKey!];
    expect(operatingDetails.filter(item => item.contributionType === 'BALANCE_CHANGE').map(item => item.transactionId)).toEqual(['parent-activity', 'child-activity']);
  });

  it('uses credit-card operating liabilities for charge and payment timing', () => {
    addAccount('cash', 'Main cash', 5_000n, '2025-12-01', 'CASH');
    addAccount('card', 'Business card', 0n, '2025-12-01', 'NOT_CASH', false, 'CREDIT_CARD');
    const expense = addChartAccount('expense', 'Office expense', 'EXPENSE', 'Office expenses');
    addChartClassification(expense.id, expense.accountType, expense.detailType, 'OPERATING_REVENUE_EXPENSE');
    const cardClassification = repository.cashFlowClassifications.get('FINANCIAL_SOURCE:card')!;
    repository.cashFlowClassifications.set('FINANCIAL_SOURCE:card', { ...cardClassification, cashRole: 'NOT_CASH', treatment: 'OPERATING_LIABILITY', accountType: 'CREDIT_CARD', detailType: 'Credit Card' });
    addTransaction('card-charge', 'card', '2026-01-02', -100n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -100n }]);
    addTransaction('card-payment', 'card', '2026-01-20', 100n, 'MATCHED_TRANSFER', 'card-payment-transfer');
    addTransaction('cash-payment', 'cash', '2026-01-20', -100n, 'MATCHED_TRANSFER', 'card-payment-transfer');
    repository.transfers.set('card-payment-transfer', {
      id: 'card-payment-transfer', leftTransactionId: 'card-payment', rightTransactionId: 'cash-payment', confidence: 1,
      rationale: 'Confirmed card payment.', confirmedAtUtc: '2026-01-20T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const cardRow = report.rows.find(row => row.rowType === 'ACCOUNT_ACTIVITY' && row.accountId === 'card')!;
    expect(cardRow.amountMinor).toBe(0n);
    expect(report.rows.find(row => row.rowType === 'NET_PROFIT')?.amountMinor).toBe(-100n);
    expect(report.netOperatingMinor).toBe(-100n);
    expect(report.netChangeInCashMinor).toBe(-100n);
    expect(sumDetail(report, cardRow.detailKey)).toBe(0n);
    expect(report.detailIndex[cardRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([
      ['card-charge', 100n], ['card-payment', -100n],
    ]);
  });

  it('keeps zero-row working-capital detail and report identity invariant', () => {
    addAccount('cash', 'Main cash', 0n, '2026-01-01', 'CASH');
    const receivable = addChartAccount('zero-ar', 'Zero receivable', 'ACCOUNTS_RECEIVABLE', 'Accounts receivable');
    const zeroChild = addChartAccount('zero-ar-child', 'Zero receivable detail', 'OTHER_CURRENT_ASSET', 'Other current assets', { parentId: receivable.id });
    addChartClassification(receivable.id, receivable.accountType, receivable.detailType, 'OPERATING_ASSET');
    addChartClassification(zeroChild.id, zeroChild.accountType, zeroChild.detailType, 'OPERATING_ASSET');
    addTransaction('ar-plus', 'cash', '2026-01-02', 0n, 'POSTED', undefined, [{ chartAccountId: receivable.id, amountMinor: -100n }]);
    addTransaction('ar-minus', 'cash', '2026-01-03', 0n, 'POSTED', undefined, [{ chartAccountId: receivable.id, amountMinor: 100n }]);
    addTransaction('ar-child-plus', 'cash', '2026-01-04', 0n, 'POSTED', undefined, [{ chartAccountId: zeroChild.id, amountMinor: -50n }]);
    addTransaction('ar-child-minus', 'cash', '2026-01-05', 0n, 'POSTED', undefined, [{ chartAccountId: zeroChild.id, amountMinor: 50n }]);

    const hidden = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const shown = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const shownRow = shown.rows.find(row => row.accountId === receivable.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const hiddenOperating = hidden.rows.find(row => row.rowType === 'TOTAL' && row.section === 'OPERATING')!;
    const shownOperating = shown.rows.find(row => row.rowType === 'TOTAL' && row.section === 'OPERATING')!;
    expect(hidden.rows.find(row => row.accountId === receivable.id && row.rowType === 'ACCOUNT_ACTIVITY')).toBeUndefined();
    expect(shownRow.amountMinor).toBe(0n);
    expect(hidden.reportId).toBe(shown.reportId);
    expect(hidden.netOperatingMinor).toBe(shown.netOperatingMinor);
    expect(hidden.status).toBe(shown.status);
    expect(hidden.detailIndex[shownRow.detailKey!]).toEqual(shown.detailIndex[shownRow.detailKey!]);
    expect(Object.keys(hidden.detailIndex).sort()).toEqual(Object.keys(shown.detailIndex).sort());
    Object.keys(shown.detailIndex).forEach(key => expect(hidden.detailIndex[key]).toEqual(shown.detailIndex[key]));
    expect(hidden.detailIndex[shownRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([
      ['ar-plus', -100n], ['ar-minus', 100n],
    ]);
    expect(sumDetail(hidden, hiddenOperating.detailKey)).toBe(hiddenOperating.amountMinor!);
    expect(sumDetail(shown, shownOperating.detailKey)).toBe(shownOperating.amountMinor!);
  });

  it('retains archived and negative working-capital balances using generic account names', () => {
    addAccount('cash', 'Main cash', 0n, '2026-01-01', 'CASH');
    const archivedInventory = addChartAccount('archived-stock', 'Legacy balance', 'OTHER_CURRENT_ASSET', 'Inventory', { archived: true });
    const negativePayable = addChartAccount('negative-ap', 'Vendor credit', 'ACCOUNTS_PAYABLE', 'Accounts payable');
    addChartClassification(archivedInventory.id, archivedInventory.accountType, archivedInventory.detailType, 'OPERATING_ASSET');
    addChartClassification(negativePayable.id, negativePayable.accountType, negativePayable.detailType, 'OPERATING_LIABILITY');
    addTransaction('inventory-credit', 'cash', '2026-01-02', 0n, 'POSTED', undefined, [{ chartAccountId: archivedInventory.id, amountMinor: 25n }]);
    addTransaction('payable-debit', 'cash', '2026-01-03', 0n, 'POSTED', undefined, [{ chartAccountId: negativePayable.id, amountMinor: -40n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const inventoryRow = report.rows.find(row => row.accountId === archivedInventory.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const payableRow = report.rows.find(row => row.accountId === negativePayable.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    expect(inventoryRow.amountMinor).toBe(25n);
    expect(payableRow.amountMinor).toBe(-40n);
    expect(inventoryRow.archived).toBeTrue();
    expect(report.rows.find(row => row.rowType === 'GROUP_HEADER' && row.label === 'Operating assets')).toBeDefined();
    expect(sumDetail(report, inventoryRow.detailKey)).toBe(25n);
    expect(sumDetail(report, payableRow.detailKey)).toBe(-40n);
  });

  it('isolates missing parents and cyclic hierarchies in a deterministic review group', () => {
    addAccount('cash', 'Main cash', 0n, '2026-01-01', 'CASH');
    addAccount('source-parent', 'Unclassified source parent', 0n, '2026-01-01', 'NOT_CASH');
    const missingSource = addAccount('missing-source', 'Clearing source', 0n, '2026-01-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Clearing account', 'source-parent');
    const sourceCycleA = addAccount('source-cycle-a', 'Source cycle A', 0n, '2026-01-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Clearing account', 'source-cycle-b');
    const sourceCycleB = addAccount('source-cycle-b', 'Source cycle B', 0n, '2026-01-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Clearing account', 'source-cycle-a');
    for (const id of [missingSource.id, sourceCycleA.id, sourceCycleB.id]) {
      const key = `FINANCIAL_SOURCE:${id}`;
      const classification = repository.cashFlowClassifications.get(key)!;
      repository.cashFlowClassifications.set(key, { ...classification, treatment: 'OPERATING_ASSET', cashRole: 'NOT_CASH' });
    }
    addTransaction('missing-source-activity', 'missing-source', '2026-01-02', 40n, 'POSTED');
    addTransaction('source-cycle-a-activity', 'source-cycle-a', '2026-01-03', 20n, 'POSTED');
    addTransaction('source-cycle-b-activity', 'source-cycle-b', '2026-01-04', 30n, 'POSTED');

    const missingChart = addChartAccount('missing-chart', 'Receivables control', 'ACCOUNTS_RECEIVABLE', 'Accounts receivable', { parentId: 'missing-chart-parent' });
    const chartCycleA = addChartAccount('chart-cycle-a', 'Inventory cycle A', 'OTHER_CURRENT_ASSET', 'Inventory', { parentId: 'chart-cycle-b' });
    const chartCycleB = addChartAccount('chart-cycle-b', 'Inventory cycle B', 'OTHER_CURRENT_ASSET', 'Inventory', { parentId: 'chart-cycle-c' });
    const chartCycleC = addChartAccount('chart-cycle-c', 'Inventory cycle C', 'OTHER_CURRENT_ASSET', 'Inventory', { parentId: 'chart-cycle-a' });
    for (const account of [missingChart, chartCycleA, chartCycleB, chartCycleC]) addChartClassification(account.id, account.accountType, account.detailType, 'OPERATING_ASSET');
    addTransaction('missing-chart-activity', 'cash', '2026-01-05', 0n, 'POSTED', undefined, [{ chartAccountId: missingChart.id, amountMinor: -40n }]);
    addTransaction('chart-cycle-a-activity', 'cash', '2026-01-06', 0n, 'POSTED', undefined, [{ chartAccountId: chartCycleA.id, amountMinor: -20n }]);
    addTransaction('chart-cycle-b-activity', 'cash', '2026-01-07', 0n, 'POSTED', undefined, [{ chartAccountId: chartCycleB.id, amountMinor: -30n }]);
    addTransaction('chart-cycle-c-activity', 'cash', '2026-01-08', 0n, 'POSTED', undefined, [{ chartAccountId: chartCycleC.id, amountMinor: -50n }]);

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const second = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const invalidIds = ['missing-source', 'source-cycle-a', 'source-cycle-b', 'missing-chart', 'chart-cycle-a', 'chart-cycle-b', 'chart-cycle-c'];
    const invalidRows = report.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY' && invalidIds.includes(row.accountId ?? ''));
    expect(invalidRows.map(row => row.accountId).sort()).toEqual([
      'missing-source', 'source-cycle-a', 'source-cycle-b', 'missing-chart', 'chart-cycle-a', 'chart-cycle-b', 'chart-cycle-c',
    ].sort());
    expect(invalidRows.every(row => row.parentRowId === undefined && row.reviewRequired)).toBeTrue();
    expect(report.rows.filter(row => row.label.includes('hierarchy review')).map(row => row.rowId)).toEqual([
      'GROUP:OPERATING:HIERARCHY_REVIEW:OPERATING_ASSET:2026-01-01:2026-01-31' as never,
    ]);
    const hierarchyWarnings = report.warnings.filter(warning => warning.code === 'ACCOUNT_HIERARCHY_INVALID');
    expect(hierarchyWarnings.map(warning => `${warning.accountRole}:${warning.accountId}`).sort()).toEqual([
      'CHART:chart-cycle-a', 'CHART:chart-cycle-b', 'CHART:chart-cycle-c', 'CHART:missing-chart',
      'FINANCIAL_SOURCE:missing-source', 'FINANCIAL_SOURCE:source-cycle-a', 'FINANCIAL_SOURCE:source-cycle-b',
    ].sort());
    expect(hierarchyWarnings.find(warning => warning.accountId === 'missing-source')?.message).toContain('nonparticipating parent');
    expect(hierarchyWarnings.find(warning => warning.accountId === 'missing-chart')?.message).toContain('missing parent');
    const rowById = new Map(report.rows.map(row => [row.rowId, row]));
    report.rows.forEach(row => {
      const seen = new Set<string>();
      let parent = row.parentRowId;
      while (parent) {
        expect(seen.has(parent)).toBeFalse();
        seen.add(parent);
        parent = rowById.get(parent)?.parentRowId;
      }
      if (row.amountMinor !== undefined && row.detailKey) expect(sumDetail(report, row.detailKey)).toBe(row.amountMinor);
    });
    expect(report.netOperatingMinor).toBe(second.netOperatingMinor);
    expect(report.rows.map(row => row.rowId)).toEqual(second.rows.map(row => row.rowId));
    expect(report.warnings.map(warning => warning.warningId)).toEqual(second.warnings.map(warning => warning.warningId));
  });

  it('explains empty zero-valued working-capital rows in both account namespaces', () => {
    addAccount('cash', 'Main cash', 0n, '2026-01-01', 'CASH');
    const financial = addAccount('zero-source', 'Empty clearing', 0n, '2026-01-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Clearing account');
    const sourceClassification = repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${financial.id}`)!;
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${financial.id}`, { ...sourceClassification, treatment: 'OPERATING_ASSET', cashRole: 'NOT_CASH' });
    const chart = addChartAccount('zero-chart', 'Empty payable', 'OTHER_CURRENT_LIABILITY', 'Other current liabilities');
    addChartClassification(chart.id, chart.accountType, chart.detailType, 'OPERATING_LIABILITY');

    const hidden = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: false });
    const shown = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const rows = [
      shown.rows.find(row => row.accountRole === 'FINANCIAL_SOURCE' && row.accountId === financial.id && row.rowType === 'ACCOUNT_ACTIVITY')!,
      shown.rows.find(row => row.accountRole === 'CHART' && row.accountId === chart.id && row.rowType === 'ACCOUNT_ACTIVITY')!,
    ];
    expect(rows.every(row => row.amountMinor === 0n)).toBeTrue();
    expect(rows.map(row => shown.detailIndex[row.detailKey!])).toEqual([
      [jasmine.objectContaining({ contributionType: 'FORMULA', openingAmountMinor: 0n, endingAmountMinor: 0n, rawChangeMinor: 0n, formula: 'Opening - Ending', contributionMinor: 0n })],
      [jasmine.objectContaining({ contributionType: 'FORMULA', openingAmountMinor: 0n, endingAmountMinor: 0n, rawChangeMinor: 0n, formula: 'Ending - Opening', contributionMinor: 0n })],
    ]);
    rows.forEach(row => expect(sumDetail(shown, row.detailKey)).toBe(0n));
    expect(hidden.rows.find(row => row.accountId === financial.id && row.rowType === 'ACCOUNT_ACTIVITY')).toBeUndefined();
    expect(hidden.rows.find(row => row.accountId === chart.id && row.rowType === 'ACCOUNT_ACTIVITY')).toBeUndefined();
    expect(Object.keys(hidden.detailIndex).sort()).toEqual(Object.keys(shown.detailIndex).sort());
    Object.keys(shown.detailIndex).forEach(key => expect(hidden.detailIndex[key]).toEqual(shown.detailIndex[key]));
  });

  it('reports fixed-asset cash purchases once in Investing with exact split detail', () => {
    addAccount('cash', 'Primary funds', 60_000n, '2025-12-01', 'CASH');
    const fixedAsset = addChartAccount('fixed-assets', 'Equipment ledger', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(fixedAsset.id, fixedAsset.accountType, fixedAsset.detailType, 'INVESTING');
    addTransaction('equipment-purchase', 'cash', '2026-06-10', -50_000n, 'POSTED', undefined, [{ chartAccountId: fixedAsset.id, amountMinor: -50_000n, splitId: 'equipment-purchase:cash' }]);

    const report = service.getCashFlowReport({ startDate: '2026-06-01', endDate: '2026-06-30', includeZeroRows: false });
    const row = report.rows.find(candidate => candidate.accountId === fixedAsset.id && candidate.rowType === 'ACCOUNT_ACTIVITY')!;
    const total = report.rows.find(candidate => candidate.rowId.startsWith('SYNTHETIC:NET_INVESTING'))!;
    expect(row.amountMinor).toBe(-50_000n);
    expect(total.amountMinor).toBe(-50_000n);
    expect(report.netInvestingMinor).toBe(-50_000n);
    expect(report.netOperatingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(-50_000n);
    expect(report.endingCashMinor).toBe(10_000n);
    expect(report.detailIndex[row.detailKey!].map(item => [item.transactionId, item.splitId, item.contributionMinor])).toEqual([['equipment-purchase', 'equipment-purchase:cash', -50_000n]]);
    expect(sumDetail(report, row.detailKey)).toBe(row.amountMinor!);
    expect(sumDetail(report, total.detailKey)).toBe(total.amountMinor!);
  });

  it('allocates loan proceeds and mixed principal/interest splits without duplication', () => {
    addAccount('cash', 'Primary funds', 20_000n, '2025-12-01', 'CASH');
    const proceeds = addChartAccount('loan-proceeds', 'Borrowed funds', 'LONG_TERM_LIABILITY', 'Notes payable');
    const principal = addChartAccount('loan-principal', 'Principal repayment', 'LONG_TERM_LIABILITY', 'Notes payable');
    const interest = addChartAccount('interest', 'Interest expense', 'EXPENSE', 'Interest paid');
    addChartClassification(proceeds.id, proceeds.accountType, proceeds.detailType, 'FINANCING');
    addChartClassification(principal.id, principal.accountType, principal.detailType, 'FINANCING');
    addChartClassification(interest.id, interest.accountType, interest.detailType, 'OPERATING_REVENUE_EXPENSE');
    addTransaction('loan-proceeds', 'cash', '2026-08-05', 100_000n, 'POSTED', undefined, [{ chartAccountId: proceeds.id, amountMinor: 100_000n, splitId: 'loan-proceeds:cash' }]);
    addTransaction('loan-payment', 'cash', '2026-08-20', -11_000n, 'POSTED', undefined, [
      { chartAccountId: principal.id, amountMinor: -10_000n, splitId: 'loan-principal:cash' },
      { chartAccountId: interest.id, amountMinor: -1_000n, splitId: 'loan-interest:pnl' },
    ]);

    const report = service.getCashFlowReport({ startDate: '2026-08-01', endDate: '2026-08-31', includeZeroRows: false });
    const proceedsRow = report.rows.find(row => row.accountId === proceeds.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const principalRow = report.rows.find(row => row.accountId === principal.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    expect(proceedsRow.amountMinor).toBe(100_000n);
    expect(principalRow.amountMinor).toBe(-10_000n);
    expect(report.netFinancingMinor).toBe(90_000n);
    expect(report.netOperatingMinor).toBe(-1_000n);
    expect(report.netChangeInCashMinor).toBe(89_000n);
    expect(report.endingCashMinor).toBe(109_000n);
    expect(report.detailIndex[principalRow.detailKey!].map(item => item.contributionMinor)).toEqual([-10_000n]);
    expect(report.detailIndex[proceedsRow.detailKey!].map(item => item.contributionMinor)).toEqual([100_000n]);
    expect(sumDetail(report, report.rows.find(row => row.rowId.startsWith('SYNTHETIC:NET_FINANCING'))?.detailKey)).toBe(90_000n);
    expect(report.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY' && row.treatment === 'OPERATING_REVENUE_EXPENSE')).toHaveSize(0);
  });

  it('presents owner contributions and draws as Financing without changing Net Profit', () => {
    addAccount('cash', 'Primary funds', 10_000n, '2025-12-01', 'CASH');
    const contribution = addChartAccount('owner-contribution', 'Member capital', 'EQUITY', 'Owner equity');
    const draw = addChartAccount('owner-draw', 'Member distribution', 'EQUITY', 'Owner draw');
    addChartClassification(contribution.id, contribution.accountType, contribution.detailType, 'FINANCING');
    addChartClassification(draw.id, draw.accountType, draw.detailType, 'FINANCING');
    addTransaction('owner-contribution', 'cash', '2026-09-05', 60_000n, 'POSTED', undefined, [{ chartAccountId: contribution.id, amountMinor: 60_000n, splitId: 'owner-contribution:cash' }]);
    addTransaction('owner-draw', 'cash', '2026-09-20', -15_000n, 'POSTED', undefined, [{ chartAccountId: draw.id, amountMinor: -15_000n, splitId: 'owner-draw:cash' }]);

    const report = service.getCashFlowReport({ startDate: '2026-09-01', endDate: '2026-09-30', includeZeroRows: false });
    expect(report.rows.find(row => row.accountId === contribution.id)?.amountMinor).toBe(60_000n);
    expect(report.rows.find(row => row.accountId === draw.id)?.amountMinor).toBe(-15_000n);
    expect(report.rows.find(row => row.rowType === 'NET_PROFIT')?.amountMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(45_000n);
    expect(report.netChangeInCashMinor).toBe(45_000n);
    expect(report.endingCashMinor).toBe(55_000n);
  });

  it('keeps Investing detail and identity invariant when offsetting cash activity is hidden', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const investment = addChartAccount('investment', 'Long-term investment', 'OTHER_ASSET', 'Other long-term assets');
    addChartClassification(investment.id, investment.accountType, investment.detailType, 'INVESTING');
    addTransaction('investment-buy', 'cash', '2026-07-02', -30_000n, 'POSTED', undefined, [{ chartAccountId: investment.id, amountMinor: -30_000n, splitId: 'investment-buy:cash' }]);
    addTransaction('investment-sale', 'cash', '2026-07-18', 30_000n, 'POSTED', undefined, [{ chartAccountId: investment.id, amountMinor: 30_000n, splitId: 'investment-sale:cash' }]);

    const hidden = service.getCashFlowReport({ startDate: '2026-07-01', endDate: '2026-07-31', includeZeroRows: false });
    const shown = service.getCashFlowReport({ startDate: '2026-07-01', endDate: '2026-07-31', includeZeroRows: true });
    const shownRow = shown.rows.find(row => row.accountId === investment.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    expect(hidden.rows.find(row => row.accountId === investment.id && row.rowType === 'ACCOUNT_ACTIVITY')).toBeUndefined();
    expect(shownRow.amountMinor).toBe(0n);
    expect(hidden.netInvestingMinor).toBe(0n);
    expect(hidden.netInvestingMinor).toBe(shown.netInvestingMinor);
    expect(hidden.netChangeInCashMinor).toBe(shown.netChangeInCashMinor);
    expect(hidden.reportId).toBe(shown.reportId);
    expect(hidden.detailIndex[shownRow.detailKey!]).toEqual(shown.detailIndex[shownRow.detailKey!]);
    expect(hidden.detailIndex[shownRow.detailKey!].map(item => [item.transactionId, item.contributionMinor])).toEqual([
      ['investment-buy', -30_000n], ['investment-sale', 30_000n],
    ]);
  });

  it('uses direct parent activity and child rows exactly once in Financing hierarchy', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const debt = addChartAccount('debt', 'Debt accounts', 'LONG_TERM_LIABILITY', 'Other long-term liabilities');
    const principal = addChartAccount('debt-principal', 'Principal', 'LONG_TERM_LIABILITY', 'Notes payable', { parentId: debt.id });
    addChartClassification(debt.id, debt.accountType, debt.detailType, 'FINANCING');
    addChartClassification(principal.id, principal.accountType, principal.detailType, 'FINANCING');
    addTransaction('debt-direct', 'cash', '2026-10-02', 25n, 'POSTED', undefined, [{ chartAccountId: debt.id, amountMinor: 25n, splitId: 'debt-direct:cash' }]);
    addTransaction('debt-child', 'cash', '2026-10-03', -10n, 'POSTED', undefined, [{ chartAccountId: principal.id, amountMinor: -10n, splitId: 'debt-child:cash' }]);

    const report = service.getCashFlowReport({ startDate: '2026-10-01', endDate: '2026-10-31', includeZeroRows: false });
    const parent = report.rows.find(row => row.accountId === debt.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const child = report.rows.find(row => row.accountId === principal.id && row.rowType === 'ACCOUNT_ACTIVITY')!;
    const subtotal = report.rows.find(row => row.rowType === 'SUBTOTAL' && row.accountId === debt.id)!;
    expect(parent.amountMinor).toBe(25n);
    expect(child.amountMinor).toBe(-10n);
    expect(child.parentRowId).toBe(parent.rowId);
    expect(subtotal.amountMinor).toBe(15n);
    expect(report.netFinancingMinor).toBe(15n);
    expect(report.detailIndex[subtotal.detailKey!].map(item => item.transactionId)).toEqual(['debt-direct', 'debt-child']);
    expect(sumDetail(report, subtotal.detailKey)).toBe(15n);
  });

  it('uses a supported cash-to-Financing transfer side exactly once', () => {
    addAccount('cash', 'Primary funds', 1_000n, '2025-12-01', 'CASH');
    const brokerage = addAccount('brokerage', 'Long-term account', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets');
    const existing = repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${brokerage.id}`)!;
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${brokerage.id}`, { ...existing, treatment: 'INVESTING', cashRole: 'NOT_CASH' });
    addTransaction('transfer-out', 'cash', '2026-11-02', -300n, 'MATCHED_TRANSFER', 'cash-investing-transfer');
    addTransaction('transfer-in', 'brokerage', '2026-11-02', 300n, 'MATCHED_TRANSFER', 'cash-investing-transfer');
    repository.transfers.set('cash-investing-transfer', {
      id: 'cash-investing-transfer', leftTransactionId: 'transfer-out', rightTransactionId: 'transfer-in', confidence: 1,
      rationale: 'Cash to investment account.', confirmedAtUtc: '2026-11-02T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30', includeZeroRows: false });
    const row = report.rows.find(candidate => candidate.accountRole === 'FINANCIAL_SOURCE' && candidate.accountId === brokerage.id && candidate.rowType === 'ACCOUNT_ACTIVITY')!;
    expect(row.amountMinor).toBe(-300n);
    expect(report.netInvestingMinor).toBe(-300n);
    expect(report.netChangeInCashMinor).toBe(-300n);
    expect(report.detailIndex[row.detailKey!].map(item => [item.contributionType, item.transferId, item.transactionId, item.counterpartyTransactionId, item.contributionMinor])).toEqual([
      ['TRANSFER', 'cash-investing-transfer', 'transfer-out', 'transfer-in', -300n],
    ]);
    expect(sumDetail(report, row.detailKey)).toBe(-300n);
  });

  it('eliminates cash-to-cash transfers once with zero diagnostic activity', () => {
    addAccount('cash-a', 'Primary funds', 80_000n, '2025-12-01', 'CASH');
    addAccount('cash-b', 'Reserve funds', 20_000n, '2025-12-01', 'CASH_EQUIVALENT');
    addTransaction('cash-to-cash-in', 'cash-b', '2026-10-15', 30_000n, 'MATCHED_TRANSFER', 'cash-to-cash');
    addTransaction('cash-to-cash-out', 'cash-a', '2026-10-15', -30_000n, 'MATCHED_TRANSFER', 'cash-to-cash');
    repository.transfers.set('cash-to-cash', {
      id: 'cash-to-cash', leftTransactionId: 'cash-to-cash-in', rightTransactionId: 'cash-to-cash-out', confidence: 1,
      rationale: 'Cash composition transfer.', confirmedAtUtc: '2026-10-15T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-10-01', endDate: '2026-10-31', includeZeroRows: true });
    const diagnostics = Object.values(report.detailIndex).flatMap(items => items).filter(item => item.transferId === 'cash-to-cash');
    expect(report.netOperatingMinor).toBe(0n);
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.unclassifiedCashActivityMinor).toBe(0n);
    expect(diagnostics.map(item => [item.transferId, item.transactionId, item.counterpartyTransactionId, item.contributionMinor])).toEqual([
      ['cash-to-cash', 'cash-to-cash-in', 'cash-to-cash-out', 0n],
    ]);
    expect(report.warnings.map(warning => warning.code)).not.toContain('UNCLASSIFIED_CASH_ACTIVITY');

    const transfer = repository.transfers.get('cash-to-cash')!;
    repository.transfers.set('cash-to-cash', { ...transfer, leftTransactionId: 'cash-to-cash-out', rightTransactionId: 'cash-to-cash-in' });
    const reversed = service.getCashFlowReport({ startDate: '2026-10-01', endDate: '2026-10-31', includeZeroRows: true });
    const reversedDiagnostic = Object.values(reversed.detailIndex).flatMap(items => items)
      .filter(item => item.transferId === 'cash-to-cash')
      .map(item => [item.transferId, item.transactionId, item.counterpartyTransactionId, item.contributionMinor]);
    expect(reversedDiagnostic).toEqual(diagnostics.map(item => [item.transferId, item.transactionId, item.counterpartyTransactionId, item.contributionMinor]));
    expect(reversed.netInvestingMinor).toBe(report.netInvestingMinor);
    expect(reversed.netFinancingMinor).toBe(report.netFinancingMinor);
    expect(reversed.netChangeInCashMinor).toBe(report.netChangeInCashMinor);
  });

  it('presents unrestricted-to-restricted transfers as unclassified reconciliation activity', () => {
    addAccount('cash', 'Primary funds', 50_000n, '2025-12-01', 'CASH');
    addAccount('restricted', 'Restricted reserve', 0n, '2025-12-01', 'RESTRICTED_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    addTransaction('restricted-cash-out', 'cash', '2026-01-15', -20_000n, 'MATCHED_TRANSFER', 'restricted-transfer');
    addTransaction('restricted-cash-in', 'restricted', '2026-01-15', 20_000n, 'MATCHED_TRANSFER', 'restricted-transfer');
    repository.transfers.set('restricted-transfer', {
      id: 'restricted-transfer', leftTransactionId: 'restricted-cash-in', rightTransactionId: 'restricted-cash-out', confidence: 1,
      rationale: 'Restricted cash transfer.', confirmedAtUtc: '2026-01-15T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const restrictedRow = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:RESTRICTED_CASH_ENDING'))!;
    const unclassifiedRow = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    const differenceRow = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(50_000n);
    expect(report.endingCashMinor).toBe(30_000n);
    expect(report.differenceMinor).toBe(20_000n);
    expect(report.restrictedCashEndingMinor).toBe(20_000n);
    expect(report.unclassifiedCashActivityMinor).toBe(-20_000n);
    expect(restrictedRow.amountMinor).toBe(20_000n);
    expect(unclassifiedRow.amountMinor).toBe(-20_000n);
    expect(differenceRow.amountMinor).toBe(20_000n);
    expect(sumDetail(report, restrictedRow.detailKey)).toBe(20_000n);
    expect(sumDetail(report, unclassifiedRow.detailKey)).toBe(-20_000n);
    expect(sumDetail(report, differenceRow.detailKey)).toBe(20_000n);
    expect(report.warnings.map(warning => warning.code)).toEqual(jasmine.arrayWithExactContents([
      'RESTRICTED_CASH_PRESENT', 'UNCLASSIFIED_CASH_ACTIVITY', 'CASH_RECONCILIATION_DIFFERENCE',
    ]));
  });

  it('retains malformed confirmed transfer cash activity as signed diagnostics', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    addTransaction('malformed-cash', 'cash', '2026-02-02', -90n, 'MATCHED_TRANSFER', 'malformed-transfer');
    repository.transfers.set('malformed-transfer', {
      id: 'malformed-transfer', leftTransactionId: 'malformed-cash', rightTransactionId: 'missing-endpoint', confidence: 1,
      rationale: 'Incomplete transfer.', confirmedAtUtc: '2026-02-02T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(0n);
    expect(report.endingCashMinor).toBe(-90n);
    expect(report.differenceMinor).toBe(90n);
    expect(report.unclassifiedCashActivityMinor).toBe(-90n);
    expect(report.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    expect(report.warnings.map(warning => warning.code)).toContain('UNMATCHED_CASH_TRANSFER_CANDIDATE');
    const detail = Object.values(report.detailIndex).flatMap(items => items).find(item => item.transferId === 'malformed-transfer')!;
    expect(detail.contributionMinor).toBe(-90n);
    expect(detail.counterpartyTransactionId).toBeUndefined();
    const difference = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(report.detailIndex[difference.detailKey!].find(item => item.transactionId === 'malformed-cash')?.contributionMinor).toBe(90n);
    expect(sumDetail(report, difference.detailKey)).toBe(90n);
    expect(report.warnings.map(warning => warning.code)).toContain('CASH_RECONCILIATION_DIFFERENCE');
  });

  it('diagnoses review-required, mismatched, and no-cash transfer structures without assigning sections', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const reviewEndpoint = addAccount('review-endpoint', 'Review endpoint', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    markReviewRequired('review-endpoint');
    const mismatchEndpoint = addAccount('mismatch-endpoint', 'Mismatch endpoint', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    const noCashLeft = addAccount('no-cash-left', 'Noncash left', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    const noCashRight = addAccount('no-cash-right', 'Noncash right', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    const addTransfer = (id: string, leftAccountId: string, rightAccountId: string, leftAmount: bigint, rightAmount: bigint, leftDate: string, rightDate: string): void => {
      addTransaction(`${id}:left`, leftAccountId, leftDate, leftAmount, 'MATCHED_TRANSFER', id);
      addTransaction(`${id}:right`, rightAccountId, rightDate, rightAmount, 'MATCHED_TRANSFER', id);
      repository.transfers.set(id, {
        id, leftTransactionId: `${id}:left`, rightTransactionId: `${id}:right`, confidence: 1,
        rationale: 'Transfer structure validation.', confirmedAtUtc: `${leftDate}T00:00:00.000Z`,
      });
    };
    addTransfer('review-transfer', 'cash', reviewEndpoint.id, -40n, 40n, '2026-02-01', '2026-02-01');
    addTransfer('mismatch-transfer', 'cash', mismatchEndpoint.id, -30n, 25n, '2026-02-02', '2026-02-02');
    addTransfer('no-cash-transfer', noCashLeft.id, noCashRight.id, -80n, 80n, '2026-02-03', '2026-02-03');
    addTransfer('date-mismatch-transfer', 'cash', mismatchEndpoint.id, -15n, 15n, '2026-02-04', '2026-02-05');
    addTransfer('excluded-endpoint-transfer', 'cash', mismatchEndpoint.id, -22n, 22n, '2026-02-06', '2026-02-06');
    repository.transactions.get('excluded-endpoint-transfer:right')!.state = 'EXCLUDED';

    const report = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const hidden = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: false });
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(0n);
    expect(report.differenceMinor).toBe(107n);
    expect(report.unclassifiedCashActivityMinor).toBe(-92n);
    const unclassified = report.detailIndex[report.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!.detailKey!];
    expect(unclassified.map(item => [item.transferId, item.contributionMinor])).toEqual([
      ['review-transfer', -40n], ['mismatch-transfer', -30n], ['excluded-endpoint-transfer', -22n],
    ]);
    expect(report.warnings.find(warning => warning.code === 'UNMATCHED_CASH_TRANSFER_CANDIDATE')?.references).toEqual([
      'excluded-endpoint-transfer', 'mismatch-transfer',
    ]);
    const transferDiagnostics = Object.values(report.detailIndex).flatMap(items => items)
      .filter(item => item.transferId === 'no-cash-transfer');
    expect(transferDiagnostics).toHaveSize(1);
    expect(transferDiagnostics[0].contributionMinor).toBe(0n);
    expect(report.rows.some(row => (row.section === 'INVESTING' || row.section === 'FINANCING')
      && (row.accountId === reviewEndpoint.id || row.accountId === mismatchEndpoint.id || row.accountId === noCashLeft.id || row.accountId === noCashRight.id))).toBeFalse();
    const difference = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(sumDetail(report, difference.detailKey)).toBe(107n);
    expect(report.warnings.map(warning => warning.code)).toContain('CASH_RECONCILIATION_DIFFERENCE');
    const hiddenUnclassified = hidden.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    const hiddenDifference = hidden.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    const reportUnclassified = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    expect(hidden.netChangeInCashMinor).toBe(report.netChangeInCashMinor);
    expect(hidden.calculatedEndingCashMinor).toBe(report.calculatedEndingCashMinor);
    expect(hidden.endingCashMinor).toBe(report.endingCashMinor);
    expect(hidden.differenceMinor).toBe(report.differenceMinor);
    expect(hidden.unclassifiedCashActivityMinor).toBe(report.unclassifiedCashActivityMinor);
    expect(hidden.detailIndex[hiddenUnclassified.detailKey!]).toEqual(report.detailIndex[reportUnclassified.detailKey!]);
    expect(hidden.detailIndex[hiddenDifference.detailKey!]).toEqual(report.detailIndex[difference.detailKey!]);
    expect(sumDetail(hidden, hiddenDifference.detailKey)).toBe(hidden.differenceMinor);
  });

  it('retains every unresolved cash endpoint once and canonicalizes transfer diagnostics', () => {
    addAccount('cash-a', 'Primary funds', 1_000n, '2025-12-01', 'CASH');
    addAccount('cash-b', 'Reserve funds', 0n, '2025-12-01', 'CASH_EQUIVALENT');
    addAccount('cash-c', 'Third claimant funds', 0n, '2025-12-01', 'CASH');
    addTransaction('unequal-left', 'cash-a', '2026-02-10', -30n, 'MATCHED_TRANSFER', 'ambiguous-transfer');
    addTransaction('unequal-right', 'cash-b', '2026-02-10', 20n, 'MATCHED_TRANSFER', 'ambiguous-transfer');
    addTransaction('third-claimant', 'cash-c', '2026-02-10', 7n, 'MATCHED_TRANSFER', 'ambiguous-transfer');
    repository.transfers.set('ambiguous-transfer', {
      id: 'ambiguous-transfer', leftTransactionId: 'unequal-left', rightTransactionId: 'unequal-right', confidence: 1,
      rationale: 'Intentionally malformed transfer.', confirmedAtUtc: '2026-02-10T00:00:00.000Z',
    });
    const first = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const firstUnclassified = first.detailIndex[first.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!.detailKey!]
      .map(item => [item.transactionId, item.counterpartyTransactionId, item.contributionMinor]);
    expect(firstUnclassified).toEqual([
      ['third-claimant', 'unequal-left', 7n],
      ['unequal-left', 'unequal-right', -30n],
      ['unequal-right', 'unequal-left', 20n],
    ]);
    expect(first.unclassifiedCashActivityMinor).toBe(-3n);
    expect(first.netChangeInCashMinor).toBe(0n);
    expect(first.calculatedEndingCashMinor).toBe(1_000n);
    expect(first.endingCashMinor).toBe(990n);
    expect(first.differenceMinor).toBe(10n);
    expect(first.warnings.map(warning => warning.code)).toContain('UNMATCHED_CASH_TRANSFER_CANDIDATE');
    expect(first.warnings.map(warning => warning.code)).toContain('CASH_RECONCILIATION_DIFFERENCE');
    const firstDifference = first.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(first.detailIndex[firstDifference.detailKey!].map(item => [item.transactionId, item.counterpartyTransactionId, item.contributionMinor]))
      .toEqual([
        ['unequal-left', 'unequal-right', 30n],
        ['unequal-right', 'unequal-left', -20n],
      ]);
    expect(first.detailIndex[firstDifference.detailKey!].some(item => item.transactionId === 'third-claimant')).toBeFalse();
    expect(sumDetail(first, firstDifference.detailKey)).toBe(10n);

    const transfer = repository.transfers.get('ambiguous-transfer')!;
    repository.transfers.set('ambiguous-transfer', { ...transfer, leftTransactionId: 'unequal-right', rightTransactionId: 'unequal-left' });
    const reversed = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const reversedUnclassified = reversed.detailIndex[reversed.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!.detailKey!]
      .map(item => [item.transactionId, item.counterpartyTransactionId, item.contributionMinor]);
    expect(reversedUnclassified).toEqual(firstUnclassified);
    expect(reversed.netChangeInCashMinor).toBe(first.netChangeInCashMinor);
    expect(reversed.differenceMinor).toBe(first.differenceMinor);
    expect(reversed.warnings.map(warning => warning.code)).toEqual(first.warnings.map(warning => warning.code));
    const reversedDifference = reversed.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(reversed.detailIndex[reversedDifference.detailKey!]).toEqual(first.detailIndex[firstDifference.detailKey!]);

    repository.transfers.set('duplicate-transfer', {
      id: 'duplicate-transfer', leftTransactionId: 'unequal-left', rightTransactionId: 'unequal-right', confidence: 1,
      rationale: 'Duplicate endpoint candidate.', confirmedAtUtc: '2026-02-10T00:00:00.000Z',
    });
    const duplicate = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const duplicateUnclassified = duplicate.detailIndex[duplicate.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!.detailKey!];
    expect(duplicateUnclassified.map(item => item.transactionId)).toEqual(['third-claimant', 'unequal-left', 'unequal-right']);
    expect(duplicate.unclassifiedCashActivityMinor).toBe(first.unclassifiedCashActivityMinor);
    expect(duplicate.warnings.find(warning => warning.code === 'UNMATCHED_CASH_TRANSFER_CANDIDATE')?.references)
      .toEqual(['ambiguous-transfer', 'duplicate-transfer']);
    const duplicateDifference = duplicate.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(duplicate.detailIndex[duplicateDifference.detailKey!]).toEqual(first.detailIndex[firstDifference.detailKey!]);
    const hidden = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: false });
    const hiddenDifference = hidden.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(hidden.netChangeInCashMinor).toBe(first.netChangeInCashMinor);
    expect(hidden.differenceMinor).toBe(first.differenceMinor);
    expect(hidden.detailIndex[hiddenDifference.detailKey!]).toEqual(first.detailIndex[firstDifference.detailKey!]);
  });

  it('reports invalid cash-side splits as unclassified and rejects posting mismatches', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const fixedAsset = addChartAccount('fixed-assets', 'Equipment ledger', 'FIXED_ASSET', 'Machinery and equipment');
    addTransaction('unclassified-investment', 'cash', '2026-12-02', -100n, 'POSTED', undefined, [{ chartAccountId: fixedAsset.id, amountMinor: -100n, splitId: 'unclassified-investment:cash' }]);
    const unclassified = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: false });
    expect(unclassified.netInvestingMinor).toBe(0n);
    expect(unclassified.unclassifiedCashActivityMinor).toBe(-100n);
    expect(unclassified.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    expect(unclassified.rows.some(row => row.accountId === fixedAsset.id && row.section !== 'OPERATING')).toBeFalse();

    addChartClassification(fixedAsset.id, fixedAsset.accountType, fixedAsset.detailType, 'INVESTING');
    addTransaction('mismatched-investment', 'cash', '2026-12-03', -100n, 'POSTED', undefined, [{ chartAccountId: fixedAsset.id, amountMinor: -50n, splitId: 'mismatched-investment:cash' }], false);
    expect(() => service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: false })).toThrowError(CashFlowContractError);
  });

  it('isolates malformed Investing and Financing hierarchies across Chart and financial namespaces', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');

    const chartMissing = addChartAccount('chart-investing-missing', 'Missing investing parent', 'FIXED_ASSET', 'Machinery and equipment', { parentId: 'chart-investing-parent-missing' });
    const chartDescendant = addChartAccount('chart-investing-descendant', 'Descendant of missing parent', 'FIXED_ASSET', 'Machinery and equipment', { parentId: chartMissing.id });
    const chartCycleA = addChartAccount('chart-financing-cycle-a', 'Financing cycle A', 'LONG_TERM_LIABILITY', 'Notes payable', { parentId: 'chart-financing-cycle-b' });
    const chartCycleB = addChartAccount('chart-financing-cycle-b', 'Financing cycle B', 'LONG_TERM_LIABILITY', 'Notes payable', { parentId: chartCycleA.id });
    const chartCrossParent = addChartAccount('chart-financing-parent', 'Financing parent', 'LONG_TERM_LIABILITY', 'Notes payable');
    const chartCrossChild = addChartAccount('chart-investing-cross', 'Cross-treatment child', 'FIXED_ASSET', 'Machinery and equipment', { parentId: chartCrossParent.id });
    addChartClassification(chartMissing.id, chartMissing.accountType, chartMissing.detailType, 'INVESTING');
    addChartClassification(chartDescendant.id, chartDescendant.accountType, chartDescendant.detailType, 'INVESTING');
    addChartClassification(chartCycleA.id, chartCycleA.accountType, chartCycleA.detailType, 'FINANCING');
    addChartClassification(chartCycleB.id, chartCycleB.accountType, chartCycleB.detailType, 'FINANCING');
    addChartClassification(chartCrossParent.id, chartCrossParent.accountType, chartCrossParent.detailType, 'FINANCING');
    addChartClassification(chartCrossChild.id, chartCrossChild.accountType, chartCrossChild.detailType, 'INVESTING');
    addTransaction('chart-investing-missing-activity', 'cash', '2026-12-02', -10n, 'POSTED', undefined, [{ chartAccountId: chartMissing.id, amountMinor: -10n }]);
    addTransaction('chart-investing-descendant-activity', 'cash', '2026-12-03', -5n, 'POSTED', undefined, [{ chartAccountId: chartDescendant.id, amountMinor: -5n }]);
    addTransaction('chart-financing-cycle-a-activity', 'cash', '2026-12-04', 20n, 'POSTED', undefined, [{ chartAccountId: chartCycleA.id, amountMinor: 20n }]);
    addTransaction('chart-financing-cycle-b-activity', 'cash', '2026-12-05', -8n, 'POSTED', undefined, [{ chartAccountId: chartCycleB.id, amountMinor: -8n }]);
    addTransaction('chart-financing-parent-activity', 'cash', '2026-12-06', 12n, 'POSTED', undefined, [{ chartAccountId: chartCrossParent.id, amountMinor: 12n }]);
    addTransaction('chart-investing-cross-activity', 'cash', '2026-12-07', -7n, 'POSTED', undefined, [{ chartAccountId: chartCrossChild.id, amountMinor: -7n }]);

    const financialMissing = addAccount('financial-financing-missing', 'Missing financing parent', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets', 'financial-financing-parent-missing');
    const financialDescendant = addAccount('financial-financing-descendant', 'Descendant of missing financing parent', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets', financialMissing.id);
    const financialCycleA = addAccount('financial-investing-cycle-a', 'Investing cycle A', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets', 'financial-investing-cycle-b');
    const financialCycleB = addAccount('financial-investing-cycle-b', 'Investing cycle B', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets', financialCycleA.id);
    const financialCrossParent = addAccount('financial-financing-parent', 'Financial financing parent', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'LONG_TERM_LIABILITY', 'Notes payable');
    const financialCrossChild = addAccount('financial-investing-cross', 'Financial cross-treatment child', 0n, '2025-12-01', 'NOT_CASH', false, 'ENTITY', 'OTHER_ASSET', 'Other long-term assets', financialCrossParent.id);
    for (const [account, treatment] of [
      [financialMissing, 'FINANCING'], [financialDescendant, 'FINANCING'], [financialCycleA, 'INVESTING'],
      [financialCycleB, 'INVESTING'], [financialCrossParent, 'FINANCING'], [financialCrossChild, 'INVESTING'],
    ] as const) updateFinancialTreatment(account.id, treatment, 'NOT_CASH');
    const addTransfer = (id: string, otherAccountId: string, amount: bigint, date: string): void => {
      addTransaction(`${id}:cash`, 'cash', date, amount, 'MATCHED_TRANSFER', id);
      addTransaction(`${id}:other`, otherAccountId, date, -amount, 'MATCHED_TRANSFER', id);
      repository.transfers.set(id, {
        id, leftTransactionId: `${id}:cash`, rightTransactionId: `${id}:other`, confidence: 1,
        rationale: 'Hierarchy test transfer.', confirmedAtUtc: `${date}T00:00:00.000Z`,
      });
    };
    addTransfer('financial-missing-transfer', financialMissing.id, -11n, '2026-12-08');
    addTransfer('financial-descendant-transfer', financialDescendant.id, -6n, '2026-12-09');
    addTransfer('financial-cycle-a-transfer', financialCycleA.id, 21n, '2026-12-10');
    addTransfer('financial-cycle-b-transfer', financialCycleB.id, -9n, '2026-12-11');
    addTransfer('financial-parent-transfer', financialCrossParent.id, 13n, '2026-12-12');
    addTransfer('financial-cross-transfer', financialCrossChild.id, -4n, '2026-12-13');

    const hidden = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: false });
    const shown = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: true });
    const expectedIds = [
      chartMissing.id, chartDescendant.id, chartCycleA.id, chartCycleB.id, chartCrossChild.id,
      financialMissing.id, financialDescendant.id, financialCycleA.id, financialCycleB.id, financialCrossChild.id,
    ];
    const invalidRows = hidden.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY' && expectedIds.includes(row.accountId ?? ''));
    expect(invalidRows).toHaveSize(expectedIds.length);
    expect(invalidRows.every(row => row.parentRowId === undefined && row.reviewRequired)).toBeTrue();
    const warningRefs = hidden.warnings.filter(warning => warning.code === 'ACCOUNT_HIERARCHY_INVALID').map(warning => `${warning.accountRole}:${warning.accountId}`).sort();
    expect(warningRefs).toEqual(expectedIds.map(id => `${id.startsWith('chart-') ? 'CHART' : 'FINANCIAL_SOURCE'}:${id}`).sort());
    expect(hidden.netInvestingMinor).toBe(shown.netInvestingMinor);
    expect(hidden.netFinancingMinor).toBe(shown.netFinancingMinor);
    expect(hidden.netChangeInCashMinor).toBe(shown.netChangeInCashMinor);
    const rowById = new Map(hidden.rows.map(row => [row.rowId, row]));
    hidden.rows.forEach(row => {
      if (row.parentRowId) expect(rowById.has(row.parentRowId)).toBeTrue();
      if (row.amountMinor !== undefined && row.detailKey) expect(sumDetail(hidden, row.detailKey)).toBe(row.amountMinor);
    });
    expect(Object.keys(hidden.detailIndex).sort()).toEqual(Object.keys(shown.detailIndex).sort());
    Object.keys(hidden.detailIndex).forEach(key => expect(hidden.detailIndex[key]).toEqual(shown.detailIndex[key]));
  });

  it('omits explicitly excluded cash-side activity and warns when it is material', () => {
    addAccount('cash', 'Primary funds', 500n, '2025-12-01', 'CASH');
    const excluded = addChartAccount('excluded-asset', 'Do not report', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(excluded.id, excluded.accountType, excluded.detailType, 'EXCLUDED');
    addTransaction('excluded-investment', 'cash', '2026-12-15', -200n, 'POSTED', undefined, [{ chartAccountId: excluded.id, amountMinor: -200n, splitId: 'excluded-investment:cash' }]);

    const report = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: true });
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(500n);
    expect(report.warnings.map(warning => warning.code)).toContain('EXCLUDED_MATERIAL_CASH_ACTIVITY');
    expect(report.rows.some(row => row.accountId === excluded.id && (row.section === 'INVESTING' || row.section === 'FINANCING'))).toBeFalse();
  });

  it('keeps zero-net unclassified and excluded activity material for status and provenance', () => {
    addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const unresolved = addChartAccount('zero-net-unresolved', 'Unresolved activity', 'OTHER_CURRENT_ASSET', 'Other current assets');
    addChartClassification(unresolved.id, unresolved.accountType, unresolved.detailType, 'REVIEW_REQUIRED');
    const excluded = addChartAccount('zero-net-excluded', 'Excluded activity', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(excluded.id, excluded.accountType, excluded.detailType, 'EXCLUDED');
    addTransaction('unclassified-in', 'cash', '2026-12-01', 100n, 'POSTED', undefined, [{ chartAccountId: unresolved.id, amountMinor: 100n, splitId: 'unclassified-in:split' }], false);
    addTransaction('unclassified-out', 'cash', '2026-12-02', -100n, 'POSTED', undefined, [{ chartAccountId: unresolved.id, amountMinor: -100n, splitId: 'unclassified-out:split' }], false);
    addTransaction('excluded-in', 'cash', '2026-12-03', 75n, 'POSTED', undefined, [{ chartAccountId: excluded.id, amountMinor: 75n, splitId: 'excluded-in:split' }], false);
    addTransaction('excluded-out', 'cash', '2026-12-04', -75n, 'POSTED', undefined, [{ chartAccountId: excluded.id, amountMinor: -75n, splitId: 'excluded-out:split' }], false);

    const query = { startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: true } as const;
    const shown = service.getCashFlowReport(query);
    const hidden = service.getCashFlowReport({ ...query, includeZeroRows: false });
    expect(shown.status).toBe('REVIEW_REQUIRED');
    expect(shown.netChangeInCashMinor).toBe(0n);
    expect(shown.calculatedEndingCashMinor).toBe(0n);
    expect(shown.endingCashMinor).toBe(0n);
    expect(shown.differenceMinor).toBe(0n);
    expect(shown.unclassifiedCashActivityMinor).toBe(0n);
    expect(shown.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    expect(shown.warnings.map(warning => warning.code)).toContain('EXCLUDED_MATERIAL_CASH_ACTIVITY');
    const unclassifiedRow = shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    expect(shown.detailIndex[unclassifiedRow.detailKey!].map(item => [item.transactionId, item.contributionMinor]))
      .toEqual([['unclassified-in', 100n], ['unclassified-out', -100n]]);
    const differenceRow = shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(differenceRow.amountMinor).toBe(0n);
    expect(shown.detailIndex[differenceRow.detailKey!].map(item => [item.transactionId, item.contributionMinor]))
      .toEqual([['unclassified-in', -100n], ['unclassified-out', 100n], ['excluded-in', -75n], ['excluded-out', 75n]]);
    expect(sumDetail(shown, unclassifiedRow.detailKey)).toBe(0n);
    expect(sumDetail(shown, differenceRow.detailKey)).toBe(0n);

    expect(hidden.status).toBe(shown.status);
    expect(hidden.netChangeInCashMinor).toBe(shown.netChangeInCashMinor);
    expect(hidden.calculatedEndingCashMinor).toBe(shown.calculatedEndingCashMinor);
    expect(hidden.endingCashMinor).toBe(shown.endingCashMinor);
    expect(hidden.differenceMinor).toBe(shown.differenceMinor);
    expect(hidden.detailIndex[unclassifiedRow.detailKey!]).toEqual(shown.detailIndex[unclassifiedRow.detailKey!]);
    expect(hidden.detailIndex[differenceRow.detailKey!]).toEqual(shown.detailIndex[differenceRow.detailKey!]);
    expect(hidden.rows.some(row => row.rowId === unclassifiedRow.rowId)).toBeFalse();
    const hiddenDifferenceRow = hidden.rows.find(row => row.rowId === differenceRow.rowId)!;
    expect(hiddenDifferenceRow).toBeDefined();
    expect(hiddenDifferenceRow.rowId).toBe(differenceRow.rowId);
    expect(hiddenDifferenceRow.amountMinor).toBe(0n);
    expect(hiddenDifferenceRow.detailKey).toBe(differenceRow.detailKey);
    expect(sumDetail(hidden, hiddenDifferenceRow.detailKey)).toBe(0n);
    expect(hidden.reportId).toBe(shown.reportId);

    const transactions = [...repository.transactions.entries()].reverse();
    repository.transactions.clear();
    transactions.forEach(([id, transaction]) => repository.transactions.set(id, transaction));
    const reordered = service.getCashFlowReport(query);
    expect(reordered.status).toBe(shown.status);
    expect(reordered.warnings.map(warning => warning.warningId)).toEqual(shown.warnings.map(warning => warning.warningId));
    expect(reordered.detailIndex[unclassifiedRow.detailKey!]).toEqual(shown.detailIndex[unclassifiedRow.detailKey!]);
    expect(reordered.detailIndex[differenceRow.detailKey!]).toEqual(shown.detailIndex[differenceRow.detailKey!]);
  });

  it('warns for restricted cash activity even when its period-end balance is zero', () => {
    addAccount('cash', 'Primary funds', 1_000n, '2025-12-01', 'CASH');
    addAccount('restricted', 'Restricted reserve', 0n, '2025-12-01', 'RESTRICTED_CASH');
    addTransaction('restricted-roundtrip-out', 'cash', '2026-12-10', -100n, 'MATCHED_TRANSFER', 'restricted-roundtrip');
    addTransaction('restricted-roundtrip-in', 'restricted', '2026-12-10', 100n, 'MATCHED_TRANSFER', 'restricted-roundtrip');
    repository.transfers.set('restricted-roundtrip', {
      id: 'restricted-roundtrip', leftTransactionId: 'restricted-roundtrip-out', rightTransactionId: 'restricted-roundtrip-in', confidence: 1,
      rationale: 'Restricted round-trip out.', confirmedAtUtc: '2026-12-10T00:00:00.000Z',
    });
    addTransaction('restricted-roundtrip-back-in', 'cash', '2026-12-11', 100n, 'MATCHED_TRANSFER', 'restricted-roundtrip-back');
    addTransaction('restricted-roundtrip-back-out', 'restricted', '2026-12-11', -100n, 'MATCHED_TRANSFER', 'restricted-roundtrip-back');
    repository.transfers.set('restricted-roundtrip-back', {
      id: 'restricted-roundtrip-back', leftTransactionId: 'restricted-roundtrip-back-out', rightTransactionId: 'restricted-roundtrip-back-in', confidence: 1,
      rationale: 'Restricted round-trip back.', confirmedAtUtc: '2026-12-11T00:00:00.000Z',
    });

    const query = { startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: true } as const;
    const shown = service.getCashFlowReport(query);
    const hidden = service.getCashFlowReport({ ...query, includeZeroRows: false });
    expect(shown.beginningCashMinor).toBe(1_000n);
    expect(shown.endingCashMinor).toBe(1_000n);
    expect(shown.restrictedCashBeginningMinor).toBe(0n);
    expect(shown.restrictedCashEndingMinor).toBe(0n);
    expect(shown.netChangeInCashMinor).toBe(0n);
    expect(shown.differenceMinor).toBe(0n);
    expect(shown.unclassifiedCashActivityMinor).toBe(0n);
    expect(shown.warnings.find(warning => warning.code === 'RESTRICTED_CASH_PRESENT')?.references).toEqual(['restricted']);
    expect(shown.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    const unclassifiedRow = shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    expect(shown.detailIndex[unclassifiedRow.detailKey!].map(item => [item.transferId, item.transactionId, item.contributionMinor]))
      .toEqual([
        ['restricted-roundtrip', 'restricted-roundtrip-out', -100n],
        ['restricted-roundtrip-back', 'restricted-roundtrip-back-in', 100n],
      ]);
    const differenceRow = shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(sumDetail(shown, unclassifiedRow.detailKey)).toBe(0n);
    expect(sumDetail(shown, differenceRow.detailKey)).toBe(0n);
    expect(hidden.status).toBe(shown.status);
    expect(hidden.warnings.map(warning => warning.warningId)).toEqual(shown.warnings.map(warning => warning.warningId));
    expect(hidden.detailIndex[unclassifiedRow.detailKey!]).toEqual(shown.detailIndex[unclassifiedRow.detailKey!]);
    expect(hidden.detailIndex[differenceRow.detailKey!]).toEqual(shown.detailIndex[differenceRow.detailKey!]);

    const transactions = [...repository.transactions.entries()].reverse();
    repository.transactions.clear();
    transactions.forEach(([id, transaction]) => repository.transactions.set(id, transaction));
    const reordered = service.getCashFlowReport(query);
    expect(reordered.warnings.map(warning => warning.warningId)).toEqual(shown.warnings.map(warning => warning.warningId));
    expect(reordered.detailIndex[unclassifiedRow.detailKey!]).toEqual(shown.detailIndex[unclassifiedRow.detailKey!]);
    expect(reordered.detailIndex[differenceRow.detailKey!]).toEqual(shown.detailIndex[differenceRow.detailKey!]);
  });

  it('warns independently for participating archived financial and Chart accounts', () => {
    addAccount('cash', 'Primary funds', 1_000n, '2025-12-01', 'CASH');
    const archivedFinancial = addAccount('archived-financial', 'Archived liability', 0n, '2025-12-01', 'NOT_CASH', true, 'CREDIT_CARD');
    updateFinancialTreatment(archivedFinancial.id, 'OPERATING_LIABILITY', 'NOT_CASH');
    const archivedChart = addChartAccount('archived-chart', 'Archived asset', 'OTHER_CURRENT_ASSET', 'Other current assets', { archived: true });
    addChartClassification(archivedChart.id, archivedChart.accountType, archivedChart.detailType, 'OPERATING_ASSET');
    const zeroArchivedChart = addChartAccount('zero-archived-chart', 'Zero archived asset', 'OTHER_CURRENT_ASSET', 'Other current assets', { archived: true });
    addChartClassification(zeroArchivedChart.id, zeroArchivedChart.accountType, zeroArchivedChart.detailType, 'OPERATING_ASSET');
    addTransaction('archived-activity', archivedFinancial.id, '2026-12-15', -100n, 'POSTED', undefined, [{ chartAccountId: archivedChart.id, amountMinor: -100n, splitId: 'archived-activity:asset' }], false);

    const report = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31' });
    const archivedWarnings = report.warnings.filter(warning => warning.code === 'ARCHIVED_PARTICIPATING_ACCOUNT');
    expect(archivedWarnings.map(warning => [warning.accountRole, warning.accountId, warning.references])).toEqual([
      ['CHART', archivedChart.id, ['CHART', archivedChart.id]],
      ['FINANCIAL_SOURCE', archivedFinancial.id, ['FINANCIAL_SOURCE', archivedFinancial.id]],
    ]);
    expect(archivedWarnings).toHaveSize(2);
    expect(archivedWarnings.some(warning => warning.accountId === zeroArchivedChart.id)).toBeFalse();
  });

  it('fails report generation when P/L detail cannot reconcile to the shared Net Profit identity', () => {
    addAccount('cash', 'Operating Checking', 0n, '2026-01-01', 'CASH');
    const malformed = addChartAccount('malformed', 'Malformed P/L account', 'EXPENSE', 'Other expense');
    (malformed as { type: string }).type = 'UNKNOWN_RUNTIME_TYPE';
    addTransaction('malformed-entry', 'cash', '2026-01-02', -12n, 'POSTED', undefined, [{ chartAccountId: malformed.id, amountMinor: -12n }]);

    expect(() => service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31' });
    } catch (error) {
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_REPORT_GENERATION_FAILED');
    }
  });

  it('uses the prior calendar day for opening cash and respects opening-balance boundaries', () => {
    addAccount('opening-on-start', 'New Checking', 400n, '2026-01-01', 'CASH');

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-01', includeZeroRows: true });

    expect(dayBeforeBusinessDate('2026-01-01')).toBe('2025-12-31');
    expect(dayBeforeBusinessDate('2024-03-01')).toBe('2024-02-29');
    expect(report.beginningCashMinor).toBe(0n);
    expect(report.endingCashMinor).toBe(400n);
  });

  it('discloses a recorded noncash asset acquisition financed by debt without cash activity', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const debt = addAccount('debt-source', 'Debt source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment('debt-source', 'FINANCING', 'NOT_CASH');
    const asset = addChartAccount('asset-counterparty', 'Equipment', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(asset.id, asset.accountType, asset.detailType, 'INVESTING');
    addTransaction('noncash-acquisition', debt.id, '2026-11-15', -5000n, 'POSTED', undefined, [
      { chartAccountId: asset.id, amountMinor: -5000n, splitId: 'noncash-acquisition:asset' },
    ], false);

    const report = service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30', includeZeroRows: true });
    const disclosureRows = report.rows.filter(row => row.section === 'NONCASH_DISCLOSURE' && row.rowType === 'NONCASH_DISCLOSURE');
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.beginningCashMinor).toBe(1000n);
    expect(report.endingCashMinor).toBe(1000n);
    expect(report.warnings.map(warning => warning.code)).toContain('NONCASH_ACTIVITY_IDENTIFIED');
    expect(disclosureRows).toHaveSize(1);
    expect(disclosureRows[0].amountMinor).toBe(5000n);
    expect(report.disclosures).toHaveSize(1);
    expect(report.disclosures![0].accountId).toBe('debt-source');
    expect(report.disclosures![0].chartAccountId).toBe('asset-counterparty');
    expect(report.disclosures![0].transactionId).toBe('noncash-acquisition');
    expect(report.detailIndex[disclosureRows[0].detailKey!].map(item => [item.transactionId, item.splitId, item.contributionMinor]))
      .toEqual([['noncash-acquisition', 'noncash-acquisition:asset', 5000n]]);
    expect(sumDetail(report, disclosureRows[0].detailKey)).toBe(5000n);
  });

  it('uses an explicit Investing or Financing counteraccount when the other side is NONCASH_DISCLOSURE', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const noncashSource = addAccount('noncash-source', 'Recorded noncash source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(noncashSource.id, 'NONCASH_DISCLOSURE', 'NOT_CASH');
    const investingAsset = addChartAccount('noncash-investing-asset', 'Acquired asset', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(investingAsset.id, investingAsset.accountType, investingAsset.detailType, 'INVESTING');
    addTransaction('noncash-source-side', noncashSource.id, '2026-11-01', -100n, 'POSTED', undefined, [{ chartAccountId: investingAsset.id, amountMinor: -100n, splitId: 'noncash-source-side:asset' }], false);

    const financingSource = addAccount('financing-source', 'Recorded financing source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(financingSource.id, 'FINANCING', 'NOT_CASH');
    const noncashLiability = addChartAccount('noncash-financing-liability', 'Debt acquired', 'LONG_TERM_LIABILITY', 'Notes payable');
    addChartClassification(noncashLiability.id, noncashLiability.accountType, noncashLiability.detailType, 'NONCASH_DISCLOSURE');
    addTransaction('noncash-counter-side', financingSource.id, '2026-11-02', -200n, 'POSTED', undefined, [{ chartAccountId: noncashLiability.id, amountMinor: -200n, splitId: 'noncash-counter-side:liability' }], false);

    const report = service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30', includeZeroRows: true });
    const disclosureRows = report.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE' && row.accountId);
    expect(disclosureRows.map(row => [row.accountId, row.amountMinor])).toEqual([
      ['noncash-investing-asset', 100n], ['noncash-financing-liability', 200n],
    ]);
    expect(report.disclosures?.map(disclosure => disclosure.transactionId)).toEqual(['noncash-counter-side', 'noncash-source-side']);
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.detailIndex[disclosureRows[0].detailKey!][0]).toEqual(jasmine.objectContaining({
      transactionId: 'noncash-source-side', contributionMinor: 100n,
    }));
  });

  it('does not discard an explicit Chart noncash signal when the financial source classification is missing', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('missing-noncash-source', 'Missing source classification', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    repository.cashFlowClassifications.delete(`FINANCIAL_SOURCE:${source.id}`);
    const asset = addChartAccount('missing-source-asset', 'Missing source asset', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(asset.id, asset.accountType, asset.detailType, 'INVESTING');
    addTransaction('missing-noncash-source-entry', source.id, '2026-11-04', -100n, 'POSTED', undefined, [{ chartAccountId: asset.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' });
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_GENERATION_FAILED');
      expect((error as CashFlowContractError).message).toContain('Source account “Missing source classification”');
      expect((error as CashFlowContractError).message).toContain('Open Review classifications');
    }
  });

  it('rejects a Review-required financial source when its recorded Chart side signals noncash activity', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('review-noncash-source', 'Review source classification', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    const sourceClassification = repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${source.id}`)!;
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${source.id}`, {
      ...sourceClassification, cashRole: 'REVIEW_REQUIRED', treatment: 'FINANCING', status: 'REVIEW_REQUIRED',
    });
    const liability = addChartAccount('review-source-liability', 'Review source liability', 'LONG_TERM_LIABILITY', 'Notes payable');
    addChartClassification(liability.id, liability.accountType, liability.detailType, 'NONCASH_DISCLOSURE');
    addTransaction('review-noncash-source-entry', source.id, '2026-11-05', -100n, 'POSTED', undefined, [{ chartAccountId: liability.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' })).toThrowError(CashFlowContractError);
  });

  it('rejects an ordinary source paired with an explicitly noncash Chart counteraccount', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('ordinary-source', 'Ordinary credit card', 0n, '2025-12-01', 'NOT_CASH', false, 'CREDIT_CARD');
    updateFinancialTreatment(source.id, 'OPERATING_LIABILITY', 'NOT_CASH');
    const asset = addChartAccount('ordinary-source-asset', 'Incompatible asset', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(asset.id, asset.accountType, asset.detailType, 'INVESTING');
    addTransaction('ordinary-source-entry', source.id, '2026-11-06', -100n, 'POSTED', undefined, [{ chartAccountId: asset.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' });
    } catch (error) {
      const failure = (error as CashFlowContractError).failure;
      expect(failure.message).toContain('transaction category corrected');
      expect(failure.message).toContain('Ordinary credit card');
      expect(failure.message).toContain('Incompatible asset');
      expect(failure.transactionCategoryCorrection).toEqual(jasmine.objectContaining({
        transactionId: 'ordinary-source-entry', transactionDate: '2026-11-06', sourceAccountId: source.id,
        chartAccountId: asset.id, chartTreatment: 'INVESTING',
      }));
    }
  });

  it('rejects a noncash disclosure whose two recorded sides never establish Investing or Financing', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('ambiguous-source', 'Ambiguous source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(source.id, 'NONCASH_DISCLOSURE', 'NOT_CASH');
    const counter = addChartAccount('ambiguous-counter', 'Ambiguous counter', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(counter.id, counter.accountType, counter.detailType, 'NONCASH_DISCLOSURE');
    addTransaction('ambiguous-noncash', source.id, '2026-11-03', -100n, 'POSTED', undefined, [{ chartAccountId: counter.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30' })).toThrowError(CashFlowContractError);
  });

  it('keeps an in-period cash opening outside sections and reconciles its boundary effect', () => {
    addAccount('opening-cash', 'Opening funds', 2500n, '2026-02-10', 'CASH');

    const report = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const unclassified = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
    const difference = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(report.netOperatingMinor).toBe(0n);
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.beginningCashMinor).toBe(0n);
    expect(report.endingCashMinor).toBe(2500n);
    expect(report.calculatedEndingCashMinor).toBe(0n);
    expect(report.differenceMinor).toBe(-2500n);
    expect(report.unclassifiedCashActivityMinor).toBe(2500n);
    expect(report.warnings.map(warning => warning.code)).toContain('OPENING_CASH_BALANCE_WITHIN_PERIOD');
    expect(report.detailIndex[unclassified.detailKey!][0]).toEqual(jasmine.objectContaining({
      contributionId: 'unclassified:opening:opening-cash:2026-02-10',
      contributionMinor: 2500n,
      businessDate: '2026-02-10',
      openingAmountMinor: 2500n,
    }));
    expect(report.detailIndex[difference.detailKey!].map(item => [item.contributionId, item.contributionMinor]))
      .toEqual([['unclassified:opening:opening-cash:2026-02-10:reconciliation', -2500n]]);
  });

  it('applies cash opening balances only at the report boundaries', () => {
    addAccount('cash-before', 'Funds before period', 400n, '2026-01-15', 'CASH');
    addAccount('cash-at-end', 'Funds after period', 500n, '2026-03-01', 'CASH');
    const report = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });

    expect(report.beginningCashMinor).toBe(400n);
    expect(report.endingCashMinor).toBe(400n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.differenceMinor).toBe(0n);
    expect(report.warnings.map(warning => warning.code)).not.toContain('OPENING_CASH_BALANCE_WITHIN_PERIOD');
    expect(report.detailIndex[report.rows.find(row => row.rowId.startsWith('SYNTHETIC:BEGINNING_CASH'))!.detailKey!]
      .map(item => [item.accountId, item.contributionMinor])).toEqual([['cash-before', 400n]]);
    expect(report.detailIndex[report.rows.find(row => row.rowId.startsWith('SYNTHETIC:ENDING_CASH'))!.detailKey!]
      .map(item => [item.accountId, item.contributionMinor])).toEqual([['cash-before', 400n]]);
  });

  it('does not let unrelated posted, pending, or excluded activity explain an in-period opening', () => {
    addAccount('opening-a', 'Opening A', 2500n, '2026-02-10', 'CASH');
    addAccount('opening-b', 'Opening B', 5000n, '2026-02-15', 'CASH');
    const expense = addChartAccount('opening-expense', 'Unrelated expense', 'EXPENSE', 'Other business expenses');
    addChartClassification(expense.id, expense.accountType, expense.detailType, 'OPERATING_REVENUE_EXPENSE');
    addTransaction('before-opening', 'opening-a', '2026-02-05', -100n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -100n, splitId: 'before-opening:expense' }]);
    addTransaction('after-opening', 'opening-a', '2026-02-11', -200n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -200n, splitId: 'after-opening:expense' }]);
    addTransaction('pending-after-opening', 'opening-b', '2026-02-16', -300n, 'PENDING');
    addTransaction('excluded-after-opening', 'opening-b', '2026-02-17', 400n, 'EXCLUDED');

    const shown = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    const hidden = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: false });
    expect(shown.warnings.map(warning => warning.code)).toContain('OPENING_CASH_BALANCE_WITHIN_PERIOD');
    expect(shown.unclassifiedCashActivityMinor).toBe(7500n);
    expect(shown.netOperatingMinor).toBe(-300n);
    expect(shown.calculatedEndingCashMinor).toBe(-300n);
    expect(shown.endingCashMinor).toBe(7200n);
    expect(shown.differenceMinor).toBe(-7500n);
    expect(shown.detailIndex[shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!.detailKey!]
      .map(item => [item.contributionId, item.contributionMinor])).toEqual([
        ['unclassified:opening:opening-a:2026-02-10', 2500n],
        ['unclassified:opening:opening-b:2026-02-15', 5000n],
      ]);
    expect(shown.detailIndex[shown.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!.detailKey!]
      .map(item => [item.contributionId, item.contributionMinor])).toEqual([
        ['unclassified:opening:opening-a:2026-02-10:reconciliation', -2500n],
        ['unclassified:opening:opening-b:2026-02-15:reconciliation', -5000n],
      ]);
    expect(hidden.warnings.map(warning => warning.code)).toContain('OPENING_CASH_BALANCE_WITHIN_PERIOD');
    expect(hidden.detailIndex).toEqual(shown.detailIndex);
    expect(hidden.differenceMinor).toBe(shown.differenceMinor);
  });

  it('treats explicit ledger-activity mode as the supported opening representation', () => {
    const account = addAccount('ledger-opening', 'Ledger opening', 0n, '2026-02-10', 'CASH');
    account.openingBalanceSource = 'LEDGER_ACTIVITY';
    const income = addChartAccount('ledger-income', 'Ledger income', 'INCOME', 'Sales of product income');
    addChartClassification(income.id, income.accountType, income.detailType, 'OPERATING_REVENUE_EXPENSE');
    addTransaction('ledger-activity', account.id, '2026-02-11', 100n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 100n, splitId: 'ledger-activity:income' }]);

    const report = service.getCashFlowReport({ startDate: '2026-02-01', endDate: '2026-02-28', includeZeroRows: true });
    expect(report.warnings.map(warning => warning.code)).not.toContain('OPENING_CASH_BALANCE_WITHIN_PERIOD');
    expect(report.unclassifiedCashActivityMinor).toBe(0n);
    expect(report.differenceMinor).toBe(0n);
  });

  it('discloses every identifiable noncash split once and preserves archived and zero-filter state', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const debt = addAccount('archived-debt', 'Legacy financing source', 0n, '2025-12-01', 'NOT_CASH', true, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(debt.id, 'FINANCING', 'NOT_CASH');
    const equipment = addChartAccount('equipment', 'Acquired equipment', 'FIXED_ASSET', 'Machinery and equipment', { archived: true });
    const investment = addChartAccount('investment', 'Long term investment', 'OTHER_ASSET', 'Other assets');
    addChartClassification(equipment.id, equipment.accountType, equipment.detailType, 'INVESTING');
    addChartClassification(investment.id, investment.accountType, investment.detailType, 'INVESTING');
    addTransaction('multi-noncash', debt.id, '2026-04-10', -500n, 'POSTED', undefined, [
      { chartAccountId: equipment.id, amountMinor: -300n, splitId: 'multi-noncash:equipment' },
      { chartAccountId: investment.id, amountMinor: -200n, splitId: 'multi-noncash:investment' },
    ], false);
    addTransaction('pending-noncash', debt.id, '2026-04-11', -100n, 'PENDING', undefined, [{ chartAccountId: equipment.id, amountMinor: -100n }], false);
    addTransaction('excluded-noncash', debt.id, '2026-04-12', -100n, 'EXCLUDED', undefined, [{ chartAccountId: equipment.id, amountMinor: -100n }], false);

    const shown = service.getCashFlowReport({ startDate: '2026-04-01', endDate: '2026-04-30', includeZeroRows: true });
    const hidden = service.getCashFlowReport({ startDate: '2026-04-01', endDate: '2026-04-30', includeZeroRows: false });
    const shownRows = shown.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE');
    const hiddenRows = hidden.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE');
    expect(shownRows.map(row => [row.accountId, row.amountMinor, row.archived])).toEqual([
      ['equipment', 300n, true], ['investment', 200n, true],
    ]);
    expect(hiddenRows.map(row => row.rowId)).toEqual(shownRows.map(row => row.rowId));
    expect(hidden.disclosures).toEqual(shown.disclosures);
    expect(hidden.netChangeInCashMinor).toBe(shown.netChangeInCashMinor);
    expect(hidden.detailIndex).toEqual(shown.detailIndex);
    expect(shownRows.every(row => sumDetail(shown, row.detailKey) === row.amountMinor)).toBeTrue();
    expect(shownRows.flatMap(row => shown.detailIndex[row.detailKey!]).map(item => [item.transactionId, item.splitId, item.contributionMinor])).toEqual([
      ['multi-noncash', 'multi-noncash:equipment', 300n], ['multi-noncash', 'multi-noncash:investment', 200n],
    ]);
  });

  it('renders supplemental noncash parent and child activity exactly once with zero-filter invariance', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('hierarchy-source', 'Debt source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(source.id, 'FINANCING', 'NOT_CASH');
    const parent = addChartAccount('noncash-parent', 'Equipment', 'FIXED_ASSET', 'Machinery and equipment');
    const child = addChartAccount('noncash-child', 'Equipment detail', 'FIXED_ASSET', 'Machinery and equipment', { parentId: parent.id });
    const zeroChild = addChartAccount('noncash-zero-child', 'Zero equipment detail', 'FIXED_ASSET', 'Machinery and equipment', { parentId: parent.id });
    addChartClassification(parent.id, parent.accountType, parent.detailType, 'INVESTING');
    addChartClassification(child.id, child.accountType, child.detailType, 'INVESTING');
    addChartClassification(zeroChild.id, zeroChild.accountType, zeroChild.detailType, 'INVESTING');
    addTransaction('noncash-parent-entry', source.id, '2026-11-05', -40n, 'POSTED', undefined, [{ chartAccountId: parent.id, amountMinor: -40n, splitId: 'noncash-parent-entry:parent' }], false);
    addTransaction('noncash-child-entry', source.id, '2026-11-06', -60n, 'POSTED', undefined, [{ chartAccountId: child.id, amountMinor: -60n, splitId: 'noncash-child-entry:child' }], false);
    addTransaction('noncash-zero-entry', source.id, '2026-11-07', 0n, 'POSTED', undefined, [{ chartAccountId: zeroChild.id, amountMinor: 0n, splitId: 'noncash-zero-entry:zero' }], false);

    const shown = service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30', includeZeroRows: true });
    const hidden = service.getCashFlowReport({ startDate: '2026-11-01', endDate: '2026-11-30', includeZeroRows: false });
    const shownAccounts = shown.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE' && row.accountId);
    const hiddenAccounts = hidden.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE' && row.accountId);
    const parentRow = shownAccounts.find(row => row.accountId === parent.id)!;
    const childRow = shownAccounts.find(row => row.accountId === child.id)!;
    const zeroRow = shownAccounts.find(row => row.accountId === zeroChild.id)!;
    expect(childRow.parentRowId).toBe(parentRow.rowId);
    expect(parentRow.parentRowId).toBeUndefined();
    expect(zeroRow.amountMinor).toBe(0n);
    expect(sumDetail(shown, parentRow.detailKey)).toBe(40n);
    expect(sumDetail(shown, childRow.detailKey)).toBe(60n);
    expect(sumDetail(shown, zeroRow.detailKey)).toBe(0n);
    const parentSubtotal = shown.rows.find(row => row.rowType === 'SUBTOTAL' && row.accountId === parent.id && row.section === 'NONCASH_DISCLOSURE')!;
    expect(parentSubtotal.amountMinor).toBe(100n);
    expect(sumDetail(shown, parentSubtotal.detailKey)).toBe(100n);
    expect(hiddenAccounts.map(row => row.accountId)).not.toContain(zeroChild.id);
    expect(hidden.detailIndex).toEqual(shown.detailIndex);
    expect(hidden.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE' && row.accountId).map(row => row.accountId))
      .toEqual([parent.id, child.id]);
  });

  it('places malformed supplemental hierarchies in deterministic review groups without cyclic parents', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('malformed-hierarchy-source', 'Debt source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(source.id, 'FINANCING', 'NOT_CASH');
    const missing = addChartAccount('disclosure-missing-parent', 'Missing parent child', 'FIXED_ASSET', 'Machinery and equipment', { parentId: 'not-present' });
    const crossParent = addChartAccount('disclosure-cross-parent', 'Financing parent', 'LONG_TERM_LIABILITY', 'Notes payable');
    const crossChild = addChartAccount('disclosure-cross-child', 'Investing child', 'FIXED_ASSET', 'Machinery and equipment', { parentId: crossParent.id });
    const cycleA = addChartAccount('disclosure-cycle-a', 'Cycle A', 'FIXED_ASSET', 'Machinery and equipment', { parentId: 'disclosure-cycle-b' });
    const cycleB = addChartAccount('disclosure-cycle-b', 'Cycle B', 'FIXED_ASSET', 'Machinery and equipment', { parentId: cycleA.id });
    const cycleDescendant = addChartAccount('disclosure-cycle-descendant', 'Cycle descendant', 'FIXED_ASSET', 'Machinery and equipment', { parentId: cycleA.id });
    addChartClassification(missing.id, missing.accountType, missing.detailType, 'INVESTING');
    addChartClassification(crossParent.id, crossParent.accountType, crossParent.detailType, 'FINANCING');
    addChartClassification(crossChild.id, crossChild.accountType, crossChild.detailType, 'INVESTING');
    addChartClassification(cycleA.id, cycleA.accountType, cycleA.detailType, 'INVESTING');
    addChartClassification(cycleB.id, cycleB.accountType, cycleB.detailType, 'INVESTING');
    addChartClassification(cycleDescendant.id, cycleDescendant.accountType, cycleDescendant.detailType, 'INVESTING');
    addTransaction('disclosure-missing-entry', source.id, '2026-12-01', -10n, 'POSTED', undefined, [{ chartAccountId: missing.id, amountMinor: -10n }], false);
    addTransaction('disclosure-cross-parent-entry', source.id, '2026-12-02', -20n, 'POSTED', undefined, [{ chartAccountId: crossParent.id, amountMinor: -20n }], false);
    addTransaction('disclosure-cross-child-entry', source.id, '2026-12-03', -30n, 'POSTED', undefined, [{ chartAccountId: crossChild.id, amountMinor: -30n }], false);
    addTransaction('disclosure-cycle-a-entry', source.id, '2026-12-04', -40n, 'POSTED', undefined, [{ chartAccountId: cycleA.id, amountMinor: -40n }], false);
    addTransaction('disclosure-cycle-b-entry', source.id, '2026-12-05', -50n, 'POSTED', undefined, [{ chartAccountId: cycleB.id, amountMinor: -50n }], false);
    addTransaction('disclosure-cycle-descendant-entry', source.id, '2026-12-06', -60n, 'POSTED', undefined, [{ chartAccountId: cycleDescendant.id, amountMinor: -60n }], false);

    const report = service.getCashFlowReport({ startDate: '2026-12-01', endDate: '2026-12-31', includeZeroRows: false });
    const expected = [missing.id, crossChild.id, cycleA.id, cycleB.id, cycleDescendant.id];
    const invalidRows = report.rows.filter(row => row.rowType === 'NONCASH_DISCLOSURE' && expected.includes(row.accountId ?? ''));
    expect(invalidRows).toHaveSize(expected.length);
    expect(invalidRows.every(row => row.parentRowId === undefined && row.reviewRequired)).toBeTrue();
    const hierarchyWarnings = report.warnings.filter(warning => warning.code === 'ACCOUNT_HIERARCHY_INVALID');
    expect(hierarchyWarnings.map(warning => warning.accountId).sort()).toEqual(expected.slice().sort());
    const rowById = new Map(report.rows.map(row => [row.rowId, row]));
    report.rows.filter(row => row.section === 'NONCASH_DISCLOSURE').forEach(row => {
      const seen = new Set<string>();
      let parent = row.parentRowId;
      while (parent) {
        expect(seen.has(parent)).toBeFalse();
        seen.add(parent);
        expect(rowById.has(parent)).toBeTrue();
        parent = rowById.get(parent)?.parentRowId;
      }
      if (row.amountMinor !== undefined && row.detailKey) expect(sumDetail(report, row.detailKey)).toBe(row.amountMinor);
    });
    expect(report.netInvestingMinor).toBe(0n);
    expect(report.netFinancingMinor).toBe(0n);
    expect(report.netChangeInCashMinor).toBe(0n);
  });

  it('fails rather than silently dropping malformed noncash counteraccount structures', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const debt = addAccount('debt', 'Financing source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(debt.id, 'FINANCING', 'NOT_CASH');
    const missingChart = addChartAccount('missing-counter', 'Missing counteraccount', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(missingChart.id, missingChart.accountType, missingChart.detailType, 'INVESTING');
    repository.chartAccounts.delete(missingChart.id);
    addTransaction('missing-counter-entry', debt.id, '2026-05-05', -100n, 'POSTED', undefined, [{ chartAccountId: missingChart.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-05-01', endDate: '2026-05-31' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-05-01', endDate: '2026-05-31' });
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_GENERATION_FAILED');
      expect((error as CashFlowContractError).message).toContain('counteraccount');
    }
  });

  it('fails when an explicit noncash event has a review-required Chart counteraccount', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const source = addAccount('review-counter-source', 'Financing source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    updateFinancialTreatment(source.id, 'FINANCING', 'NOT_CASH');
    const counter = addChartAccount('review-counter', 'Review counteraccount', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(counter.id, counter.accountType, counter.detailType, 'INVESTING');
    const classification = repository.cashFlowClassifications.get(`CHART:${counter.id}`)!;
    repository.cashFlowClassifications.set(`CHART:${counter.id}`, { ...classification, status: 'REVIEW_REQUIRED', rationale: 'Counteraccount needs review.' });
    addTransaction('review-counter-entry', source.id, '2026-05-06', -100n, 'POSTED', undefined, [{ chartAccountId: counter.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-05-01', endDate: '2026-05-31' })).toThrowError(CashFlowContractError);
  });

  it('fails through the typed contract for a review-required noncash source', () => {
    addAccount('cash', 'Primary funds', 1000n, '2025-12-01', 'CASH');
    const debt = addAccount('review-debt', 'Unresolved debt source', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
    const sourceClassification = repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${debt.id}`)!;
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${debt.id}`, {
      ...sourceClassification, treatment: 'FINANCING', status: 'REVIEW_REQUIRED',
      rationale: 'Review required before identifying this noncash source.',
    });
    const asset = addChartAccount('review-asset', 'Unresolved asset', 'FIXED_ASSET', 'Machinery and equipment');
    addChartClassification(asset.id, asset.accountType, asset.detailType, 'INVESTING');
    addTransaction('review-noncash', debt.id, '2026-06-05', -100n, 'POSTED', undefined, [{ chartAccountId: asset.id, amountMinor: -100n }], false);

    expect(() => service.getCashFlowReport({ startDate: '2026-06-01', endDate: '2026-06-30' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-06-01', endDate: '2026-06-30' });
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_GENERATION_FAILED');
      expect((error as CashFlowContractError).message).toContain('Source account “Unresolved debt source”');
      expect((error as CashFlowContractError).message).toContain('Open Review classifications');
      expect((error as CashFlowContractError).message).not.toContain('review-debt');
    }
  });

  it('runs the production service against the Cash Flow acceptance oracle for all implemented production scenarios', async () => {
    type OracleScenario = {
      id: string;
      companyId: string;
      period: { startDate: string; endDate: string };
      expectedTotals: Record<string, number>;
      expectedRows: Record<string, number>;
      detailGroups: Record<string, readonly { sourceId: string; amountMinor: number }[]>;
      diagnosticContributions?: readonly { sourceId: string; amountMinor: number }[];
      expectedStatus: 'COMPLETE' | 'REVIEW_REQUIRED';
      expectedWarnings?: readonly string[];
      checkpoints?: readonly { endDate: string; netProfitMinor: number; operatingAssetAdjustmentsMinor?: number; operatingLiabilityAdjustmentsMinor?: number; netOperatingMinor: number; endingCashMinor: number }[];
    };
    type OracleDocument = { scenarios: readonly OracleScenario[] };
    const oracleDocument = await fetch('fixtures/cash-flow/baseline-oracle.json').then(response => {
      if (!response.ok) throw new Error(`Unable to load Cash Flow acceptance oracle (${response.status}).`);
      return response.json() as Promise<OracleDocument>;
    });
    const scenarios = new Map(oracleDocument.scenarios.map(scenario => [scenario.id, scenario]));
    const caseIds = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17'];
    productionCsvParityScenarioCount = 0;
    expect(caseIds.every(id => scenarios.has(id))).toBeTrue();
    for (const id of caseIds) {
      const expected = scenarios.get(id)!;
      const expectedCompany = expected.companyId === 'company-copper-kettle' ? 'COPPER' : 'NORTHWIND';
      prepareProductionFixture(expectedCompany);
      addProductionFixtureScenario(id);
      const report = service.getCashFlowReport({ startDate: expected.period.startDate, endDate: expected.period.endDate, includeZeroRows: true });
      const repeat = service.getCashFlowReport({ startDate: expected.period.startDate, endDate: expected.period.endDate, includeZeroRows: true });
      assertProductionCsvParity(report);
      assertProductionXlsxParity(report);
      assertProductionPrintParity(report);
      const accountRows = report.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY');
      const amount = (rows: readonly { amountMinor?: bigint }[]) => rows.reduce((sum, row) => sum + (row.amountMinor ?? 0n), 0n);
      const totals = expected.expectedTotals;
      expect(report.status).toBe(expected.expectedStatus);
      if (expected.expectedWarnings) expect(report.warnings.map(warning => warning.code).sort().join('|')).toBe([...expected.expectedWarnings].sort().join('|'));
      expect(report.rows.find(row => row.rowType === 'NET_PROFIT')!.amountMinor).toBe(BigInt(totals['netProfitMinor']));
      expect(amount(report.rows.filter(row => row.rowType === 'ADJUSTMENT' && row.treatment === 'NONCASH_PNL_ADJUSTMENT'))).toBe(BigInt(totals['noncashAdjustmentsMinor']));
      expect(amount(accountRows.filter(row => row.treatment === 'OPERATING_ASSET'))).toBe(BigInt(totals['operatingAssetAdjustmentsMinor']));
      expect(amount(accountRows.filter(row => row.treatment === 'OPERATING_LIABILITY'))).toBe(BigInt(totals['operatingLiabilityAdjustmentsMinor']));
      expect(report.rows.find(row => row.rowId.startsWith('SYNTHETIC:NET_INVESTING'))?.amountMinor).toBe(BigInt(totals['netInvestingMinor']));
      expect(report.rows.find(row => row.rowId.startsWith('SYNTHETIC:NET_FINANCING'))?.amountMinor).toBe(BigInt(totals['netFinancingMinor']));
      expect(report.rows.find(row => row.rowId.startsWith('SYNTHETIC:NET_CHANGE_IN_CASH'))?.amountMinor).toBe(BigInt(expected.expectedRows['NET_CHANGE'] ?? totals['netChangeInCashMinor']));
      expect(report.netOperatingMinor).toBe(BigInt(totals['netOperatingMinor']));
      expect(report.beginningCashMinor).toBe(BigInt(totals['beginningCashMinor']));
      expect(report.endingCashMinor).toBe(BigInt(totals['endingCashMinor']));
      if (id === 'A10' || id === 'A11' || id === 'A12' || id === 'A13' || id === 'A14') {
        expect(report.netChangeInCashMinor).toBe(BigInt(totals['netChangeInCashMinor']));
        expect(report.calculatedEndingCashMinor).toBe(BigInt(totals['calculatedEndingCashMinor']));
        expect(report.differenceMinor).toBe(BigInt(totals['differenceMinor']));
        expect(report.restrictedCashBeginningMinor).toBe(BigInt(totals['restrictedCashBeginningMinor']));
        expect(report.restrictedCashEndingMinor).toBe(BigInt(totals['restrictedCashEndingMinor']));
        expect(report.unclassifiedCashActivityMinor).toBe(BigInt(totals['unclassifiedCashActivityMinor']));
      }
      expect(report.databaseRevision).toBe(repository.getDatabaseRevision());
      const netProfitRow = report.rows.find(row => row.rowType === 'NET_PROFIT')!;
      const oracleSourceId = (item: CashFlowContribution, phase: 'NONCASH' | 'BALANCE' | 'CASH'): string => {
        if (!item.transactionId) return '';
        if (phase === 'CASH') return item.splitId ?? `${item.transactionId}:cash`;
        if (phase === 'NONCASH') return `${item.transactionId}:reversal`;
        return `${item.transactionId}:${item.splitId?.split(':').slice(1).join(':') ?? 'balance'}`;
      };
      expect(report.detailIndex[netProfitRow.detailKey!].map(item => ({
        sourceId: item.splitId ?? item.transactionId ?? '', contributionMinor: item.contributionMinor,
      }))).toEqual((expected.detailGroups['NET_PROFIT'] ?? []).map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
      if (id === 'A10' || id === 'A12') {
        for (const rowKey of ['BEGINNING_CASH', 'ENDING_CASH']) {
          const row = report.rows.find(candidate => candidate.rowId.startsWith(`SYNTHETIC:${rowKey}`))!;
          const actual = (report.detailIndex[row.detailKey!] ?? []).map(item => ({
            sourceId: `${item.accountId}:${rowKey === 'BEGINNING_CASH' ? 'open' : 'end'}`,
            contributionMinor: item.contributionMinor,
          }));
          expect(actual).toEqual((expected.detailGroups[rowKey] ?? []).map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
          expect(sumDetail(report, row.detailKey)).toBe(row.amountMinor!);
        }
      }
      if (id === 'A11') {
        const disclosureRows = report.rows.filter(row => row.section === 'NONCASH_DISCLOSURE' && row.rowType === 'NONCASH_DISCLOSURE');
        const expectedDisclosureKey = 'NONCASH_DISCLOSURE:asset-financed-by-debt';
        expect(disclosureRows).toHaveSize(1);
        expect(disclosureRows[0].amountMinor).toBe(BigInt(expected.expectedRows[expectedDisclosureKey]));
        expect(report.netInvestingMinor).toBe(0n);
        expect(report.netFinancingMinor).toBe(0n);
        expect(report.netChangeInCashMinor).toBe(0n);
        expect(report.disclosures).toHaveSize(1);
        expect(report.disclosures![0].transactionId).toBe('a11-noncash-acquisition');
        expect(report.disclosures![0].accountId).toBe('a11-debt');
        expect(report.disclosures![0].chartAccountId).toBe('a11-fixed-asset');
        expect(report.detailIndex[disclosureRows[0].detailKey!].map(item => ({ sourceId: item.transactionId, contributionMinor: item.contributionMinor })))
          .toEqual(expected.detailGroups[expectedDisclosureKey].map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
      }
      if (id === 'A13') {
        const unclassifiedRow = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))!;
        const differenceRow = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
        expect(report.detailIndex[unclassifiedRow.detailKey!].map(item => ({ sourceId: item.transactionId ? item.transactionId : 'a13-opening', contributionMinor: item.contributionMinor })))
          .toEqual(expected.detailGroups['UNCLASSIFIED_CASH_ACTIVITY'].map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
        expect(report.detailIndex[differenceRow.detailKey!].map(item => ({ sourceId: 'a13-opening:reconciliation', contributionMinor: item.contributionMinor })))
          .toEqual(expected.detailGroups['DIFFERENCE'].map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
      }
      const expectedRows = Object.keys(expected.expectedRows)
        .filter(key => key.startsWith('WORKING_CAPITAL:') || key.startsWith('NONCASH:') || key.startsWith('INVESTING:') || key.startsWith('FINANCING:'))
        .map(key => {
          const sectionKey = key.slice(0, key.indexOf(':'));
          const accountId = key.slice(key.indexOf(':') + 1);
          const isNoncash = key.startsWith('NONCASH:');
          const isInvesting = sectionKey === 'INVESTING';
          const isFinancing = sectionKey === 'FINANCING';
          const isLiability = accountId === 'copper-card' || accountId === 'accounts-payable';
          const treatment = isNoncash ? 'NONCASH_PNL_ADJUSTMENT' as const : isInvesting ? 'INVESTING' as const : isFinancing ? 'FINANCING' as const : isLiability ? 'OPERATING_LIABILITY' as const : 'OPERATING_ASSET' as const;
          return {
            accountRole: accountId === 'copper-card' ? 'FINANCIAL_SOURCE' as const : 'CHART' as const,
            accountId,
            treatment,
            section: isInvesting ? 'INVESTING' as const : isFinancing ? 'FINANCING' as const : 'OPERATING' as const,
            amountMinor: BigInt(expected.expectedRows[key]),
            detail: (expected.detailGroups[key] ?? []).map(item => ({
              sourceId: item.sourceId,
              contributionType: isNoncash ? 'NONCASH_REVERSAL' as const : isInvesting || isFinancing ? 'CASH_TRANSACTION' as const : 'BALANCE_CHANGE' as const,
              contributionMinor: BigInt(item.amountMinor),
            })),
          };
        });
      const expectedKeys = expectedRows.map(row => `${row.accountRole}:${row.accountId}:${row.treatment}`).sort();
      const actualRows = report.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY' || row.rowType === 'ADJUSTMENT');
      const actualExpectedRows = actualRows.filter(row => row.treatment === 'OPERATING_ASSET' || row.treatment === 'OPERATING_LIABILITY' || row.treatment === 'NONCASH_PNL_ADJUSTMENT' || row.treatment === 'INVESTING' || row.treatment === 'FINANCING');
      expect(actualExpectedRows.map(row => `${row.accountRole}:${row.accountId}:${row.treatment}`).sort()).toEqual(expectedKeys);
      for (const expectedRow of expectedRows) {
        const actualRow = actualExpectedRows.find(row => row.accountRole === expectedRow.accountRole && row.accountId === expectedRow.accountId && row.treatment === expectedRow.treatment)!;
        expect(actualRow.amountMinor).toBe(expectedRow.amountMinor);
        expect(actualRow.rowId).toBe(`ACCOUNT:${expectedRow.section}:${expectedRow.accountRole}:${encodeURIComponent(expectedRow.accountId)}`);
        expect(report.detailIndex[actualRow.detailKey!].map(item => ({
          sourceId: oracleSourceId(item, expectedRow.treatment === 'NONCASH_PNL_ADJUSTMENT' ? 'NONCASH' : expectedRow.section === 'OPERATING' ? 'BALANCE' : 'CASH'),
          contributionType: item.contributionType,
          contributionMinor: item.contributionMinor,
        }))).toEqual(expectedRow.detail);
      }
      for (const [rowKey, expectedAmount] of id === 'A10' || id === 'A12' || id === 'A13' || id === 'A14'
        ? Object.entries(expected.expectedRows).filter(([key]) => ['RESTRICTED_CASH_ENDING', 'UNCLASSIFIED_CASH_ACTIVITY', 'DIFFERENCE'].includes(key))
        : []) {
        const row = rowKey === 'RESTRICTED_CASH_ENDING'
          ? report.rows.find(candidate => candidate.rowId.startsWith('SYNTHETIC:RESTRICTED_CASH_ENDING'))
          : rowKey === 'UNCLASSIFIED_CASH_ACTIVITY'
            ? report.rows.find(candidate => candidate.rowId.startsWith('SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY'))
            : report.rows.find(candidate => candidate.rowId.startsWith('SYNTHETIC:DIFFERENCE'));
        expect(row?.amountMinor).toBe(BigInt(expectedAmount));
        const expectedDetail = (expected.detailGroups[rowKey] ?? []).map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) }));
        const actualDetail = (row?.detailKey ? report.detailIndex[row.detailKey] ?? [] : []).map(item => ({
          sourceId: rowKey === 'RESTRICTED_CASH_ENDING'
            ? `${item.accountId}:end`
            : rowKey === 'DIFFERENCE'
              ? (id === 'A13' ? 'a13-opening:reconciliation' : id === 'A14' ? 'a14-unclassified:reconciliation' : `${item.transferId}:reconciliation`)
              : (id === 'A13' ? 'a13-opening' : item.transferId ?? item.transactionId ?? ''),
          contributionMinor: item.contributionMinor,
        }));
        expect(actualDetail).toEqual(expectedDetail);
      }
      if (expected.diagnosticContributions) {
        const diagnostics = Object.values(report.detailIndex).flatMap(items => items)
          .filter(item => item.contributionType === 'TRANSFER' && item.transferId)
          .map(item => ({ sourceId: item.transferId!, amountMinor: Number(item.contributionMinor) }));
        expect(diagnostics).toEqual(expected.diagnosticContributions);
      }
      const expectedOperatingDetail = expected.detailGroups['NET_OPERATING'] ?? [];
      const actualNetProfitAmount = sumDetail(report, netProfitRow.detailKey);
      const actualChildAmount = (sourceId: string): bigint => {
        const accountId = sourceId.includes(':') ? sourceId.slice(sourceId.indexOf(':') + 1) : '';
        const row = actualExpectedRows.find(candidate => candidate.accountId === accountId);
        return row ? sumDetail(report, row.detailKey) : 0n;
      };
      expect(expectedOperatingDetail.map(item => ({
        sourceId: item.sourceId,
        contributionMinor: item.sourceId === 'NET_PROFIT' ? actualNetProfitAmount : actualChildAmount(item.sourceId),
      }))).toEqual(expectedOperatingDetail.map(item => ({ sourceId: item.sourceId, contributionMinor: BigInt(item.amountMinor) })));
      expect(report.reportId).toBe(repeat.reportId);
      expect(report.rows.map(row => row.rowId)).toEqual(repeat.rows.map(row => row.rowId));
      expect(Object.keys(report.detailIndex).sort()).toEqual(Object.keys(repeat.detailIndex).sort());
      expect(new Set(report.rows.map(row => row.rowId)).size).toBe(report.rows.length);
      const rowById = new Map(report.rows.map(row => [row.rowId, row]));
      report.rows.filter(row => row.section === 'OPERATING' || row.section === 'INVESTING' || row.section === 'FINANCING').forEach(row => {
        if (row.amountMinor !== undefined && row.detailKey) expect(sumDetail(report, row.detailKey)).toBe(row.amountMinor);
        const seen = new Set<string>();
        let parent = row.parentRowId;
        while (parent) {
          expect(seen.has(parent)).toBeFalse();
          seen.add(parent);
          parent = rowById.get(parent)?.parentRowId;
        }
      });
      if (expected.checkpoints?.length) {
        const checkpoint = service.getCashFlowReport({ startDate: expected.period.startDate, endDate: expected.checkpoints[0].endDate, includeZeroRows: true });
        const checkpointAccounts = checkpoint.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY');
        expect(checkpoint.rows.find(row => row.rowType === 'NET_PROFIT')?.amountMinor).toBe(BigInt(expected.checkpoints[0].netProfitMinor));
        expect(amount(checkpointAccounts.filter(row => row.treatment === 'OPERATING_ASSET'))).toBe(BigInt(expected.checkpoints[0].operatingAssetAdjustmentsMinor ?? 0));
        expect(amount(checkpointAccounts.filter(row => row.treatment === 'OPERATING_LIABILITY'))).toBe(BigInt(expected.checkpoints[0].operatingLiabilityAdjustmentsMinor ?? 0));
        expect(checkpoint.netOperatingMinor).toBe(BigInt(expected.checkpoints[0].netOperatingMinor));
        expect(checkpoint.endingCashMinor).toBe(BigInt(expected.checkpoints[0].endingCashMinor));
      }
    }
    expect(productionCsvParityScenarioCount).toBe(caseIds.length);
  });

  it('includes only confirmed matched transfers and keeps archived participating accounts visible', () => {
    addAccount('archived-cash', 'Archived Checking', 100n, '2025-01-01', 'CASH', true);
    addTransaction('matched-left', 'archived-cash', '2026-02-01', 50n, 'MATCHED_TRANSFER', 'transfer-1');
    addTransaction('unconfirmed-match', 'archived-cash', '2026-02-02', 900n, 'MATCHED_TRANSFER', 'missing-transfer');
    repository.transfers.set('transfer-1', {
      id: 'transfer-1', leftTransactionId: 'matched-left', rightTransactionId: 'matched-right', confidence: 1,
      rationale: 'Confirmed transfer.', confirmedAtUtc: '2026-02-01T00:00:00.000Z',
    });

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false });

    expect(report.beginningCashMinor).toBe(100n);
    expect(report.endingCashMinor).toBe(150n);
    expect(report.netChangeInCashMinor).toBe(0n);
    expect(report.calculatedEndingCashMinor).toBe(100n);
    expect(report.differenceMinor).toBe(-50n);
    expect(report.unclassifiedCashActivityMinor).toBe(950n);
    const difference = report.rows.find(row => row.rowId.startsWith('SYNTHETIC:DIFFERENCE'))!;
    expect(report.detailIndex[difference.detailKey!].some(item => item.transactionId === 'unconfirmed-match'))
      .toBeFalse();
    expect(report.detailIndex[difference.detailKey!].map(item => [item.transactionId, item.contributionMinor]))
      .toEqual([['matched-left', -50n]]);
    expect(sumDetail(report, difference.detailKey)).toBe(-50n);
    expect(report.warnings.map(warning => warning.code)).toContain('ARCHIVED_PARTICIPATING_ACCOUNT');
    expect(report.warnings.map(warning => warning.code)).toContain('UNCLASSIFIED_CASH_ACTIVITY');
    expect(report.warnings.map(warning => warning.code)).toContain('CASH_RECONCILIATION_DIFFERENCE');
  });

  it('does not warn for zero-balance unresolved or archived accounts', () => {
    addAccount('zero-unresolved', 'Zero Unresolved', 0n, '2026-01-01', 'REVIEW_REQUIRED');
    addAccount('zero-archived', 'Zero Archived', 0n, '2026-01-01', 'CASH', true);
    markReviewRequired('zero-unresolved');

    const report = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false });
    const warningAccounts = report.warnings
      .filter(warning => warning.code === 'CASH_ROLE_REVIEW_REQUIRED' || warning.code === 'ARCHIVED_PARTICIPATING_ACCOUNT')
      .map(warning => warning.accountId);

    expect(warningAccounts).not.toContain('zero-unresolved');
    expect(warningAccounts).not.toContain('zero-archived');
  });

  it('rejects invalid dates and unsupported currencies without reading mutable report state', () => {
    expect(() => service.getCashFlowReport({ startDate: '2026-02-30', endDate: '2026-03-01' })).toThrowError(CashFlowContractError);
    repository.company = { ...repository.company, currency: 'EUR' as 'USD' };
    expect(() => service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31' })).toThrowError(CashFlowContractError);
    try {
      service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31' });
    } catch (error) {
      expect((error as CashFlowContractError).code).toBe('UNSUPPORTED_CURRENCY');
    }
  });

  function prepareProductionFixture(company: 'COPPER' | 'NORTHWIND'): void {
    repository.company = {
      id: company === 'COPPER' ? 'company-copper-kettle' : 'company-northwind-repair',
      name: company === 'COPPER' ? 'Copper Kettle Studio LLC' : 'Northwind Repair Cooperative',
      currency: 'USD', fiscalYearStartMonth: company === 'COPPER' ? 1 : 7, accountingBasis: repository.company.accountingBasis, activeTaxYear: 2026,
    };
    repository.accounts.clear();
    repository.chartAccounts.clear();
    repository.transactions.clear();
    repository.transfers.clear();
    repository.cashFlowClassifications.clear();
    repository.audit.length = 0;
  }

  function addProductionFixtureScenario(id: string): void {
    const copper = !['A12', 'A13', 'A14', 'A15', 'A16', 'A17'].includes(id);
    const cashId = copper ? 'copper-cash-a' : 'northwind-cash-a';
    const opening = ({ A1: 0n, A2: 10_000n, A3: 20_000n, A4: 0n, A5: 30_000n, A6: 60_000n, A7: 10_000n, A8: 20_000n, A9: 10_000n, A10: 80_000n, A11: 10_000n, A12: 50_000n, A13: 25_000n, A14: 10_000n, A15: 10_000n, A16: 50_000n, A17: 0n } as Record<string, bigint>)[id];
    const openingDate = id === 'A13' ? '2026-02-10' : id === 'A16' ? '2025-06-01' : '2025-12-01';
    addAccount(cashId, copper ? 'Daily funds' : 'Workshop till', opening, openingDate, 'CASH');
    if (id === 'A10') addAccount('copper-cash-b', 'Reserve funds', 20_000n, openingDate, 'CASH');
    if (id === 'A12') addAccount('northwind-restricted', 'Restricted reserve', 0n, openingDate, 'RESTRICTED_CASH', false, 'ENTITY', 'OTHER_CURRENT_ASSET', 'Other current assets');
    const income = addChartAccount(`${id.toLowerCase()}-income`, 'Operating income', 'INCOME', 'Sales of product income');
    const expense = addChartAccount(`${id.toLowerCase()}-expense`, 'Operating expense', 'EXPENSE', 'Other business expenses');
    addChartClassification(income.id, income.accountType, income.detailType, 'OPERATING_REVENUE_EXPENSE');
    addChartClassification(expense.id, expense.accountType, expense.detailType, 'OPERATING_REVENUE_EXPENSE');
    if (id === 'A1') addTransaction('a1-sale', cashId, '2026-01-05', 10_000n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 10_000n, splitId: 'a1-sale:income' }]);
    if (id === 'A2') addTransaction('a2-expense', cashId, '2026-02-05', -4_000n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -4_000n, splitId: 'a2-expense:expense' }]);
    if (id === 'A3') {
      addAccount('copper-card', 'Studio charge line', 0n, '2025-12-01', 'NOT_CASH', false, 'CREDIT_CARD');
      updateFinancialTreatment('copper-card', 'OPERATING_LIABILITY', 'NOT_CASH');
      addTransaction('a3-card-charge', 'copper-card', '2026-03-10', -10_000n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -10_000n, splitId: 'a3-card-charge:expense' }]);
      addTransaction('a3-card-payment', 'copper-card', '2026-03-25', 10_000n, 'MATCHED_TRANSFER', 'a3-transfer');
      addTransaction('a3-cash-payment', cashId, '2026-03-25', -10_000n, 'MATCHED_TRANSFER', 'a3-transfer');
      repository.transfers.set('a3-transfer', { id: 'a3-transfer', leftTransactionId: 'a3-card-payment', rightTransactionId: 'a3-cash-payment', confidence: 1, rationale: 'Fixture card payment.', confirmedAtUtc: '2026-03-25T00:00:00.000Z' });
    }
    if (id === 'A4') {
      const receivable = addChartAccount('receivables', 'Trade receivables', 'ACCOUNTS_RECEIVABLE', 'Accounts receivable');
      addChartClassification(receivable.id, receivable.accountType, receivable.detailType, 'OPERATING_ASSET');
      addTransaction('a4-invoice', cashId, '2026-04-05', 0n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 20_000n, splitId: 'a4-invoice:income' }, { chartAccountId: receivable.id, amountMinor: -20_000n, splitId: 'a4-invoice:receivables' }]);
      addTransaction('a4-collection', cashId, '2026-04-20', 20_000n, 'POSTED', undefined, [{ chartAccountId: receivable.id, amountMinor: 20_000n, splitId: 'a4-collection:receivables' }]);
    }
    if (id === 'A5') {
      const inventory = addChartAccount('inventory', 'Materials on hand', 'OTHER_CURRENT_ASSET', 'Inventory');
      const payable = addChartAccount('accounts-payable', 'Supplier balances', 'ACCOUNTS_PAYABLE', 'Accounts payable');
      addChartClassification(inventory.id, inventory.accountType, inventory.detailType, 'OPERATING_ASSET');
      addChartClassification(payable.id, payable.accountType, payable.detailType, 'OPERATING_LIABILITY');
      addTransaction('a5-inventory-credit', cashId, '2026-05-05', 0n, 'POSTED', undefined, [{ chartAccountId: inventory.id, amountMinor: -12_000n, splitId: 'a5-inventory-credit:inventory' }, { chartAccountId: payable.id, amountMinor: 12_000n, splitId: 'a5-inventory-credit:accounts-payable' }]);
      addTransaction('a5-supplier-payment', cashId, '2026-05-20', -7_000n, 'POSTED', undefined, [{ chartAccountId: payable.id, amountMinor: -7_000n, splitId: 'a5-supplier-payment:accounts-payable' }]);
    }
    if (id === 'A7') {
      const depreciation = addChartAccount('depreciation', 'Depreciation', 'OTHER_EXPENSE', 'Depreciation');
      addChartClassification(depreciation.id, depreciation.accountType, depreciation.detailType, 'NONCASH_PNL_ADJUSTMENT');
      addTransaction('a7-depreciation', cashId, '2026-07-05', 0n, 'POSTED', undefined, [{ chartAccountId: depreciation.id, amountMinor: -6_000n, splitId: 'a7-depreciation:pnl' }]);
    }
    if (id === 'A6') {
      const fixedAssets = addChartAccount('fixed-assets', 'Production equipment', 'FIXED_ASSET', 'Machinery and equipment');
      addChartClassification(fixedAssets.id, fixedAssets.accountType, fixedAssets.detailType, 'INVESTING');
      addTransaction('a6-equipment', cashId, '2026-06-10', -50_000n, 'POSTED', undefined, [{ chartAccountId: fixedAssets.id, amountMinor: -50_000n, splitId: 'a6-equipment:cash' }]);
    }
    if (id === 'A8') {
      const proceeds = addChartAccount('loan-proceeds', 'Loan proceeds', 'LONG_TERM_LIABILITY', 'Notes payable');
      const principal = addChartAccount('loan-principal', 'Loan principal', 'LONG_TERM_LIABILITY', 'Notes payable');
      addChartClassification(proceeds.id, proceeds.accountType, proceeds.detailType, 'FINANCING');
      addChartClassification(principal.id, principal.accountType, principal.detailType, 'FINANCING');
      addTransaction('a8-loan-proceeds', cashId, '2026-08-05', 100_000n, 'POSTED', undefined, [{ chartAccountId: proceeds.id, amountMinor: 100_000n, splitId: 'a8-loan-proceeds:cash' }]);
      addTransaction('a8-loan-payment', cashId, '2026-08-20', -11_000n, 'POSTED', undefined, [
        { chartAccountId: principal.id, amountMinor: -10_000n, splitId: 'a8-principal:cash' },
        { chartAccountId: expense.id, amountMinor: -1_000n, splitId: 'a8-interest:pnl' },
      ]);
    }
    if (id === 'A9') {
      const contribution = addChartAccount('owner-contribution', 'Member capital contribution', 'EQUITY', 'Owner equity');
      const draw = addChartAccount('owner-draw', 'Member distribution', 'EQUITY', 'Owner draw');
      addChartClassification(contribution.id, contribution.accountType, contribution.detailType, 'FINANCING');
      addChartClassification(draw.id, draw.accountType, draw.detailType, 'FINANCING');
      addTransaction('a9-contribution', cashId, '2026-09-05', 60_000n, 'POSTED', undefined, [{ chartAccountId: contribution.id, amountMinor: 60_000n, splitId: 'a9-contribution:cash' }]);
      addTransaction('a9-draw', cashId, '2026-09-20', -15_000n, 'POSTED', undefined, [{ chartAccountId: draw.id, amountMinor: -15_000n, splitId: 'a9-draw:cash' }]);
    }
    if (id === 'A11') {
      const debt = addAccount('a11-debt', 'Long term debt', 0n, '2025-12-01', 'NOT_CASH', false, 'BANK', 'LONG_TERM_LIABILITY', 'Notes payable');
      updateFinancialTreatment(debt.id, 'FINANCING', 'NOT_CASH');
      const asset = addChartAccount('a11-fixed-asset', 'Equipment acquired', 'FIXED_ASSET', 'Machinery and equipment');
      addChartClassification(asset.id, asset.accountType, asset.detailType, 'INVESTING');
      addTransaction('a11-noncash-acquisition', debt.id, '2026-11-15', -50_000n, 'POSTED', undefined, [
        { chartAccountId: asset.id, amountMinor: -50_000n, splitId: 'a11-noncash-acquisition:asset' },
      ], false);
    }
    if (id === 'A10') {
      addTransaction('a10-transfer:from', cashId, '2026-10-15', -30_000n, 'MATCHED_TRANSFER', 'a10-transfer', [], false);
      addTransaction('a10-transfer:to', 'copper-cash-b', '2026-10-15', 30_000n, 'MATCHED_TRANSFER', 'a10-transfer', [], false);
      repository.transfers.set('a10-transfer', { id: 'a10-transfer', leftTransactionId: 'a10-transfer:from', rightTransactionId: 'a10-transfer:to', confidence: 1, rationale: 'Fixture cash transfer.', confirmedAtUtc: '2026-10-15T00:00:00.000Z' });
    }
    if (id === 'A12') {
      addTransaction('a12-restricted-transfer:cash', cashId, '2026-01-15', -20_000n, 'MATCHED_TRANSFER', 'a12-restricted-transfer', [], false);
      addTransaction('a12-restricted-transfer:restricted', 'northwind-restricted', '2026-01-15', 20_000n, 'MATCHED_TRANSFER', 'a12-restricted-transfer', [], false);
      repository.transfers.set('a12-restricted-transfer', { id: 'a12-restricted-transfer', leftTransactionId: 'a12-restricted-transfer:cash', rightTransactionId: 'a12-restricted-transfer:restricted', confidence: 1, rationale: 'Fixture restricted cash transfer.', confirmedAtUtc: '2026-01-15T00:00:00.000Z' });
    }
    if (id === 'A14') {
      const unresolved = addChartAccount('a14-unresolved', 'Unresolved activity', 'OTHER_CURRENT_ASSET', 'Other current assets');
      addChartClassification(unresolved.id, unresolved.accountType, unresolved.detailType, 'REVIEW_REQUIRED');
      const classification = repository.cashFlowClassifications.get(`CHART:${unresolved.id}`)!;
      repository.cashFlowClassifications.set(`CHART:${unresolved.id}`, { ...classification, status: 'REVIEW_REQUIRED' });
      addTransaction('a14-unclassified', cashId, '2026-03-15', -3_000n, 'POSTED', undefined, [{ chartAccountId: unresolved.id, amountMinor: -3_000n, splitId: 'a14-unclassified:activity' }], false);
    }
    if (id === 'A15') {
      addTransaction('a15-pending', cashId, '2026-04-05', 5_000n, 'PENDING');
      addTransaction('a15-excluded', cashId, '2026-04-06', -2_000n, 'EXCLUDED');
      addTransaction('a15-undone', cashId, '2026-04-07', 3_000n, 'PENDING');
    }
    if (id === 'A16') {
      addTransaction('a16-income', cashId, '2025-09-15', 25_000n, 'POSTED', undefined, [{ chartAccountId: income.id, amountMinor: 25_000n, splitId: 'a16-income:pnl' }]);
      addTransaction('a16-expense', cashId, '2026-05-20', -10_000n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -10_000n, splitId: 'a16-expense:pnl' }]);
    }
  }

  function updateFinancialTreatment(accountId: string, treatment: CashFlowClassification['treatment'], cashRole: CashFlowClassification['cashRole']): void {
    const key = `FINANCIAL_SOURCE:${accountId}`;
    const classification = repository.cashFlowClassifications.get(key)!;
    repository.cashFlowClassifications.set(key, { ...classification, treatment, cashRole });
  }

  function addAccount(
    id: string,
    name: string,
    opening: bigint,
    openingDate: string,
    cashRole: CashFlowClassification['cashRole'],
    archived = false,
    accountType: 'BANK' | 'CREDIT_CARD' | 'ENTITY' = 'BANK',
    taxonomyType: FinancialAccount['accountType'] = accountType === 'CREDIT_CARD' ? 'CREDIT_CARD' : accountType === 'ENTITY' ? 'OTHER_CURRENT_ASSET' : 'BANK',
    detailType = accountType === 'CREDIT_CARD' ? 'Credit Card' : taxonomyType === 'ACCOUNTS_RECEIVABLE' ? 'Accounts receivable' : taxonomyType === 'OTHER_CURRENT_ASSET' ? 'Other current assets' : 'Checking',
    parentAccountId?: string,
  ): FinancialAccount {
    const account: FinancialAccount = {
      id, type: accountType, accountType: taxonomyType, classificationStatus: 'CONFIRMED', importEnabled: true,
      supportedSourceKinds: ['CSV'], openingBalanceSource: 'DERIVED_EQUITY', detailType, name,
      institutionOrEntity: 'Example Bank', openingBalance: money(opening), openingBalanceDate: openingDate,
      parentAccountId, archived, locked: false,
    };
    repository.accounts.set(id, account);
    const classification: CashFlowClassificationRecord = {
      accountRole: 'FINANCIAL_SOURCE', accountId: id, accountType: taxonomyType, detailType, cashRole,
      treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'USER', rationale: 'Explicit test cash role.',
      modifiedAtUtc: '2026-01-01T00:00:00.000Z',
    };
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${id}`, classification);
    return account;
  }

  function addTransaction(
    id: string,
    accountId: string,
    postingDate: string,
    amount: bigint,
    state: Transaction['state'],
    transferMatchId?: string,
    splitInputs: readonly { chartAccountId: string; amountMinor: bigint; memo?: string; splitId?: string }[] = [],
    balanceFixture = true,
  ): void {
    const fixtureSplits = splitInputs.slice();
    let fixtureBalanceMinor: bigint | undefined;
    if (balanceFixture && state === 'POSTED') {
      const splitTotal = fixtureSplits.reduce((total, split) => total + split.amountMinor, 0n);
      if (splitTotal !== amount) {
        fixtureBalanceMinor = amount - splitTotal;
        fixtureSplits.push({
          chartAccountId: ensureFixtureBalancingAccount().id,
          amountMinor: fixtureBalanceMinor,
          splitId: `${id}:fixture-balance`,
        });
      }
    }
    repository.transactions.set(id, {
      id, accountId, postingDate, amount: money(amount), rawDescription: id, description: id, state,
      splits: fixtureSplits.map(split => ({ id: split.splitId ?? `${id}:${split.chartAccountId}`, chartAccountId: split.chartAccountId, amount: money(split.amountMinor), memo: split.memo })),
      categorizationSource: state === 'MATCHED_TRANSFER' ? 'TRANSFER' : 'MANUAL', transferMatchId,
      createdAtUtc: `${postingDate}T00:00:00.000Z`, modifiedAtUtc: `${postingDate}T00:00:00.000Z`,
    });
    if (fixtureBalanceMinor !== undefined && fixtureBalanceMinor !== 0n) {
      addFixtureEquityOffset(id, postingDate, fixtureBalanceMinor);
    }
  }

  function ensureFixtureBalancingAccount(): ChartAccount {
    const id = '__fixture-balancing-equity__';
    const existing = repository.chartAccounts.get(id);
    if (existing) return existing;
    // Keep the fixture-balancing split outside P/L and Balance Sheet while
    // still giving it a valid Chart classification. This account exists only
    // to make intentionally synthetic split totals reconcile in fixture rows.
    const account = addChartAccount(id, 'Fixture balancing account', 'OTHER_EXPENSE', 'Other expense', { displayOrder: 999_999 });
    account.type = 'ASSET';
    addChartClassification(account.id, account.accountType, account.detailType, 'OPERATING_REVENUE_EXPENSE');
    return account;
  }

  function addFixtureEquityOffset(transactionId: string, postingDate: string, amountMinor: bigint): void {
    const accountId = '__fixture-balancing-equity-offset__';
    let account = repository.chartAccounts.get(accountId);
    if (!account) {
      account = addChartAccount(accountId, 'Fixture balancing equity offset', 'EQUITY', 'Owner equity', { displayOrder: 999_998 });
      addChartClassification(account.id, account.accountType, account.detailType, 'EXCLUDED');
    }
    const id = `${transactionId}:fixture-equity-offset`;
    repository.transactions.set(id, {
      id,
      accountId: '__fixture-journal__',
      postingDate,
      amount: money(0n),
      rawDescription: id,
      description: 'Fixture balancing equity offset',
      state: 'POSTED',
      splits: [{ id: `${id}:split`, chartAccountId: account.id, amount: money(amountMinor) }],
      categorizationSource: 'MANUAL',
      createdAtUtc: `${postingDate}T00:00:00.000Z`,
      modifiedAtUtc: `${postingDate}T00:00:00.000Z`,
    });
  }

  function addChartAccount(
    id: string,
    name: string,
    accountType: ChartAccount['accountType'],
    detailType: string,
    options: Partial<Pick<ChartAccount, 'parentId' | 'archived' | 'displayOrder'>> = {},
  ): ChartAccount {
    const reportingType: ChartAccount['type'] = ['INCOME', 'OTHER_INCOME', 'COGS', 'EXPENSE', 'OTHER_EXPENSE'].includes(accountType) ? accountType as ChartAccount['type'] : accountType === 'EQUITY' ? 'EQUITY' : accountType === 'CREDIT_CARD' || accountType === 'ACCOUNTS_PAYABLE' || accountType === 'OTHER_CURRENT_LIABILITY' || accountType === 'LONG_TERM_LIABILITY' ? 'LIABILITY' : 'ASSET';
    const account: ChartAccount = { id, name, type: reportingType, accountType, detailType, displayOrder: options.displayOrder ?? repository.chartAccounts.size + 1, archived: options.archived ?? false, locked: false, parentId: options.parentId };
    repository.chartAccounts.set(id, account);
    return account;
  }

  function addChartClassification(accountId: string, accountType: string, detailType: string, treatment: CashFlowClassification['treatment']): void {
    repository.cashFlowClassifications.set(`CHART:${accountId}`, {
      accountRole: 'CHART', accountId, accountType, detailType, treatment, status: 'CONFIRMED', source: 'USER', rationale: 'Explicit test classification.',
    });
  }

  function sumDetail(report: ReturnType<CashFlowReportService['getCashFlowReport']>, detailKey: string | undefined): bigint {
    return detailKey ? (report.detailIndex[detailKey] ?? []).reduce((sum, contribution) => sum + contribution.contributionMinor, 0n) : 0n;
  }

  function markReviewRequired(accountId: string): void {
    const key = `FINANCIAL_SOURCE:${accountId}`;
    const classification = repository.cashFlowClassifications.get(key);
    if (!classification) throw new Error(`Missing classification for ${accountId}`);
    repository.cashFlowClassifications.set(key, { ...classification, status: 'REVIEW_REQUIRED' });
  }

  it('meets release performance targets for a 10,000-transaction immutable report, cached read, and 2,000-plus contribution detail', () => {
    const cash = addAccount('release-scale-cash', 'Release scale cash', 0n, '2025-12-31', 'CASH');
    const expense = addChartAccount('release-scale-expense', 'Release scale expense', 'EXPENSE', 'Office expenses');
    addChartClassification(expense.id, expense.accountType, expense.detailType, 'OPERATING_REVENUE_EXPENSE');
    for (let index = 0; index < 10_000; index += 1) {
      addTransaction(`release-scale-${index}`, cash.id, '2026-06-15', -1n, 'POSTED', undefined, [{ chartAccountId: expense.id, amountMinor: -1n, splitId: `release-scale-${index}:expense` }], false);
    }
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
    const revisionBefore = repository.getDatabaseRevision();
    const started = performance.now();
    const report = service.getCashFlowReport(query);
    const reportMs = performance.now() - started;
    const cachedStarted = performance.now();
    const cached = service.getCashFlowReport({ ...query });
    const cachedMs = performance.now() - cachedStarted;
    const accountRow = report.rows.find(row => row.detailKey && (report.detailIndex[row.detailKey] ?? []).length >= 2_000)!;
    const detailStarted = performance.now();
    const detail = service.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: accountRow.detailKey! });
    const detailMs = performance.now() - detailStarted;

    console.info(`Cash Flow release performance: full=${reportMs.toFixed(2)}ms cached=${cachedMs.toFixed(2)}ms detail=${detailMs.toFixed(2)}ms transactions=10000 contributions=${detail.contributions.length}`);

    expect(reportMs).toBeLessThan(750);
    expect(cachedMs).toBeLessThan(100);
    expect(detailMs).toBeLessThan(300);
    expect(cached).toBe(report);
    expect(detail.contributions.length).toBeGreaterThanOrEqual(2_000);
    expect(detail.contributions.reduce((sum, contribution) => sum + contribution.contributionMinor, 0n)).toBe(accountRow.amountMinor!);
    expect(repository.getDatabaseRevision()).toBe(revisionBefore);
  });

  it('orders participating classifications with locale-independent normalized paths and role/id tie-breakers', () => {
    const cash = addAccount('cash', 'Primary funds', 0n, '2025-12-01', 'CASH');
    const decomposed = addChartAccount('z-account', 'E\u0301clair', 'EXPENSE', 'Office expenses');
    const composed = addChartAccount('a-account', 'Éclair', 'EXPENSE', 'Office expenses');
    const turkish = addChartAccount('m-account', 'İnvoice', 'EXPENSE', 'Office expenses');
    const unrelated = addChartAccount('unrelated', 'Unrelated inactive account', 'EXPENSE', 'Office expenses');
    [decomposed, composed, turkish].forEach(account => addChartClassification(account.id, account.accountType, account.detailType, 'OPERATING_REVENUE_EXPENSE'));
    addChartClassification(unrelated.id, unrelated.accountType, unrelated.detailType, 'OPERATING_REVENUE_EXPENSE');
    addTransaction('classification-z', cash.id, '2026-01-03', -1n, 'POSTED', undefined, [{ chartAccountId: decomposed.id, amountMinor: -1n }]);
    addTransaction('classification-a', cash.id, '2026-01-02', -1n, 'POSTED', undefined, [{ chartAccountId: composed.id, amountMinor: -1n }]);
    addTransaction('classification-m', cash.id, '2026-01-01', -1n, 'POSTED', undefined, [{ chartAccountId: turkish.id, amountMinor: -1n }]);
    const first = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    const firstOrder = first.classifications.map(classification => `${classification.accountRole}:${classification.accountId}`);
    const transactions = [...repository.transactions.entries()].reverse();
    repository.transactions.clear();
    transactions.forEach(([id, transaction]) => repository.transactions.set(id, transaction));
    const accounts = [...repository.chartAccounts.entries()].reverse();
    repository.chartAccounts.clear();
    accounts.forEach(([id, account]) => repository.chartAccounts.set(id, account));
    const second = service.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-01-31', includeZeroRows: true });
    expect(second.classifications.map(classification => `${classification.accountRole}:${classification.accountId}`)).toEqual(firstOrder);
    expect(firstOrder).toEqual(['CHART:a-account', 'CHART:z-account', 'CHART:m-account', `FINANCIAL_SOURCE:${cash.id}`]);
    expect(firstOrder).not.toContain('CHART:unrelated');
  });
});

let productionCsvParityScenarioCount = 0;

/**
 * Production acceptance guard: parse the actual CSV emitted for every oracle
 * scenario and compare its complete screen-order payload with the immutable
 * report used to generate it. The fixture gate executes this spec, so a
 * disabled or stale CSV assertion cannot leave the production gate green.
 */
function assertProductionCsvParity(report: CashFlowReport): void {
  productionCsvParityScenarioCount += 1;
  expect(report.rows.filter(row => row.accountRole === 'FINANCIAL_SOURCE' && row.accountId).every(row => row.cashRole !== undefined)).toBeTrue();
  const parsed = Papa.parse<string[]>(cashFlowCsv(report), { header: false, skipEmptyLines: false });
  expect(parsed.errors).toEqual([]);
  const rows = parsed.data;
  expect(rows[0][0].replace(/^\uFEFF/, '')).toBe('Report');
  expect(rows.slice(0, 14)).toEqual([
    ['Report', 'Statement of Cash Flows'],
    ['Company legal name', report.company.legalName],
    ['Company display name', report.company.displayName],
    ['Report title', 'Statement of Cash Flows'],
    ['Start date', report.query.startDate],
    ['End date', report.query.endDate],
    ['Method', report.method],
    ['Basis', report.accountingBasis],
    ['Currency', report.currencyCode],
    ['Report ID', report.reportId],
    ['Database revision', report.databaseRevision],
    ['Generated at', report.generatedAt],
    ['Status', report.status],
    ['Disclaimer', `Prepared from recorded transactions and account classifications for ${report.query.startDate} through ${report.query.endDate}. Supplemental noncash disclosures do not affect cash totals.`],
  ]);
  const rowHeaderIndex = 15;
  expect(rows[rowHeaderIndex]).toEqual(['Row ID', 'Row type', 'Section', 'Treatment', 'Label', 'Full path', 'Depth', 'Amount minor', 'Amount', 'Account role', 'Account ID', 'Cash role', 'Archived', 'Review required', 'Detail key', 'Warning code', 'Warning message', 'Warning references']);
  const csvRows = rows.slice(rowHeaderIndex + 1, rowHeaderIndex + 1 + report.rows.length);
  expect(csvRows).toEqual(report.rows.map(row => [
    row.rowId, row.rowType, row.section, row.treatment ?? '', row.label, row.fullPath ?? '', String(row.depth),
    row.amountMinor === undefined ? '' : row.amountMinor.toString(), row.amountMinor === undefined ? '' : decimalForCsv(row.amountMinor),
    row.accountRole ?? '', row.accountId ?? '', row.cashRole ?? '', String(row.archived), String(row.reviewRequired), row.detailKey ?? '', '', '', '',
  ]));

  const warningsMarker = rowHeaderIndex + 1 + report.rows.length + 1;
  expect(rows[warningsMarker]).toEqual(['Warnings']);
  const warningHeader = warningsMarker + 1;
  expect(rows[warningHeader]).toEqual(['Warning ID', 'Code', 'Message', 'Account role', 'Account ID', 'Business date', 'Detail key', 'References']);
  expect(rows.slice(warningHeader + 1, warningHeader + 1 + report.warnings.length)).toEqual(report.warnings.map(warning => [
    warning.warningId, warning.code, warning.message, warning.accountRole ?? '', warning.accountId ?? '', warning.businessDate ?? '', warning.detailKey ?? '', (warning.references ?? []).slice().sort().join(';'),
  ]));

  const reconciliationMarker = warningHeader + 1 + report.warnings.length + 1;
  expect(rows[reconciliationMarker]).toEqual(['Reconciliation']);
  const reconciliationHeader = reconciliationMarker + 1;
  expect(rows[reconciliationHeader]).toEqual(['Metric', 'Amount minor', 'Amount']);
  const metrics: readonly [string, bigint][] = [
    ['Net Operating', report.netOperatingMinor], ['Net Investing', report.netInvestingMinor], ['Net Financing', report.netFinancingMinor],
    ['Net Change in Cash', report.netChangeInCashMinor], ['Beginning Cash', report.beginningCashMinor], ['Calculated Ending Cash', report.calculatedEndingCashMinor],
    ['Ending Cash', report.endingCashMinor], ['Restricted Cash Beginning', report.restrictedCashBeginningMinor], ['Restricted Cash Ending', report.restrictedCashEndingMinor],
    ['Unclassified Cash Activity', report.unclassifiedCashActivityMinor], ['Difference', report.differenceMinor],
  ];
  expect(rows.slice(reconciliationHeader + 1, reconciliationHeader + 1 + metrics.length)).toEqual(metrics.map(([label, amount]) => [label, amount.toString(), decimalForCsv(amount)]));

  const disclosureMarker = reconciliationHeader + 1 + metrics.length + 1;
  expect(rows[disclosureMarker]).toEqual(['Noncash disclosures']);
  const disclosureHeader = disclosureMarker + 1;
  expect(rows[disclosureHeader]).toEqual(['Disclosure ID', 'Section', 'Label', 'Amount minor', 'Amount', 'Detail key', 'Account role', 'Account ID', 'Chart account ID', 'Transaction ID', 'Transfer ID', 'Rationale']);
  expect(rows.slice(disclosureHeader + 1, disclosureHeader + 1 + (report.disclosures ?? []).length)).toEqual((report.disclosures ?? []).map(disclosure => [
    disclosure.disclosureId, disclosure.section, disclosure.label, disclosure.amountMinor === undefined ? '' : disclosure.amountMinor.toString(),
    disclosure.amountMinor === undefined ? '' : decimalForCsv(disclosure.amountMinor), disclosure.detailKey ?? '', disclosure.accountRole ?? '', disclosure.accountId ?? '',
    disclosure.chartAccountId ?? '', disclosure.transactionId ?? '', disclosure.transferId ?? '', disclosure.rationale,
  ]));
}

/** Production print/PDF acceptance guard.  It projects the actual immutable
 * report used by the canonical oracle test and mechanically verifies all
 * print metadata, warning provenance, reconciliation metrics and repeating
 * table context before Electron renders the same HTML to PDF. */
function assertProductionPrintParity(report: CashFlowReport): void {
  const model = cashFlowPrintModel(report);
  expect(model.reportId).toBe(report.reportId);
  expect(model.databaseRevision).toBe(report.databaseRevision);
  expect(model.generatedAt).toBe(report.generatedAt);
  expect(model.disclaimer).toBe(`Prepared from recorded transactions and account classifications for ${report.query.startDate} through ${report.query.endDate}. Supplemental noncash disclosures do not affect cash totals.`);
  expect(model.warnings).toEqual(report.warnings);
  expect(model.disclosures).toEqual(report.disclosures ?? []);
  expect(model.reconciliation).toEqual([
    { label: 'Net Cash from Operating Activities', amountMinor: report.netOperatingMinor }, { label: 'Net Cash from Investing Activities', amountMinor: report.netInvestingMinor }, { label: 'Net Cash from Financing Activities', amountMinor: report.netFinancingMinor },
    { label: 'Net Change in Cash', amountMinor: report.netChangeInCashMinor }, { label: 'Beginning Cash', amountMinor: report.beginningCashMinor }, { label: 'Calculated Ending Cash', amountMinor: report.calculatedEndingCashMinor }, { label: 'Ending Cash', amountMinor: report.endingCashMinor },
    { label: 'Restricted Cash Beginning', amountMinor: report.restrictedCashBeginningMinor }, { label: 'Restricted Cash Ending', amountMinor: report.restrictedCashEndingMinor }, { label: 'Unclassified Cash Activity', amountMinor: report.unclassifiedCashActivityMinor }, { label: 'Difference', amountMinor: report.differenceMinor },
  ]);
  const document = new DOMParser().parseFromString(cashFlowPrintHtml(report), 'text/html');
  expect(document.title).toBe(`${report.company.displayName} — Statement of Cash Flows`);
  const tables = Array.from(document.querySelectorAll('table'));
  expect(tables.length).toBeGreaterThan(1);
  expect(tables.every(table => table.querySelectorAll('thead .running-context').length === 1)).toBeTrue();
  report.warnings.forEach(warning => {
    const rendered = document.querySelector(`[data-warning-id="${warning.warningId}"]`)?.textContent ?? '';
    expect(rendered).toContain(warning.warningId);
    expect(rendered).toContain(warning.code);
    expect(rendered).toContain(warning.message);
    if (warning.accountRole) expect(rendered).toContain(warning.accountRole);
    if (warning.accountId) expect(rendered).toContain(warning.accountId);
    if (warning.businessDate) expect(rendered).toContain(warning.businessDate);
    if (warning.detailKey) expect(rendered).toContain(warning.detailKey);
    (warning.references ?? []).forEach(reference => expect(rendered).toContain(reference));
  });
}

function decimalForCsv(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/** Reopen and mechanically compare the production XLSX payload to the same
 * immutable report used by the CSV assertion above. */
function assertProductionXlsxParity(report: CashFlowReport): void {
  const workbook = XLSX.read(cashFlowXlsx(report), { type: 'array', cellStyles: true });
  expect(workbook.SheetNames).toEqual(['Statement of Cash Flows', 'Cash Flow Detail', 'Cash Flow Classifications']);
  const statement = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Statement of Cash Flows'], { header: 1, defval: '', raw: true });
  const metadata = new Map(statement.slice(0, 14).map(row => [String(row[0] ?? ''), String(row[1] ?? '')]));
  expect(metadata.get('Report')).toBe('Statement of Cash Flows');
  expect(metadata.get('Company legal name')).toBe(report.company.legalName);
  expect(metadata.get('Company display name')).toBe(report.company.displayName);
  expect(metadata.get('Start date')).toBe(report.query.startDate);
  expect(metadata.get('End date')).toBe(report.query.endDate);
  expect(metadata.get('Report ID')).toBe(report.reportId);
  expect(metadata.get('Database revision')).toBe(report.databaseRevision);
  expect(metadata.get('Status')).toBe(report.status);
  expect(metadata.get('Disclaimer')).toBe(`Prepared from recorded transactions and account classifications for ${report.query.startDate} through ${report.query.endDate}. Supplemental noncash disclosures do not affect cash totals.`);
  const header = statement.findIndex(row => row[0] === 'Row ID');
  expect(header).toBe(15);
  const rows = statement.slice(header + 1, header + 1 + report.rows.length);
  expect(rows).toHaveSize(report.rows.length);
  report.rows.forEach((expected, index) => {
    const actual = rows[index];
    expect(actual.slice(0, 18)).toEqual([
      xlsxText(expected.rowId), xlsxText(expected.rowType), xlsxText(expected.section), xlsxText(expected.treatment ?? ''), xlsxText(expected.label), xlsxText(expected.fullPath ?? ''), expected.depth,
      expected.amountMinor === undefined ? '' : expected.amountMinor.toString(), expected.amountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(expected.amountMinor),
      xlsxText(expected.accountRole ?? ''), xlsxText(expected.accountId ?? ''), xlsxText(expected.cashRole ?? ''), expected.archived ? 'Yes' : 'No', expected.reviewRequired ? 'Yes' : 'No',
      xlsxText(expected.detailKey ?? ''), xlsxText(expected.parentRowId ?? ''), expected.bold ? 'Yes' : 'No', expected.derived ? 'Yes' : 'No',
    ]);
  });
  const warningHeader = statement.findIndex(row => row[0] === 'Warning ID');
  expect(warningHeader).toBeGreaterThan(header);
  expect(statement.slice(warningHeader + 1, warningHeader + 1 + report.warnings.length).map(row => row.slice(0, 8))).toEqual(report.warnings.map(warning => [
    xlsxText(warning.warningId), xlsxText(warning.code), xlsxText(warning.message), xlsxText(warning.accountRole ?? ''), xlsxText(warning.accountId ?? ''), xlsxText(warning.businessDate ?? ''), xlsxText(warning.detailKey ?? ''), xlsxText((warning.references ?? []).slice().sort().join(';')),
  ]));
  const reconciliationHeader = statement.findIndex(row => row[0] === 'Metric');
  expect(reconciliationHeader).toBeGreaterThan(warningHeader);
  const metrics: readonly [string, bigint][] = [
    ['Net Operating', report.netOperatingMinor], ['Net Investing', report.netInvestingMinor], ['Net Financing', report.netFinancingMinor],
    ['Net Change in Cash', report.netChangeInCashMinor], ['Beginning Cash', report.beginningCashMinor], ['Calculated Ending Cash', report.calculatedEndingCashMinor],
    ['Ending Cash', report.endingCashMinor], ['Restricted Cash Beginning', report.restrictedCashBeginningMinor], ['Restricted Cash Ending', report.restrictedCashEndingMinor],
    ['Unclassified Cash Activity', report.unclassifiedCashActivityMinor], ['Difference', report.differenceMinor],
  ];
  expect(statement.slice(reconciliationHeader + 1, reconciliationHeader + 1 + metrics.length).map(row => row.slice(0, 3))).toEqual(metrics.map(([label, amount]) => [label, amount.toString(), cashFlowXlsxDecimalNumber(amount)]));
  const disclosureHeader = statement.findIndex(row => row[0] === 'Disclosure ID');
  expect(disclosureHeader).toBeGreaterThan(reconciliationHeader);
  expect(statement.slice(disclosureHeader + 1, disclosureHeader + 1 + (report.disclosures ?? []).length).map(row => row.slice(0, 13))).toEqual((report.disclosures ?? []).map(disclosure => [
    xlsxText(disclosure.disclosureId), xlsxText(disclosure.section), xlsxText(disclosure.label), disclosure.amountMinor === undefined ? '' : disclosure.amountMinor.toString(),
    disclosure.amountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(disclosure.amountMinor), xlsxText(disclosure.detailKey ?? ''), xlsxText(disclosure.accountRole ?? ''), xlsxText(disclosure.accountId ?? ''),
    xlsxText(disclosure.chartAccountId ?? ''), xlsxText(disclosure.transactionId ?? ''), xlsxText(disclosure.transferId ?? ''), xlsxText(disclosure.description ?? ''), xlsxText(disclosure.rationale),
  ]));
  const detailMatrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Cash Flow Detail'], { header: 1, defval: '', raw: true });
  const detailHeader = (detailMatrix[0] ?? []).map(value => String(value));
  const details = detailMatrix.slice(1);
  expect(detailHeader).toEqual([
    'Record type', 'Row ID', 'Detail key', 'Contribution ID', 'Contribution type', 'Contribution minor', 'Contribution amount', 'Business date', 'Account role', 'Account ID', 'Account name', 'Chart account ID', 'Chart account path', 'Transaction ID', 'Counterparty transaction ID', 'Split ID', 'Transfer ID', 'Source batch ID', 'Payee', 'Description', 'Memo', 'Opening amount minor', 'Opening amount', 'Ending amount minor', 'Ending amount', 'Raw change minor', 'Raw change', 'Formula', 'Child row ID', 'Report ID', 'Database revision',
  ]);
  const expectedDetails: unknown[][] = [];
  report.rows.forEach(row => {
    const contributions = row.detailKey ? (report.detailIndex[row.detailKey] ?? []) : [];
    if (!contributions.length) {
      if (row.amountMinor === 0n) {
        const context = new Array<unknown>(31).fill('');
        context[0] = 'ROW_CONTEXT'; context[1] = row.rowId; context[2] = row.detailKey ?? '';
        context[8] = xlsxText(row.accountRole ?? ''); context[9] = xlsxText(row.accountId ?? ''); context[27] = 'Zero-valued row context';
        context[29] = xlsxText(report.reportId); context[30] = xlsxText(report.databaseRevision);
        expectedDetails.push(context);
      }
      return;
    }
    contributions.forEach(contribution => {
      expectedDetails.push([
        'CONTRIBUTION', xlsxText(row.rowId), xlsxText(contribution.detailKey), xlsxText(contribution.contributionId), xlsxText(contribution.contributionType), contribution.contributionMinor.toString(), cashFlowXlsxDecimalNumber(contribution.contributionMinor),
        xlsxText(contribution.businessDate ?? ''), xlsxText(contribution.accountRole ?? row.accountRole ?? ''), xlsxText(contribution.accountId ?? row.accountId ?? ''), xlsxText(contribution.accountName ?? ''), xlsxText(contribution.chartAccountId ?? ''), xlsxText(contribution.chartAccountPath ?? ''),
        xlsxText(contribution.transactionId ?? ''), xlsxText(contribution.counterpartyTransactionId ?? ''), xlsxText(contribution.splitId ?? ''), xlsxText(contribution.transferId ?? ''), xlsxText(contribution.sourceBatchId ?? ''), xlsxText(contribution.payee ?? ''), xlsxText(contribution.description ?? ''), xlsxText(contribution.memo ?? ''),
        contribution.openingAmountMinor === undefined ? '' : contribution.openingAmountMinor.toString(), contribution.openingAmountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.openingAmountMinor),
        contribution.endingAmountMinor === undefined ? '' : contribution.endingAmountMinor.toString(), contribution.endingAmountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.endingAmountMinor),
        contribution.rawChangeMinor === undefined ? '' : contribution.rawChangeMinor.toString(), contribution.rawChangeMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.rawChangeMinor),
        xlsxText(contribution.formula ?? ''), xlsxText(contribution.childRowId ?? ''), xlsxText(report.reportId), xlsxText(report.databaseRevision),
      ]);
    });
  });
  expect(details).toEqual(expectedDetails);
  const classifications = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Cash Flow Classifications'], { header: 1, defval: '', raw: true }).slice(1);
  expect(classifications).toHaveSize(report.classifications.length);
  report.classifications.forEach((expected, index) => {
    const actual = classifications[index];
    expect(actual).toEqual([
      xlsxText(expected.accountRole), xlsxText(expected.accountId), xlsxText(expected.accountPath), xlsxText(expected.accountType), xlsxText(expected.detailType), xlsxText(expected.cashRole ?? ''), xlsxText(expected.treatment),
      xlsxText(expected.status), xlsxText(expected.source), xlsxText(expected.rationale), expected.archived ? 'Yes' : 'No', xlsxText(expected.modifiedAtUtc ?? ''), xlsxText(report.databaseRevision),
    ]);
  });
}

function xlsxText(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}
