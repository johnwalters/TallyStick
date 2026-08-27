import { Injectable, inject } from '@angular/core';
import { ChartAccount, FinancialAccount } from '../domain-model/accounting.types';
import { getAccountTypeDefinition } from '../domain-model/account-taxonomy';
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
import { ACCOUNTING_REPOSITORY, AccountingRepository, BalanceSheetRepositorySnapshot, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { BalanceSheetProjection, ChartBalance, FinancialSourceBalance, calculateBalanceSheetProjection, calculateFinancialSourceBalances } from './balance-sheet-report.service';
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
    const beginningProjection = calculateBalanceSheetProjection(snapshot, { asOfDate: beginningDate, includeZeroBalanceAccounts: true });
    const endingProjection = calculateBalanceSheetProjection(snapshot, { asOfDate: query.endDate, includeZeroBalanceAccounts: true });
    const classifications = snapshot.cashFlowClassifications;
    let profitAndLoss: UnadjustedProfitLossProjection;
    let operating: OperatingRows;
    try {
      profitAndLoss = calculateUnadjustedProfitLoss(snapshot.transactions, snapshot.chartAccounts, query.startDate, query.endDate);
      const chartClassifications = new Map(classifications
        .filter(classification => classification.accountRole === 'CHART')
        .map(classification => [classification.accountId, classification]));
      const workingCapital = buildWorkingCapitalRows(query, snapshot, beginningProjection, endingProjection, classifications);
      operating = buildNetProfitAndNoncashRows(query, snapshot.chartAccounts, chartClassifications, profitAndLoss, workingCapital);
    } catch {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_GENERATION_FAILED',
        message: 'Profit and Loss sections do not reconcile to transaction detail for this Cash Flow period.',
        retryable: false,
      });
    }
    const beginningBalances = beginningProjection.sourceBalances;
    const endingBalances = endingProjection.sourceBalances;
    const financialClassifications = new Map(classifications
      .filter(classification => classification.accountRole === 'FINANCIAL_SOURCE')
      .map(classification => [classification.accountId, classification]));
    const cashAccountIds = classifiedAccountIds(financialClassifications, ['CASH', 'CASH_EQUIVALENT']);
    const restrictedAccountIds = classifiedAccountIds(financialClassifications, ['RESTRICTED_CASH']);
    const beginningCashMinor = sumBalances(beginningBalances, cashAccountIds);
    const endingCashMinor = sumBalances(endingBalances, cashAccountIds);
    const restrictedCashBeginningMinor = sumBalances(beginningBalances, restrictedAccountIds);
    const restrictedCashEndingMinor = sumBalances(endingBalances, restrictedAccountIds);
    const measuredNetChangeMinor = endingCashMinor - beginningCashMinor;
    const warnings = buildWarnings(snapshot.accounts, financialClassifications, cashAccountIds, restrictedAccountIds, query,
      beginningBalances, endingBalances,
      restrictedCashBeginningMinor, restrictedCashEndingMinor, beginningDate,
      beginningProjection.differenceMinor, endingProjection.differenceMinor,
      operating.hierarchyIssues);
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

    // Slice 10 extends the indirect Net Profit/noncash rows with working-capital
    // adjustments. Investing and Financing remain outside this slice.
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
  readonly hierarchyIssues: readonly WorkingCapitalHierarchyIssue[];
}

interface WorkingCapitalRows {
  readonly rows: readonly CashFlowRow[];
  readonly detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
  readonly contributions: readonly CashFlowContribution[];
  readonly netOperatingMinor: bigint;
  readonly hierarchyIssues: readonly WorkingCapitalHierarchyIssue[];
}

interface WorkingCapitalAccount {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly account: FinancialAccount | ChartAccount;
  readonly classification: CashFlowClassificationRecord;
  readonly parentId: string | undefined;
  readonly accountPath: string;
  readonly openingAmountMinor: bigint;
  readonly endingAmountMinor: bigint;
  readonly rawChangeMinor: bigint;
  readonly amountMinor: bigint;
  readonly rowId: CashFlowRow['rowId'];
  readonly detailKey: NonNullable<CashFlowRow['detailKey']>;
  readonly contributions: readonly CashFlowContribution[];
}

interface BalanceComponent {
  readonly sourceId: string;
  readonly businessDate?: string;
  readonly transactionId?: string;
  readonly splitId?: string;
  readonly transferId?: string;
  readonly sourceBatchId?: string;
  readonly payee?: string;
  readonly description: string;
  readonly memo?: string;
  readonly contributionMinor: bigint;
}

