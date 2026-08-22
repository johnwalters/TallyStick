import { ChartAccount, Transaction } from '../domain-model/accounting.types';

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
