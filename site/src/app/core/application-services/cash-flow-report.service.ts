import { Injectable, inject } from '@angular/core';
import { ChartAccount, FinancialAccount, PostingSplit, Transaction, TransferMatch } from '../domain-model/accounting.types';
import { getAccountTypeDefinition } from '../domain-model/account-taxonomy';
import { validateCashFlowClassification } from '../domain-model/cash-flow-classification';
import { reportCompanyIdentity } from '../domain-model/balance-sheet.types';
import {
  CashFlowContractError,
  CashFlowContribution,
  CashFlowDetail,
  CashFlowDisclosure,
  CASH_FLOW_CONTRACT_VERSION,
  CashFlowReportIdentity,
  CashFlowQueryInput,
  CashFlowReport,
  CashFlowRow,
  CashFlowWarning,
  GetCashFlowDetailCommand,
  cashFlowAccountRowId,
  cashFlowDetailKey,
  cashFlowReportId,
  cashFlowSyntheticRowId,
  cashFlowWarningId,
  freezeCashFlowReport,
  normalizeCashFlowQuery,
  validateCashFlowDetail,
} from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, BalanceSheetRepositorySnapshot, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { BalanceSheetProjection, ChartBalance, FinancialSourceBalance, calculateBalanceSheetProjection, calculateFinancialSourceBalances } from './balance-sheet-report.service';
import { calculateUnadjustedProfitLoss, UnadjustedProfitLossContribution, UnadjustedProfitLossProjection } from './profit-loss-calculation';

@Injectable({ providedIn: 'root' })
export class CashFlowReportService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;
  /**
   * Reports are immutable values. Keep one value per normalized query and
   * revision so repeated reads do not recalculate (or observe a second
   * snapshot), while a repository revision change invalidates every cached
   * value. The report id intentionally omits the presentation-only zero-row
   * flag, so the cache key includes it separately.
   */
  private readonly reportCache = new Map<string, CashFlowReport>();
  /**
   * Detail commands carry only report identity. Retain the most complete
   * presentation for each identity so a detail request for a zero-valued row
   * still works when the first report read used the hidden-zero view.
   */
  private readonly reportsById = new Map<string, CashFlowReport>();
  private cachedRevision?: string;

  getCashFlowReport(input: CashFlowQueryInput): CashFlowReport {
    const normalized = normalizeCashFlowQuery(input, this.repository.company);
    if (!normalized.ok) throw new CashFlowContractError(normalized.error);
    const query = normalized.value;
    const currentRevision = this.repository.getDatabaseRevision();
    this.invalidateIfRevisionChanged(currentRevision);
    const cacheKey = cashFlowReportCacheKey(currentRevision, query);
    const cached = this.reportCache.get(cacheKey);
    if (cached) return cached;
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
    } catch (error) {
      if (error instanceof CashFlowContractError) throw error;
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
    let cashSide: CashSideActivity;
    try {
      cashSide = buildCashSideActivity(query, snapshot, cashAccountIds, restrictedAccountIds, classifications);
    } catch (error) {
      if (error instanceof CashFlowContractError) throw error;
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Cash-side posting could not be reconciled for this Cash Flow period.',
        retryable: false,
      });
    }
    const investing = renderCashFlowActivitySection(query, 'INVESTING', cashSide.investing, cashSide.hierarchyIssues);
    const financing = renderCashFlowActivitySection(query, 'FINANCING', cashSide.financing, cashSide.hierarchyIssues);
    let noncash: NoncashDisclosureRows;
    try {
      noncash = buildNoncashDisclosures(query, snapshot, classifications, cashAccountIds, restrictedAccountIds);
    } catch (error) {
      if (error instanceof CashFlowContractError) throw error;
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Recorded noncash activity could not be validated for this Cash Flow period.',
        retryable: false,
      });
    }
    const netChangeMinor = operating.netOperatingMinor + investing.amountMinor + financing.amountMinor;
    const netChangeRowId = cashFlowSyntheticRowId('NET_CHANGE_IN_CASH', query);
    const netChangeDetailKey = cashFlowDetailKey(netChangeRowId);
    const netChangeContributions = [
      activityFormulaContribution(netChangeDetailKey, operating.netOperatingMinor, cashFlowSyntheticRowId('NET_OPERATING', query), 'Net operating activities'),
      activityFormulaContribution(netChangeDetailKey, investing.amountMinor, cashFlowSyntheticRowId('NET_INVESTING', query), 'Net investing activities'),
      activityFormulaContribution(netChangeDetailKey, financing.amountMinor, cashFlowSyntheticRowId('NET_FINANCING', query), 'Net financing activities'),
    ];
    // Net Change is always derived from the three statement sections. Any
    // included cash movement that could not be classified remains outside
    // those sections and is exposed through Difference instead of being
    // silently absorbed into the measured cash-boundary movement.
    const calculatedEndingCashMinor = beginningCashMinor + netChangeMinor;
    const differenceMinor = calculatedEndingCashMinor - endingCashMinor;
    const chartClassifications = new Map(classifications
      .filter(classification => classification.accountRole === 'CHART')
      .map(classification => [classification.accountId, classification]));
    const warnings = buildWarnings(snapshot.accounts, snapshot.chartAccounts, snapshot.transactions, classifications,
      financialClassifications, chartClassifications, cashAccountIds, restrictedAccountIds, query,
      beginningBalances, endingBalances,
      beginningProjection.chartBalances, endingProjection.chartBalances,
      restrictedCashBeginningMinor, restrictedCashEndingMinor, beginningDate,
      beginningProjection.differenceMinor, endingProjection.differenceMinor,
      [...operating.hierarchyIssues, ...cashSide.hierarchyIssues, ...noncash.hierarchyIssues], cashSide.unclassifiedReferences,
      cashSide.excludedReferences, differenceMinor, cashSide.transferWarningReferences,
      noncash.disclosures.flatMap(disclosure => [
        disclosure.disclosureId,
        disclosure.transactionId,
        disclosure.accountId,
        ...(disclosure.chartAccountId ? [disclosure.chartAccountId] : []),
      ]).filter((reference): reference is string => Boolean(reference)));
    const netChangeRow: CashFlowRow = {
      rowId: netChangeRowId,
      rowType: 'TOTAL', section: 'CASH_RECONCILIATION', label: 'Net increase (decrease) in cash', depth: 0,
      amountMinor: netChangeMinor, detailKey: netChangeDetailKey,
      bold: true, derived: true, archived: false, reviewRequired: false,
    };
    const detailIndex: Record<string, readonly CashFlowContribution[]> = {
      ...operating.detailIndex,
      ...investing.detailIndex,
      ...financing.detailIndex,
      [netChangeDetailKey]: netChangeContributions,
    };
    const reportIdentity = {
      reportId: cashFlowReportId(snapshot.databaseRevision, query),
      databaseRevision: snapshot.databaseRevision,
    } satisfies CashFlowReportIdentity;
    assertCashFlowDetailAmount(netChangeRow, netChangeContributions, reportIdentity);
    if (cashSide.unclassifiedDetailKey) detailIndex[cashSide.unclassifiedDetailKey] = cashSide.unclassifiedContributions;
    if (cashSide.transferDiagnosticContributions.length > 0) {
      detailIndex[transferDiagnosticDetailKey(query)] = cashSide.transferDiagnosticContributions;
    }
    const restrictedDetailKey = restrictedCashDetailKey(query);
    const restrictedContributions = restrictedCashBalanceContributions(query, endingBalances, restrictedAccountIds, restrictedDetailKey);
    detailIndex[restrictedDetailKey] = restrictedContributions;
    const beginningDetailKey = cashFlowDetailKey(cashFlowSyntheticRowId('BEGINNING_CASH', query));
    const endingDetailKey = cashFlowDetailKey(cashFlowSyntheticRowId('ENDING_CASH', query));
    detailIndex[beginningDetailKey] = cashBoundaryContributions(query, beginningBalances, cashAccountIds, beginningDetailKey, 'OPENING');
    detailIndex[endingDetailKey] = cashBoundaryContributions(query, endingBalances, cashAccountIds, endingDetailKey, 'ENDING');
    const differenceDetailKey = cashFlowDetailKey(cashFlowSyntheticRowId('DIFFERENCE', query));
    const cashBoundaryTransactionIds = new Set(cashSide.cashBoundaryTransactionIds);
    const differenceContributions: CashFlowContribution[] = [
      ...cashSide.unclassifiedContributions,
      ...cashSide.excludedContributions,
    ].filter(contribution => Boolean(contribution.transactionId && cashBoundaryTransactionIds.has(contribution.transactionId)))
      .map(contribution => ({
      ...contribution,
      contributionId: `${contribution.contributionId}:reconciliation`,
      detailKey: differenceDetailKey,
      contributionType: 'FORMULA' as const,
      contributionMinor: -contribution.contributionMinor,
      description: contribution.contributionType === 'UNCLASSIFIED'
        ? 'Unclassified cash activity reconciliation difference'
        : 'Excluded cash activity reconciliation difference',
      formula: 'Calculated Ending Cash - Ending Cash',
      }));
    // In-period opening balances have no transaction ID, but they do change
    // the ending cash boundary. Their contribution IDs are explicitly marked
    // by the cash-side projector so Difference can attribute that boundary
    // effect without inventing a transaction source.
    const boundaryContributionIds = new Set(cashSide.cashBoundaryContributionIds);
    differenceContributions.push(...[
      ...cashSide.unclassifiedContributions,
      ...cashSide.excludedContributions,
    ].filter(contribution => boundaryContributionIds.has(contribution.contributionId))
      .map(contribution => ({
        ...contribution,
        contributionId: `${contribution.contributionId}:reconciliation`,
        detailKey: differenceDetailKey,
        contributionType: 'FORMULA' as const,
        contributionMinor: -contribution.contributionMinor,
        description: contribution.contributionType === 'UNCLASSIFIED'
          ? 'In-period opening balance reconciliation difference'
          : 'Excluded cash activity reconciliation difference',
        formula: 'Calculated Ending Cash - Ending Cash',
      })));
    const differenceDetailTotal = differenceContributions.reduce((sum, contribution) => sum + contribution.contributionMinor, 0n);
    if (differenceDetailTotal !== differenceMinor) {
      differenceContributions.push({
        contributionId: `difference:residual:${query.startDate}:${query.endDate}`,
        detailKey: differenceDetailKey,
        contributionType: 'FORMULA',
        contributionMinor: differenceMinor - differenceDetailTotal,
        description: 'Residual calculated ending cash difference',
        formula: 'Calculated Ending Cash - Ending Cash',
      });
    }
    detailIndex[differenceDetailKey] = differenceContributions;
    const rows = [...operating.rows, ...investing.rows, ...financing.rows, netChangeRow,
      ...cashBalanceRows(query, beginningCashMinor, endingCashMinor, restrictedCashEndingMinor, restrictedDetailKey, beginningDetailKey, endingDetailKey,
      cashSide.unclassifiedCashActivityMinor, cashSide.unclassifiedDetailKey, differenceMinor, differenceDetailKey)];
    rows.push(...noncash.rows);
    Object.entries(noncash.detailIndex).forEach(([key, contributions]) => { detailIndex[key] = contributions; });
    rows.filter(row => row.amountMinor !== undefined).forEach(row => assertCashFlowDetailAmount(
      row,
      row.detailKey ? detailIndex[row.detailKey] : undefined,
      reportIdentity,
    ));
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

    const status = warnings.some(warning => isBlockingCashFlowWarning(warning.code))
      ? 'REVIEW_REQUIRED' as const
      : 'COMPLETE' as const;
    // Slice 11 adds actual cash-side Investing and Financing activity to the
    // indirect Operating calculation. Slice 13 appends recorded-only
    // noncash disclosures after reconciliation without changing any cash
    // section total or boundary projection.
    const report = freezeCashFlowReport({
      reportId: cashFlowReportId(snapshot.databaseRevision, query),
      databaseRevision: snapshot.databaseRevision,
      generatedAt: new Date().toISOString(),
      query,
      company: reportCompanyIdentity(profile),
      currencyCode: snapshot.company.currency,
      accountingBasis: snapshot.company.accountingBasis,
      method: 'INDIRECT',
      status,
      rows,
      disclosures: noncash.disclosures,
      netOperatingMinor: operating.netOperatingMinor,
      netInvestingMinor: investing.amountMinor,
      netFinancingMinor: financing.amountMinor,
      netChangeInCashMinor: netChangeMinor,
      beginningCashMinor,
      calculatedEndingCashMinor,
      endingCashMinor,
      differenceMinor,
      restrictedCashBeginningMinor,
      restrictedCashEndingMinor,
      unclassifiedCashActivityMinor: cashSide.unclassifiedCashActivityMinor,
      warnings,
      detailIndex,
    });
    // A repository snapshot is immutable for the duration of this
    // calculation. If a host mutation raced the initial revision check, do
    // not publish a value under the wrong cache key.
    if (snapshot.databaseRevision !== currentRevision) {
      this.reportCache.clear();
      this.reportsById.clear();
      this.cachedRevision = snapshot.databaseRevision;
    }
    const finalCacheKey = cashFlowReportCacheKey(snapshot.databaseRevision, query);
    this.reportCache.set(finalCacheKey, report);
    const existing = this.reportsById.get(report.reportId);
    if (!existing || (!existing.query.includeZeroRows && query.includeZeroRows)) {
      this.reportsById.set(report.reportId, report);
    }
    return report;
  }

  /**
   * Resolve one immutable row detail from a previously generated report.
   * Detail is deliberately revision-bound: callers must regenerate after any
   * report-affecting write instead of reading a stale contribution list.
   */
  getCashFlowDetail(command: GetCashFlowDetailCommand): CashFlowDetail {
    const currentRevision = this.repository.getDatabaseRevision();
    this.invalidateIfRevisionChanged(currentRevision);
    const report = this.reportsById.get(command.reportId);
    if (!report || report.databaseRevision !== command.databaseRevision || currentRevision !== command.databaseRevision) {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_REVISION_STALE',
        message: 'The Statement of Cash Flows report is stale. Regenerate the report before reading detail.',
        reportId: command.reportId,
        databaseRevision: command.databaseRevision,
        retryable: true,
      });
    }
    const row = report.rows.find(candidate => candidate.detailKey === command.detailKey);
    const contributions = report.detailIndex[command.detailKey];
    if (!row || row.amountMinor === undefined || !contributions) {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_DETAIL_NOT_FOUND',
        message: 'Cash Flow detail was not found for the selected report row.',
        reportId: command.reportId,
        databaseRevision: command.databaseRevision,
        detailKey: command.detailKey,
        retryable: false,
      });
    }
    // Aggregate/formula rows intentionally retain each child contribution's
    // source detail key in the report index.  The public detail contract is
    // row-scoped, so normalize that key at the boundary while preserving the
    // immutable contribution identity and provenance.
    const normalizedContributions = contributions.every(contribution => contribution.detailKey === command.detailKey)
      ? contributions
      : Object.freeze(contributions.map(contribution => Object.freeze({ ...contribution, detailKey: command.detailKey })));
    const detail = Object.freeze({
      ...command,
      rowId: row.rowId,
      amountMinor: row.amountMinor,
      contributions: normalizedContributions,
    });
    const validation = validateCashFlowDetail(detail);
    if (!validation.ok) throw new CashFlowContractError(validation.error);
    return validation.value;
  }

  /**
   * Output operations are still implemented by a later slice, but their
   * public boundary must reject a report that no longer matches the books.
   * Unknown current-revision identities are left to the deferred operation
   * so existing callers receive the contract's not-implemented response.
   */
  assertCashFlowReportCurrent(identity: CashFlowReportIdentity): void {
    const currentRevision = this.repository.getDatabaseRevision();
    this.invalidateIfRevisionChanged(currentRevision);
    const report = this.reportsById.get(identity.reportId);
    if (currentRevision !== identity.databaseRevision || (report && report.databaseRevision !== currentRevision)) {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_REPORT_REVISION_STALE',
        message: 'The Statement of Cash Flows report is stale. Regenerate it before exporting or printing.',
        reportId: identity.reportId,
        databaseRevision: identity.databaseRevision,
        retryable: true,
      });
    }
  }

  private invalidateIfRevisionChanged(revision: string): void {
    if (this.cachedRevision === revision) return;
    this.reportCache.clear();
    this.reportsById.clear();
    this.cachedRevision = revision;
  }
}