interface RenderedWorkingCapitalNode {
  readonly totalMinor: bigint;
  readonly rendered: boolean;
  readonly rows: readonly CashFlowRow[];
}

interface WorkingCapitalHierarchyIssue {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY';
  readonly parentId?: string;
  readonly reason: 'MISSING_PARENT' | 'NONPARTICIPATING_PARENT' | 'CYCLE' | 'INVALID_ANCESTOR';
}

function buildNetProfitAndNoncashRows(
  query: CashFlowReport['query'],
  chartAccounts: readonly import('../domain-model/accounting.types').ChartAccount[],
  classifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  profitAndLoss: UnadjustedProfitLossProjection,
  workingCapital: WorkingCapitalRows,
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
  const netOperatingMinor = profitAndLoss.netProfitMinor + noncashMinor + workingCapital.netOperatingMinor;
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
  const allContributions = [...allOperatingContributions, ...workingCapital.contributions];
  const details: Record<string, readonly CashFlowContribution[]> = {
    [netProfitDetailKey]: netProfitContributions,
    [netOperatingDetailKey]: allContributions,
  };
  adjustments.forEach(adjustment => {
    details[adjustment.detailKey] = adjustment.contributions;
  });
  Object.entries(workingCapital.detailIndex).forEach(([key, contributions]) => { details[key] = contributions; });
  assertDetailAmount(netProfitRow, details[netProfitDetailKey]);
  adjustmentRows.forEach(row => assertDetailAmount(row, details[row.detailKey!]));
  workingCapital.rows.filter(row => row.amountMinor !== undefined).forEach(row => assertDetailAmount(row, details[row.detailKey!]));
  assertDetailAmount(netOperatingRow, details[netOperatingDetailKey]);
  return {
    rows: Object.freeze([sectionRow, netProfitRow, ...adjustmentRows, ...workingCapital.rows, netOperatingRow]),
    detailIndex: Object.freeze(details),
    netOperatingMinor,
    hierarchyIssues: workingCapital.hierarchyIssues,
  };
}

