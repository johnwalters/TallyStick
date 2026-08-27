import { TestBed } from '@angular/core/testing';
import { ChartAccount, FinancialAccount, Transaction, money } from '../domain-model/accounting.types';
import { CashFlowClassification } from '../domain-model/cash-flow-classification';
import { CashFlowContribution, CashFlowContractError } from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { BalanceSheetReportService } from './balance-sheet-report.service';
import { CashFlowReportService, dayBeforeBusinessDate } from './cash-flow-report.service';
import { calculateUnadjustedNetProfit } from './profit-loss-calculation';

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
    expect(report.netChangeInCashMinor).toBe(300n);
    expect(report.calculatedEndingCashMinor).toBe(report.endingCashMinor);
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
    expect(report.netChangeInCashMinor).toBe(-200n);
    expect(report.warnings.map(warning => warning.code)).toContain('EXCLUDED_MATERIAL_CASH_ACTIVITY');
    expect(report.rows.some(row => row.accountId === excluded.id && (row.section === 'INVESTING' || row.section === 'FINANCING'))).toBeFalse();
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

  it('runs the production service against the Cash Flow acceptance oracle for A1-A9, A13, and A15-A17', async () => {
    type OracleScenario = {
      id: string;
      companyId: string;
      period: { startDate: string; endDate: string };
      expectedTotals: Record<string, number>;
      expectedRows: Record<string, number>;
      detailGroups: Record<string, readonly { sourceId: string; amountMinor: number }[]>;
      checkpoints?: readonly { endDate: string; netProfitMinor: number; operatingAssetAdjustmentsMinor?: number; operatingLiabilityAdjustmentsMinor?: number; netOperatingMinor: number; endingCashMinor: number }[];
    };
    type OracleDocument = { scenarios: readonly OracleScenario[] };
    const oracleDocument = await fetch('fixtures/cash-flow/baseline-oracle.json').then(response => {
      if (!response.ok) throw new Error(`Unable to load Cash Flow acceptance oracle (${response.status}).`);
      return response.json() as Promise<OracleDocument>;
    });
    const scenarios = new Map(oracleDocument.scenarios.map(scenario => [scenario.id, scenario]));
    const caseIds = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A13', 'A15', 'A16', 'A17'];
    expect(caseIds.every(id => scenarios.has(id))).toBeTrue();
    for (const id of caseIds) {
      const expected = scenarios.get(id)!;
      const expectedCompany = expected.companyId === 'company-copper-kettle' ? 'COPPER' : 'NORTHWIND';
      prepareProductionFixture(expectedCompany);
      addProductionFixtureScenario(id);
      const report = service.getCashFlowReport({ startDate: expected.period.startDate, endDate: expected.period.endDate, includeZeroRows: true });
      const repeat = service.getCashFlowReport({ startDate: expected.period.startDate, endDate: expected.period.endDate, includeZeroRows: true });
      const accountRows = report.rows.filter(row => row.rowType === 'ACCOUNT_ACTIVITY');
      const amount = (rows: readonly { amountMinor?: bigint }[]) => rows.reduce((sum, row) => sum + (row.amountMinor ?? 0n), 0n);
      const totals = expected.expectedTotals;
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
    expect(report.warnings.map(warning => warning.code)).toContain('ARCHIVED_PARTICIPATING_ACCOUNT');
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
    const copper = !['A13', 'A15', 'A16', 'A17'].includes(id);
    const cashId = copper ? 'copper-cash-a' : 'northwind-cash-a';
    const opening = ({ A1: 0n, A2: 10_000n, A3: 20_000n, A4: 0n, A5: 30_000n, A6: 60_000n, A7: 10_000n, A8: 20_000n, A9: 10_000n, A13: 25_000n, A15: 10_000n, A16: 50_000n, A17: 0n } as Record<string, bigint>)[id];
    const openingDate = id === 'A13' ? '2026-02-10' : id === 'A16' ? '2025-06-01' : '2025-12-01';
    addAccount(cashId, copper ? 'Daily funds' : 'Workshop till', opening, openingDate, 'CASH');
    const income = addChartAccount(`${id.toLowerCase()}-income`, 'Operating income', 'INCOME', 'Sales of product income');
    const expense = addChartAccount(`${id.toLowerCase()}-expense`, 'Operating expense', 'EXPENSE', 'Other business expenses');
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
    if (balanceFixture && state === 'POSTED') {
      const splitTotal = fixtureSplits.reduce((total, split) => total + split.amountMinor, 0n);
      if (splitTotal !== amount) {
        fixtureSplits.push({
          chartAccountId: ensureFixtureBalancingAccount().id,
          amountMinor: amount - splitTotal,
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
  }

  function ensureFixtureBalancingAccount(): ChartAccount {
    const id = '__fixture-balancing-equity__';
    const existing = repository.chartAccounts.get(id);
    if (existing) return existing;
    const account = addChartAccount(id, 'Fixture balancing equity', 'EQUITY', 'Owner equity', { displayOrder: 999_999 });
    addChartClassification(account.id, account.accountType, account.detailType, 'CASH_BALANCE');
    return account;
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
});
