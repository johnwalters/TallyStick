import { Injectable, inject } from '@angular/core';
import { reportCompanyIdentity } from '../domain-model/balance-sheet.types';
import {
  CashFlowContractError,
  CashFlowContribution,
  CashFlowQueryInput,
  CashFlowReport,
  CashFlowRow,
  CashFlowWarning,
  cashFlowAccountRowId,
  cashFlowDetailKey,
  cashFlowReportId,
  cashFlowSyntheticRowId,
  cashFlowWarningId,
  freezeCashFlowReport,
  normalizeCashFlowQuery,
} from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { calculateBalanceSheetProjection, calculateFinancialSourceBalances } from './balance-sheet-report.service';
import { calculateUnadjustedProfitLoss, UnadjustedProfitLossContribution, UnadjustedProfitLossProjection } from './profit-loss-calculation';

@Injectable({ providedIn: 'root' })
export class CashFlowReportService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;

  getCashFlowReport(input: CashFlowQueryInput): CashFlowReport {
    const normalized = normalizeCashFlowQuery(input, this.repository.company);
    if (!normalized.ok) throw new CashFlowContractError(normalized.error);
    const query = normalized.value;
    const snapshot = this.repository.readCashFlowSnapshot(query.endDate);
    if (snapshot.company.currency !== 'USD') {
      throw new CashFlowContractError({
        code: 'UNSUPPORTED_CURRENCY',
        message: `Currency ${snapshot.company.currency} requires conversion before Cash Flow balances can be calculated.`,
        retryable: false,
      });
    }
    const openingModeConflict = snapshot.accounts.find(account =>
      account.openingBalanceSource === 'LEDGER_ACTIVITY' && account.openingBalance.minorUnits !== 0n);
    if (openingModeConflict) {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_GENERATION_FAILED',
        message: `Stored opening balance conflicts with ledger activity for ${openingModeConflict.name}.`,
        accountId: openingModeConflict.id,
        retryable: false,
      });
    }

    const beginningDate = dayBeforeBusinessDate(query.startDate);
    let profitAndLoss: UnadjustedProfitLossProjection;
    let operating: OperatingRows;
    try {
      profitAndLoss = calculateUnadjustedProfitLoss(snapshot.transactions, snapshot.chartAccounts, query.startDate, query.endDate);
      const chartClassifications = new Map(snapshot.cashFlowClassifications
        .filter(classification => classification.accountRole === 'CHART')
        .map(classification => [classification.accountId, classification]));
      operating = buildNetProfitAndNoncashRows(query, snapshot.chartAccounts, chartClassifications, profitAndLoss);
    } catch {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_GENERATION_FAILED',
        message: 'Profit and Loss sections do not reconcile to transaction detail for this Cash Flow period.',
        retryable: false,
      });
    }
    const beginningProjection = calculateBalanceSheetProjection(snapshot, { asOfDate: beginningDate, includeZeroBalanceAccounts: true });
    const endingProjection = calculateBalanceSheetProjection(snapshot, { asOfDate: query.endDate, includeZeroBalanceAccounts: true });
    const beginningBalances = beginningProjection.sourceBalances;
    const endingBalances = endingProjection.sourceBalances;
    const classifications = new Map(snapshot.cashFlowClassifications
      .filter(classification => classification.accountRole === 'FINANCIAL_SOURCE')
      .map(classification => [classification.accountId, classification]));
    const cashAccountIds = classifiedAccountIds(classifications, ['CASH', 'CASH_EQUIVALENT']);
    const restrictedAccountIds = classifiedAccountIds(classifications, ['RESTRICTED_CASH']);
    const beginningCashMinor = sumBalances(beginningBalances, cashAccountIds);
    const endingCashMinor = sumBalances(endingBalances, cashAccountIds);
    const restrictedCashBeginningMinor = sumBalances(beginningBalances, restrictedAccountIds);
    const restrictedCashEndingMinor = sumBalances(endingBalances, restrictedAccountIds);
    const measuredNetChangeMinor = endingCashMinor - beginningCashMinor;
    const warnings = buildWarnings(snapshot.accounts, classifications, cashAccountIds, restrictedAccountIds, query,
      beginningBalances, endingBalances,
      restrictedCashBeginningMinor, restrictedCashEndingMinor, beginningDate,
      beginningProjection.differenceMinor, endingProjection.differenceMinor);
    const rows = [...operating.rows, ...cashBalanceRows(query, beginningCashMinor, endingCashMinor)];
    const profile = snapshot.companyProfile ?? {
      companyId: snapshot.company.id,
      legalName: snapshot.company.name,
      displayName: snapshot.company.name,
      currencyCode: snapshot.company.currency,
      fiscalYearStartMonth: snapshot.company.fiscalYearStartMonth,
      accountingBasis: snapshot.company.accountingBasis,
      activeTaxYear: snapshot.company.activeTaxYear,
      createdAt: '',
      modifiedAt: '',
    };

    // Slice 09 establishes the indirect Net Profit starting point and noncash
    // reversals. Later slices add working-capital, Investing, and Financing rows.
    return freezeCashFlowReport({
      reportId: cashFlowReportId(snapshot.databaseRevision, query),
      databaseRevision: snapshot.databaseRevision,
      generatedAt: new Date().toISOString(),
      query,
      company: reportCompanyIdentity(profile),
      currencyCode: snapshot.company.currency,
      accountingBasis: snapshot.company.accountingBasis,
      method: 'INDIRECT',
      status: 'REVIEW_REQUIRED',
      rows,
      netOperatingMinor: operating.netOperatingMinor,
      netInvestingMinor: 0n,
      netFinancingMinor: 0n,
      netChangeInCashMinor: measuredNetChangeMinor,
      beginningCashMinor,
      calculatedEndingCashMinor: endingCashMinor,
      endingCashMinor,
      differenceMinor: 0n,
      restrictedCashBeginningMinor,
      restrictedCashEndingMinor,
      unclassifiedCashActivityMinor: 0n,
      warnings,
      detailIndex: operating.detailIndex,
    });
  }
}

