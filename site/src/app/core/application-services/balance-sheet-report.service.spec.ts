import { TestBed } from '@angular/core/testing';
import { FinancialAccount, Transaction, TransferMatch, money } from '../domain-model/accounting.types';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { BalanceSheetReportService } from './balance-sheet-report.service';

describe('BalanceSheetReportService source balances', () => {
  let repository: InMemoryAccountingRepository;
  let service: BalanceSheetReportService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      InMemoryAccountingRepository,
      { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
    ] });
    repository = TestBed.inject(InMemoryAccountingRepository);
    service = TestBed.inject(BalanceSheetReportService);
    repository.accounts.set('bank', account('bank', 'BANK'));
    repository.accounts.set('card', account('card', 'CREDIT_CARD'));
  });

  it('uses one immutable revision and includes only Posted and confirmed Matched Transfer activity through as-of', () => {
    const transfer: TransferMatch = { id: 'match', leftTransactionId: 'transfer-bank', rightTransactionId: 'transfer-card', confidence: 1, rationale: 'Confirmed', confirmedAtUtc: '2026-02-01T00:00:00Z' };
    repository.transfers.set(transfer.id, transfer);
    [
      transaction('posted', 'bank', '2026-01-01', 10_000n, 'POSTED'),
      transaction('pending', 'bank', '2026-01-02', 90_000n, 'PENDING'),
      transaction('excluded', 'bank', '2026-01-03', 80_000n, 'EXCLUDED'),
      transaction('future', 'bank', '2026-03-01', 70_000n, 'POSTED'),
      transaction('transfer-bank', 'bank', '2026-02-01', -2_000n, 'MATCHED_TRANSFER', 'match'),
      transaction('transfer-card', 'card', '2026-02-01', 2_000n, 'MATCHED_TRANSFER', 'match'),
      transaction('orphan-transfer', 'bank', '2026-02-02', 60_000n, 'MATCHED_TRANSFER', 'missing'),
    ].forEach(row => repository.transactions.set(row.id, row));

    const result = service.readFinancialSourceBalances({ asOfDate: '2026-02-28' });
    expect(result.balances.find(row => row.account.id === 'bank')?.amountMinor).toBe(8_000n);
    expect(result.balances.find(row => row.account.id === 'card')?.amountMinor).toBe(-2_000n);
    expect(result.balances.flatMap(row => row.transactions).map(row => row.id)).toEqual(['posted', 'transfer-bank', 'transfer-card']);
    expect(result.databaseRevision).toBe(repository.readBalanceSheetSnapshot('2026-02-28').databaseRevision);
    expect(Object.isFrozen(result.balances)).toBeTrue();
  });

  it('preserves negative asset and liability contra presentation without clamping', () => {
    repository.transactions.set('overdrawn', transaction('overdrawn', 'bank', '2026-01-01', -500n, 'POSTED'));
    repository.transactions.set('credit', transaction('credit', 'card', '2026-01-01', 300n, 'POSTED'));
    const result = service.readFinancialSourceBalances({ asOfDate: '2026-12-31' });
    expect(result.balances.find(row => row.account.id === 'bank')?.amountMinor).toBe(-500n);
    expect(result.balances.find(row => row.account.id === 'card')?.amountMinor).toBe(-300n);
  });

  it('combines source and Chart rows with natural signs and an exact equation', () => {
    repository.chartAccounts.set('fixed', chartAccount('fixed', 'FIXED_ASSET'));
    repository.chartAccounts.set('loan', chartAccount('loan', 'LONG_TERM_LIABILITY'));
    repository.chartAccounts.set('equity', chartAccount('equity', 'EQUITY'));
    repository.transactions.set('asset-buy', transactionWithSplit('asset-buy', -5_000n, 'fixed', -5_000n));
    repository.transactions.set('loan-funding', transactionWithSplit('loan-funding', 7_000n, 'loan', 7_000n));
    repository.transactions.set('owner-funding', transactionWithSplit('owner-funding', 3_000n, 'equity', 3_000n));

    const report = service.getBalanceSheet({ asOfDate: '2026-12-31' });
    expect(report.rows.filter(row => ['ACCOUNT', 'DERIVED_EQUITY'].includes(row.rowType)).map(row => [row.accountRole, row.accountId, row.amountMinor])).toEqual([
      ['FINANCIAL_SOURCE', 'bank', 5_000n],
      ['CHART', 'fixed', 5_000n], ['CHART', 'loan', 7_000n], ['CHART', 'equity', 3_000n],
      [undefined, undefined, 0n], [undefined, undefined, 0n], [undefined, undefined, 0n],
    ]);
    expect(report.totalAssetsMinor).toBe(10_000n);
    expect(report.totalLiabilitiesMinor).toBe(7_000n);
    expect(report.totalEquityMinor).toBe(3_000n);
    expect(report.totalLiabilitiesAndEquityMinor).toBe(10_000n);
    expect(report.differenceMinor).toBe(0n);
  });

  it('returns an immutable all-zero report for empty books', () => {
    repository.accounts.clear();
    const report = service.getBalanceSheet({ asOfDate: '2026-12-31' });
    expect(report.rows.map(row => [row.label, row.amountMinor])).toEqual([['Current Earnings', 0n], ['Retained Earnings', 0n], ['Opening Balance Equity', 0n]]);
    expect([report.totalAssetsMinor, report.totalLiabilitiesMinor, report.totalEquityMinor, report.differenceMinor]).toEqual([0n, 0n, 0n, 0n]);
    expect(Object.isFrozen(report)).toBeTrue();
  });

  it('derives fiscal Current and Retained Earnings from the shared unadjusted P/L identity', () => {
    repository.company.fiscalYearStartMonth = 7;
    repository.chartAccounts.set('income', { id: 'income', name: 'Service Income', type: 'INCOME', accountType: 'INCOME', detailType: 'Service income', displayOrder: 1, archived: false, locked: false });
    repository.chartAccounts.set('expense', { id: 'expense', name: 'Office', type: 'EXPENSE', accountType: 'EXPENSE', detailType: 'Office expenses', displayOrder: 2, archived: false, locked: false });
    repository.transactions.set('prior-income', { ...transaction('prior-income', 'bank', '2025-06-30', 4_000n, 'POSTED'), splits: [{ id: 'prior-split', chartAccountId: 'income', amount: money(4_000n) }] });
    repository.transactions.set('current-expense', { ...transaction('current-expense', 'bank', '2025-07-01', -1_000n, 'POSTED'), splits: [{ id: 'current-split', chartAccountId: 'expense', amount: money(-1_000n) }] });
    repository.transactions.set('schedule-c-irrelevant', { ...transaction('schedule-c-irrelevant', 'bank', '2026-01-01', 0n, 'EXCLUDED'), splits: [{ id: 'excluded-split', chartAccountId: 'income', amount: money(99_000n) }] });

    const report = service.getBalanceSheet({ asOfDate: '2026-06-30' });
    expect(report.fiscalPeriod).toEqual({ startDate: '2025-07-01', endDate: '2026-06-30' });
    expect(report.rows.find(row => row.label === 'Current Earnings')?.amountMinor).toBe(-1_000n);
    expect(report.rows.find(row => row.label === 'Retained Earnings')?.amountMinor).toBe(4_000n);
    expect(report.totalEquityMinor).toBe(3_000n);
    expect(report.totalAssetsMinor).toBe(3_000n);
    expect(report.differenceMinor).toBe(0n);
  });

  it('includes eligible openings once, derives Opening Balance Equity, and warns on future openings', () => {
    repository.accounts.get('bank')!.openingBalance = money(10_000n);
    repository.accounts.get('bank')!.openingBalanceDate = '2025-12-31';
    repository.accounts.get('card')!.openingBalance = money(-4_000n);
    repository.accounts.get('card')!.openingBalanceDate = '2025-12-31';
    repository.accounts.set('future', { ...account('future', 'BANK'), openingBalance: money(9_000n), openingBalanceDate: '2027-01-01' });
    const report = service.getBalanceSheet({ asOfDate: '2026-12-31' });
    expect(report.rows.find(row => row.accountId === 'bank')?.amountMinor).toBe(10_000n);
    expect(report.rows.find(row => row.accountId === 'card')?.amountMinor).toBe(4_000n);
    expect(report.rows.find(row => row.label === 'Opening Balance Equity')?.amountMinor).toBe(6_000n);
    expect(report.differenceMinor).toBe(0n);
    expect(report.warnings).toEqual([jasmine.objectContaining({ code: 'OPENING_BALANCE_AFTER_AS_OF', accountId: 'future' })]);
  });

  it('fails a ledger-activity account with a conflicting stored opening', () => {
    repository.accounts.get('bank')!.openingBalanceSource = 'LEDGER_ACTIVITY';
    repository.accounts.get('bank')!.openingBalance = money(1n);
    expect(() => service.getBalanceSheet({ asOfDate: '2026-12-31' })).toThrowError(/conflicts with ledger activity/);
  });

  it('orders hierarchy deterministically, preserves parent direct activity, hides zero leaves, and warns without losing balances', () => {
    repository.accounts.clear();
    repository.chartAccounts.set('parent', { ...chartAccount('parent', 'FIXED_ASSET'), name: 'Equipment', displayOrder: 1, archived: true });
    repository.chartAccounts.set('child', { ...chartAccount('child', 'FIXED_ASSET'), name: 'Camera', parentId: 'parent', displayOrder: 2 });
    repository.chartAccounts.set('zero', { ...chartAccount('zero', 'FIXED_ASSET'), name: 'Zero', displayOrder: 3 });
    repository.chartAccounts.set('orphan', { ...chartAccount('orphan', 'FIXED_ASSET'), name: 'Orphan', parentId: 'missing', displayOrder: 4 });
    repository.transactions.set('parent-post', transactionWithSplit('parent-post', 0n, 'parent', -100n));
    repository.transactions.set('child-post', transactionWithSplit('child-post', 0n, 'child', -200n));
    repository.transactions.set('orphan-post', transactionWithSplit('orphan-post', 0n, 'orphan', -50n));
    const first = service.getBalanceSheet({ asOfDate: '2026-12-31' });
    const second = service.getBalanceSheet({ asOfDate: '2026-12-31' });
    expect(first.rows.map(row => [row.rowId, row.amountMinor])).toEqual(second.rows.map(row => [row.rowId, row.amountMinor]));
    expect(first.rows.find(row => row.label === 'Total for Equipment')?.amountMinor).toBe(300n);
    expect(first.rows.some(row => row.label === 'Zero')).toBeFalse();
    expect(first.rows.find(row => row.label === 'Orphan')?.unclassified).toBeTrue();
    expect(first.warnings.map(warning => warning.code)).toContain('ACCOUNT_HIERARCHY_INVALID');
    expect(first.warnings.map(warning => warning.code)).toContain('ARCHIVED_NONZERO_ACCOUNT');
  });
});