function cashFlowReportCacheKey(revision: string, query: { readonly startDate: string; readonly endDate: string; readonly includeZeroRows: boolean }): string {
  return `${revision}|${query.startDate}|${query.endDate}|${query.includeZeroRows ? 'WITH_ZERO' : 'NONZERO'}|INDIRECT:v${CASH_FLOW_CONTRACT_VERSION}`;
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

interface CashFlowActivityAccount {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly account: FinancialAccount | ChartAccount;
  readonly classification: CashFlowClassificationRecord;
  readonly parentId?: string;
  readonly accountPath: string;
  readonly amountMinor: bigint;
  readonly rowId: CashFlowRow['rowId'];
  readonly detailKey: NonNullable<CashFlowRow['detailKey']>;
  readonly contributions: readonly CashFlowContribution[];
}

interface CashFlowActivitySection {
  readonly section: 'INVESTING' | 'FINANCING';
  readonly candidates: readonly CashFlowActivityAccount[];
  readonly hierarchyIssues: readonly CashFlowActivityHierarchyIssue[];
  readonly amountMinor: bigint;
  readonly rows: readonly CashFlowRow[];
  readonly detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
}

interface CashSideActivity {
  readonly investing: readonly CashFlowActivityAccount[];
  readonly financing: readonly CashFlowActivityAccount[];
  readonly unclassifiedCashActivityMinor: bigint;
  readonly unclassifiedReferences: readonly string[];
  readonly unclassifiedDetailKey?: CashFlowContribution['detailKey'];
  readonly unclassifiedContributions: readonly CashFlowContribution[];
  /** Transaction IDs that the Balance Sheet cash boundary actually includes. */
  readonly cashBoundaryTransactionIds: readonly string[];
  /** Synthetic boundary contributions (currently in-period openings) that
   * affect Ending Cash without having a transaction ID. */
  readonly cashBoundaryContributionIds: readonly string[];
  readonly excludedContributions: readonly CashFlowContribution[];
  readonly transferDiagnosticContributions: readonly CashFlowContribution[];
  readonly transferDiagnosticReferences: readonly string[];
  readonly transferWarningReferences: readonly string[];
  readonly excludedCashActivityMinor: bigint;
  readonly excludedReferences: readonly string[];
  readonly hierarchyIssues: readonly CashFlowActivityHierarchyIssue[];
}

interface NoncashDisclosureRows {
  readonly rows: readonly CashFlowRow[];
  readonly disclosures: readonly CashFlowDisclosure[];
  readonly detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
  readonly hierarchyIssues: readonly NoncashDisclosureHierarchyIssue[];
}

interface NoncashDisclosureCandidate {
  readonly transaction: Transaction;
  readonly split: PostingSplit;
  readonly source: FinancialAccount;
  readonly sourceClassification: CashFlowClassificationRecord;
  readonly chart: ChartAccount;
  readonly chartClassification: CashFlowClassificationRecord;
  /** The explicit Investing/Financing side that establishes presentation. */
  readonly sectionTreatment: 'INVESTING' | 'FINANCING';
  readonly amountMinor: bigint;
  readonly rowId: CashFlowRow['rowId'];
  readonly detailKey: NonNullable<CashFlowRow['detailKey']>;
}

interface NoncashDisclosureAccount {
  readonly account: ChartAccount;
  readonly sectionTreatment: 'INVESTING' | 'FINANCING';
  readonly amountMinor: bigint;
  readonly rowId: CashFlowRow['rowId'];
  readonly detailKey: NonNullable<CashFlowRow['detailKey']>;
  readonly contributions: readonly CashFlowContribution[];
  readonly archived: boolean;
}

interface NoncashDisclosureHierarchyIssue {
  readonly accountRole: 'CHART';
  readonly accountId: string;
  readonly treatment: 'INVESTING' | 'FINANCING';
  readonly parentId?: string;
  readonly reason: 'MISSING_PARENT' | 'NONPARTICIPATING_PARENT' | 'CROSS_TREATMENT' | 'CYCLE' | 'INVALID_ANCESTOR';
}

interface CashFlowActivityHierarchyIssue {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly treatment: 'INVESTING' | 'FINANCING';
  readonly parentId?: string;
  readonly reason: 'MISSING_PARENT' | 'NONPARTICIPATING_PARENT' | 'CROSS_TREATMENT' | 'CYCLE' | 'INVALID_ANCESTOR';
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
  assertCashFlowDetailAmount(netProfitRow, details[netProfitDetailKey]);
  adjustmentRows.forEach(row => assertCashFlowDetailAmount(row, details[row.detailKey!]));
  workingCapital.rows.filter(row => row.amountMinor !== undefined).forEach(row => assertCashFlowDetailAmount(row, details[row.detailKey!]));
  assertCashFlowDetailAmount(netOperatingRow, details[netOperatingDetailKey]);
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
      assertCashFlowDetailAmount({
        rowId,
        rowType: 'ACCOUNT_ACTIVITY',
        section: 'OPERATING',
        treatment: classification.treatment,
        accountRole: classification.accountRole,
        accountId: account.id,
        label: account.name,
        depth: 0,
        amountMinor,
        detailKey,
        bold: false,
        derived: true,
        archived: account.archived,
        reviewRequired: classification.status === 'REVIEW_REQUIRED',
      }, contributions);
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

/**
 * Project actual cash-side activity into Investing and Financing. The cash
 * account is the source of the transaction; Chart split classifications are
 * the only section assignment. This keeps Operating in the indirect
 * calculation and avoids guessing from descriptions or account names.
 */
function buildCashSideActivity(
  query: CashFlowReport['query'],
  snapshot: BalanceSheetRepositorySnapshot,
  cashAccountIds: ReadonlySet<string>,
  restrictedAccountIds: ReadonlySet<string>,
  classifications: readonly CashFlowClassificationRecord[],
): CashSideActivity {
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  const sourceById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const chartClassifications = new Map(classifications
    .filter(classification => classification.accountRole === 'CHART')
    .map(classification => [classification.accountId, classification]));
  const financialClassifications = new Map(classifications
    .filter(classification => classification.accountRole === 'FINANCIAL_SOURCE')
    .map(classification => [classification.accountId, classification]));
  const activity = new Map<'INVESTING' | 'FINANCING', Map<string, CashFlowActivityAccount>>([
    ['INVESTING', new Map()],
    ['FINANCING', new Map()],
  ]);
  const unclassifiedContributions: CashFlowContribution[] = [];
  const transferDiagnosticContributions: CashFlowContribution[] = [];
  const unclassifiedReferences = new Set<string>();
  const transferDiagnosticReferences = new Set<string>();
  const transferWarningReferences = new Set<string>();
  const excludedReferences = new Set<string>();
  const excludedContributions: CashFlowContribution[] = [];
  const unclassifiedContributionKeys = new Set<string>();
  const processedTransferCashTransactionIds = new Set<string>();
  let unclassifiedCashActivityMinor = 0n;
  let excludedCashActivityMinor = 0n;
  const periodTransactions = snapshot.transactions
    .filter(transaction => transaction.postingDate >= query.startDate && transaction.postingDate <= query.endDate)
    .filter(transaction => transaction.state === 'POSTED')
    .slice().sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id));
  const transactionsById = new Map(snapshot.transactions.map(transaction => [transaction.id, transaction]));
  const confirmedTransfers = new Map(snapshot.transfers.map(transfer => [transfer.id, transfer]));
  // Balance Sheet cash boundaries include every Posted transaction and only
  // the two endpoints of a confirmed matched transfer.  Keep this identity
  // set separate from the unresolved-activity list: malformed/extra
  // claimants can be diagnosable without contributing to the cash boundary
  // reconciliation Difference.
  const cashBoundaryTransactionIds = new Set(snapshot.transactions
    .filter(transaction => transaction.state === 'POSTED' || (
      transaction.state === 'MATCHED_TRANSFER'
      && Boolean(transaction.transferMatchId)
      && confirmedTransfers.has(transaction.transferMatchId!)
      && [confirmedTransfers.get(transaction.transferMatchId!)!.leftTransactionId,
        confirmedTransfers.get(transaction.transferMatchId!)!.rightTransactionId].includes(transaction.id)
    ))
    .map(transaction => transaction.id));

  const addUnclassified = (
    transaction: Transaction,
    split: PostingSplit | undefined,
    amountMinor: bigint,
    chart?: ChartAccount,
    transfer?: TransferMatch,
    counterparty?: Transaction,
    sourceKeyOverride?: string,
  ): void => {
    if (amountMinor === 0n) return;
    const sourceKey = sourceKeyOverride ?? (transfer
      ? `transfer:${transfer.id}`
      : `transaction:${transaction.id}:${split?.id ?? 'activity'}`);
    if (unclassifiedContributionKeys.has(sourceKey)) return;
    unclassifiedContributionKeys.add(sourceKey);
    if (transfer) unclassifiedReferences.add(`transfer:${transfer.id}`);
    else unclassifiedReferences.add(sourceKey);
    unclassifiedCashActivityMinor += amountMinor;
    unclassifiedContributions.push({
      contributionId: `unclassified:${sourceKey}`,
      detailKey: unclassifiedDetailKey(query),
      contributionType: 'UNCLASSIFIED',
      contributionMinor: amountMinor,
      businessDate: transaction.postingDate,
      accountRole: 'FINANCIAL_SOURCE',
      accountId: transaction.accountId,
      accountName: sourceById.get(transaction.accountId)?.name,
      ...(chart ? { chartAccountId: chart.id, chartAccountPath: chartAccountPath(chart.id, chartById) } : {}),
      transactionId: transaction.id,
      counterpartyTransactionId: counterparty?.id,
      splitId: split?.id,
      transferId: transfer?.id,
      sourceBatchId: transaction.sourceBatchId,
      payee: transaction.payee,
      description: transaction.description,
      memo: split?.memo ?? transaction.memo,
    });
  };

  const addTransferDiagnostic = (
    transfer: TransferMatch,
    left: Transaction | undefined,
    right: Transaction | undefined,
    amountMinor: bigint,
    description: string,
  ): void => {
    if (transferDiagnosticReferences.has(transfer.id)) return;
    transferDiagnosticReferences.add(transfer.id);
    const endpoints = [left, right].filter((candidate): candidate is Transaction => Boolean(candidate))
      .slice().sort((a, b) => a.id.localeCompare(b.id));
    const endpoint = endpoints.find(candidate => cashAccountIds.has(candidate.accountId)) ?? endpoints[0];
    transferDiagnosticContributions.push({
      contributionId: `transfer-diagnostic:${transfer.id}`,
      detailKey: transferDiagnosticDetailKey(query),
      contributionType: 'TRANSFER',
      contributionMinor: amountMinor,
      businessDate: endpoint?.postingDate,
      accountRole: endpoint ? 'FINANCIAL_SOURCE' : undefined,
      accountId: endpoint?.accountId,
      accountName: endpoint ? sourceById.get(endpoint.accountId)?.name : undefined,
      transactionId: endpoints[0]?.id,
      counterpartyTransactionId: endpoints[1]?.id,
      transferId: transfer.id,
      sourceBatchId: endpoint?.sourceBatchId,
      payee: endpoint?.payee,
      description,
      memo: endpoint?.memo,
    });
  };

  const addActivity = (
    section: 'INVESTING' | 'FINANCING',
    accountRole: 'FINANCIAL_SOURCE' | 'CHART',
    account: FinancialAccount | ChartAccount,
    classification: CashFlowClassificationRecord,
    amountMinor: bigint,
    contribution: CashFlowContribution,
  ): void => {
    const key = `${accountRole}:${account.id}`;
    const sectionAccounts = activity.get(section)!;
    const existing = sectionAccounts.get(key);
    if (existing) {
      sectionAccounts.set(key, {
        ...existing,
        amountMinor: existing.amountMinor + amountMinor,
        contributions: [...existing.contributions, contribution],
      });
      return;
    }
    const rowId = cashFlowAccountRowId(section, accountRole, account.id);
    sectionAccounts.set(key, {
      accountRole,
      account,
      classification,
      parentId: accountRole === 'CHART' ? (account as ChartAccount).parentId : (account as FinancialAccount).parentAccountId,
      accountPath: accountRole === 'CHART' ? chartAccountPath(account.id, chartById) : financialAccountPath(account.id, sourceById),
      amountMinor,
      rowId,
      detailKey: cashFlowDetailKey(rowId),
      contributions: [contribution],
    });
  };

  const addExcluded = (transaction: Transaction, split: PostingSplit): void => {
    if (split.amount.minorUnits === 0n) return;
    const reference = `transaction:${transaction.id}:${split.id}`;
    if (excludedReferences.has(reference)) return;
    excludedReferences.add(reference);
    excludedCashActivityMinor += split.amount.minorUnits;
    excludedContributions.push({
      contributionId: `excluded:${reference}`,
      detailKey: cashFlowDetailKey(cashFlowSyntheticRowId('DIFFERENCE', query)),
      contributionType: 'FORMULA',
      contributionMinor: split.amount.minorUnits,
      businessDate: transaction.postingDate,
      accountRole: 'FINANCIAL_SOURCE',
      accountId: transaction.accountId,
      accountName: sourceById.get(transaction.accountId)?.name,
      chartAccountId: split.chartAccountId,
      chartAccountPath: chartAccountPath(split.chartAccountId, chartById),
      transactionId: transaction.id,
      splitId: split.id,
      sourceBatchId: transaction.sourceBatchId,
      payee: transaction.payee,
      description: transaction.description,
      memo: split.memo ?? transaction.memo,
    });
  };

  const isInPeriod = (transaction: Transaction | undefined): boolean => Boolean(transaction
    && transaction.postingDate >= query.startDate && transaction.postingDate <= query.endDate);

  const transferClaimants = new Map<string, readonly Transaction[]>();
  const transferEndpointReferences = new Map<string, string[]>();
  for (const transaction of snapshot.transactions) {
    if (!['MATCHED_TRANSFER', 'POSTED'].includes(transaction.state) || !transaction.transferMatchId) continue;
    transferClaimants.set(transaction.transferMatchId, [
      ...(transferClaimants.get(transaction.transferMatchId) ?? []), transaction,
    ]);
  }
  for (const transfer of confirmedTransfers.values()) {
    for (const transactionId of [transfer.leftTransactionId, transfer.rightTransactionId]) {
      transferEndpointReferences.set(transactionId, [
        ...(transferEndpointReferences.get(transactionId) ?? []), transfer.id,
      ]);
    }
  }

  // Traverse confirmed transfers independently of transaction ordering. This
  // guarantees that a transfer with one endpoint in the period is consumed at
  // most once and that malformed endpoint structures remain diagnosable.
  for (const transfer of [...confirmedTransfers.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    const left = transactionsById.get(transfer.leftTransactionId);
    const right = transactionsById.get(transfer.rightTransactionId);
    if (!isInPeriod(left) && !isInPeriod(right)) continue;
    const endpointTransactions = [left, right].filter((value): value is Transaction => Boolean(value));
    const cashEndpoints = endpointTransactions.filter(endpoint => cashAccountIds.has(endpoint.accountId));
    const restrictedEndpoints = endpointTransactions.filter(endpoint => restrictedAccountIds.has(endpoint.accountId));
    const expectedEndpointIds = new Set([transfer.leftTransactionId, transfer.rightTransactionId]);
    const extraClaimants = (transferClaimants.get(transfer.id) ?? []).filter(candidate => !expectedEndpointIds.has(candidate.id));
    const duplicateEndpointReference = [transfer.leftTransactionId, transfer.rightTransactionId]
      .some(transactionId => (transferEndpointReferences.get(transactionId) ?? []).length > 1);
    const malformed = !left || !right || left.id === right.id
      || left.state !== 'MATCHED_TRANSFER' || right.state !== 'MATCHED_TRANSFER'
      || left.transferMatchId !== transfer.id || right.transferMatchId !== transfer.id
      || left.accountId === right.accountId
      || (left && right && left.amount.minorUnits + right.amount.minorUnits !== 0n)
      || (left && right && left.postingDate !== right.postingDate)
      || extraClaimants.length > 0
      || duplicateEndpointReference;
    if (malformed) {
      transferWarningReferences.add(transfer.id);
      for (const endpoint of cashEndpoints) processedTransferCashTransactionIds.add(endpoint.id);
      const lifecycleExcluded = endpointTransactions.some(endpoint => endpoint.state === 'PENDING' || endpoint.state === 'EXCLUDED');
      const eligibleCashEndpoints = cashEndpoints
        .filter(endpoint => endpoint.state !== 'PENDING' && endpoint.state !== 'EXCLUDED' && isInPeriod(endpoint));
      // A confirmed transfer with a pending/excluded counterpart is still
      // malformed, but an included cash endpoint has already moved the cash
      // balance. Keep that signed movement as unresolved activity so the
      // reconciliation Difference retains both the amount and provenance.
      if (eligibleCashEndpoints.length > 0) {
        for (const cashEndpoint of eligibleCashEndpoints.sort((a, b) => a.id.localeCompare(b.id))) {
          processedTransferCashTransactionIds.add(cashEndpoint.id);
          const other = cashEndpoint === left ? right : left;
          addUnclassified(cashEndpoint, undefined, cashEndpoint.amount.minorUnits, undefined, transfer, other,
            `transfer-cash:${cashEndpoint.id}`);
        }
      } else {
        addTransferDiagnostic(transfer, left, right, 0n,
          lifecycleExcluded ? 'Confirmed transfer has Pending or Excluded endpoint activity.' : 'Malformed or partial confirmed transfer.');
      }
      continue;
    }
    if (cashEndpoints.length === 0) {
      addTransferDiagnostic(transfer, left, right, 0n, 'Confirmed transfer has no included cash endpoint.');
      continue;
    }
    if (cashEndpoints.length > 1) {
      // Cash-to-cash and cash-equivalent transfers change account composition
      // only. Keep a zero diagnostic with both endpoint identities.
      for (const endpoint of cashEndpoints) processedTransferCashTransactionIds.add(endpoint.id);
      addTransferDiagnostic(transfer, left, right, 0n, 'Cash-to-cash transfer has no report activity.');
      continue;
    }
    const cashEndpoint = cashEndpoints[0];
    processedTransferCashTransactionIds.add(cashEndpoint.id);
    const otherEndpoint = cashEndpoint === left ? right! : left!;
    if (restrictedEndpoints.includes(otherEndpoint)) {
      addUnclassified(cashEndpoint, undefined, cashEndpoint.amount.minorUnits, undefined, transfer, otherEndpoint,
        `transfer-cash:${cashEndpoint.id}`);
      continue;
    }
    const otherClassification = financialClassifications.get(otherEndpoint.accountId);
    const otherAccount = sourceById.get(otherEndpoint.accountId);
    const classificationMatchesSource = Boolean(otherAccount && otherClassification
      && otherClassification.accountRole === 'FINANCIAL_SOURCE'
      && otherClassification.accountId === otherAccount.id
      && otherClassification.accountType === otherAccount.accountType
      && otherClassification.detailType === otherAccount.detailType);
    if (!otherAccount || !classificationMatchesSource || !otherClassification
      || otherClassification.status === 'REVIEW_REQUIRED' || otherClassification.treatment === 'REVIEW_REQUIRED') {
      addUnclassified(cashEndpoint, undefined, cashEndpoint.amount.minorUnits, undefined, transfer, otherEndpoint,
        `transfer-cash:${cashEndpoint.id}`);
      continue;
    }
    if (otherClassification.treatment === 'OPERATING_ASSET' || otherClassification.treatment === 'OPERATING_LIABILITY' || otherClassification.treatment === 'CASH_BALANCE' || otherClassification.treatment === 'NONCASH_DISCLOSURE') {
      addTransferDiagnostic(transfer, left, right, 0n, 'Transfer is captured by the balance or disclosure path.');
      continue;
    }
    if (otherClassification.treatment !== 'INVESTING' && otherClassification.treatment !== 'FINANCING') {
      addUnclassified(cashEndpoint, undefined, cashEndpoint.amount.minorUnits, undefined, transfer, otherEndpoint,
        `transfer-cash:${cashEndpoint.id}`);
      continue;
    }
    const detailKey = cashFlowDetailKey(cashFlowAccountRowId(otherClassification.treatment, 'FINANCIAL_SOURCE', otherAccount.id));
    addActivity(otherClassification.treatment, 'FINANCIAL_SOURCE', otherAccount, otherClassification, cashEndpoint.amount.minorUnits, {
      contributionId: `transfer:${transfer.id}:${cashEndpoint.id}`,
      detailKey,
      contributionType: 'TRANSFER',
      contributionMinor: cashEndpoint.amount.minorUnits,
      businessDate: cashEndpoint.postingDate,
      accountRole: 'FINANCIAL_SOURCE',
      accountId: cashEndpoint.accountId,
      accountName: sourceById.get(cashEndpoint.accountId)?.name,
      transactionId: cashEndpoint.id,
      counterpartyTransactionId: otherEndpoint.id,
      transferId: transfer.id,
      sourceBatchId: cashEndpoint.sourceBatchId,
      payee: cashEndpoint.payee,
      description: cashEndpoint.description,
      memo: cashEndpoint.memo,
    });
  }

  for (const transaction of periodTransactions) {
    if (!cashAccountIds.has(transaction.accountId)) continue;
    if (transaction.state === 'POSTED') {
      if (transaction.splits.length === 0) {
        if (transaction.amount.minorUnits !== 0n) {
          throw new Error(`Posted cash transaction ${transaction.id} has no posting splits.`);
        }
        continue;
      }
      const splitTotal = transaction.splits.reduce((total, split) => total + split.amount.minorUnits, 0n);
      if (splitTotal !== transaction.amount.minorUnits) {
        throw new Error(`Posting splits for ${transaction.id} do not equal the cash transaction amount.`);
      }
    }
    if (transaction.transferMatchId) {
      if (processedTransferCashTransactionIds.has(transaction.id)) continue;
      transferWarningReferences.add(transaction.transferMatchId);
      const transfer = confirmedTransfers.get(transaction.transferMatchId);
      const counterparty = transfer
        ? [transactionsById.get(transfer.leftTransactionId), transactionsById.get(transfer.rightTransactionId)]
          .filter((candidate): candidate is Transaction => Boolean(candidate))
          .slice().sort((left, right) => left.id.localeCompare(right.id))
          .find(candidate => candidate.id !== transaction.id)
        : undefined;
      addUnclassified(transaction, undefined, transaction.amount.minorUnits, undefined, transfer, counterparty,
        transfer ? `transfer-cash:${transaction.id}` : undefined);
      processedTransferCashTransactionIds.add(transaction.id);
      continue;
    }
    if (transaction.splits.length === 0) continue;
    const splitClassifications = transaction.splits.map(split => ({ split, chart: chartById.get(split.chartAccountId), classification: chartClassifications.get(split.chartAccountId) }));
    for (const item of splitClassifications.slice().sort((left, right) => left.split.id.localeCompare(right.split.id))) {
      const { split, chart, classification } = item;
      const classificationMatchesChart = Boolean(chart && classification
        && classification.accountRole === 'CHART'
        && classification.accountId === chart.id
        && classification.accountType === chart.accountType
        && classification.detailType === chart.detailType);
      if (!chart || !classificationMatchesChart || !classification || classification.status !== 'CONFIRMED' || classification.treatment === 'REVIEW_REQUIRED') {
        addUnclassified(transaction, split, split.amount.minorUnits, chart);
      } else if (classification.treatment === 'INVESTING' || classification.treatment === 'FINANCING') {
        const detailKey = cashFlowDetailKey(cashFlowAccountRowId(classification.treatment, 'CHART', chart.id));
        addActivity(classification.treatment, 'CHART', chart, classification, split.amount.minorUnits, {
          contributionId: `cash:${transaction.id}:${split.id}`,
          detailKey,
          contributionType: 'CASH_TRANSACTION',
          contributionMinor: split.amount.minorUnits,
          businessDate: transaction.postingDate,
          accountRole: 'FINANCIAL_SOURCE',
          accountId: transaction.accountId,
          accountName: sourceById.get(transaction.accountId)?.name,
          chartAccountId: chart.id,
          chartAccountPath: chartAccountPath(chart.id, chartById),
          transactionId: transaction.id,
          splitId: split.id,
          sourceBatchId: transaction.sourceBatchId,
          payee: transaction.payee,
          description: transaction.description,
          memo: split.memo ?? transaction.memo,
        });
      } else if (classification.treatment === 'EXCLUDED') {
        addExcluded(transaction, split);
      } else if (!['CASH_BALANCE', 'OPERATING_REVENUE_EXPENSE', 'OPERATING_ASSET', 'OPERATING_LIABILITY', 'NONCASH_PNL_ADJUSTMENT', 'NONCASH_DISCLOSURE'].includes(classification.treatment)) {
        addUnclassified(transaction, split, split.amount.minorUnits, chart);
      }
    }
  }

  // MATCHED_TRANSFER rows that point at no confirmed transfer are not allowed
  // to disappear. Retain their signed cash amount as unclassified activity.
  for (const transaction of snapshot.transactions
    .filter(candidate => (candidate.state === 'MATCHED_TRANSFER' || (candidate.state === 'POSTED' && Boolean(candidate.transferMatchId))) && isInPeriod(candidate))
    .slice().sort((left, right) => left.id.localeCompare(right.id))) {
    if (!cashAccountIds.has(transaction.accountId) || processedTransferCashTransactionIds.has(transaction.id)) continue;
    transferWarningReferences.add(transaction.transferMatchId ?? transaction.id);
    const transfer = transaction.transferMatchId ? confirmedTransfers.get(transaction.transferMatchId) : undefined;
    const counterparty = transfer
      ? [transactionsById.get(transfer.leftTransactionId), transactionsById.get(transfer.rightTransactionId)]
        .filter((candidate): candidate is Transaction => Boolean(candidate))
        .slice().sort((left, right) => left.id.localeCompare(right.id))
        .find(candidate => candidate.id !== transaction.id)
      : undefined;
    addUnclassified(transaction, undefined, transaction.amount.minorUnits, undefined, transfer, counterparty,
      transfer ? `transfer-cash:${transaction.id}` : undefined);
  }

  // A derived opening balance dated inside the selected period changes the
  // ending cash boundary even though it is not a period transaction. Ordinary
  // subsequent Posted activity does not explain that opening: it is separate
  // ledger evidence and must not hide the opening diagnostic. The only
  // supported representation of a ledger-sourced opening is the explicit
  // LEDGER_ACTIVITY mode, which has no stored opening amount (and therefore
  // never reaches this DERIVED_EQUITY-only path).
  const cashBoundaryContributionIds = new Set<string>();
  for (const account of snapshot.accounts
    .filter(candidate => cashAccountIds.has(candidate.id))
    .slice().sort((left, right) => left.id.localeCompare(right.id))) {
    if (account.openingBalanceSource !== 'DERIVED_EQUITY' || account.openingBalance.minorUnits === 0n) continue;
    if (account.openingBalanceDate < query.startDate || account.openingBalanceDate > query.endDate) continue;
    const sourceKey = `opening:${account.id}:${account.openingBalanceDate}`;
    const contributionId = `unclassified:${sourceKey}`;
    if (unclassifiedContributionKeys.has(sourceKey)) continue;
    unclassifiedContributionKeys.add(sourceKey);
    unclassifiedReferences.add(sourceKey);
    unclassifiedCashActivityMinor += account.openingBalance.minorUnits;
    unclassifiedContributions.push({
      contributionId,
      detailKey: unclassifiedDetailKey(query),
      contributionType: 'UNCLASSIFIED',
      contributionMinor: account.openingBalance.minorUnits,
      businessDate: account.openingBalanceDate,
      accountRole: 'FINANCIAL_SOURCE',
      accountId: account.id,
      accountName: account.name,
      openingAmountMinor: account.openingBalance.minorUnits,
      description: 'Cash opening balance introduced within the report period',
      formula: 'In-period opening balance is not a section cash flow',
    });
    cashBoundaryContributionIds.add(contributionId);
  }

  const allContributions = [...unclassifiedContributions].sort(compareCashFlowContributions);
  const investingCandidates = [...activity.get('INVESTING')!.values()].sort(compareCashFlowActivityAccounts);
  const financingCandidates = [...activity.get('FINANCING')!.values()].sort(compareCashFlowActivityAccounts);
  const hierarchyIssues = [
    ...detectCashFlowActivityHierarchyIssues('INVESTING', investingCandidates, chartById, sourceById, chartClassifications, financialClassifications),
    ...detectCashFlowActivityHierarchyIssues('FINANCING', financingCandidates, chartById, sourceById, chartClassifications, financialClassifications),
  ];
  return {
    investing: investingCandidates,
    financing: financingCandidates,
    unclassifiedCashActivityMinor,
    unclassifiedReferences: [...unclassifiedReferences].sort(),
    unclassifiedDetailKey: allContributions.length > 0 ? unclassifiedDetailKey(query) : undefined,
    unclassifiedContributions: allContributions,
    cashBoundaryTransactionIds: [...cashBoundaryTransactionIds].sort(),
    cashBoundaryContributionIds: [...cashBoundaryContributionIds].sort(),
    excludedContributions: Object.freeze(excludedContributions.sort(compareCashFlowContributions)),
    transferDiagnosticContributions: transferDiagnosticContributions.sort(compareCashFlowContributions),
    transferDiagnosticReferences: [...transferDiagnosticReferences].sort(),
    transferWarningReferences: [...transferWarningReferences].sort(),
    excludedCashActivityMinor,
    excludedReferences: [...excludedReferences].sort(),
    hierarchyIssues,
  };
}

/**
 * Build the supplemental noncash disclosure hierarchy from recorded journal
 * relationships only. A financial-source transaction is eligible when it is
 * a confirmed noncash account and every nonzero posting split is explicitly
 * confirmed. One side must establish Investing or Financing presentation;
 * NONCASH_DISCLOSURE is allowed on the opposite side. No account name or
 * description inference is used, and no disclosure contributes to cash totals.
 */
function buildNoncashDisclosures(
  query: CashFlowReport['query'],
  snapshot: BalanceSheetRepositorySnapshot,
  classifications: readonly CashFlowClassificationRecord[],
  cashAccountIds: ReadonlySet<string>,
  restrictedAccountIds: ReadonlySet<string>,
): NoncashDisclosureRows {
  const chartById = new Map(snapshot.chartAccounts.map(account => [account.id, account]));
  const sourceById = new Map(snapshot.accounts.map(account => [account.id, account]));
  const chartClassifications = new Map(classifications
    .filter(classification => classification.accountRole === 'CHART')
    .map(classification => [classification.accountId, classification]));
  const financialClassifications = new Map(classifications
    .filter(classification => classification.accountRole === 'FINANCIAL_SOURCE')
    .map(classification => [classification.accountId, classification]));
  const candidates: NoncashDisclosureCandidate[] = [];

  const periodTransactions = snapshot.transactions
    .filter(transaction => transaction.state === 'POSTED' && !transaction.transferMatchId)
    .filter(transaction => transaction.postingDate >= query.startDate && transaction.postingDate <= query.endDate)
    .slice().sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id));

  for (const transaction of periodTransactions) {
    const source = sourceById.get(transaction.accountId);
    const sourceClassification = source ? financialClassifications.get(source.id) : undefined;
    const nonzeroSplits = transaction.splits.filter(split => split.amount.minorUnits !== 0n);
    const transactionHasMaterialActivity = transaction.amount.minorUnits !== 0n || nonzeroSplits.length > 0;
    const chartSplits = transaction.splits.map(split => ({
      split,
      chart: chartById.get(split.chartAccountId),
      classification: chartClassifications.get(split.chartAccountId),
    }));
    const chartSignalsNoncash = chartSplits.some(item => isNoncashDisclosureTreatment(item.classification?.treatment));

    // Cash and restricted-cash sources are handled by the cash-side activity
    // projector. Evaluate their Chart side first, however, so an unresolved
    // cash-role source cannot hide an explicitly noncash structure.
    if (source && (cashAccountIds.has(source.id) || restrictedAccountIds.has(source.id))) continue;
    if (!source) {
      if (transactionHasMaterialActivity && chartSignalsNoncash) {
        throw new Error(`Noncash transaction ${transaction.id} has an explicit Chart noncash treatment but no financial source account.`);
      }
      // Neither recorded side signals a noncash structure. This can be an
      // ordinary/legacy transaction whose source is outside the snapshot.
      continue;
    }

    const sourceClassificationValid = Boolean(sourceClassification
      && sourceClassification.status === 'CONFIRMED'
      && classificationMatchesAccount(sourceClassification, source));
    const sourceRequiresReview = sourceClassification?.status === 'REVIEW_REQUIRED'
      || sourceClassification?.cashRole === 'REVIEW_REQUIRED';
    if (sourceRequiresReview && transactionHasMaterialActivity) {
      throw new Error(`Noncash source ${source.id} has an invalid or review-required Cash Flow classification.`);
    }
    if (!sourceClassificationValid) {
      if (transactionHasMaterialActivity && chartSignalsNoncash) {
        throw new Error(`Noncash source ${source.id} has an invalid or review-required Cash Flow classification.`);
      }
      // A source with no confirmed structural classification is only safe to
      // leave alone after confirming that no Chart side explicitly signals a
      // noncash Investing/Financing structure.
      continue;
    }

    const confirmedSourceClassification = sourceClassification!;
    if (confirmedSourceClassification.cashRole !== 'NOT_CASH') {
      if (transactionHasMaterialActivity && chartSignalsNoncash) {
        throw new Error(`Noncash source ${source.id} has an incompatible cash role for its Chart counteraccount.`);
      }
      continue;
    }

    const sourceHasSectionIntent = confirmedSourceClassification.treatment === 'INVESTING'
      || confirmedSourceClassification.treatment === 'FINANCING'
      || confirmedSourceClassification.treatment === 'NONCASH_DISCLOSURE';
    const sourceSectionTreatment = confirmedSourceClassification.treatment === 'INVESTING' || confirmedSourceClassification.treatment === 'FINANCING'
      ? confirmedSourceClassification.treatment : undefined;
    // Only an explicitly Investing/Financing source can establish a
    // supplemental noncash event. Ordinary operating source transactions
    // (for example, a credit-card charge posted to an expense account) are
    // handled by the normal P/L or working-capital paths. They are safe to
    // exclude only after their Chart side has been checked for an explicit
    // noncash signal.
    if (!sourceHasSectionIntent) {
      if (transactionHasMaterialActivity && chartSignalsNoncash) {
        throw new Error(`Noncash source ${source.id} has an incompatible ordinary treatment for its Chart counteraccount.`);
      }
      continue;
    }
    if (transaction.amount.minorUnits !== 0n && transaction.splits.length === 0) {
      throw new Error(`Noncash source transaction ${transaction.id} has no posting splits.`);
    }
    // Build zero-valued candidates too. The renderer applies includeZeroRows
    // only after the complete disclosure/detail model exists, so hiding zero
    // rows cannot erase provenance or change hierarchy identity.
    const candidateSplits = transaction.splits;
    if (candidateSplits.length === 0) continue;
    const splitTotal = transaction.splits.reduce((total, split) => total + split.amount.minorUnits, 0n);
    if (chartSplits.some(item => !item.chart || !item.classification
      || item.classification.accountRole !== 'CHART'
      || item.classification.accountId !== item.chart.id
      || item.classification.accountType !== item.chart.accountType
      || item.classification.detailType !== item.chart.detailType
      || item.classification.status !== 'CONFIRMED'
      || !['INVESTING', 'FINANCING', 'NONCASH_DISCLOSURE'].includes(item.classification.treatment))) {
      throw new Error(`Noncash source transaction ${transaction.id} has a missing or invalid Chart counteraccount.`);
    }
    const chartSectionTreatments = [...new Set(chartSplits
      .map(item => item.classification!.treatment)
      .filter((treatment): treatment is 'INVESTING' | 'FINANCING' => treatment === 'INVESTING' || treatment === 'FINANCING'))];
    if (chartSectionTreatments.length > 1) {
      throw new Error(`Noncash source transaction ${transaction.id} has Investing and Financing counteraccounts mixed together.`);
    }
    const sectionTreatment = chartSectionTreatments[0] ?? sourceSectionTreatment;
    if (!sectionTreatment) {
      // Two NONCASH_DISCLOSURE sides (or an otherwise ambiguous pair) do not
      // establish a presentation section and must never be guessed.
      throw new Error(`Noncash source transaction ${transaction.id} has no confirmed Investing or Financing counteraccount.`);
    }
    const allowedCounteraccounts = chartSplits.every(item => item.classification!.treatment === sectionTreatment
      || (sourceSectionTreatment !== undefined && item.classification!.treatment === 'NONCASH_DISCLOSURE'));
    if (!allowedCounteraccounts) {
      throw new Error(`Noncash source transaction ${transaction.id} has an incomplete, mismatched, or invalid counteraccount structure.`);
    }
    // Mixed/partial structures are not sufficiently identifiable for a
    // disclosure. Fail through the typed report contract rather than
    // disclosing only one side of an ambiguous journal or silently dropping
    // the recorded noncash event.
    const fullyIdentified = splitTotal === transaction.amount.minorUnits
      && chartSplits.length > 0
      && chartSplits.every(item => Boolean(item.chart && item.classification
        && item.classification.accountRole === 'CHART'
        && item.classification.accountId === item.chart!.id
        && item.classification.accountType === item.chart!.accountType
        && item.classification.detailType === item.chart!.detailType
        && item.classification.status === 'CONFIRMED'));
    if (!fullyIdentified) {
      throw new Error(`Noncash source transaction ${transaction.id} has an incomplete, mismatched, or invalid counteraccount structure.`);
    }

    for (const item of chartSplits
      .slice().sort((left, right) => left.split.id.localeCompare(right.split.id))) {
      const chart = item.chart!;
      const chartClassification = item.classification!;
      const rowId = `DISCLOSURE:NONCASH:${encodeURIComponent(transaction.id)}:${encodeURIComponent(item.split.id)}` as CashFlowRow['rowId'];
      candidates.push({
        transaction,
        split: item.split,
        source,
        sourceClassification: confirmedSourceClassification,
        chart,
        chartClassification,
        sectionTreatment,
        amountMinor: -item.split.amount.minorUnits,
        rowId,
        detailKey: cashFlowDetailKey(rowId),
      });
    }
  }

  const detailIndex: Record<string, readonly CashFlowContribution[]> = {};
  const disclosures: CashFlowDisclosure[] = [];
  const accountMap = new Map<string, NoncashDisclosureAccount>();
  for (const candidate of candidates) {
    const rowId = noncashDisclosureAccountRowId(candidate.sectionTreatment, candidate.chart.id);
    const detailKey = cashFlowDetailKey(rowId);
    const contribution: CashFlowContribution = {
      contributionId: `noncash:${candidate.transaction.id}:${candidate.split.id}`,
      detailKey,
      contributionType: 'NONCASH_DISCLOSURE',
      contributionMinor: candidate.amountMinor,
      businessDate: candidate.transaction.postingDate,
      accountRole: 'FINANCIAL_SOURCE',
      accountId: candidate.source.id,
      accountName: candidate.source.name,
      chartAccountId: candidate.chart.id,
      chartAccountPath: chartAccountPath(candidate.chart.id, chartById),
      transactionId: candidate.transaction.id,
      splitId: candidate.split.id,
      sourceBatchId: candidate.transaction.sourceBatchId,
      payee: candidate.transaction.payee,
      description: candidate.transaction.description,
      memo: candidate.split.memo ?? candidate.transaction.memo,
      formula: 'Recorded noncash source and classified counteraccount',
    };
    const disclosureDetailKey = cashFlowDetailKey(candidate.rowId);
    detailIndex[disclosureDetailKey] = [{ ...contribution, detailKey: disclosureDetailKey }];
    const existing = accountMap.get(`${candidate.sectionTreatment}:${candidate.chart.id}`);
    accountMap.set(`${candidate.sectionTreatment}:${candidate.chart.id}`, existing ? {
      ...existing,
      amountMinor: existing.amountMinor + candidate.amountMinor,
      contributions: [...existing.contributions, contribution],
      archived: existing.archived || candidate.source.archived || candidate.chart.archived,
    } : {
      account: candidate.chart,
      sectionTreatment: candidate.sectionTreatment,
      amountMinor: candidate.amountMinor,
      rowId,
      detailKey,
      contributions: [contribution],
      archived: candidate.source.archived || candidate.chart.archived,
    });
    disclosures.push({
      disclosureId: candidate.rowId,
      section: 'NONCASH_DISCLOSURE',
      label: `${leafAccountName(candidate.chart.name)} — recorded noncash activity`,
      amountMinor: candidate.amountMinor,
      detailKey: disclosureDetailKey,
      accountRole: 'FINANCIAL_SOURCE', accountId: candidate.source.id, chartAccountId: candidate.chart.id,
      transactionId: candidate.transaction.id,
      description: candidate.transaction.description,
      rationale: `TallyStick discloses only identifiable recorded noncash activity; this item is excluded from cash-flow sections. Source: ${candidate.sourceClassification.rationale} Counteraccount: ${candidate.chartClassification.rationale}`,
    });
  }
  const accounts = [...accountMap.values()].map(account => ({
    ...account,
    contributions: Object.freeze(account.contributions.slice().sort(compareCashFlowContributions)),
  }));
  accounts.forEach(account => { detailIndex[account.detailKey] = account.contributions; });
  const hierarchyIssues = detectNoncashDisclosureHierarchyIssues(accounts, chartById, chartClassifications);
  const rows = renderNoncashDisclosureRows(query, accounts, hierarchyIssues, detailIndex, chartById);
  disclosures.sort((left, right) => left.disclosureId.localeCompare(right.disclosureId));
  return {
    rows: Object.freeze(rows),
    disclosures: Object.freeze(disclosures),
    detailIndex: Object.freeze(detailIndex),
    hierarchyIssues: Object.freeze(hierarchyIssues),
  };
}

