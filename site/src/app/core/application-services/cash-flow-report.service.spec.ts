import { TestBed } from '@angular/core/testing';
import { FinancialAccount, Transaction, money } from '../domain-model/accounting.types';
import { CashFlowClassification } from '../domain-model/cash-flow-classification';
import { CashFlowContractError } from '../domain-model/cash-flow.types';
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
    expect(report.warnings.map(warning => warning.code)).toContain('SOURCE_BALANCE_SHEET_OUT_OF_BALANCE');
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
    expect(withZeroRows.reportId).not.toBe(report.reportId);
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

  function addAccount(id: string, name: string, opening: bigint, openingDate: string, cashRole: CashFlowClassification['cashRole'], archived = false, accountType: 'BANK' | 'CREDIT_CARD' = 'BANK'): void {
    const account: FinancialAccount = {
      id, type: accountType, accountType, classificationStatus: 'CONFIRMED', importEnabled: true,
      supportedSourceKinds: ['CSV'], openingBalanceSource: 'DERIVED_EQUITY', detailType: accountType === 'CREDIT_CARD' ? 'Credit Card' : 'Checking', name,
      institutionOrEntity: 'Example Bank', openingBalance: money(opening), openingBalanceDate: openingDate,
      archived, locked: false,
    };
    repository.accounts.set(id, account);
    const classification: CashFlowClassificationRecord = {
      accountRole: 'FINANCIAL_SOURCE', accountId: id, accountType: 'BANK', detailType: 'Checking', cashRole,
      treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'USER', rationale: 'Explicit test cash role.',
      modifiedAtUtc: '2026-01-01T00:00:00.000Z',
    };
    repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${id}`, classification);
  }

  function addTransaction(
    id: string,
    accountId: string,
    postingDate: string,
    amount: bigint,
    state: Transaction['state'],
    transferMatchId?: string,
    splitInputs: readonly { chartAccountId: string; amountMinor: bigint; memo?: string }[] = [],
  ): void {
    repository.transactions.set(id, {
      id, accountId, postingDate, amount: money(amount), rawDescription: id, description: id, state,
      splits: splitInputs.map(split => ({ id: `${id}:${split.chartAccountId}`, chartAccountId: split.chartAccountId, amount: money(split.amountMinor), memo: split.memo })),
      categorizationSource: state === 'MATCHED_TRANSFER' ? 'TRANSFER' : 'MANUAL', transferMatchId,
      createdAtUtc: `${postingDate}T00:00:00.000Z`, modifiedAtUtc: `${postingDate}T00:00:00.000Z`,
    });
  }

  function addChartAccount(id: string, name: string, accountType: import('../domain-model/accounting.types').ChartAccount['accountType'], detailType: string): import('../domain-model/accounting.types').ChartAccount {
    const account = { id, name, type: accountType === 'INCOME' || accountType === 'OTHER_INCOME' ? accountType : accountType === 'COGS' ? 'COGS' : accountType === 'OTHER_EXPENSE' ? 'OTHER_EXPENSE' : accountType === 'EXPENSE' ? 'EXPENSE' : accountType, accountType, detailType, displayOrder: repository.chartAccounts.size + 1, archived: false, locked: false } as import('../domain-model/accounting.types').ChartAccount;
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
