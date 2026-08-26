import { TestBed } from '@angular/core/testing';
import { FinancialAccount, Transaction, money } from '../domain-model/accounting.types';
import { CashFlowClassification } from '../domain-model/cash-flow-classification';
import { CashFlowContractError } from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { BalanceSheetReportService } from './balance-sheet-report.service';
import { CashFlowReportService, dayBeforeBusinessDate } from './cash-flow-report.service';

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

  function addAccount(id: string, name: string, opening: bigint, openingDate: string, cashRole: CashFlowClassification['cashRole'], archived = false): void {
    const account: FinancialAccount = {
      id, type: 'BANK', accountType: 'BANK', classificationStatus: 'CONFIRMED', importEnabled: true,
      supportedSourceKinds: ['CSV'], openingBalanceSource: 'DERIVED_EQUITY', detailType: 'Checking', name,
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
  ): void {
    repository.transactions.set(id, {
      id, accountId, postingDate, amount: money(amount), rawDescription: id, description: id, state, splits: [],
      categorizationSource: state === 'MATCHED_TRANSFER' ? 'TRANSFER' : 'MANUAL', transferMatchId,
      createdAtUtc: `${postingDate}T00:00:00.000Z`, modifiedAtUtc: `${postingDate}T00:00:00.000Z`,
    });
  }

  function markReviewRequired(accountId: string): void {
    const key = `FINANCIAL_SOURCE:${accountId}`;
    const classification = repository.cashFlowClassifications.get(key);
    if (!classification) throw new Error(`Missing classification for ${accountId}`);
    repository.cashFlowClassifications.set(key, { ...classification, status: 'REVIEW_REQUIRED' });
  }
});