function noncashDisclosureAccountRowId(
  treatment: 'INVESTING' | 'FINANCING',
  accountId: string,
): CashFlowRow['rowId'] {
  return `ACCOUNT:NONCASH_DISCLOSURE:${treatment}:CHART:${encodeURIComponent(accountId)}` as CashFlowRow['rowId'];
}

function noncashDisclosureGroupRowId(
  treatment: 'INVESTING' | 'FINANCING',
  query: CashFlowReport['query'],
): CashFlowRow['rowId'] {
  return `GROUP:NONCASH_DISCLOSURE:${treatment}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function noncashDisclosureReviewGroupRowId(
  treatment: 'INVESTING' | 'FINANCING',
  query: CashFlowReport['query'],
): CashFlowRow['rowId'] {
  return `GROUP:NONCASH_DISCLOSURE:${treatment}:HIERARCHY_REVIEW:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function noncashDisclosureSubtotalRowId(
  treatment: 'INVESTING' | 'FINANCING',
  account: NoncashDisclosureAccount,
  query: CashFlowReport['query'],
): CashFlowRow['rowId'] {
  return `SUBTOTAL:NONCASH_DISCLOSURE:${treatment}:CHART:${encodeURIComponent(account.account.id)}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function detectNoncashDisclosureHierarchyIssues(
  candidates: readonly NoncashDisclosureAccount[],
  chartById: ReadonlyMap<string, ChartAccount>,
  chartClassifications: ReadonlyMap<string, CashFlowClassificationRecord>,
): readonly NoncashDisclosureHierarchyIssue[] {
  const byKey = new Map(candidates.map(candidate => [
    `${candidate.sectionTreatment}:${candidate.account.id}`,
    candidate,
  ]));
  const issues = new Map<string, NoncashDisclosureHierarchyIssue>();
  const accountCandidateFor = (treatment: 'INVESTING' | 'FINANCING', accountId: string): NoncashDisclosureAccount | undefined =>
    byKey.get(`${treatment}:${accountId}`);
  const addIssue = (candidate: NoncashDisclosureAccount, reason: NoncashDisclosureHierarchyIssue['reason']): void => {
    const key = `${candidate.sectionTreatment}:${candidate.account.id}`;
    if (issues.has(key)) return;
    issues.set(key, {
      accountRole: 'CHART', accountId: candidate.account.id, treatment: candidate.sectionTreatment,
      parentId: candidate.account.parentId, reason,
    });
  };

  for (const candidate of candidates) {
    const parentId = candidate.account.parentId;
    if (!parentId) continue;
    const parent = chartById.get(parentId);
    const sameTreatmentParent = accountCandidateFor(candidate.sectionTreatment, parentId);
    const otherTreatmentParent = accountCandidateFor(candidate.sectionTreatment === 'INVESTING' ? 'FINANCING' : 'INVESTING', parentId);
    if (!parent) addIssue(candidate, 'MISSING_PARENT');
    else if (otherTreatmentParent && !sameTreatmentParent) addIssue(candidate, 'CROSS_TREATMENT');
    else if (!sameTreatmentParent) {
      const parentClassification = chartClassifications.get(parentId);
      addIssue(candidate, parentClassification?.treatment === candidate.sectionTreatment ? 'NONPARTICIPATING_PARENT' : 'CROSS_TREATMENT');
    }
  }

  for (const candidate of candidates) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: NoncashDisclosureAccount | undefined = candidate;
    while (current) {
      const currentKey = `${current.sectionTreatment}:${current.account.id}`;
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
      current = current.account.parentId
        ? accountCandidateFor(current.sectionTreatment, current.account.parentId)
        : undefined;
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      const parentId = candidate.account.parentId;
      if (!parentId) continue;
      const key = `${candidate.sectionTreatment}:${candidate.account.id}`;
      const parentKey = `${candidate.sectionTreatment}:${parentId}`;
      if (!issues.has(key) && issues.has(parentKey)) {
        addIssue(candidate, 'INVALID_ANCESTOR');
        changed = true;
      }
    }
  }

  return [...issues.values()].sort((left, right) =>
    left.treatment.localeCompare(right.treatment) || left.accountId.localeCompare(right.accountId));
}

function renderNoncashDisclosureRows(
  query: CashFlowReport['query'],
  candidates: readonly NoncashDisclosureAccount[],
  hierarchyIssues: readonly NoncashDisclosureHierarchyIssue[],
  detailIndex: Record<string, readonly CashFlowContribution[]>,
  chartById: ReadonlyMap<string, ChartAccount>,
): readonly CashFlowRow[] {
  if (candidates.length === 0) return [];
  const sectionRowId = cashFlowSyntheticRowId('SECTION_NONCASH_DISCLOSURE', query);
  const invalidKeys = new Set(hierarchyIssues.map(issue => `${issue.treatment}:${issue.accountId}`));
  const rows: CashFlowRow[] = [];
  const visibleGroups: CashFlowRow[] = [];
  for (const treatment of ['INVESTING', 'FINANCING'] as const) {
    const group = candidates.filter(candidate => candidate.sectionTreatment === treatment)
      .slice().sort(compareNoncashDisclosureAccounts);
    if (group.length === 0) continue;
    const validCandidates = group.filter(candidate => !invalidKeys.has(`${treatment}:${candidate.account.id}`));
    const reviewCandidates = group.filter(candidate => invalidKeys.has(`${treatment}:${candidate.account.id}`));
    const byKey = new Map(validCandidates.map(candidate => [`${treatment}:${candidate.account.id}`, candidate]));
    const children = new Map<string, NoncashDisclosureAccount[]>();
    const roots: NoncashDisclosureAccount[] = [];
    validCandidates.forEach(candidate => {
      const parentKey = candidate.account.parentId ? `${treatment}:${candidate.account.parentId}` : undefined;
      if (parentKey && byKey.has(parentKey) && noncashDisclosureParentChainIsAcyclic(candidate, byKey)) {
        children.set(parentKey, [...(children.get(parentKey) ?? []), candidate]);
      } else {
        roots.push(candidate);
      }
    });
    const groupRows: CashFlowRow[] = [];
    const groupRowId = noncashDisclosureGroupRowId(treatment, query);
    const renderedNodes = roots.sort(compareNoncashDisclosureAccounts)
      .map(root => renderNoncashDisclosureNode(query, treatment, root, children, byKey, detailIndex, chartById));
    const visibleNodeRows = renderedNodes.filter(result => result.rendered).flatMap(result => result.rows);
    const visibleReviewCandidates = reviewCandidates.filter(candidate => query.includeZeroRows || candidate.amountMinor !== 0n);
    if (visibleNodeRows.length > 0 || visibleReviewCandidates.length > 0 || query.includeZeroRows) {
      groupRows.push({
        rowId: groupRowId,
        rowType: 'GROUP_HEADER', section: 'NONCASH_DISCLOSURE', label: `${treatment === 'INVESTING' ? 'Investing' : 'Financing'} noncash activity`, depth: 1,
        parentRowId: sectionRowId, bold: true, derived: true, archived: false, reviewRequired: false,
      }, ...visibleNodeRows);
    }
    if (visibleReviewCandidates.length > 0) {
      const reviewGroupRowId = noncashDisclosureReviewGroupRowId(treatment, query);
      groupRows.push({
        rowId: reviewGroupRowId,
        rowType: 'GROUP_HEADER', section: 'NONCASH_DISCLOSURE', label: `${treatment === 'INVESTING' ? 'Investing' : 'Financing'} noncash activity — hierarchy review`, depth: 1,
        parentRowId: sectionRowId, bold: true, derived: true, archived: false, reviewRequired: true,
      }, ...visibleReviewCandidates.map(candidate => ({
        rowId: candidate.rowId,
        rowType: 'NONCASH_DISCLOSURE' as const,
        section: 'NONCASH_DISCLOSURE' as const,
        treatment: 'NONCASH_DISCLOSURE' as const,
        accountRole: 'CHART' as const,
        accountId: candidate.account.id,
        label: `${leafAccountName(candidate.account.name)} — recorded noncash activity`,
        fullPath: chartDisclosurePath(candidate.account, chartById),
        depth: 2,
        amountMinor: candidate.amountMinor,
        detailKey: candidate.detailKey,
        bold: false, derived: true, archived: candidate.archived, reviewRequired: true,
      })));
    }
    const groupTotalRowId = `SUBTOTAL:NONCASH_DISCLOSURE:${treatment}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
    const groupTotalDetailKey = cashFlowDetailKey(groupTotalRowId);
    const groupContributions = group.flatMap(candidate => candidate.contributions.map(contribution => ({
      ...contribution,
      contributionId: `group:${groupTotalRowId}:${contribution.contributionId}`,
      detailKey: groupTotalDetailKey,
    })));
    detailIndex[groupTotalDetailKey] = groupContributions;
    const groupTotal = group.reduce((total, candidate) => total + candidate.amountMinor, 0n);
    const groupTotalRow: CashFlowRow = {
      rowId: groupTotalRowId,
      rowType: 'SUBTOTAL', section: 'NONCASH_DISCLOSURE', treatment: 'NONCASH_DISCLOSURE',
      label: `${treatment === 'INVESTING' ? 'Investing' : 'Financing'} noncash activity total`, depth: 1,
      parentRowId: groupRowId, amountMinor: groupTotal, detailKey: groupTotalDetailKey,
      bold: true, derived: true, archived: group.some(candidate => candidate.archived), reviewRequired: reviewCandidates.length > 0,
    };
    assertCashFlowDetailAmount(groupTotalRow, groupContributions);
    if (groupRows.length > 0) {
      groupRows.push(groupTotalRow);
      visibleGroups.push(...groupRows);
    }
  }
  if (visibleGroups.length === 0) return [];
  rows.push({
    rowId: sectionRowId,
    rowType: 'SECTION_HEADER', section: 'NONCASH_DISCLOSURE', label: 'Supplemental noncash disclosures', depth: 0,
    bold: true, derived: true, archived: false, reviewRequired: false,
  }, ...visibleGroups);
  return rows;
}

