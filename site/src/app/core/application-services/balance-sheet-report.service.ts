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
  BalanceSheetContribution,
  BalanceSheetDetail,
  GetBalanceSheetDetailCommand,
  DatabaseRevision,
  freezeBalanceSheetReport,
  normalizeBalanceSheetQuery,
  reportCompanyIdentity,
  syntheticBalanceSheetRowId,
} from '../domain-model/balance-sheet.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, BalanceSheetRepositorySnapshot } from '../repository-gateways/accounting.repository';
import { calculateUnadjustedNetProfit } from './profit-loss-calculation';
import { presentBalanceSheetRows } from './balance-sheet-presentation';

export interface FinancialSourceBalance {
  readonly account: FinancialAccount;
  readonly section: BalanceSheetSection;
  readonly internalAmountMinor: bigint;
  readonly amountMinor: bigint;
  readonly openingAmountMinor: bigint;
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
  private readonly reports = new Map<string, BalanceSheetReport>();

  readFinancialSourceBalances(input: BalanceSheetQueryInput): FinancialSourceBalanceSnapshot {
    const company = this.repository.company;
    const normalized = normalizeBalanceSheetQuery(input, company);
    if (!normalized.ok) throw new BalanceSheetContractError(normalized.error);

    const snapshot = this.repository.readBalanceSheetSnapshot(normalized.value.asOfDate);
    const conflicts = snapshot.accounts.filter(account => account.openingBalanceSource === 'LEDGER_ACTIVITY' && account.openingBalance.minorUnits !== 0n);
    if (conflicts.length) throw new BalanceSheetContractError({ code: 'REPORT_GENERATION_FAILED', message: `Stored opening balance conflicts with ledger activity for ${conflicts[0].name}.`, accountId: conflicts[0].id, retryable: false });
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
    const conflicts = snapshot.accounts.filter(account => account.openingBalanceSource === 'LEDGER_ACTIVITY' && account.openingBalance.minorUnits !== 0n);
    if (conflicts.length) throw new BalanceSheetContractError({ code: 'REPORT_GENERATION_FAILED', message: `Stored opening balance conflicts with ledger activity for ${conflicts[0].name}.`, accountId: conflicts[0].id, retryable: false });
    const sourceBalances = this.sourceBalances(snapshot, normalized.value);
    const chartBalances = this.chartBalances(snapshot, normalized.value);
    const period = fiscalPeriod(normalized.value.asOfDate, snapshot.company.fiscalYearStartMonth);
    const currentEarnings = calculateUnadjustedNetProfit(snapshot.transactions, snapshot.chartAccounts, period.startDate, normalized.value.asOfDate);
    const retainedEarnings = calculateRetainedEarnings(snapshot, period.startDate);
    const openingBalanceEquity = sourceBalances.reduce((total, balance) => {
      if (balance.section === 'ASSETS') return total + balance.openingAmountMinor;
      if (balance.section === 'LIABILITIES') return total - balance.openingAmountMinor;
      return total;
    }, 0n);
    const presented = presentBalanceSheetRows([
      ...sourceBalances.map(balance => ({ row: this.sourceRow(balance), parentAccountId: balance.account.parentAccountId, displayOrder: Number.MAX_SAFE_INTEGER })),
      ...chartBalances.map(balance => ({ row: this.chartRow(balance), parentAccountId: balance.account.parentId, displayOrder: balance.account.displayOrder })),
    ], normalized.value.asOfDate, normalized.value.includeZeroBalanceAccounts);
    const rows: BalanceSheetRow[] = [
      ...presented.rows,
      derivedEquityRow('CURRENT_EARNINGS', 'Current Earnings', normalized.value.asOfDate, currentEarnings),
      derivedEquityRow('RETAINED_EARNINGS', 'Retained Earnings', normalized.value.asOfDate, retainedEarnings),
      derivedEquityRow('OPENING_BALANCE_EQUITY', 'Opening Balance Equity', normalized.value.asOfDate, openingBalanceEquity),
    ];
    const totalAssetsMinor = sumBalances(sourceBalances, chartBalances, 'ASSETS');
    const totalLiabilitiesMinor = sumBalances(sourceBalances, chartBalances, 'LIABILITIES');
    const totalEquityMinor = sumBalances(sourceBalances, chartBalances, 'EQUITY') + currentEarnings + retainedEarnings + openingBalanceEquity;
    const totalLiabilitiesAndEquityMinor = totalLiabilitiesMinor + totalEquityMinor;
    rows.push(
      totalRow('TOTAL_ASSETS', 'ASSETS', 'Total Assets', normalized.value.asOfDate, totalAssetsMinor),
      totalRow('TOTAL_LIABILITIES', 'LIABILITIES', 'Total Liabilities', normalized.value.asOfDate, totalLiabilitiesMinor),
      totalRow('TOTAL_EQUITY', 'EQUITY', 'Total Equity', normalized.value.asOfDate, totalEquityMinor),
      totalRow('TOTAL_LIABILITIES_AND_EQUITY', 'RECONCILIATION', 'Total Liabilities and Equity', normalized.value.asOfDate, totalLiabilitiesAndEquityMinor),
      totalRow('DIFFERENCE', 'RECONCILIATION', 'Difference', normalized.value.asOfDate, totalAssetsMinor - totalLiabilitiesAndEquityMinor, 'DIFFERENCE'),
    );
    const profile = snapshot.companyProfile ?? {
      companyId: snapshot.company.id, legalName: snapshot.company.name, displayName: snapshot.company.name,
      currencyCode: snapshot.company.currency, fiscalYearStartMonth: snapshot.company.fiscalYearStartMonth,
      accountingBasis: snapshot.company.accountingBasis, activeTaxYear: snapshot.company.activeTaxYear,
      createdAt: '', modifiedAt: '',
    };
    const report = freezeBalanceSheetReport({
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
      warnings: buildWarnings(snapshot, normalized.value.asOfDate, rows, presented.invalidAccountIds, totalAssetsMinor - totalLiabilitiesAndEquityMinor),
      detailIndex: buildDetailIndex(snapshot, normalized.value, period, sourceBalances, chartBalances, rows),
    });
    this.reports.set(report.reportId, report);
    return report;
  }