function buildWorkingCapitalRows(
  query: CashFlowReport['query'],
  snapshot: BalanceSheetRepositorySnapshot,
  beginningProjection: BalanceSheetProjection,
  endingProjection: BalanceSheetProjection,
  classifications: readonly CashFlowClassificationRecord[],
): WorkingCapitalRows {
  const sourceById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  const beginningSources = new Map(beginningProjection.sourceBalances.map(balance => [balance.account.id, balance]));
  const endingSources = new Map(endingProjection.sourceBalances.map(balance => [balance.account.id, balance]));
  const beginningCharts = new Map(beginningProjection.chartBalances.map(balance => [balance.account.id, balance]));
  const endingCharts = new Map(endingProjection.chartBalances.map(balance => [balance.account.id, balance]));
  const beginningChartComponents = chartBalanceComponentsByAccount(snapshot, dayBeforeBusinessDate(query.startDate));
  const endingChartComponents = chartBalanceComponentsByAccount(snapshot, query.endDate);
  const candidates = classifications
    .filter(classification => classification.treatment === 'OPERATING_ASSET' || classification.treatment === 'OPERATING_LIABILITY')
    .map(classification => {
      if (classification.treatment !== 'OPERATING_ASSET' && classification.treatment !== 'OPERATING_LIABILITY') return undefined;
      const account = classification.accountRole === 'FINANCIAL_SOURCE'
        ? sourceById.get(classification.accountId)
        : chartById.get(classification.accountId);
      if (!account || !workingCapitalTypeAllowed(account.accountType, classification.treatment)) return undefined;
      const openingBalance = classification.accountRole === 'FINANCIAL_SOURCE'
        ? beginningSources.get(account.id)
        : beginningCharts.get(account.id);
      const endingBalance = classification.accountRole === 'FINANCIAL_SOURCE'
        ? endingSources.get(account.id)
        : endingCharts.get(account.id);
      const openingAmountMinor = openingBalance?.amountMinor ?? 0n;
      const endingAmountMinor = endingBalance?.amountMinor ?? 0n;
      const rawChangeMinor = endingAmountMinor - openingAmountMinor;
      const amountMinor = classification.treatment === 'OPERATING_ASSET' ? -rawChangeMinor : rawChangeMinor;
      const rowId = cashFlowAccountRowId('OPERATING', classification.accountRole, account.id);
      const detailKey = cashFlowDetailKey(rowId);
      const accountPath = classification.accountRole === 'FINANCIAL_SOURCE'
        ? financialAccountPath(account.id, sourceById)
        : chartAccountPath(account.id, chartById);
      const contributions = balanceChangeContributions(
        classification,
        account,
        accountPath,
        openingBalance,
        endingBalance,
        classification.accountRole === 'CHART' ? beginningChartComponents.get(account.id) ?? [] : undefined,
        classification.accountRole === 'CHART' ? endingChartComponents.get(account.id) ?? [] : undefined,
        openingAmountMinor,
        endingAmountMinor,
        rawChangeMinor,
        detailKey,
      );
      if (contributions.reduce((sum, contribution) => sum + contribution.contributionMinor, 0n) !== amountMinor) {
        throw new Error(`Working-capital detail does not reconcile for ${classification.accountRole}/${account.id}.`);
      }
      return {
        accountRole: classification.accountRole,
        account,
        classification,
        parentId: classification.accountRole === 'FINANCIAL_SOURCE'
          ? (account as FinancialAccount).parentAccountId
          : (account as ChartAccount).parentId,
        accountPath,
        openingAmountMinor,
        endingAmountMinor,
        rawChangeMinor,
        amountMinor,
        rowId,
        detailKey,
        contributions,
      } satisfies WorkingCapitalAccount;
    })
    .filter((candidate): candidate is WorkingCapitalAccount => candidate !== undefined);

  const detailIndex: Record<string, readonly CashFlowContribution[]> = {};
  candidates.forEach(candidate => { detailIndex[candidate.detailKey] = candidate.contributions; });
  const hierarchyIssues = detectWorkingCapitalHierarchyIssues(candidates, snapshot);
  const invalidKeys = new Set(hierarchyIssues.map(issue => workingCapitalCandidateKey(issue.accountRole, issue.accountId)));
  const rows: CashFlowRow[] = [];
  const orderedContributions: CashFlowContribution[] = [];
  for (const treatment of ['OPERATING_ASSET', 'OPERATING_LIABILITY'] as const) {
    const groupCandidates = candidates.filter(candidate => candidate.classification.treatment === treatment);
    const validCandidates = groupCandidates.filter(candidate => !invalidKeys.has(workingCapitalCandidateKey(candidate.accountRole, candidate.account.id)));
    const reviewCandidates = groupCandidates.filter(candidate => invalidKeys.has(workingCapitalCandidateKey(candidate.accountRole, candidate.account.id)));
    const groupResult = renderWorkingCapitalGroup(query, treatment, validCandidates, reviewCandidates, detailIndex);
    if (groupResult.rows.length > 0) rows.push(...groupResult.rows);
    orderedContributions.push(...flattenWorkingCapitalNodes(groupCandidates).flatMap(candidate => candidate.contributions));
  }
  const netOperatingMinor = candidates.reduce((sum, candidate) => sum + candidate.amountMinor, 0n);
  return {
    rows: Object.freeze(rows),
    detailIndex: Object.freeze(detailIndex),
    contributions: Object.freeze(orderedContributions),
    netOperatingMinor,
    hierarchyIssues: Object.freeze(hierarchyIssues),
  };
}

function workingCapitalTypeAllowed(accountType: string, treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY'): boolean {
  if (!getAccountTypeDefinition(accountType).ok) return false;
  return treatment === 'OPERATING_ASSET'
    ? ['ACCOUNTS_RECEIVABLE', 'OTHER_CURRENT_ASSET'].includes(accountType)
    : ['CREDIT_CARD', 'ACCOUNTS_PAYABLE', 'OTHER_CURRENT_LIABILITY'].includes(accountType);
}