function renderNoncashDisclosureNode(
  query: CashFlowReport['query'],
  treatment: 'INVESTING' | 'FINANCING',
  node: NoncashDisclosureAccount,
  children: ReadonlyMap<string, readonly NoncashDisclosureAccount[]>,
  byKey: ReadonlyMap<string, NoncashDisclosureAccount>,
  detailIndex: Record<string, readonly CashFlowContribution[]>,
  chartById: ReadonlyMap<string, ChartAccount>,
): { readonly rows: readonly CashFlowRow[]; readonly totalMinor: bigint; readonly rendered: boolean } {
  const childResults = (children.get(`${treatment}:${node.account.id}`) ?? [])
    .slice().sort(compareNoncashDisclosureAccounts)
    .map(child => renderNoncashDisclosureNode(query, treatment, child, children, byKey, detailIndex, chartById));
  const childTotal = childResults.reduce((total, child) => total + child.totalMinor, 0n);
  const totalMinor = node.amountMinor + childTotal;
  const visibleChildren = childResults.filter(result => result.rendered);
  const rendered = query.includeZeroRows || node.amountMinor !== 0n || visibleChildren.length > 0;
  const row: CashFlowRow = {
    rowId: node.rowId,
    rowType: 'NONCASH_DISCLOSURE', section: 'NONCASH_DISCLOSURE', treatment: 'NONCASH_DISCLOSURE',
    accountRole: 'CHART', accountId: node.account.id,
    parentRowId: node.account.parentId && byKey.has(`${treatment}:${node.account.parentId}`)
      ? noncashDisclosureAccountRowId(treatment, node.account.parentId) : undefined,
    label: `${leafAccountName(node.account.name)} — recorded noncash activity`,
    fullPath: chartDisclosurePath(node.account, chartById),
    depth: noncashDisclosureAccountDepth(node, byKey), amountMinor: node.amountMinor, detailKey: node.detailKey,
    bold: false, derived: true, archived: node.archived, reviewRequired: false,
  };
  const rows: CashFlowRow[] = rendered ? [row, ...visibleChildren.flatMap(child => child.rows)] : [];
  if (childResults.length > 0) {
    const subtotalRowId = noncashDisclosureSubtotalRowId(treatment, node, query);
    const subtotalDetailKey = cashFlowDetailKey(subtotalRowId);
    const subtree = collectNoncashDisclosureSubtree(node, children, treatment);
    const subtotalContributions = subtree.flatMap(candidate => candidate.contributions.map(contribution => ({
      ...contribution,
      contributionId: `subtotal:${subtotalRowId}:${contribution.contributionId}`,
      detailKey: subtotalDetailKey,
      childRowId: candidate.rowId,
    })));
    detailIndex[subtotalDetailKey] = subtotalContributions;
    const subtotal: CashFlowRow = {
      rowId: subtotalRowId,
      rowType: 'SUBTOTAL', section: 'NONCASH_DISCLOSURE', treatment: 'NONCASH_DISCLOSURE',
      accountRole: 'CHART', accountId: node.account.id, parentRowId: node.rowId,
      label: `Total for ${leafAccountName(node.account.name)} noncash activity`, fullPath: row.fullPath, depth: row.depth,
      amountMinor: totalMinor, detailKey: subtotalDetailKey, bold: true, derived: true,
      archived: node.archived, reviewRequired: false,
    };
    assertCashFlowDetailAmount(subtotal, subtotalContributions);
    if (rendered && (query.includeZeroRows || visibleChildren.length > 0)) rows.push(subtotal);
  }
  return { rows, totalMinor, rendered };
}

