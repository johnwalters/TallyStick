import { ChartAccount, Transaction } from '../domain-model/accounting.types';

export type UnadjustedProfitLossSection = 'INCOME' | 'COGS' | 'EXPENSES' | 'OTHER_INCOME' | 'OTHER_EXPENSE';

export interface UnadjustedProfitLossContribution {
  readonly transactionId: string;
  readonly splitId: string;
  readonly postingDate: string;
  readonly accountId: string;
  readonly chartAccountId: string;
  readonly chartAccountPath: string;
  readonly accountName: string;
  readonly contributionMinor: bigint;
  readonly amountMinor: bigint;
  readonly description?: string;
  readonly payee?: string;
  readonly memo?: string;
  readonly sourceBatchId?: string;
}

export interface UnadjustedProfitLossProjection {
  readonly netProfitMinor: bigint;
  readonly sectionContributions: Readonly<Record<UnadjustedProfitLossSection, bigint>>;
  readonly contributions: readonly UnadjustedProfitLossContribution[];
}

/** Shared unadjusted P/L identity used by both P/L and Balance Sheet earnings. */
export function calculateUnadjustedNetProfit(
  transactions: readonly Transaction[],
  chartAccounts: readonly ChartAccount[],
  startDate: string | undefined,
  endDate: string,
  excludedChartAccountIds: ReadonlySet<string> = new Set(),
): bigint {
  const chartById = new Map(chartAccounts.map(account => [account.id, account]));
  return transactions
    .filter(transaction => transaction.state === 'POSTED' && (!startDate || transaction.postingDate >= startDate) && transaction.postingDate <= endDate)
    .flatMap(transaction => transaction.splits)
    .reduce((total, split) => {
      const type = chartById.get(split.chartAccountId)?.type;
      if (!type || excludedChartAccountIds.has(split.chartAccountId) || ['ASSET', 'LIABILITY', 'EQUITY'].includes(type)) return total;
      return total + split.amount.minorUnits;
  }, 0n);
}

/**
 * Pure P/L projection used by Cash Flow. It deliberately shares the exact
 * unadjusted-net-profit identity above and adds deterministic split detail so
 * report rows can reconcile without reading mutable application state.
 */
export function calculateUnadjustedProfitLoss(
  transactions: readonly Transaction[],
  chartAccounts: readonly ChartAccount[],
  startDate: string,
  endDate: string,
  excludedChartAccountIds: ReadonlySet<string> = new Set(),
): UnadjustedProfitLossProjection {
  const chartById = new Map(chartAccounts.map(account => [account.id, account]));
  const sectionContributions: Record<UnadjustedProfitLossSection, bigint> = {
    INCOME: 0n,
    COGS: 0n,
    EXPENSES: 0n,
    OTHER_INCOME: 0n,
    OTHER_EXPENSE: 0n,
  };
  const contributions: UnadjustedProfitLossContribution[] = [];
  const included = transactions
    .filter(transaction => transaction.state === 'POSTED' && transaction.postingDate >= startDate && transaction.postingDate <= endDate)
    .slice()
    .sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id));

  for (const transaction of included) {
    for (const split of transaction.splits.slice().sort((left, right) => left.id.localeCompare(right.id))) {
      if (excludedChartAccountIds.has(split.chartAccountId)) continue;
      const chart = chartById.get(split.chartAccountId);
      const section = chart ? profitLossSectionForType(chart.type) : undefined;
      if (!chart || !section) continue;
      const contributionMinor = split.amount.minorUnits;
      sectionContributions[section] += contributionMinor;
      contributions.push({
        transactionId: transaction.id,
        splitId: split.id,
        postingDate: transaction.postingDate,
        accountId: transaction.accountId,
        chartAccountId: chart.id,
        chartAccountPath: chartAccountPath(chart.id, chartById),
        accountName: chart.name,
        contributionMinor,
        amountMinor: split.amount.minorUnits,
        description: transaction.description,
        payee: transaction.payee,
        memo: split.memo ?? transaction.memo,
        sourceBatchId: transaction.sourceBatchId,
      });
    }
  }

  const netProfitMinor = calculateUnadjustedNetProfit(transactions, chartAccounts, startDate, endDate, excludedChartAccountIds);
  const sectionTotal = Object.values(sectionContributions).reduce((total, amount) => total + amount, 0n);
  const detailTotal = contributions.reduce((total, contribution) => total + contribution.contributionMinor, 0n);
  if (sectionTotal !== netProfitMinor || detailTotal !== netProfitMinor) {
    throw new Error('Profit and Loss section/detail reconciliation failed.');
  }
  return Object.freeze({
    netProfitMinor,
    sectionContributions: Object.freeze({ ...sectionContributions }),
    contributions: Object.freeze(contributions.map(contribution => Object.freeze({ ...contribution }))),
  });
}

function profitLossSectionForType(type: ChartAccount['type']): UnadjustedProfitLossSection | undefined {
  if (type === 'INCOME') return 'INCOME';
  if (type === 'COGS') return 'COGS';
  if (type === 'EXPENSE') return 'EXPENSES';
  if (type === 'OTHER_INCOME') return 'OTHER_INCOME';
  if (type === 'OTHER_EXPENSE') return 'OTHER_EXPENSE';
  return undefined;
}

function chartAccountPath(chartAccountId: string, chartById: ReadonlyMap<string, ChartAccount>): string {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = chartById.get(chartAccountId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(current.name.split(':').at(-1)?.trim() || current.name);
    current = current.parentId ? chartById.get(current.parentId) : undefined;
  }
  return parts.join(' > ');
}