function account(id: string, type: 'BANK' | 'CREDIT_CARD'): FinancialAccount {
  return {
    id, type, accountType: type, classificationStatus: 'CONFIRMED', importEnabled: true, supportedSourceKinds: ['CSV'],
    openingBalanceSource: 'DERIVED_EQUITY', detailType: type === 'BANK' ? 'Checking' : 'Credit Card', name: id,
    institutionOrEntity: 'Example Institution', openingBalance: money(0n), openingBalanceDate: '2025-01-01', archived: false, locked: false,
  };
}

function chartAccount(id: string, accountType: 'FIXED_ASSET' | 'LONG_TERM_LIABILITY' | 'EQUITY') {
  return { id, name: id, type: accountType === 'FIXED_ASSET' ? 'ASSET' as const : accountType === 'LONG_TERM_LIABILITY' ? 'LIABILITY' as const : 'EQUITY' as const, accountType, detailType: accountType === 'FIXED_ASSET' ? 'Machinery and equipment' : accountType === 'LONG_TERM_LIABILITY' ? 'Loan payable' : 'Owner equity', displayOrder: 1, archived: false, locked: false };
}

function transactionWithSplit(id: string, amount: bigint, chartAccountId: string, splitAmount: bigint): Transaction {
  return { ...transaction(id, 'bank', '2026-01-01', amount, 'POSTED'), splits: [{ id: `${id}-split`, chartAccountId, amount: money(splitAmount) }] };
}

function transaction(id: string, accountId: string, postingDate: string, amount: bigint, state: Transaction['state'], transferMatchId?: string): Transaction {
  return {
    id, accountId, postingDate, amount: money(amount), rawDescription: id, description: id, state, splits: [],
    categorizationSource: state === 'MATCHED_TRANSFER' ? 'TRANSFER' : 'MANUAL', transferMatchId,
    createdAtUtc: '2026-01-01T00:00:00Z', modifiedAtUtc: '2026-01-01T00:00:00Z',
  };
}
