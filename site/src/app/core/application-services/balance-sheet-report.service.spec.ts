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
});

function account(id: string, type: 'BANK' | 'CREDIT_CARD'): FinancialAccount {
  return {
    id, type, accountType: type, classificationStatus: 'CONFIRMED', importEnabled: true, supportedSourceKinds: ['CSV'],
    openingBalanceSource: 'DERIVED_EQUITY', detailType: type === 'BANK' ? 'Checking' : 'Credit Card', name: id,
    institutionOrEntity: 'Example Institution', openingBalance: money(999_999n), openingBalanceDate: '2025-01-01', archived: false, locked: false,
  };
}

function transaction(id: string, accountId: string, postingDate: string, amount: bigint, state: Transaction['state'], transferMatchId?: string): Transaction {
  return {
    id, accountId, postingDate, amount: money(amount), rawDescription: id, description: id, state, splits: [],
    categorizationSource: state === 'MATCHED_TRANSFER' ? 'TRANSFER' : 'MANUAL', transferMatchId,
    createdAtUtc: '2026-01-01T00:00:00Z', modifiedAtUtc: '2026-01-01T00:00:00Z',
  };
}