function noncashDisclosureParentChainIsAcyclic(
  node: NoncashDisclosureAccount,
  accounts: ReadonlyMap<string, NoncashDisclosureAccount>,
): boolean {
  const visited = new Set<string>([`${node.sectionTreatment}:${node.account.id}`]);
  let parentKey = node.account.parentId ? `${node.sectionTreatment}:${node.account.parentId}` : undefined;
  while (parentKey) {
    if (visited.has(parentKey)) return false;
    visited.add(parentKey);
    const parent = accounts.get(parentKey);
    if (!parent) return true;
    parentKey = parent.account.parentId ? `${parent.sectionTreatment}:${parent.account.parentId}` : undefined;
  }
  return true;
}

function collectNoncashDisclosureSubtree(
  node: NoncashDisclosureAccount,
  children: ReadonlyMap<string, readonly NoncashDisclosureAccount[]>,
  treatment: 'INVESTING' | 'FINANCING',
): readonly NoncashDisclosureAccount[] {
  return [node, ...(children.get(`${treatment}:${node.account.id}`) ?? [])
    .slice().sort(compareNoncashDisclosureAccounts)
    .flatMap(child => collectNoncashDisclosureSubtree(child, children, treatment))];
}

function noncashDisclosureAccountDepth(
  node: NoncashDisclosureAccount,
  accounts: ReadonlyMap<string, NoncashDisclosureAccount>,
): number {
  let depth = 2;
  const visited = new Set<string>();
  let parent = node.account.parentId;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = accounts.get(`${node.sectionTreatment}:${parent}`)?.account.parentId;
  }
  return depth;
}

