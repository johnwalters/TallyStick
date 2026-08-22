import { Injectable, inject } from '@angular/core';
import { BalanceSheetSection, getAccountTypeDefinition } from '../domain-model/account-taxonomy';
import { ChartAccount, FinancialAccount, Transaction } from '../domain-model/accounting.types';
import {
  accountBalanceSheetRowId,
  balanceSheetDetailKey,
  balanceSheetReportId,
  BalanceSheetContractError,
  BalanceSheetQuery,
  BalanceSheetQueryInput,
  BalanceSheetReport,
  BalanceSheetRow,
  DatabaseRevision,
  freezeBalanceSheetReport,
  normalizeBalanceSheetQuery,
  reportCompanyIdentity,
  syntheticBalanceSheetRowId,
} from '../domain-model/balance-sheet.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, BalanceSheetRepositorySnapshot } from '../repository-gateways/accounting.repository';
import { calculateUnadjustedNetProfit } from './profit-loss-calculation';

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

export interface ChartBalance {
  readonly account: ChartAccount;
  readonly section: BalanceSheetSection;
  readonly amountMinor: bigint;
}

@Injectable({ providedIn: 'root' })
export class BalanceSheetReportService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;

  readFinancialSourceBalances(input: BalanceSheetQueryInput): FinancialSourceBalanceSnapshot {
    const company = this.repository.company;
    const normalized = normalizeBalanceSheetQuery(input, company);
    if (!normalized.ok) throw new BalanceSheetContractError(normalized.error);

    const snapshot = this.repository.readBalanceSheetSnapshot(normalized.value.asOfDate);
    return Object.freeze({
      query: Object.freeze(normalized.value),
      databaseRevision: snapshot.databaseRevision,
      balances: this.sourceBalances(snapshot, normalized.value),
    });
  }

  getBalanceSheet(input: BalanceSheetQueryInput): BalanceSheetReport {
    const normalized = normalizeBalanceSheetQuery(input, this.repository.company);
    if (!normalized.ok) throw new BalanceSheetContractError(normalized.error);
    const snapshot = this.repository.readBalanceSheetSnapshot(normalized.value.asOfDate);
    const sourceBalances = this.sourceBalances(snapshot, normalized.value);
    const chartBalances = this.chartBalances(snapshot, normalized.value);
    const period = fiscalPeriod(normalized.value.asOfDate, snapshot.company.fiscalYearStartMonth);
    const currentEarnings = calculateUnadjustedNetProfit(snapshot.transactions, snapshot.chartAccounts, period.startDate, normalized.value.asOfDate);
    const retainedEarnings = calculateRetainedEarnings(snapshot, period.startDate);
    const rows: BalanceSheetRow[] = [
      ...sourceBalances.map(balance => this.sourceRow(balance)),
      ...chartBalances.map(balance => this.chartRow(balance)),
      derivedEquityRow('CURRENT_EARNINGS', 'Current Earnings', normalized.value.asOfDate, currentEarnings),
      derivedEquityRow('RETAINED_EARNINGS', 'Retained Earnings', normalized.value.asOfDate, retainedEarnings),
    ];
    const totalAssetsMinor = sumSection(rows, 'ASSETS');
    const totalLiabilitiesMinor = sumSection(rows, 'LIABILITIES');
    const totalEquityMinor = sumSection(rows, 'EQUITY');
    const totalLiabilitiesAndEquityMinor = totalLiabilitiesMinor + totalEquityMinor;
    const profile = snapshot.companyProfile ?? {
      companyId: snapshot.company.id, legalName: snapshot.company.name, displayName: snapshot.company.name,
      currencyCode: snapshot.company.currency, fiscalYearStartMonth: snapshot.company.fiscalYearStartMonth,
      accountingBasis: snapshot.company.accountingBasis, activeTaxYear: snapshot.company.activeTaxYear,
      createdAt: '', modifiedAt: '',
    };
    return freezeBalanceSheetReport({
      reportId: balanceSheetReportId(snapshot.databaseRevision, normalized.value),
      databaseRevision: snapshot.databaseRevision,
      generatedAt: new Date().toISOString(),
      query: normalized.value,
      company: reportCompanyIdentity(profile),
      currencyCode: snapshot.company.currency,
      accountingBasis: snapshot.company.accountingBasis,
      fiscalPeriod: period,
      rows,
      totalAssetsMinor,
      totalLiabilitiesMinor,
      totalEquityMinor,
      totalLiabilitiesAndEquityMinor,
      differenceMinor: totalAssetsMinor - totalLiabilitiesAndEquityMinor,
      warnings: [],
      detailIndex: {},
    });
  }

  private sourceBalances(snapshot: BalanceSheetRepositorySnapshot, query: BalanceSheetQuery): readonly FinancialSourceBalance[] {
    const confirmedTransfers = new Map(snapshot.transfers.map(transfer => [transfer.id, transfer]));
    const transactionsByAccount = new Map<string, Transaction[]>();
    for (const transaction of snapshot.transactions) {
      if (transaction.postingDate > query.asOfDate) continue;
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

    return Object.freeze(balances.map(balance => Object.freeze(balance)));
  }

  private chartBalances(snapshot: BalanceSheetRepositorySnapshot, query: BalanceSheetQuery): readonly ChartBalance[] {
    const amounts = new Map<string, bigint>();
    for (const transaction of snapshot.transactions) {
      if (transaction.state !== 'POSTED' || transaction.postingDate > query.asOfDate) continue;
      for (const split of transaction.splits) amounts.set(split.chartAccountId, (amounts.get(split.chartAccountId) ?? 0n) + split.amount.minorUnits);
    }
    return Object.freeze(snapshot.chartAccounts.flatMap(account => {
      const definition = getAccountTypeDefinition(account.accountType);
      if (!definition.ok || !definition.value.balanceSheetSection) return [];
      const stored = amounts.get(account.id) ?? 0n;
      return [Object.freeze({ account: structuredClone(account), section: definition.value.balanceSheetSection, amountMinor: definition.value.naturalBalance === 'DEBIT' ? -stored : stored })];
    }));
  }

  private sourceRow(balance: FinancialSourceBalance): BalanceSheetRow {
    const rowId = accountBalanceSheetRowId('FINANCIAL_SOURCE', balance.account.id);
    return { rowId, rowType: 'ACCOUNT', section: balance.section, accountType: balance.account.accountType, accountRole: 'FINANCIAL_SOURCE', accountId: balance.account.id, label: balance.account.name, depth: 0, amountMinor: balance.amountMinor, detailKey: balanceSheetDetailKey(rowId), bold: false, derived: false, archived: balance.account.archived, unclassified: balance.account.classificationStatus === 'REVIEW_REQUIRED' };
  }

  private chartRow(balance: ChartBalance): BalanceSheetRow {
    const rowId = accountBalanceSheetRowId('CHART', balance.account.id);
    return { rowId, rowType: 'ACCOUNT', section: balance.section, accountType: balance.account.accountType, accountRole: 'CHART', accountId: balance.account.id, label: balance.account.name, depth: 0, amountMinor: balance.amountMinor, detailKey: balanceSheetDetailKey(rowId), bold: false, derived: false, archived: balance.account.archived, unclassified: false };
  }
}