function renderWorkingCapitalGroup(
  query: CashFlowReport['query'],
  treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY',
  candidates: readonly WorkingCapitalAccount[],
  reviewCandidates: readonly WorkingCapitalAccount[],
  detailIndex: Record<string, readonly CashFlowContribution[]>,
): { readonly rows: readonly CashFlowRow[] } {
  if (candidates.length === 0 && reviewCandidates.length === 0) return { rows: [] };
  const byKey = new Map(candidates.map(candidate => [`${candidate.accountRole}:${candidate.account.id}`, candidate]));
  const children = new Map<string, WorkingCapitalAccount[]>();
  const roots: WorkingCapitalAccount[] = [];
  candidates.forEach(candidate => {
    const parentKey = candidate.parentId ? `${candidate.accountRole}:${candidate.parentId}` : undefined;
    if (parentKey && byKey.has(parentKey) && parentChainIsAcyclic(candidate, byKey)) {
      children.set(parentKey, [...(children.get(parentKey) ?? []), candidate]);
    } else {
      roots.push(candidate);
    }
  });
  const compare = workingCapitalAccountOrder;
  const renderedRoots = roots.sort(compare).map(root => renderWorkingCapitalNode(query, treatment, root, children, byKey, detailIndex, compare));
  const visibleRows = renderedRoots.filter(result => result.rendered).flatMap(result => result.rows);
  const groupLabel = treatment === 'OPERATING_ASSET' ? 'Operating assets' : 'Operating liabilities';
  const rows: CashFlowRow[] = [];
  if (visibleRows.length > 0) {
    rows.push({
      rowId: workingCapitalGroupRowId(treatment, query),
      rowType: 'GROUP_HEADER', section: 'OPERATING', label: groupLabel, depth: 1,
      bold: true, derived: true, archived: false, reviewRequired: false,
    }, ...visibleRows);
  }
  const visibleReviewCandidates = reviewCandidates
    .filter(candidate => query.includeZeroRows || candidate.amountMinor !== 0n)
    .slice().sort(compare);
  if (visibleReviewCandidates.length > 0) {
    rows.push({
      rowId: workingCapitalReviewGroupRowId(treatment, query),
      rowType: 'GROUP_HEADER', section: 'OPERATING', label: `${groupLabel} — hierarchy review`, depth: 1,
      bold: true, derived: true, archived: false, reviewRequired: true,
    });
    rows.push(...visibleReviewCandidates.map(candidate => workingCapitalReviewRow(candidate)));
  }
  return { rows };
}

function workingCapitalReviewRow(candidate: WorkingCapitalAccount): CashFlowRow {
  return {
    rowId: candidate.rowId,
    rowType: 'ACCOUNT_ACTIVITY', section: 'OPERATING', treatment: candidate.classification.treatment,
    accountRole: candidate.accountRole, accountId: candidate.account.id,
    label: leafAccountName(candidate.account.name), fullPath: candidate.accountPath, depth: 2,
    amountMinor: candidate.amountMinor, detailKey: candidate.detailKey,
    bold: false, derived: true, archived: candidate.account.archived, reviewRequired: true,
  };
}

function workingCapitalCandidateKey(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): string {
  return `${accountRole}:${accountId}`;
}

function detectWorkingCapitalHierarchyIssues(
  candidates: readonly WorkingCapitalAccount[],
  snapshot: BalanceSheetRepositorySnapshot,
): readonly WorkingCapitalHierarchyIssue[] {
  const byKey = new Map(candidates.map(candidate => [workingCapitalCandidateKey(candidate.accountRole, candidate.account.id), candidate]));
  const sourceById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  const issues = new Map<string, WorkingCapitalHierarchyIssue>();
  const parentFor = (candidate: WorkingCapitalAccount): WorkingCapitalAccount | undefined => {
    if (!candidate.parentId) return undefined;
    return byKey.get(workingCapitalCandidateKey(candidate.accountRole, candidate.parentId));
  };
  const parentExists = (candidate: WorkingCapitalAccount): boolean => candidate.accountRole === 'FINANCIAL_SOURCE'
    ? sourceById.has(candidate.parentId ?? '')
    : chartById.has(candidate.parentId ?? '');
  const addIssue = (candidate: WorkingCapitalAccount, reason: WorkingCapitalHierarchyIssue['reason']): void => {
    const key = workingCapitalCandidateKey(candidate.accountRole, candidate.account.id);
    if (issues.has(key)) return;
    issues.set(key, {
      accountRole: candidate.accountRole,
      accountId: candidate.account.id,
      treatment: candidate.classification.treatment as 'OPERATING_ASSET' | 'OPERATING_LIABILITY',
      parentId: candidate.parentId,
      reason,
    });
  };

  for (const candidate of candidates) {
    if (!candidate.parentId) continue;
    const parent = parentFor(candidate);
    if (!parentExists(candidate)) addIssue(candidate, 'MISSING_PARENT');
    else if (!parent || parent.classification.treatment !== candidate.classification.treatment) addIssue(candidate, 'NONPARTICIPATING_PARENT');
  }

  // Walk each candidate's parent chain once. A repeated key identifies the
  // complete cycle; descendants of a cycle are handled in the propagation pass.
  for (const candidate of candidates) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: WorkingCapitalAccount | undefined = candidate;
    while (current) {
      const currentKey = workingCapitalCandidateKey(current.accountRole, current.account.id);
      const previousIndex = pathIndexes.get(currentKey);
      if (previousIndex !== undefined) {
        for (const cycleKey of path.slice(previousIndex)) {
          const cycleCandidate = byKey.get(cycleKey);
          if (cycleCandidate) addIssue(cycleCandidate, 'CYCLE');
        }
        break;
      }
      if (issues.has(currentKey)) break;
      pathIndexes.set(currentKey, path.length);
      path.push(currentKey);
      current = parentFor(current);
    }
  }

  // A candidate below an invalid parent cannot safely retain a parentRowId;
  // keep it in the same deterministic review group instead of flattening it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!candidate.parentId) continue;
      const key = workingCapitalCandidateKey(candidate.accountRole, candidate.account.id);
      if (issues.has(key)) continue;
      const parentKey = workingCapitalCandidateKey(candidate.accountRole, candidate.parentId);
      if (issues.has(parentKey)) {
        addIssue(candidate, 'INVALID_ANCESTOR');
        changed = true;
      }
    }
  }

  return [...issues.values()].sort((left, right) =>
    left.accountRole.localeCompare(right.accountRole)
    || left.treatment.localeCompare(right.treatment)
    || left.accountId.localeCompare(right.accountId));
}