function compareNoncashDisclosureAccounts(left: NoncashDisclosureAccount, right: NoncashDisclosureAccount): number {
  return left.account.displayOrder - right.account.displayOrder
    || left.account.name.localeCompare(right.account.name)
    || left.account.id.localeCompare(right.account.id);
}

function chartDisclosurePath(account: ChartAccount, accounts: ReadonlyMap<string, ChartAccount>): string {
  const names: string[] = [account.name];
  const visited = new Set<string>([account.id]);
  let parentId = account.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = accounts.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(' > ');
}

function isNoncashDisclosureTreatment(
  treatment: CashFlowClassificationRecord['treatment'] | undefined,
): treatment is 'INVESTING' | 'FINANCING' | 'NONCASH_DISCLOSURE' {
  return treatment === 'INVESTING' || treatment === 'FINANCING' || treatment === 'NONCASH_DISCLOSURE';
}

function classificationMatchesAccount(
  classification: CashFlowClassificationRecord,
  account: FinancialAccount | ChartAccount,
): boolean {
  return classification.accountId === account.id
    && classification.accountType === account.accountType
    && classification.detailType === account.detailType;
}

function detectCashFlowActivityHierarchyIssues(
  treatment: 'INVESTING' | 'FINANCING',
  candidates: readonly CashFlowActivityAccount[],
  chartById: ReadonlyMap<string, ChartAccount>,
  sourceById: ReadonlyMap<string, FinancialAccount>,
  chartClassifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  financialClassifications: ReadonlyMap<string, CashFlowClassificationRecord>,
): readonly CashFlowActivityHierarchyIssue[] {
  const byKey = new Map(candidates.map(candidate => [cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id), candidate]));
  const issues = new Map<string, CashFlowActivityHierarchyIssue>();
  const accountExists = (candidate: CashFlowActivityAccount): boolean => candidate.accountRole === 'CHART'
    ? chartById.has(candidate.parentId ?? '')
    : sourceById.has(candidate.parentId ?? '');
  const parentClassification = (candidate: CashFlowActivityAccount): CashFlowClassificationRecord | undefined => candidate.accountRole === 'CHART'
    ? chartClassifications.get(candidate.parentId ?? '')
    : financialClassifications.get(candidate.parentId ?? '');
  const parentFor = (candidate: CashFlowActivityAccount): CashFlowActivityAccount | undefined => candidate.parentId
    ? byKey.get(cashFlowActivityCandidateKey(candidate.accountRole, candidate.parentId))
    : undefined;
  const addIssue = (candidate: CashFlowActivityAccount, reason: CashFlowActivityHierarchyIssue['reason']): void => {
    const key = cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id);
    if (issues.has(key)) return;
    issues.set(key, {
      accountRole: candidate.accountRole,
      accountId: candidate.account.id,
      treatment,
      parentId: candidate.parentId,
      reason,
    });
  };

  for (const candidate of candidates) {
    if (!candidate.parentId) continue;
    const parent = parentFor(candidate);
    if (!accountExists(candidate)) addIssue(candidate, 'MISSING_PARENT');
    else if (!parent) {
      const classification = parentClassification(candidate);
      addIssue(candidate, classification && classification.treatment !== treatment ? 'CROSS_TREATMENT' : 'NONPARTICIPATING_PARENT');
    } else if (parent.classification.treatment !== treatment) {
      addIssue(candidate, 'CROSS_TREATMENT');
    }
  }

  for (const candidate of candidates) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: CashFlowActivityAccount | undefined = candidate;
    while (current) {
      const currentKey = cashFlowActivityCandidateKey(current.accountRole, current.account.id);
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

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!candidate.parentId) continue;
      const key = cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id);
      if (issues.has(key)) continue;
      const parentKey = cashFlowActivityCandidateKey(candidate.accountRole, candidate.parentId);
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

function renderCashFlowActivitySection(
  query: CashFlowReport['query'],
  section: 'INVESTING' | 'FINANCING',
  candidates: readonly CashFlowActivityAccount[],
  allHierarchyIssues: readonly CashFlowActivityHierarchyIssue[],
): CashFlowActivitySection {
  const detailIndex: Record<string, readonly CashFlowContribution[]> = {};
  candidates.forEach(candidate => { detailIndex[candidate.detailKey] = candidate.contributions; });
  const hierarchyIssues = allHierarchyIssues.filter(issue => issue.treatment === section);
  const invalidKeys = new Set(hierarchyIssues.map(issue => cashFlowActivityCandidateKey(issue.accountRole, issue.accountId)));
  const validCandidates = candidates.filter(candidate => !invalidKeys.has(cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id)));
  const reviewCandidates = candidates.filter(candidate => invalidKeys.has(cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id)));
  const byKey = new Map(validCandidates.map(candidate => [cashFlowActivityCandidateKey(candidate.accountRole, candidate.account.id), candidate]));
  const children = new Map<string, CashFlowActivityAccount[]>();
  const roots: CashFlowActivityAccount[] = [];
  validCandidates.forEach(candidate => {
    const parentKey = candidate.parentId ? cashFlowActivityCandidateKey(candidate.accountRole, candidate.parentId) : undefined;
    if (parentKey && byKey.has(parentKey) && activityParentChainIsAcyclic(candidate, byKey)) {
      children.set(parentKey, [...(children.get(parentKey) ?? []), candidate]);
    } else {
      roots.push(candidate);
    }
  });
  const rows: CashFlowRow[] = [{
    rowId: cashFlowSyntheticRowId(section === 'INVESTING' ? 'SECTION_INVESTING' : 'SECTION_FINANCING', query),
    rowType: 'SECTION_HEADER', section, label: section === 'INVESTING' ? 'Investing activities' : 'Financing activities', depth: 0,
    bold: true, derived: true, archived: false, reviewRequired: false,
  }];
  rows.push(...roots.sort(compareCashFlowActivityAccounts).flatMap(root => renderCashFlowActivityNode(query, section, root, children, byKey, detailIndex).rows));
  const visibleReviewCandidates = reviewCandidates
    .filter(candidate => query.includeZeroRows || candidate.amountMinor !== 0n)
    .slice().sort(compareCashFlowActivityAccounts);
  if (visibleReviewCandidates.length > 0) {
    rows.push({
      rowId: cashFlowActivityReviewGroupRowId(section, query),
      rowType: 'GROUP_HEADER', section, label: `${section === 'INVESTING' ? 'Investing activities' : 'Financing activities'} — hierarchy review`, depth: 1,
      bold: true, derived: true, archived: false, reviewRequired: true,
    }, ...visibleReviewCandidates.map(candidate => cashFlowActivityReviewRow(candidate)));
  }
  const amountMinor = candidates.reduce((total, candidate) => total + candidate.amountMinor, 0n);
  const totalRowId = cashFlowSyntheticRowId(section === 'INVESTING' ? 'NET_INVESTING' : 'NET_FINANCING', query);
  const totalDetailKey = cashFlowDetailKey(totalRowId);
  const totalContributions = candidates.map(candidate => ({
    ...candidate.contributions[0],
    contributionId: `section:${section}:${candidate.rowId}`,
    detailKey: totalDetailKey,
    contributionType: 'FORMULA' as const,
    contributionMinor: candidate.amountMinor,
    childRowId: candidate.rowId,
    description: section === 'INVESTING' ? 'Investing activity row total' : 'Financing activity row total',
  }));
  detailIndex[totalDetailKey] = totalContributions;
  const totalRow: CashFlowRow = {
    rowId: totalRowId,
    rowType: 'TOTAL', section, label: section === 'INVESTING' ? 'Net cash from investing activities' : 'Net cash from financing activities', depth: 0,
    amountMinor, detailKey: totalDetailKey, bold: true, derived: true, archived: false,
    reviewRequired: candidates.some(candidate => candidate.classification.status === 'REVIEW_REQUIRED'),
  };
  assertCashFlowDetailAmount(totalRow, totalContributions);
  rows.push(totalRow);
  return { section, candidates, hierarchyIssues, amountMinor, rows: Object.freeze(rows), detailIndex: Object.freeze(detailIndex) };
}

