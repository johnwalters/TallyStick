import { Injectable, inject } from '@angular/core';
import { BalanceSheetSection, getAccountTypeDefinition } from '../domain-model/account-taxonomy';
import { FinancialAccount, Transaction } from '../domain-model/accounting.types';
import {
  BalanceSheetContractError,
  BalanceSheetQuery,
  BalanceSheetQueryInput,
  DatabaseRevision,
  normalizeBalanceSheetQuery,
} from '../domain-model/balance-sheet.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository } from '../repository-gateways/accounting.repository';

export interface FinancialSourceBalance {
  readonly account: FinancialAccount;
  readonly section: BalanceSheetSection;
  readonly internalAmountMinor: bigint;
  readonly amountMinor: bigint;
  readonly transactions: readonly Transaction[];
}

export interface FinancialSourceBalanceSnapshot {
  readonly query: BalanceSheetQuery;
  readonly databaseRevision: DatabaseRevision;
  readonly balances: readonly FinancialSourceBalance[];
}

@Injectable({ providedIn: 'root' })
export class BalanceSheetReportService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;

  readFinancialSourceBalances(input: BalanceSheetQueryInput): FinancialSourceBalanceSnapshot {
    const company = this.repository.company;
    const normalized = normalizeBalanceSheetQuery(input, company);
    if (!normalized.ok) throw new BalanceSheetContractError(normalized.error);

    const snapshot = this.repository.readBalanceSheetSnapshot(normalized.value.asOfDate);
    const confirmedTransfers = new Map(snapshot.transfers.map(transfer => [transfer.id, transfer]));
    const transactionsByAccount = new Map<string, Transaction[]>();
    for (const transaction of snapshot.transactions) {
      if (transaction.postingDate > normalized.value.asOfDate) continue;
      const included = transaction.state === 'POSTED' || (
        transaction.state === 'MATCHED_TRANSFER'
        && Boolean(transaction.transferMatchId)
        && confirmedTransfers.has(transaction.transferMatchId!)
        && transferContainsTransaction(confirmedTransfers.get(transaction.transferMatchId!)!, transaction.id)
      );
      if (!included) continue;
      const rows = transactionsByAccount.get(transaction.accountId) ?? [];
      rows.push(structuredClone(transaction));
      transactionsByAccount.set(transaction.accountId, rows);
    }

    const balances = snapshot.accounts.flatMap(account => {
      const definition = getAccountTypeDefinition(account.accountType);
      if (!definition.ok || !definition.value.balanceSheetSection) return [];
      const transactions = (transactionsByAccount.get(account.id) ?? [])
        .sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id));
      const internalAmountMinor = transactions.reduce((total, transaction) => total + transaction.amount.minorUnits, 0n);
      const amountMinor = definition.value.naturalBalance === 'CREDIT' ? -internalAmountMinor : internalAmountMinor;
      return [{
        account: structuredClone(account),
        section: definition.value.balanceSheetSection,
        internalAmountMinor,
        amountMinor,
        transactions: Object.freeze(transactions),
      } satisfies FinancialSourceBalance];
    });

    return Object.freeze({
      query: Object.freeze(normalized.value),
      databaseRevision: snapshot.databaseRevision,
      balances: Object.freeze(balances.map(balance => Object.freeze(balance))),
    });
  }
}

function transferContainsTransaction(transfer: { leftTransactionId: string; rightTransactionId: string }, transactionId: string): boolean {
  return transfer.leftTransactionId === transactionId || transfer.rightTransactionId === transactionId;
}