function parentChainIsAcyclic(node: WorkingCapitalAccount, accounts: ReadonlyMap<string, WorkingCapitalAccount>): boolean {
  const visited = new Set<string>([`${node.accountRole}:${node.account.id}`]);
  let parentKey = node.parentId ? `${node.accountRole}:${node.parentId}` : undefined;
  while (parentKey) {
    if (visited.has(parentKey)) return false;
    visited.add(parentKey);
    const parent = accounts.get(parentKey);
    if (!parent) return true;
    parentKey = parent.parentId ? `${parent.accountRole}:${parent.parentId}` : undefined;
  }
  return true;
}

function renderWorkingCapitalNode(
  query: CashFlowReport['query'],
  treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY',
  node: WorkingCapitalAccount,
  children: ReadonlyMap<string, readonly WorkingCapitalAccount[]>,
  byKey: ReadonlyMap<string, WorkingCapitalAccount>,
  detailIndex: Record<string, readonly CashFlowContribution[]>,
  compare: (left: WorkingCapitalAccount, right: WorkingCapitalAccount) => number,
): RenderedWorkingCapitalNode {
  const childResults = (children.get(`${node.accountRole}:${node.account.id}`) ?? [])
    .slice().sort(compare).map(child => renderWorkingCapitalNode(query, treatment, child, children, byKey, detailIndex, compare));
  const childTotal = childResults.reduce((sum, result) => sum + result.totalMinor, 0n);
  const totalMinor = node.amountMinor + childTotal;
  const visibleChildren = childResults.filter(result => result.rendered);
  const shouldRender = query.includeZeroRows || node.amountMinor !== 0n || visibleChildren.length > 0;
  const depth = accountDepth(node, byKey);
  const accountRow: CashFlowRow = {
    rowId: node.rowId,
    rowType: 'ACCOUNT_ACTIVITY', section: 'OPERATING', treatment,
    accountRole: node.accountRole, accountId: node.account.id,
    parentRowId: node.parentId && byKey.has(`${node.accountRole}:${node.parentId}`)
      ? cashFlowAccountRowId('OPERATING', node.accountRole, node.parentId)
      : undefined,
    label: leafAccountName(node.account.name), fullPath: node.accountPath, depth,
    amountMinor: node.amountMinor, detailKey: node.detailKey, bold: false, derived: true,
    archived: node.account.archived,
    reviewRequired: node.classification.status === 'REVIEW_REQUIRED',
  };
  const rows: CashFlowRow[] = [accountRow, ...visibleChildren.flatMap(result => result.rows)];
  if (childResults.length > 0) {
    const subtotalRowId = workingCapitalSubtotalRowId(node, query);
    const subtotalDetailKey = cashFlowDetailKey(subtotalRowId);
    const subtree = collectWorkingCapitalSubtree(node, children, compare);
    const subtotalContributions = subtree.flatMap(candidate => candidate.contributions.map(contribution => ({
      ...contribution,
      contributionId: `subtotal:${subtotalRowId}:${contribution.contributionId}`,
      childRowId: candidate.rowId,
      detailKey: subtotalDetailKey,
    })));
    detailIndex[subtotalDetailKey] = subtotalContributions;
    assertDetailAmount({ rowId: subtotalRowId, rowType: 'SUBTOTAL', section: 'OPERATING', label: '', depth, bold: true, derived: true, archived: false, reviewRequired: false, amountMinor: totalMinor }, subtotalContributions);
    if (query.includeZeroRows || visibleChildren.length > 0) {
      rows.push({
        rowId: subtotalRowId,
        rowType: 'SUBTOTAL', section: 'OPERATING', treatment,
        accountRole: node.accountRole, accountId: node.account.id,
        parentRowId: node.rowId, label: `Total for ${leafAccountName(node.account.name)}`,
        fullPath: node.accountPath, depth, amountMinor: totalMinor, detailKey: subtotalDetailKey,
        bold: true, derived: true, archived: node.account.archived,
        reviewRequired: subtree.some(candidate => candidate.classification.status === 'REVIEW_REQUIRED'),
      });
    }
  }
  return { totalMinor, rendered: shouldRender, rows: shouldRender ? rows : [] };
}