function cashFlowActivityReviewGroupRowId(section: 'INVESTING' | 'FINANCING', query: CashFlowReport['query']): CashFlowRow['rowId'] {
  return `GROUP:${section}:HIERARCHY_REVIEW:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function cashFlowActivityReviewRow(candidate: CashFlowActivityAccount): CashFlowRow {
  return {
    rowId: candidate.rowId,
    rowType: 'ACCOUNT_ACTIVITY', section: candidate.classification.treatment as 'INVESTING' | 'FINANCING', treatment: candidate.classification.treatment,
    accountRole: candidate.accountRole, accountId: candidate.account.id,
    label: leafAccountName(candidate.account.name), fullPath: candidate.accountPath, depth: 2,
    amountMinor: candidate.amountMinor, detailKey: candidate.detailKey,
    bold: false, derived: true, archived: candidate.account.archived, reviewRequired: true,
  };
}

function renderCashFlowActivityNode(
  query: CashFlowReport['query'],
  section: 'INVESTING' | 'FINANCING',
  node: CashFlowActivityAccount,
  children: ReadonlyMap<string, readonly CashFlowActivityAccount[]>,
  byKey: ReadonlyMap<string, CashFlowActivityAccount>,
  detailIndex: Record<string, readonly CashFlowContribution[]>,
): { readonly rows: readonly CashFlowRow[]; readonly totalMinor: bigint; readonly rendered: boolean } {
  const childResults = (children.get(cashFlowActivityCandidateKey(node.accountRole, node.account.id)) ?? [])
    .slice().sort(compareCashFlowActivityAccounts).map(child => renderCashFlowActivityNode(query, section, child, children, byKey, detailIndex));
  const childTotal = childResults.reduce((total, child) => total + child.totalMinor, 0n);
  const totalMinor = node.amountMinor + childTotal;
  const visibleChildren = childResults.filter(result => result.rendered);
  const rendered = query.includeZeroRows || node.amountMinor !== 0n || visibleChildren.length > 0;
  const row: CashFlowRow = {
    rowId: node.rowId,
    rowType: 'ACCOUNT_ACTIVITY', section, treatment: section,
    accountRole: node.accountRole, accountId: node.account.id,
    parentRowId: node.parentId && byKey.has(cashFlowActivityCandidateKey(node.accountRole, node.parentId))
      ? cashFlowAccountRowId(section, node.accountRole, node.parentId) : undefined,
    label: leafAccountName(node.account.name), fullPath: node.accountPath, depth: activityAccountDepth(node, byKey), amountMinor: node.amountMinor,
    detailKey: node.detailKey, bold: false, derived: true, archived: node.account.archived,
    reviewRequired: node.classification.status === 'REVIEW_REQUIRED',
  };
  const rows: CashFlowRow[] = rendered ? [row, ...visibleChildren.flatMap(child => child.rows)] : [];
  if (childResults.length > 0 && (query.includeZeroRows || visibleChildren.length > 0)) {
    const subtotalRowId = cashFlowActivitySubtotalRowId(section, node, query);
    const subtotalDetailKey = cashFlowDetailKey(subtotalRowId);
    const subtree = collectCashFlowActivitySubtree(node, children);
    const subtotalContributions = subtree.flatMap(candidate => candidate.contributions.map(contribution => ({
      ...contribution,
      contributionId: `subtotal:${subtotalRowId}:${contribution.contributionId}`,
      detailKey: subtotalDetailKey,
      childRowId: candidate.rowId,
    })));
    detailIndex[subtotalDetailKey] = subtotalContributions;
    const subtotal: CashFlowRow = {
      rowId: subtotalRowId,
      rowType: 'SUBTOTAL', section, treatment: section,
      accountRole: node.accountRole, accountId: node.account.id, parentRowId: node.rowId,
      label: `Total for ${leafAccountName(node.account.name)}`, fullPath: node.accountPath, depth: activityAccountDepth(node, byKey),
      amountMinor: totalMinor, detailKey: subtotalDetailKey, bold: true, derived: true, archived: node.account.archived,
      reviewRequired: subtree.some(candidate => candidate.classification.status === 'REVIEW_REQUIRED'),
    };
    assertCashFlowDetailAmount(subtotal, subtotalContributions);
    if (rendered) rows.push(subtotal);
  }
  return { rows, totalMinor, rendered };
}

function cashFlowActivityCandidateKey(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): string {
  return `${accountRole}:${accountId}`;
}

function activityParentChainIsAcyclic(node: CashFlowActivityAccount, accounts: ReadonlyMap<string, CashFlowActivityAccount>): boolean {
  const visited = new Set<string>([cashFlowActivityCandidateKey(node.accountRole, node.account.id)]);
  let parentKey = node.parentId ? cashFlowActivityCandidateKey(node.accountRole, node.parentId) : undefined;
  while (parentKey) {
    if (visited.has(parentKey)) return false;
    visited.add(parentKey);
    const parent = accounts.get(parentKey);
    if (!parent) return true;
    parentKey = parent.parentId ? cashFlowActivityCandidateKey(parent.accountRole, parent.parentId) : undefined;
  }
  return true;
}

function activityAccountDepth(node: CashFlowActivityAccount, accounts: ReadonlyMap<string, CashFlowActivityAccount>): number {
  let depth = 1;
  const visited = new Set<string>();
  let parent = node.parentId;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    depth += 1;
    parent = accounts.get(cashFlowActivityCandidateKey(node.accountRole, parent))?.parentId;
  }
  return depth;
}

function collectCashFlowActivitySubtree(node: CashFlowActivityAccount, children: ReadonlyMap<string, readonly CashFlowActivityAccount[]>): readonly CashFlowActivityAccount[] {
  return [node, ...(children.get(cashFlowActivityCandidateKey(node.accountRole, node.account.id)) ?? []).slice().sort(compareCashFlowActivityAccounts).flatMap(child => collectCashFlowActivitySubtree(child, children))];
}

function compareCashFlowActivityAccounts(left: CashFlowActivityAccount, right: CashFlowActivityAccount): number {
  const leftOrder = left.accountRole === 'CHART' ? (left.account as ChartAccount).displayOrder : Number.MAX_SAFE_INTEGER;
  const rightOrder = right.accountRole === 'CHART' ? (right.account as ChartAccount).displayOrder : Number.MAX_SAFE_INTEGER;
  return leftOrder - rightOrder || left.accountPath.localeCompare(right.accountPath) || left.account.id.localeCompare(right.account.id);
}

function compareCashFlowContributions(left: CashFlowContribution, right: CashFlowContribution): number {
  return (left.businessDate ?? '').localeCompare(right.businessDate ?? '')
    || (left.transactionId ?? '').localeCompare(right.transactionId ?? '')
    || (left.counterpartyTransactionId ?? '').localeCompare(right.counterpartyTransactionId ?? '')
    || (left.splitId ?? '').localeCompare(right.splitId ?? '')
    || left.contributionId.localeCompare(right.contributionId);
}

function cashFlowActivitySubtotalRowId(section: 'INVESTING' | 'FINANCING', node: CashFlowActivityAccount, query: CashFlowReport['query']): CashFlowRow['rowId'] {
  return `SUBTOTAL:${section}:${node.accountRole}:${encodeURIComponent(node.account.id)}:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'];
}

function unclassifiedDetailKey(query: CashFlowReport['query']): CashFlowContribution['detailKey'] {
  return `DETAIL:UNCLASSIFIED_CASH_ACTIVITY:${query.startDate}:${query.endDate}` as CashFlowContribution['detailKey'];
}