interface OperatingRows {
  readonly rows: readonly CashFlowRow[];
  readonly detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
  readonly netOperatingMinor: bigint;
}

function buildNetProfitAndNoncashRows(
  query: CashFlowReport['query'],
  chartAccounts: readonly import('../domain-model/accounting.types').ChartAccount[],
  classifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  profitAndLoss: UnadjustedProfitLossProjection,
): OperatingRows {
  const chartById = new Map(chartAccounts.map(account => [account.id, account]));
  const netProfitRowId = cashFlowSyntheticRowId('NET_PROFIT', query);
  const netOperatingRowId = cashFlowSyntheticRowId('NET_OPERATING', query);
  const netProfitDetailKey = cashFlowDetailKey(netProfitRowId);
  const netOperatingDetailKey = cashFlowDetailKey(netOperatingRowId);
  const netProfitContributions = profitAndLoss.contributions.map(contribution => pnlContribution(contribution, netProfitDetailKey));
  const contributionsByChart = new Map<string, UnadjustedProfitLossContribution[]>();
  profitAndLoss.contributions.forEach(contribution => {
    const contributions = contributionsByChart.get(contribution.chartAccountId) ?? [];
    contributions.push(contribution);
    contributionsByChart.set(contribution.chartAccountId, contributions);
  });
  const adjustments = [...classifications.values()]
    .filter(classification => classification.treatment === 'NONCASH_PNL_ADJUSTMENT')
    .map(classification => {
      const account = chartById.get(classification.accountId);
      if (!account) return undefined;
      const sourceContributions = contributionsByChart.get(account.id) ?? [];
      const amountMinor = sourceContributions.reduce((total, contribution) => total - contribution.contributionMinor, 0n);
      const rowId = cashFlowAccountRowId('OPERATING', 'CHART', account.id);
      const detailKey = cashFlowDetailKey(rowId);
      const contributions = sourceContributions.map(contribution => noncashReversalContribution(contribution, detailKey));
      return { account, classification, amountMinor, rowId, detailKey, contributions };
    })
    .filter((value): value is NoncashAdjustment => value !== undefined)
    .sort((left, right) => accountOrder(left.account, right.account));

  const adjustmentRows = adjustments
    .filter(adjustment => query.includeZeroRows || adjustment.amountMinor !== 0n)
    .map(adjustment => ({
      rowId: adjustment.rowId,
      rowType: 'ADJUSTMENT' as const,
      section: 'OPERATING' as const,
      treatment: 'NONCASH_PNL_ADJUSTMENT' as const,
      accountRole: 'CHART' as const,
      accountId: adjustment.account.id,
      label: leafAccountName(adjustment.account.name),
      fullPath: chartAccountPath(adjustment.account.id, chartById),
      depth: 1,
      amountMinor: adjustment.amountMinor,
      detailKey: adjustment.detailKey,
      bold: false,
      derived: true,
      archived: adjustment.account.archived,
      reviewRequired: adjustment.classification.status === 'REVIEW_REQUIRED' || adjustment.classification.treatment === 'REVIEW_REQUIRED',
    }));
  const adjustmentContributions = adjustments
    .flatMap(adjustment => adjustment.contributions);
  const noncashMinor = adjustments.reduce((total, adjustment) => total + adjustment.amountMinor, 0n);
  const netOperatingMinor = profitAndLoss.netProfitMinor + noncashMinor;
  const sectionRow: CashFlowRow = {
    rowId: cashFlowSyntheticRowId('SECTION_OPERATING', query),
    rowType: 'SECTION_HEADER', section: 'OPERATING', label: 'Operating activities', depth: 0,
    bold: true, derived: true, archived: false, reviewRequired: false,
  };
  const netProfitRow: CashFlowRow = {
    rowId: netProfitRowId,
    rowType: 'NET_PROFIT', section: 'OPERATING', label: 'Net Profit', depth: 0,
    amountMinor: profitAndLoss.netProfitMinor, detailKey: netProfitDetailKey,
    bold: true, derived: true, archived: false, reviewRequired: false,
  };
  const netOperatingRow: CashFlowRow = {
    rowId: netOperatingRowId,
    rowType: 'TOTAL', section: 'OPERATING', label: 'Net cash from operating activities', depth: 0,
    amountMinor: netOperatingMinor, detailKey: netOperatingDetailKey,
    bold: true, derived: true, archived: false, reviewRequired: false,
  };
  const allOperatingContributions = [...netProfitContributions, ...adjustmentContributions];
  const details: Record<string, readonly CashFlowContribution[]> = {
    [netProfitDetailKey]: netProfitContributions,
    [netOperatingDetailKey]: allOperatingContributions,
  };
  adjustments.forEach(adjustment => {
    details[adjustment.detailKey] = adjustment.contributions;
  });
  assertDetailAmount(netProfitRow, details[netProfitDetailKey]);
  adjustmentRows.forEach(row => assertDetailAmount(row, details[row.detailKey!]));
  assertDetailAmount(netOperatingRow, details[netOperatingDetailKey]);
  return {
    rows: Object.freeze([sectionRow, netProfitRow, ...adjustmentRows, netOperatingRow]),
    detailIndex: Object.freeze(details),
    netOperatingMinor,
  };
}