function collectWorkingCapitalSubtree(
  node: WorkingCapitalAccount,
  children: ReadonlyMap<string, readonly WorkingCapitalAccount[]>,
  compare: (left: WorkingCapitalAccount, right: WorkingCapitalAccount) => number,
): readonly WorkingCapitalAccount[] {
  return [node, ...(children.get(`${node.accountRole}:${node.account.id}`) ?? []).slice().sort(compare).flatMap(child => collectWorkingCapitalSubtree(child, children, compare))];
}

function flattenWorkingCapitalNodes(candidates: readonly WorkingCapitalAccount[]): readonly WorkingCapitalAccount[] {
  const byKey = new Map(candidates.map(candidate => [`${candidate.accountRole}:${candidate.account.id}`, candidate]));
  const children = new Map<string, WorkingCapitalAccount[]>();
  const roots: WorkingCapitalAccount[] = [];
  candidates.forEach(candidate => {
    const parentKey = candidate.parentId ? `${candidate.accountRole}:${candidate.parentId}` : undefined;
    if (parentKey && byKey.has(parentKey) && parentChainIsAcyclic(candidate, byKey)) children.set(parentKey, [...(children.get(parentKey) ?? []), candidate]);
    else roots.push(candidate);
  });
  const flatten = (node: WorkingCapitalAccount): readonly WorkingCapitalAccount[] => [node, ...(children.get(`${node.accountRole}:${node.account.id}`) ?? []).slice().sort(workingCapitalAccountOrder).flatMap(flatten)];
  return roots.sort(workingCapitalAccountOrder).flatMap(flatten);
}

function accountDepth(node: WorkingCapitalAccount, accounts: ReadonlyMap<string, WorkingCapitalAccount>): number {
  // Rows are grouped below the Operating section/group headers. Parent depth is
  // structural only and does not affect calculation or stable identity.
  let depth = 2;
  let parent = node.parentId;
  const visited = new Set<string>();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    const ancestor = accounts.get(`${node.accountRole}:${parent}`);
    parent = ancestor?.parentId;
  }
  return depth;
}

function workingCapitalAccountOrder(left: WorkingCapitalAccount, right: WorkingCapitalAccount): number {
  const leftOrder = left.accountRole === 'CHART' ? (left.account as ChartAccount).displayOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = right.accountRole === 'CHART' ? (right.account as ChartAccount).displayOrder : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.accountPath.localeCompare(right.accountPath) || left.account.id.localeCompare(right.account.id);
}