function activityFormulaContribution(
  detailKey: CashFlowContribution['detailKey'],
  amountMinor: bigint,
  childRowId: CashFlowRow['rowId'],
  description: string,
): CashFlowContribution {
  return {
    contributionId: `formula:${childRowId}`,
    detailKey,
    contributionType: 'FORMULA',
    contributionMinor: amountMinor,
    childRowId,
    description,
    formula: 'Sum of section totals',
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
    assertCashFlowDetailAmount({ rowId: subtotalRowId, rowType: 'SUBTOTAL', section: 'OPERATING', label: '', depth, bold: true, derived: true, archived: false, reviewRequired: false, amountMinor: totalMinor }, subtotalContributions);
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

export function assertCashFlowDetailAmount(
  row: CashFlowRow,
  contributions: readonly CashFlowContribution[] | undefined,
  identity?: CashFlowReportIdentity,
): void {
  if (row.amountMinor === undefined) return;
  const total = (contributions ?? []).reduce((sum, contribution) => sum + contribution.contributionMinor, 0n);
  if (total !== row.amountMinor) {
    throw new CashFlowContractError({
      code: 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED',
      message: `Cash Flow detail ${row.detailKey ?? row.rowId} does not reconcile for report ${identity?.reportId ?? 'unidentified'}.`,
      reportId: identity?.reportId,
      databaseRevision: identity?.databaseRevision,
      detailKey: row.detailKey,
      retryable: false,
    });
  }
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

function transferDiagnosticDetailKey(query: CashFlowReport['query']): CashFlowContribution['detailKey'] {
  return `DETAIL:TRANSFER_DIAGNOSTICS:${query.startDate}:${query.endDate}` as CashFlowContribution['detailKey'];
}

function restrictedCashDetailKey(query: CashFlowReport['query']): CashFlowContribution['detailKey'] {
  return `DETAIL:RESTRICTED_CASH_ENDING:${query.startDate}:${query.endDate}` as CashFlowContribution['detailKey'];
}

function restrictedCashBalanceContributions(
  query: CashFlowReport['query'],
  balances: ReturnType<typeof calculateFinancialSourceBalances>,
  restrictedAccountIds: ReadonlySet<string>,
  detailKey: CashFlowContribution['detailKey'],
): readonly CashFlowContribution[] {
  return balances
    .filter(balance => restrictedAccountIds.has(balance.account.id) && balance.amountMinor !== 0n)
    .slice().sort((left, right) => left.account.id.localeCompare(right.account.id))
    .map(balance => ({
      contributionId: `restricted-ending:${balance.account.id}`,
      detailKey,
      contributionType: 'FORMULA' as const,
      contributionMinor: balance.amountMinor,
      businessDate: query.endDate,
      accountRole: 'FINANCIAL_SOURCE' as const,
      accountId: balance.account.id,
      accountName: balance.account.name,
      description: 'Restricted cash ending balance',
      formula: 'Ending restricted cash balance',
    }));
}

function cashBoundaryContributions(
  query: CashFlowReport['query'],
  balances: ReturnType<typeof calculateFinancialSourceBalances>,
  cashAccountIds: ReadonlySet<string>,
  detailKey: CashFlowContribution['detailKey'],
  side: 'OPENING' | 'ENDING',
): readonly CashFlowContribution[] {
  const businessDate = side === 'OPENING' ? dayBeforeBusinessDate(query.startDate) : query.endDate;
  return balances
    .filter(balance => cashAccountIds.has(balance.account.id) && balance.amountMinor !== 0n)
    .slice().sort((left, right) => left.account.id.localeCompare(right.account.id))
    .map(balance => ({
      contributionId: `cash-boundary:${side.toLowerCase()}:${balance.account.id}`,
      detailKey,
      contributionType: 'FORMULA' as const,
      contributionMinor: balance.amountMinor,
      businessDate,
      accountRole: 'FINANCIAL_SOURCE' as const,
      accountId: balance.account.id,
      accountName: balance.account.name,
      description: side === 'OPENING' ? 'Beginning cash composition' : 'Ending cash composition',
      formula: side === 'OPENING' ? 'Balance Sheet opening snapshot' : 'Balance Sheet ending snapshot',
    }));
}

function cashBalanceRows(
  query: CashFlowReport['query'],
  beginning: bigint,
  ending: bigint,
  restrictedEnding: bigint,
  restrictedDetailKey: CashFlowContribution['detailKey'],
  beginningDetailKey: CashFlowContribution['detailKey'],
  endingDetailKey: CashFlowContribution['detailKey'],
  unclassifiedMinor: bigint,
  unclassifiedDetailKey: CashFlowContribution['detailKey'] | undefined,
  differenceMinor: bigint,
  differenceDetailKey: CashFlowContribution['detailKey'],
): readonly CashFlowRow[] {
  const rows: CashFlowRow[] = [
    {
      rowId: cashFlowSyntheticRowId('SECTION_CASH_RECONCILIATION', query),
      rowType: 'SECTION_HEADER', section: 'CASH_RECONCILIATION', label: 'Cash reconciliation', depth: 0,
      bold: true, derived: true, archived: false, reviewRequired: false,
    },
    {
      rowId: cashFlowSyntheticRowId('BEGINNING_CASH', query),
      rowType: 'CASH_BALANCE', section: 'CASH_RECONCILIATION', label: 'Beginning cash and cash equivalents', depth: 1,
      amountMinor: beginning, detailKey: beginningDetailKey, bold: false, derived: true, archived: false, reviewRequired: false,
    },
    {
      rowId: cashFlowSyntheticRowId('ENDING_CASH', query),
      rowType: 'CASH_BALANCE', section: 'CASH_RECONCILIATION', label: 'Ending cash and cash equivalents', depth: 1,
      amountMinor: ending, detailKey: endingDetailKey, bold: true, derived: true, archived: false, reviewRequired: false,
    },
  ];
  if (query.includeZeroRows || restrictedEnding !== 0n) {
    rows.push({
      rowId: `SYNTHETIC:RESTRICTED_CASH_ENDING:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'],
      rowType: 'CASH_BALANCE', section: 'CASH_RECONCILIATION', label: 'Restricted cash ending balance', depth: 1,
      amountMinor: restrictedEnding, detailKey: restrictedDetailKey, bold: false, derived: true, archived: false,
      reviewRequired: restrictedEnding !== 0n,
    });
  }
  if (unclassifiedDetailKey && (query.includeZeroRows || unclassifiedMinor !== 0n)) {
    rows.push({
      rowId: `SYNTHETIC:UNCLASSIFIED_CASH_ACTIVITY:${query.startDate}:${query.endDate}` as CashFlowRow['rowId'],
      rowType: 'DIFFERENCE', section: 'CASH_RECONCILIATION', label: 'Unclassified cash activity', depth: 1,
      amountMinor: unclassifiedMinor, detailKey: unclassifiedDetailKey, bold: false, derived: true, archived: false,
      reviewRequired: true,
    });
  }
  rows.push({
    rowId: cashFlowSyntheticRowId('DIFFERENCE', query),
    rowType: 'DIFFERENCE', section: 'CASH_RECONCILIATION', label: 'Difference', depth: 1,
    amountMinor: differenceMinor, detailKey: differenceDetailKey, bold: true, derived: true, archived: false,
    reviewRequired: differenceMinor !== 0n,
  });
  return rows;
}

function buildWarnings(
  accounts: readonly FinancialAccount[],
  chartAccounts: readonly ChartAccount[],
  transactions: readonly Transaction[],
  allClassifications: readonly CashFlowClassificationRecord[],
  classifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  chartClassifications: ReadonlyMap<string, CashFlowClassificationRecord>,
  cashAccountIds: ReadonlySet<string>,
  restrictedAccountIds: ReadonlySet<string>,
  query: CashFlowReport['query'],
  beginningBalances: ReturnType<typeof calculateFinancialSourceBalances>,
  endingBalances: ReturnType<typeof calculateFinancialSourceBalances>,
  beginningChartBalances: readonly ChartBalance[],
  endingChartBalances: readonly ChartBalance[],
  restrictedBeginning: bigint,
  restrictedEnding: bigint,
  beginningDate: string,
  beginningDifference: bigint,
  endingDifference: bigint,
  hierarchyIssues: readonly (WorkingCapitalHierarchyIssue | CashFlowActivityHierarchyIssue | NoncashDisclosureHierarchyIssue)[],
  unclassifiedReferences: readonly string[],
  excludedReferences: readonly string[],
  differenceMinor: bigint,
  transferWarningReferences: readonly string[],
  noncashReferences: readonly string[],
): readonly CashFlowWarning[] {
  const warnings: CashFlowWarning[] = [];
  const beginningByAccount = new Map(beginningBalances.map(balance => [balance.account.id, balance]));
  const endingByAccount = new Map(endingBalances.map(balance => [balance.account.id, balance]));
  const beginningChartByAccount = new Map(beginningChartBalances.map(balance => [balance.account.id, balance]));
  const endingChartByAccount = new Map(endingChartBalances.map(balance => [balance.account.id, balance]));
  const chartById = new Map(chartAccounts.map(account => [account.id, account]));
  const includedPeriodTransactions = transactions.filter(transaction =>
    transaction.state === 'POSTED'
    && transaction.postingDate >= query.startDate
    && transaction.postingDate <= query.endDate);
  const contributesToPeriod = (accountId: string): boolean => {
    const beginning = beginningByAccount.get(accountId);
    const ending = endingByAccount.get(accountId);
    if ((beginning?.amountMinor ?? 0n) !== 0n || (ending?.amountMinor ?? 0n) !== 0n) return true;
    return Boolean(ending?.transactions.some(transaction =>
      transaction.postingDate >= query.startDate
      && transaction.postingDate <= query.endDate
      && transaction.amount.minorUnits !== 0n));
  };
  const contributesToChartPeriod = (accountId: string): boolean => {
    const beginning = beginningChartByAccount.get(accountId);
    const ending = endingChartByAccount.get(accountId);
    if ((beginning?.amountMinor ?? 0n) !== 0n || (ending?.amountMinor ?? 0n) !== 0n) return true;
    return includedPeriodTransactions.some(transaction => transaction.splits.some(split =>
      split.chartAccountId === accountId && split.amount.minorUnits !== 0n));
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
    if (account.archived && contributes) {
      warnings.push({
        warningId: cashFlowWarningId('ARCHIVED_PARTICIPATING_ACCOUNT', ['FINANCIAL_SOURCE', account.id], query),
        code: 'ARCHIVED_PARTICIPATING_ACCOUNT',
        message: `${account.name} is archived but remains part of Cash Flow balances.`,
        accountRole: 'FINANCIAL_SOURCE', accountId: account.id, references: ['FINANCIAL_SOURCE', account.id],
      });
    }
  }
  for (const classification of allClassifications.slice().sort((left, right) =>
    `${left.accountRole}:${left.accountId}`.localeCompare(`${right.accountRole}:${right.accountId}`))) {
    const account = classification.accountRole === 'FINANCIAL_SOURCE'
      ? accounts.find(candidate => candidate.id === classification.accountId)
      : chartById.get(classification.accountId);
    const classificationAccount = account as FinancialAccount | ChartAccount | undefined;
    const matchesStructure = Boolean(classificationAccount
      && classificationMatchesAccount(classification, classificationAccount));
    const validation = matchesStructure && classificationAccount
      ? validateCashFlowClassification({
        accountRole: classification.accountRole,
        accountType: classificationAccount.accountType,
        detailType: classificationAccount.detailType,
        classification,
      })
      : undefined;
    if (!matchesStructure || !validation?.ok) {
      warnings.push({
        warningId: cashFlowWarningId('CASH_FLOW_CLASSIFICATION_INVALID', [classification.accountRole, classification.accountId], query),
        code: 'CASH_FLOW_CLASSIFICATION_INVALID',
        message: `${classification.accountRole === 'CHART' ? 'Chart' : 'Financial'} account ${classification.accountId} has an invalid Cash Flow classification.`,
        accountRole: classification.accountRole,
        accountId: classification.accountId,
        references: [classification.accountRole, classification.accountId],
      });
      continue;
    }
    const contributes = classification.accountRole === 'FINANCIAL_SOURCE'
      ? contributesToPeriod(classification.accountId)
      : contributesToChartPeriod(classification.accountId);
    if (!contributes) continue;
    const isCashBoundaryReview = classification.accountRole === 'FINANCIAL_SOURCE'
      && (classification.cashRole === 'CASH' || classification.cashRole === 'CASH_EQUIVALENT' || classification.cashRole === 'RESTRICTED_CASH')
      && classification.treatment === 'CASH_BALANCE';
    if (classification.status === 'REVIEW_REQUIRED' || classification.treatment === 'REVIEW_REQUIRED') {
      if (isCashBoundaryReview) continue;
      warnings.push({
        warningId: cashFlowWarningId('CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED', [classification.accountRole, classification.accountId], query),
        code: 'CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED',
        message: `${classification.accountRole === 'CHART' ? 'Chart' : 'Financial'} account ${classification.accountId} requires Cash Flow treatment review.`,
        accountRole: classification.accountRole,
        accountId: classification.accountId,
        references: [classification.accountRole, classification.accountId],
      });
    }
  }
  // Chart accounts participate independently from financial-source accounts.
  // A missing Chart classification cannot be treated as an implicit default:
  // the account may still affect P/L, Balance Sheet, or a cash-side split, so
  // surface the unresolved classification whenever it has nonzero period or
  // projected balance activity.
  const classifiedChartIds = new Set(chartClassifications.keys());
  for (const account of chartAccounts.slice().sort((left, right) =>
    left.displayOrder - right.displayOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))) {
    if (account.archived && contributesToChartPeriod(account.id)) {
      warnings.push({
        warningId: cashFlowWarningId('ARCHIVED_PARTICIPATING_ACCOUNT', ['CHART', account.id], query),
        code: 'ARCHIVED_PARTICIPATING_ACCOUNT',
        message: `${account.name} is archived but remains part of Cash Flow balances.`,
        accountRole: 'CHART', accountId: account.id, references: ['CHART', account.id],
      });
    }
    if (classifiedChartIds.has(account.id) || !contributesToChartPeriod(account.id)) continue;
    warnings.push({
      warningId: cashFlowWarningId('CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED', ['CHART', account.id], query),
      code: 'CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED',
      message: `Chart account ${account.id} requires Cash Flow treatment review.`,
      accountRole: 'CHART', accountId: account.id, references: ['CHART', account.id],
    });
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
  if (unclassifiedReferences.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('UNCLASSIFIED_CASH_ACTIVITY', unclassifiedReferences, query),
      code: 'UNCLASSIFIED_CASH_ACTIVITY',
      message: 'Cash-side Investing or Financing activity includes a Review-required or invalid Chart classification.',
      references: unclassifiedReferences,
    });
  }
  const openingReferences = unclassifiedReferences.filter(reference => reference.startsWith('opening:'));
  if (openingReferences.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('OPENING_CASH_BALANCE_WITHIN_PERIOD', openingReferences, query),
      code: 'OPENING_CASH_BALANCE_WITHIN_PERIOD',
      message: 'A cash opening balance was introduced inside the selected period without supported ledger activity.',
      references: openingReferences,
    });
  }
  if (excludedReferences.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('EXCLUDED_MATERIAL_CASH_ACTIVITY', excludedReferences, query),
      code: 'EXCLUDED_MATERIAL_CASH_ACTIVITY',
      message: 'Cash-side Investing or Financing activity was explicitly excluded from the statement.',
      references: excludedReferences,
    });
  }
  const participatingRestrictedAccountIds = [...restrictedAccountIds]
    .filter(accountId => contributesToPeriod(accountId))
    .sort();
  if (participatingRestrictedAccountIds.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('RESTRICTED_CASH_PRESENT', participatingRestrictedAccountIds, query),
      code: 'RESTRICTED_CASH_PRESENT',
      message: 'Restricted cash is reported separately from cash and cash equivalents.',
      references: participatingRestrictedAccountIds,
    });
  }
  if (noncashReferences.length > 0) {
    const references = [...new Set(noncashReferences)].sort();
    warnings.push({
      warningId: cashFlowWarningId('NONCASH_ACTIVITY_IDENTIFIED', references, query),
      code: 'NONCASH_ACTIVITY_IDENTIFIED',
      message: 'Identifiable recorded noncash Investing or Financing activity is disclosed separately from cash flows.',
      references,
    });
  }
  if (differenceMinor !== 0n) {
    const differenceReferences = [...new Set([...unclassifiedReferences, ...excludedReferences, ...transferWarningReferences])].sort();
    warnings.push({
      warningId: cashFlowWarningId('CASH_RECONCILIATION_DIFFERENCE', [differenceMinor.toString(), ...differenceReferences], query),
      code: 'CASH_RECONCILIATION_DIFFERENCE',
      message: 'Calculated Ending Cash differs from Ending Cash after classified activity.',
      references: differenceReferences,
    });
  }
  if (transferWarningReferences.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('UNMATCHED_CASH_TRANSFER_CANDIDATE', transferWarningReferences, query),
      code: 'UNMATCHED_CASH_TRANSFER_CANDIDATE',
      message: 'One or more confirmed transfer structures require review before Cash Flow classification.',
      references: transferWarningReferences,
    });
  }
  const outOfBalanceReferences = [
    ...(beginningDifference === 0n ? [] : [`${beginningDate}:${beginningDifference.toString()}`]),
    ...(endingDifference === 0n ? [] : [`${query.endDate}:${endingDifference.toString()}`]),
  ];
  if (outOfBalanceReferences.length > 0) {
    warnings.push({
      warningId: cashFlowWarningId('SOURCE_BALANCE_SHEET_OUT_OF_BALANCE', outOfBalanceReferences, query),
      code: 'SOURCE_BALANCE_SHEET_OUT_OF_BALANCE',
      message: `The source Balance Sheet is out of balance for ${outOfBalanceReferences.map(reference => reference.replace(':', ' (difference ') + ')').join(' and ')}.`,
      references: outOfBalanceReferences,
    });
  }
  return Object.freeze(warnings.sort((left, right) => left.warningId.localeCompare(right.warningId)).map(warning => Object.freeze(warning)));
}

function isBlockingCashFlowWarning(code: CashFlowWarning['code']): boolean {
  return !['RESTRICTED_CASH_PRESENT', 'NONCASH_ACTIVITY_IDENTIFIED', 'ARCHIVED_PARTICIPATING_ACCOUNT'].includes(code);
}

export function dayBeforeBusinessDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return date.toISOString().slice(0, 10);
}