interface NoncashAdjustment {
  readonly account: import('../domain-model/accounting.types').ChartAccount;
  readonly classification: CashFlowClassificationRecord;
  readonly amountMinor: bigint;
  readonly rowId: CashFlowRow['rowId'];
  readonly detailKey: NonNullable<CashFlowRow['detailKey']>;
  readonly contributions: CashFlowContribution[];
}

function pnlContribution(contribution: UnadjustedProfitLossContribution, detailKey: CashFlowContribution['detailKey']): CashFlowContribution {
  return {
    contributionId: `pnl:${contribution.transactionId}:${contribution.splitId}`,
    detailKey,
    contributionType: 'PNL_SPLIT',
    contributionMinor: contribution.contributionMinor,
    businessDate: contribution.postingDate,
    accountRole: 'CHART',
    accountId: contribution.chartAccountId,
    accountName: contribution.accountName,
    chartAccountId: contribution.chartAccountId,
    chartAccountPath: contribution.chartAccountPath,
    transactionId: contribution.transactionId,
    splitId: contribution.splitId,
    sourceBatchId: contribution.sourceBatchId,
    payee: contribution.payee,
    description: contribution.description,
    memo: contribution.memo,
  };
}

function noncashReversalContribution(contribution: UnadjustedProfitLossContribution, detailKey: CashFlowContribution['detailKey']): CashFlowContribution {
  return {
    contributionId: `noncash-reversal:${contribution.transactionId}:${contribution.splitId}`,
    detailKey,
    contributionType: 'NONCASH_REVERSAL',
    contributionMinor: -contribution.contributionMinor,
    businessDate: contribution.postingDate,
    accountRole: 'CHART',
    accountId: contribution.chartAccountId,
    accountName: contribution.accountName,
    chartAccountId: contribution.chartAccountId,
    chartAccountPath: contribution.chartAccountPath,
    transactionId: contribution.transactionId,
    splitId: contribution.splitId,
    sourceBatchId: contribution.sourceBatchId,
    payee: contribution.payee,
    description: contribution.description,
    memo: contribution.memo,
    formula: '-1 × period P/L contribution',
  };
}