function workingCapitalGroupRowId(treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY', query: CashFlowReport['query']): CashFlowRow['rowId'] {
  return `GROUP:OPERATING:${treatment}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function workingCapitalReviewGroupRowId(treatment: 'OPERATING_ASSET' | 'OPERATING_LIABILITY', query: CashFlowReport['query']): CashFlowRow['rowId'] {
  return `GROUP:OPERATING:HIERARCHY_REVIEW:${treatment}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function workingCapitalSubtotalRowId(node: WorkingCapitalAccount, query: CashFlowReport['query']): CashFlowRow['rowId'] {
  return `SUBTOTAL:OPERATING:${node.accountRole}:${encodeURIComponent(node.account.id)}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function balanceChangeContributions(
  classification: CashFlowClassificationRecord,
  account: FinancialAccount | ChartAccount,
  accountPath: string,
  openingBalance: FinancialSourceBalance | ChartBalance | undefined,
  endingBalance: FinancialSourceBalance | ChartBalance | undefined,
  openingChartComponents: readonly BalanceComponent[] | undefined,
  endingChartComponents: readonly BalanceComponent[] | undefined,
  openingAmountMinor: bigint,
  endingAmountMinor: bigint,
  rawChangeMinor: bigint,
  detailKey: NonNullable<CashFlowRow['detailKey']>,
): readonly CashFlowContribution[] {
  const openingComponents = classification.accountRole === 'FINANCIAL_SOURCE'
    ? financialBalanceComponents(openingBalance as FinancialSourceBalance | undefined, account as FinancialAccount)
    : openingChartComponents ?? [];
  const endingComponents = classification.accountRole === 'FINANCIAL_SOURCE'
    ? financialBalanceComponents(endingBalance as FinancialSourceBalance | undefined, account as FinancialAccount)
    : endingChartComponents ?? [];
  const openingMultiplier = classification.treatment === 'OPERATING_ASSET' ? 1n : -1n;
  const endingMultiplier = classification.treatment === 'OPERATING_ASSET' ? -1n : 1n;
  const formula = classification.treatment === 'OPERATING_ASSET' ? 'Opening - Ending' : 'Ending - Opening';
  const contributions = [
    ...openingComponents.map(component => balanceChangeContribution(component, openingMultiplier, 'OPENING', classification, account, accountPath, openingAmountMinor, endingAmountMinor, rawChangeMinor, formula, detailKey)),
    ...endingComponents.map(component => balanceChangeContribution(component, endingMultiplier, 'ENDING', classification, account, accountPath, openingAmountMinor, endingAmountMinor, rawChangeMinor, formula, detailKey)),
  ];
  if (contributions.length > 0) return contributions;
  return [formulaBalanceChangeContribution(classification, account, accountPath, openingAmountMinor, endingAmountMinor, rawChangeMinor, formula, detailKey)];
}

function formulaBalanceChangeContribution(
  classification: CashFlowClassificationRecord,
  account: FinancialAccount | ChartAccount,
  accountPath: string,
  openingAmountMinor: bigint,
  endingAmountMinor: bigint,
  rawChangeMinor: bigint,
  formula: string,
  detailKey: NonNullable<CashFlowRow['detailKey']>,
): CashFlowContribution {
  return {
    contributionId: `balance-change:formula:${classification.accountRole}:${encodeURIComponent(account.id)}`,
    detailKey,
    contributionType: 'FORMULA',
    contributionMinor: 0n,
    accountRole: classification.accountRole,
    accountId: account.id,
    accountName: account.name,
    ...(classification.accountRole === 'CHART' ? { chartAccountId: account.id, chartAccountPath: accountPath } : {}),
    description: 'No Balance Sheet activity',
    openingAmountMinor,
    endingAmountMinor,
    rawChangeMinor,
    formula,
  };
}

function financialBalanceComponents(
  balance: FinancialSourceBalance | undefined,
  account: FinancialAccount,
): readonly BalanceComponent[] {
  if (!balance) return [];
  const components: BalanceComponent[] = [];
  if (balance.openingAmountMinor !== 0n) {
    components.push({ sourceId: `opening:${account.id}:${account.openingBalanceDate}`, businessDate: account.openingBalanceDate, description: 'Opening balance', contributionMinor: balance.openingAmountMinor });
  }
  balance.transactions.forEach(transaction => {
    components.push({
      sourceId: `${transaction.state === 'MATCHED_TRANSFER' ? 'transfer' : 'transaction'}:${transaction.id}`,
      businessDate: transaction.postingDate, transactionId: transaction.id, transferId: transaction.transferMatchId,
      sourceBatchId: transaction.sourceBatchId, payee: transaction.payee, description: transaction.description,
      memo: transaction.memo, contributionMinor: naturalBalanceAmount(account.accountType, transaction.amount.minorUnits),
    });
  });
  return components;
}

function chartBalanceComponentsByAccount(
  snapshot: BalanceSheetRepositorySnapshot,
  asOfDate: string,
): ReadonlyMap<string, readonly BalanceComponent[]> {
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  const components = new Map<string, BalanceComponent[]>();
  const transactions = snapshot.transactions
    .filter(transaction => transaction.state === 'POSTED' && transaction.postingDate <= asOfDate)
    .slice().sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id));
  for (const transaction of transactions) {
    for (const split of transaction.splits.slice().sort((left, right) => left.id.localeCompare(right.id))) {
      const account = chartById.get(split.chartAccountId);
      const definition = account ? getAccountTypeDefinition(account.accountType) : undefined;
      if (!account || !definition?.ok || !definition.value.balanceSheetSection) continue;
      const row = {
        sourceId: `split:${split.id}`, businessDate: transaction.postingDate, transactionId: transaction.id, splitId: split.id,
        sourceBatchId: transaction.sourceBatchId, payee: transaction.payee, description: transaction.description,
        memo: split.memo ?? transaction.memo, contributionMinor: chartBalanceAmount(account.accountType, split.amount.minorUnits),
      } satisfies BalanceComponent;
      const bucket = components.get(account.id);
      if (bucket) bucket.push(row);
      else components.set(account.id, [row]);
    }
  }
  return components;
}

function balanceChangeContribution(
  component: BalanceComponent,
  multiplier: bigint,
  side: 'OPENING' | 'ENDING',
  classification: CashFlowClassificationRecord,
  account: FinancialAccount | ChartAccount,
  accountPath: string,
  openingAmountMinor: bigint,
  endingAmountMinor: bigint,
  rawChangeMinor: bigint,
  formula: string,
  detailKey: NonNullable<CashFlowRow['detailKey']>,
): CashFlowContribution {
  return {
    contributionId: `balance-change:${side}:${classification.accountRole}:${encodeURIComponent(account.id)}:${component.sourceId}`,
    detailKey,
    contributionType: 'BALANCE_CHANGE',
    contributionMinor: multiplier * component.contributionMinor,
    businessDate: component.businessDate,
    accountRole: classification.accountRole,
    accountId: account.id,
    accountName: account.name,
    ...(classification.accountRole === 'CHART' ? { chartAccountId: account.id, chartAccountPath: accountPath } : {}),
    transactionId: component.transactionId,
    splitId: component.splitId,
    transferId: component.transferId,
    sourceBatchId: component.sourceBatchId,
    payee: component.payee,
    // Preserve the source Balance Sheet contribution fields verbatim; side and
    // sign transformation are carried by the stable ID and formula metadata.
    description: component.description,
    memo: component.memo,
    openingAmountMinor,
    endingAmountMinor,
    rawChangeMinor,
    formula,
  };
}

function naturalBalanceAmount(accountType: string, amountMinor: bigint): bigint {
  const definition = getAccountTypeDefinition(accountType);
  return definition.ok && definition.value.naturalBalance === 'CREDIT' ? -amountMinor : amountMinor;
}

/** Chart Balance Sheet rows use the existing presentation sign convention:
 * debit-natural balances are the negation of stored split amounts, while
 * credit-natural balances retain the stored sign. */
function chartBalanceAmount(accountType: string, amountMinor: bigint): bigint {
  const definition = getAccountTypeDefinition(accountType);
  return definition.ok && definition.value.naturalBalance === 'DEBIT' ? -amountMinor : amountMinor;
}

function financialAccountPath(accountId: string, accounts: ReadonlyMap<string, FinancialAccount>): string {
  const parts: string[] = [];
  const visited = new Set<string>();
  let current = accounts.get(accountId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parts.unshift(leafAccountName(current.name));
    current = current.parentAccountId ? accounts.get(current.parentAccountId) : undefined;
  }
  return parts.join(' > ');
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
  hierarchyIssues: readonly WorkingCapitalHierarchyIssue[],
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
  for (const issue of hierarchyIssues) {
    const references = [issue.accountRole, issue.accountId, ...(issue.parentId ? [issue.parentId] : [])];
    warnings.push({
      warningId: cashFlowWarningId('ACCOUNT_HIERARCHY_INVALID', references, query),
      code: 'ACCOUNT_HIERARCHY_INVALID',
      message: `${issue.accountRole === 'CHART' ? 'Chart' : 'Financial'} account ${issue.accountId} has an invalid parent hierarchy (${issue.reason.toLowerCase().replaceAll('_', ' ')}).`,
      accountRole: issue.accountRole,
      accountId: issue.accountId,
      references,
    });
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