  getBalanceSheetDetail(command: GetBalanceSheetDetailCommand): BalanceSheetDetail {
    const report = this.reports.get(command.reportId);
    if (!report || report.databaseRevision !== command.databaseRevision) throw new BalanceSheetContractError({ code: 'REPORT_REVISION_STALE', message: 'The Balance Sheet report is stale. Regenerate it.', retryable: true });
    const current = this.repository.readBalanceSheetSnapshot(report.query.asOfDate);
    if (current.databaseRevision !== report.databaseRevision) throw new BalanceSheetContractError({ code: 'REPORT_REVISION_STALE', message: 'The Balance Sheet report is stale. Regenerate it.', retryable: true });
    const row = report.rows.find(item => item.detailKey === command.detailKey);
    const contributions = report.detailIndex[command.detailKey];
    if (!row || row.amountMinor === undefined || !contributions) throw new BalanceSheetContractError({ code: 'REPORT_DETAIL_NOT_FOUND', message: 'Balance Sheet detail was not found.', detailKey: command.detailKey, retryable: false });
    const amount = contributions.reduce((sum, item) => sum + item.contributionMinor, 0n);
    if (amount !== row.amountMinor) throw new BalanceSheetContractError({ code: 'REPORT_DETAIL_RECONCILIATION_FAILED', message: 'Balance Sheet detail does not reconcile.', detailKey: command.detailKey, retryable: false });
    return Object.freeze({ ...command, rowId: row.rowId, amountMinor: row.amountMinor, contributions });
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
      const openingAmountMinor = account.openingBalanceSource === 'DERIVED_EQUITY' && account.openingBalanceDate <= query.asOfDate ? account.openingBalance.minorUnits : 0n;
      const internalAmountMinor = openingAmountMinor + transactions.reduce((total, transaction) => total + transaction.amount.minorUnits, 0n);
      const amountMinor = definition.value.naturalBalance === 'CREDIT' ? -internalAmountMinor : internalAmountMinor;
      return [{
        account: structuredClone(account),
        section: definition.value.balanceSheetSection,
        internalAmountMinor,
        amountMinor,
        openingAmountMinor: definition.value.naturalBalance === 'CREDIT' ? -openingAmountMinor : openingAmountMinor,
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

function sumBalances(source: readonly FinancialSourceBalance[], chart: readonly ChartBalance[], section: BalanceSheetSection): bigint {
  return [...source, ...chart].reduce((total, row) => total + (row.section === section ? row.amountMinor : 0n), 0n);
}

function buildWarnings(snapshot: BalanceSheetRepositorySnapshot, asOfDate: string, rows: readonly BalanceSheetRow[], invalidIds: readonly string[], difference: bigint) {
  const warnings: import('../domain-model/balance-sheet.types').BalanceSheetWarning[] = [];
  snapshot.accounts.filter(a => a.openingBalance.minorUnits !== 0n && a.openingBalanceDate > asOfDate).forEach(a => warnings.push({ warningId: `OPENING_BALANCE_AFTER_AS_OF:${a.id}:${asOfDate}`, code: 'OPENING_BALANCE_AFTER_AS_OF', message: `${a.name} has an opening balance after the report date.`, accountRole: 'FINANCIAL_SOURCE', accountId: a.id, businessDate: a.openingBalanceDate }));
  rows.filter(r => r.rowType === 'ACCOUNT' && (r.amountMinor ?? 0n) !== 0n && r.archived).forEach(r => warnings.push({ warningId: `ARCHIVED_NONZERO_ACCOUNT:${r.accountRole}:${r.accountId}`, code: 'ARCHIVED_NONZERO_ACCOUNT', message: `${r.label} is archived but has a nonzero balance.`, accountRole: r.accountRole, accountId: r.accountId }));
  rows.filter(r => r.rowType === 'ACCOUNT' && (r.amountMinor ?? 0n) !== 0n && r.unclassified).forEach(r => warnings.push({ warningId: `UNCLASSIFIED_NONZERO_ACCOUNT:${r.accountRole}:${r.accountId}`, code: 'UNCLASSIFIED_NONZERO_ACCOUNT', message: `${r.label} requires account classification review.`, accountRole: r.accountRole, accountId: r.accountId }));
  invalidIds.forEach(id => warnings.push({ warningId: `ACCOUNT_HIERARCHY_INVALID:${id}`, code: 'ACCOUNT_HIERARCHY_INVALID', message: `Account ${id} has an invalid parent hierarchy.`, accountId: id }));
  if (snapshot.company.currency !== 'USD') warnings.push({ warningId: `UNSUPPORTED_CURRENCY:${snapshot.company.currency}`, code: 'UNSUPPORTED_CURRENCY', message: `Currency ${snapshot.company.currency} requires conversion before totals can be relied upon.` });
  if (difference !== 0n) warnings.push({ warningId: `BALANCE_SHEET_OUT_OF_BALANCE:${asOfDate}`, code: 'BALANCE_SHEET_OUT_OF_BALANCE', message: 'Assets do not equal liabilities plus equity.' });
  return warnings.sort((a, b) => a.warningId.localeCompare(b.warningId));
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

function derivedEquityRow(key: 'CURRENT_EARNINGS' | 'RETAINED_EARNINGS' | 'OPENING_BALANCE_EQUITY', label: string, asOfDate: string, amountMinor: bigint): BalanceSheetRow {
  const rowId = syntheticBalanceSheetRowId(key, asOfDate);
  return { rowId, rowType: 'DERIVED_EQUITY', section: 'EQUITY', label, depth: 0, amountMinor, detailKey: balanceSheetDetailKey(rowId), bold: true, derived: true, archived: false, unclassified: false };
}

function totalRow(key: 'TOTAL_ASSETS' | 'TOTAL_LIABILITIES' | 'TOTAL_EQUITY' | 'TOTAL_LIABILITIES_AND_EQUITY' | 'DIFFERENCE', section: BalanceSheetSection, label: string, asOfDate: string, amountMinor: bigint, rowType: 'TOTAL' | 'DIFFERENCE' = 'TOTAL'): BalanceSheetRow {
  const rowId = syntheticBalanceSheetRowId(key, asOfDate);
  return { rowId, rowType, section, label, depth: 0, amountMinor, detailKey: balanceSheetDetailKey(rowId), bold: true, derived: true, archived: false, unclassified: false };
}

function buildDetailIndex(snapshot: BalanceSheetRepositorySnapshot, query: BalanceSheetQuery, period: { startDate: string }, source: readonly FinancialSourceBalance[], chart: readonly ChartBalance[], rows: readonly BalanceSheetRow[]): Record<string, readonly BalanceSheetContribution[]> {
  const details: Record<string, BalanceSheetContribution[]> = {};
  const natural = (accountType: string, amount: bigint) => { const definition = getAccountTypeDefinition(accountType); return definition.ok && definition.value.naturalBalance === 'CREDIT' ? -amount : amount; };
  source.forEach(balance => {
    const row = rows.find(item => item.accountRole === 'FINANCIAL_SOURCE' && item.accountId === balance.account.id && item.rowType === 'ACCOUNT');
    if (!row?.detailKey) return;
    let running = 0n;
    const list: BalanceSheetContribution[] = [];
    if (balance.openingAmountMinor !== 0n) { running += balance.openingAmountMinor; list.push({ contributionId: `opening:${balance.account.id}:${balance.account.openingBalanceDate}`, kind: 'OPENING_BALANCE', businessDate: balance.account.openingBalanceDate, financialAccountId: balance.account.id, financialAccountName: balance.account.name, description: 'Opening balance', storedAmountMinor: balance.account.openingBalance.minorUnits, contributionMinor: balance.openingAmountMinor, runningBalanceMinor: running }); }
    balance.transactions.forEach(transaction => { const amount = natural(balance.account.accountType, transaction.amount.minorUnits); running += amount; list.push({ contributionId: `${transaction.state === 'MATCHED_TRANSFER' ? 'transfer' : 'transaction'}:${transaction.id}`, kind: transaction.state === 'MATCHED_TRANSFER' ? 'MATCHED_TRANSFER' : 'POSTED_TRANSACTION', businessDate: transaction.postingDate, financialAccountId: balance.account.id, financialAccountName: balance.account.name, transactionId: transaction.id, transferMatchId: transaction.transferMatchId, sourceBatchId: transaction.sourceBatchId, description: transaction.description, payee: transaction.payee, memo: transaction.memo, storedAmountMinor: transaction.amount.minorUnits, contributionMinor: amount, runningBalanceMinor: running }); });
    details[row.detailKey] = list;
  });
  chart.forEach(balance => {
    const row = rows.find(item => item.accountRole === 'CHART' && item.accountId === balance.account.id && item.rowType === 'ACCOUNT');
    if (!row?.detailKey) return;
    details[row.detailKey] = snapshot.transactions.filter(t => t.state === 'POSTED' && t.postingDate <= query.asOfDate).flatMap(t => t.splits.filter(s => s.chartAccountId === balance.account.id).map(s => ({ contributionId: `split:${s.id}`, kind: 'POSTING_SPLIT' as const, businessDate: t.postingDate, financialAccountId: t.accountId, chartAccountId: balance.account.id, transactionId: t.id, sourceBatchId: t.sourceBatchId, description: t.description, payee: t.payee, memo: s.memo ?? t.memo, storedAmountMinor: s.amount.minorUnits, contributionMinor: natural(balance.account.accountType, s.amount.minorUnits) })));
  });
  const earnings = (key: 'CURRENT_EARNINGS' | 'RETAINED_EARNINGS', predicate: (date: string) => boolean) => {
    const row = rows.find(item => item.rowId === syntheticBalanceSheetRowId(key, query.asOfDate)); if (!row?.detailKey) return;
    const chartById = new Map(snapshot.chartAccounts.map(a => [a.id, a]));
    details[row.detailKey] = snapshot.transactions.filter(t => t.state === 'POSTED' && predicate(t.postingDate)).flatMap(t => t.splits.filter(s => { const type = chartById.get(s.chartAccountId)?.type; return Boolean(type && !['ASSET', 'LIABILITY', 'EQUITY'].includes(type)); }).map(s => ({ contributionId: `${key.toLowerCase()}:${s.id}`, kind: key as 'CURRENT_EARNINGS' | 'RETAINED_EARNINGS', businessDate: t.postingDate, financialAccountId: t.accountId, chartAccountId: s.chartAccountId, transactionId: t.id, sourceBatchId: t.sourceBatchId, description: t.description, payee: t.payee, memo: s.memo ?? t.memo, storedAmountMinor: s.amount.minorUnits, contributionMinor: s.amount.minorUnits })));
  };
  earnings('CURRENT_EARNINGS', date => date >= period.startDate && date <= query.asOfDate); earnings('RETAINED_EARNINGS', date => date < period.startDate);
  const obe = rows.find(r => r.rowId === syntheticBalanceSheetRowId('OPENING_BALANCE_EQUITY', query.asOfDate));
  if (obe?.detailKey) details[obe.detailKey] = source.filter(b => b.openingAmountMinor !== 0n && ['ASSETS', 'LIABILITIES'].includes(b.section)).map(b => ({ contributionId: `opening-equity:${b.account.id}:${b.account.openingBalanceDate}`, kind: 'OPENING_BALANCE', businessDate: b.account.openingBalanceDate, financialAccountId: b.account.id, financialAccountName: b.account.name, description: `Opening balance: ${b.account.name}`, storedAmountMinor: b.account.openingBalance.minorUnits, contributionMinor: b.section === 'ASSETS' ? b.openingAmountMinor : -b.openingAmountMinor }));
  rows.filter(r => r.rowType === 'SUBTOTAL' && r.detailKey).forEach(subtotal => { const parent = rows.find(r => r.rowId === subtotal.parentRowId); if (!parent) return; details[subtotal.detailKey!] = union(rows.filter(r => r.rowType === 'ACCOUNT' && r.accountRole === parent.accountRole && (r.fullPath === parent.fullPath || r.fullPath?.startsWith(`${parent.fullPath} > `))).flatMap(r => r.detailKey ? details[r.detailKey] ?? [] : [])); });
  const contributionsForSection = (section: BalanceSheetSection) => union(rows.filter(r => r.rowType === 'ACCOUNT' && r.section === section).flatMap(r => r.detailKey ? details[r.detailKey] ?? [] : []).concat(rows.filter(r => r.rowType === 'DERIVED_EQUITY' && r.section === section).flatMap(r => r.detailKey ? details[r.detailKey] ?? [] : [])));
  const totals: Array<[string, BalanceSheetSection]> = [['TOTAL_ASSETS','ASSETS'],['TOTAL_LIABILITIES','LIABILITIES'],['TOTAL_EQUITY','EQUITY']];
  totals.forEach(([key, section]) => { const row = rows.find(r => r.rowId === syntheticBalanceSheetRowId(key as any, query.asOfDate)); if (row?.detailKey) details[row.detailKey] = contributionsForSection(section); });
  const le = rows.find(r => r.rowId === syntheticBalanceSheetRowId('TOTAL_LIABILITIES_AND_EQUITY', query.asOfDate)); if (le?.detailKey) details[le.detailKey] = union([...contributionsForSection('LIABILITIES'), ...contributionsForSection('EQUITY')]);
  const diff = rows.find(r => r.rowId === syntheticBalanceSheetRowId('DIFFERENCE', query.asOfDate)); if (diff?.detailKey) details[diff.detailKey] = [...contributionsForSection('ASSETS'), ...contributionsForSection('LIABILITIES').map(negated), ...contributionsForSection('EQUITY').map(negated)];
  return details;
}

function union(items: readonly BalanceSheetContribution[]): BalanceSheetContribution[] { const seen = new Set<string>(); return items.filter(item => !seen.has(item.contributionId) && Boolean(seen.add(item.contributionId))); }
function negated(item: BalanceSheetContribution): BalanceSheetContribution { return { ...item, contributionId: `difference:${item.contributionId}`, contributionMinor: -item.contributionMinor }; }