function assertDetailAmount(row: CashFlowRow, contributions: readonly CashFlowContribution[] | undefined): void {
  if (row.amountMinor === undefined) return;
  const total = (contributions ?? []).reduce((sum, contribution) => sum + contribution.contributionMinor, 0n);
  if (total !== row.amountMinor) throw new Error(`Cash Flow detail does not reconcile for ${row.rowId}.`);
}

function accountOrder(left: { displayOrder: number; name: string; id: string }, right: { displayOrder: number; name: string; id: string }): number {
  return left.displayOrder - right.displayOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

function leafAccountName(name: string): string { return name.split(':').at(-1)?.trim() || name; }

function chartAccountPath(accountId: string, chartById: ReadonlyMap<string, import('../domain-model/accounting.types').ChartAccount>): string {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = chartById.get(accountId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(leafAccountName(current.name));
    current = current.parentId ? chartById.get(current.parentId) : undefined;
  }
  return parts.join(' > ');
}

function classifiedAccountIds(
  classifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  roles: readonly CashFlowClassificationRecord['cashRole'][],
): ReadonlySet<string> {
  return new Set([...classifications.values()]
    // Explicit cash roles remain authoritative even while the classification
    // is marked Review required. The status controls warnings/workflow, not
    // whether a stated cash role participates in the balance boundary.
    .filter(classification => roles.includes(classification.cashRole))
    .map(classification => classification.accountId));
}

function sumBalances(
  balances: ReturnType<typeof calculateFinancialSourceBalances>,
  accountIds: ReadonlySet<string>,
): bigint {
  return balances.reduce((total, balance) => total + (accountIds.has(balance.account.id) ? balance.amountMinor : 0n), 0n);
}

function cashBalanceRows(query: CashFlowReport['query'], beginning: bigint, ending: bigint): readonly CashFlowRow[] {
  return [
    {
      rowId: cashFlowSyntheticRowId('SECTION_CASH_RECONCILIATION', query),
      rowType: 'SECTION_HEADER', section: 'CASH_RECONCILIATION', label: 'Cash reconciliation', depth: 0,
      bold: true, derived: true, archived: false, reviewRequired: false,
    },
    {
      rowId: cashFlowSyntheticRowId('BEGINNING_CASH', query),
      rowType: 'CASH_BALANCE', section: 'CASH_RECONCILIATION', label: 'Beginning cash and cash equivalents', depth: 1,
      amountMinor: beginning, bold: false, derived: true, archived: false, reviewRequired: false,
    },
    {
      rowId: cashFlowSyntheticRowId('ENDING_CASH', query),
      rowType: 'CASH_BALANCE', section: 'CASH_RECONCILIATION', label: 'Ending cash and cash equivalents', depth: 1,
      amountMinor: ending, bold: true, derived: true, archived: false, reviewRequired: false,
    },
  ];
}

function buildWarnings(
  accounts: readonly { id: string; name: string; archived: boolean }[],
  classifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  cashAccountIds: ReadonlySet<string>,
  restrictedAccountIds: ReadonlySet<string>,
  query: CashFlowReport['query'],
  beginningBalances: ReturnType<typeof calculateFinancialSourceBalances>,
  endingBalances: ReturnType<typeof calculateFinancialSourceBalances>,
  restrictedBeginning: bigint,
  restrictedEnding: bigint,
  beginningDate: string,
  beginningDifference: bigint,
  endingDifference: bigint,
): readonly CashFlowWarning[] {
  const warnings: CashFlowWarning[] = [];
  const beginningByAccount = new Map(beginningBalances.map(balance => [balance.account.id, balance]));
  const endingByAccount = new Map(endingBalances.map(balance => [balance.account.id, balance]));
  const contributesToPeriod = (accountId: string): boolean => {
    const beginning = beginningByAccount.get(accountId);
    const ending = endingByAccount.get(accountId);
    if ((beginning?.amountMinor ?? 0n) !== 0n || (ending?.amountMinor ?? 0n) !== 0n) return true;
    return Boolean(ending?.transactions.some(transaction =>
      transaction.postingDate >= query.startDate
      && transaction.postingDate <= query.endDate
      && transaction.amount.minorUnits !== 0n));
  };
  if (cashAccountIds.size === 0) {
    warnings.push({
      warningId: cashFlowWarningId('NO_CASH_ACCOUNTS_CONFIGURED', [], query),
      code: 'NO_CASH_ACCOUNTS_CONFIGURED',
      message: 'No financial accounts are confirmed as cash or cash equivalents.',
    });
  }
  for (const account of accounts) {
    const classification = classifications.get(account.id);
    const contributes = contributesToPeriod(account.id);
    if (contributes && (!classification || classification.status === 'REVIEW_REQUIRED' || classification.cashRole === 'REVIEW_REQUIRED')) {
      warnings.push({
        warningId: cashFlowWarningId('CASH_ROLE_REVIEW_REQUIRED', [account.id], query),
        code: 'CASH_ROLE_REVIEW_REQUIRED',
        message: `${account.name} requires Cash Flow cash-role review.`,
        accountRole: 'FINANCIAL_SOURCE', accountId: account.id, references: [account.id],
      });
    }
    if (account.archived && contributes && (cashAccountIds.has(account.id) || restrictedAccountIds.has(account.id))) {
      warnings.push({
        warningId: cashFlowWarningId('ARCHIVED_PARTICIPATING_ACCOUNT', [account.id], query),
        code: 'ARCHIVED_PARTICIPATING_ACCOUNT',
        message: `${account.name} is archived but remains part of Cash Flow balances.`,
        accountRole: 'FINANCIAL_SOURCE', accountId: account.id, references: [account.id],
      });
    }
  }
  if (restrictedBeginning !== 0n || restrictedEnding !== 0n) {
    warnings.push({
      warningId: cashFlowWarningId('RESTRICTED_CASH_PRESENT', [...restrictedAccountIds], query),
      code: 'RESTRICTED_CASH_PRESENT',
      message: 'Restricted cash is reported separately from cash and cash equivalents.',
      references: [...restrictedAccountIds].sort(),
    });
  }
  const outOfBalanceDates = [
    ...(beginningDifference === 0n ? [] : [beginningDate]),
    ...(endingDifference === 0n ? [] : [query.endDate]),
  ];
  if (outOfBalanceDates.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('SOURCE_BALANCE_SHEET_OUT_OF_BALANCE', outOfBalanceDates, query),
      code: 'SOURCE_BALANCE_SHEET_OUT_OF_BALANCE',
      message: `The source Balance Sheet is out of balance for ${outOfBalanceDates.join(' and ')}.`,
      references: outOfBalanceDates,
    });
  }
  return Object.freeze(warnings.sort((left, right) => left.warningId.localeCompare(right.warningId)).map(warning => Object.freeze(warning)));
}

export function dayBeforeBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return date.toISOString().slice(0, 10);
}