function transferContainsTransaction(transfer: { leftTransactionId: string; rightTransactionId: string }, transactionId: string): boolean {
  return transfer.leftTransactionId === transactionId || transfer.rightTransactionId === transactionId;
}

function sumSection(rows: readonly BalanceSheetRow[], section: BalanceSheetSection): bigint {
  return rows.reduce((total, row) => total + (row.section === section ? row.amountMinor ?? 0n : 0n), 0n);
}

function fiscalPeriod(asOfDate: string, startMonth: number): { startDate: string; endDate: string } {
  const [year, month] = asOfDate.split('-').map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  return { startDate: `${startYear.toString().padStart(4, '0')}-${startMonth.toString().padStart(2, '0')}-01`, endDate: asOfDate };
}

function calculateRetainedEarnings(snapshot: BalanceSheetRepositorySnapshot, fiscalStartDate: string): bigint {
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  return snapshot.transactions
    .filter(transaction => transaction.state === 'POSTED' && transaction.postingDate < fiscalStartDate)
    .flatMap(transaction => transaction.splits)
    .reduce((total, split) => {
      const type = chartById.get(split.chartAccountId)?.type;
      return !type || ['ASSET', 'LIABILITY', 'EQUITY'].includes(type) ? total : total + split.amount.minorUnits;
    }, 0n);
}

function derivedEquityRow(key: 'CURRENT_EARNINGS' | 'RETAINED_EARNINGS', label: string, asOfDate: string, amountMinor: bigint): BalanceSheetRow {
  const rowId = syntheticBalanceSheetRowId(key, asOfDate);
  return { rowId, rowType: 'DERIVED_EQUITY', section: 'EQUITY', label, depth: 0, amountMinor, detailKey: balanceSheetDetailKey(rowId), bold: true, derived: true, archived: false, unclassified: false };
}
