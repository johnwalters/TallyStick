import { Injectable, inject } from '@angular/core';
import {
  ChartAccount,
  FinancialAccount,
  Transaction,
  newId,
  nowUtc,
} from '../domain-model/accounting.types';
import {
  ACCOUNT_TYPE_CATALOG,
  AccountingAccountType,
  getAccountTypeDefinition,
  validateAccountUse,
} from '../domain-model/account-taxonomy';
import {
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_TREATMENTS,
  CashFlowClassification,
  CashFlowCashRole,
  CashFlowTreatment,
  getDefaultCashFlowClassification,
  validateCashFlowClassification,
} from '../domain-model/cash-flow-classification';
import {
  CashFlowClassificationExportResult,
  CashFlowClassificationFailure,
  CashFlowClassificationImportCommitResult,
  CashFlowClassificationImportIssue,
  CashFlowClassificationImportPreview,
  CashFlowClassificationImportRow,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowClassificationReviewItem,
  CashFlowClassificationReviewReasonCode,
  CashFlowClassificationSaveImpact,
  CashFlowClassificationExchangeRow,
  CashFlowContractError,
  CashFlowQuery,
  CommitCashFlowClassificationImportCommand,
  DatabaseRevision,
  PreviewCashFlowClassificationCommand,
  PreviewCashFlowClassificationImportCommand,
  SaveCashFlowClassificationCommand,
  ExportCashFlowClassificationsCommand,
  freezeCashFlowClassificationReview,
} from '../domain-model/cash-flow.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';

interface AccountTarget {
  readonly role: 'FINANCIAL_SOURCE' | 'CHART';
  readonly account: FinancialAccount | ChartAccount;
  readonly accountType: AccountingAccountType;
  readonly detailType: string;
}

interface PendingImport {
  readonly revision: DatabaseRevision;
  readonly rows: readonly CashFlowClassificationExchangeRow[];
  readonly updates: readonly CashFlowClassificationRecord[];
  readonly issues: readonly CashFlowClassificationImportIssue[];
}

interface ActivitySummary {
  readonly startDate: string;
  readonly endDate: string;
  readonly financialBeforeStart: ReadonlyMap<string, bigint>;
  readonly financialThroughEnd: ReadonlyMap<string, bigint>;
  readonly financialPeriod: ReadonlyMap<string, bigint>;
  readonly chartBeforeStart: ReadonlyMap<string, bigint>;
  readonly chartThroughEnd: ReadonlyMap<string, bigint>;
  readonly chartPeriod: ReadonlyMap<string, bigint>;
}

const LABELS: Readonly<Record<CashFlowTreatment, string>> = {
  CASH_BALANCE: 'Cash balance',
  OPERATING_REVENUE_EXPENSE: 'Operating revenue/expense',
  OPERATING_ASSET: 'Operating asset',
  OPERATING_LIABILITY: 'Operating liability',
  NONCASH_PNL_ADJUSTMENT: 'Noncash P/L adjustment',
  INVESTING: 'Investing',
  FINANCING: 'Financing',
  NONCASH_DISCLOSURE: 'Noncash disclosure',
  EXCLUDED: 'Excluded',
  REVIEW_REQUIRED: 'Review required',
};

const SECTION_FOR: Readonly<Partial<Record<CashFlowTreatment, 'OPERATING' | 'INVESTING' | 'FINANCING' | 'CASH_RECONCILIATION' | 'NONCASH_DISCLOSURE'>>> = {
  CASH_BALANCE: 'CASH_RECONCILIATION',
  OPERATING_REVENUE_EXPENSE: 'OPERATING',
  OPERATING_ASSET: 'OPERATING',
  OPERATING_LIABILITY: 'OPERATING',
  NONCASH_PNL_ADJUSTMENT: 'OPERATING',
  INVESTING: 'INVESTING',
  FINANCING: 'FINANCING',
  NONCASH_DISCLOSURE: 'NONCASH_DISCLOSURE',
};

@Injectable({ providedIn: 'root' })
export class CashFlowClassificationService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;
  private readonly pendingImports = new Map<string, PendingImport>();

  preview(command: PreviewCashFlowClassificationCommand): CashFlowClassificationPreview {
    const target = this.findTarget(command.accountRole, command.accountId);
    if (!target) return this.previewFailure(command, 'ACCOUNT_NOT_FOUND', 'The selected account does not exist or is archived.');

    const current = this.repository.getCashFlowClassification(command.accountRole, command.accountId);
    const classification: CashFlowClassification = {
      ...(command.cashRole === undefined ? {} : { cashRole: command.cashRole }),
      treatment: command.treatment,
      status: command.treatment === 'REVIEW_REQUIRED' || command.cashRole === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'CONFIRMED',
      source: 'USER',
      rationale: current?.rationale?.trim() || 'User classification preview.',
    };
    const validation = validateCashFlowClassification({
      accountRole: command.accountRole,
      accountType: target.accountType,
      detailType: target.detailType,
      classification,
    });
    if (!validation.ok) {
      return this.previewFailure(command, this.mapDomainFailure(validation.error.code), validation.error.message, classification.rationale);
    }
    const query = command.query ?? this.defaultQuery();
    const summary = this.buildActivitySummary(query);
    const periodActivityMinor = this.activityFor(command.accountRole, target.account, summary, query);
    return Object.freeze({
      valid: true,
      normalized: Object.freeze(validation.value.classification),
      statementSection: SECTION_FOR[validation.value.classification.treatment],
      statementLabel: LABELS[validation.value.classification.treatment],
      rationale: validation.value.classification.rationale,
      query: Object.freeze({ ...query }),
      periodActivityMinor,
      reportImpactMinor: periodActivityMinor,
      failures: Object.freeze([]),
    });
  }

  save(command: SaveCashFlowClassificationCommand): CashFlowClassificationReview {
    const target = this.findTarget(command.accountRole, command.accountId);
    if (!target) throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', 'The selected account does not exist or is archived.', command);
    const rationale = command.userRationale.trim();
    if (!rationale) throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', 'A rationale is required when saving a Cash Flow classification.', command);

    const current = this.repository.getCashFlowClassification(command.accountRole, command.accountId);
    if (command.expectedModifiedAtUtc !== undefined && command.expectedModifiedAtUtc !== (current?.modifiedAtUtc ?? undefined)) {
      throw this.failure('CLASSIFICATION_STALE', 'The classification changed before it could be saved. Reload and try again.', command, true);
    }
    const classification: CashFlowClassification = {
      ...(command.cashRole === undefined ? {} : { cashRole: command.cashRole }),
      treatment: command.treatment,
      status: command.treatment === 'REVIEW_REQUIRED' || command.cashRole === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'CONFIRMED',
      source: 'USER',
      rationale,
      modifiedAtUtc: nowUtc(),
    };
    const validation = validateCashFlowClassification({
      accountRole: command.accountRole,
      accountType: target.accountType,
      detailType: target.detailType,
      classification,
    });
    if (!validation.ok) throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', validation.error.message, command);
    const update: CashFlowClassificationRecord = {
      ...validation.value.classification,
      modifiedAtUtc: classification.modifiedAtUtc,
      accountRole: command.accountRole,
      accountId: command.accountId,
      accountType: target.accountType,
      detailType: target.detailType,
    };
    let accountReviewConfirmed = false;
    try {
      this.repository.transaction(() => {
        this.repository.saveCashFlowClassifications([update]);
        accountReviewConfirmed = this.confirmReviewedFinancialAccounts([update], rationale).has(update.accountId);
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('stale')) {
        throw this.failure('CLASSIFICATION_STALE', 'The classification changed before it could be saved. Reload and try again.', command, true);
      }
      throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', error instanceof Error ? error.message : 'The Cash Flow classification could not be saved.', command);
    }
    // Repository writes advance the shared database revision, which is the
    // report-cache key. Drop any in-memory import previews as well so a
    // preview cannot be committed against the prior classification state.
    this.pendingImports.clear();
    const query = command.query ?? this.defaultQuery();
    const summary = this.buildActivitySummary(query);
    const impact: CashFlowClassificationSaveImpact = {
      query,
      databaseRevision: this.repository.getDatabaseRevision(),
      accountRole: command.accountRole,
      accountId: command.accountId,
      accountPath: this.accountPath(command.accountRole, target.account),
      ...(current ? { previousClassification: current } : {}),
      classification: update,
      affectedReports: Object.freeze(accountReviewConfirmed ? ['CASH_FLOW', 'BALANCE_SHEET'] as const : ['CASH_FLOW'] as const),
      affectedSections: Object.freeze([...(SECTION_FOR[update.treatment] ? [SECTION_FOR[update.treatment]!] : [])]),
      periodActivityMinor: this.activityFor(command.accountRole, target.account, summary, query),
      reportImpactMinor: this.activityFor(command.accountRole, target.account, summary, query),
      cacheInvalidated: true,
    };
    return this.review(query, impact);
  }

  review(query: CashFlowQuery, saveImpact?: CashFlowClassificationSaveImpact): CashFlowClassificationReview {
    const summary = this.buildActivitySummary(query);
    const accounts = [
      ...[...this.repository.accounts.values()].map(account => this.reviewItem('FINANCIAL_SOURCE', account, query, summary)),
      ...[...this.repository.chartAccounts.values()].map(account => this.reviewItem('CHART', account, query, summary)),
    ].filter((item): item is CashFlowClassificationReviewItem => item !== undefined)
      .sort((left, right) => normalizePath(left.accountPath).localeCompare(normalizePath(right.accountPath)) || left.accountRole.localeCompare(right.accountRole) || left.accountId.localeCompare(right.accountId));
    const blockingCount = accounts.filter(item => item.status === 'REVIEW_REQUIRED').length;
    const warningCount = accounts.filter(item => item.status !== 'REVIEW_REQUIRED' && this.isArchived(item.accountRole, item.accountId)).length;
    return freezeCashFlowClassificationReview({
      query: Object.freeze({ ...query }),
      databaseRevision: this.repository.getDatabaseRevision(),
      accounts,
      blockingCount,
      warningCount,
      ...(saveImpact ? { saveImpact, impact: saveImpact } : {}),
    });
  }

  previewImport(command: PreviewCashFlowClassificationImportCommand): CashFlowClassificationImportPreview {
    const currentRevision = this.repository.getDatabaseRevision();
    const issues: CashFlowClassificationImportIssue[] = [];
    const rows: CashFlowClassificationExchangeRow[] = [];
    const updates: CashFlowClassificationRecord[] = [];
    const seenAccounts = new Set<string>();
    command.rows.forEach((raw, index) => {
      const rowNumber = index + 2;
      const resolved = this.resolveImportRow(raw, rowNumber, issues);
      if (!resolved) return;
      const key = `${resolved.row.accountRole}:${resolved.row.accountId}`;
      if (seenAccounts.has(key)) {
        issues.push({ rowNumber, code: 'INCOMPATIBLE_CLASSIFICATION', accountRole: resolved.row.accountRole, accountId: resolved.row.accountId, message: 'An account may appear only once in a classification import.' });
        return;
      }
      seenAccounts.add(key);
      rows.push(resolved.row);
      updates.push(resolved.update);
    });
    if (command.databaseRevision !== currentRevision) {
      issues.push({ rowNumber: 0, code: 'CLASSIFICATION_STALE', message: 'The import was prepared against an older database revision.' });
    }
    const previewId = newId();
    const frozenRows = Object.freeze(rows.map(row => Object.freeze({ ...row })));
    const frozenIssues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
    const pending: PendingImport = { revision: currentRevision, rows: frozenRows, updates: Object.freeze(updates.map(update => Object.freeze({ ...update }))), issues: frozenIssues };
    this.pendingImports.set(previewId, pending);
    return Object.freeze({
      previewId,
      databaseRevision: currentRevision,
      rows: frozenRows,
      issues: frozenIssues,
      validRowCount: rows.length,
      blockedRowCount: new Set(frozenIssues.map(issue => issue.rowNumber)).size,
    });
  }

  commitImport(command: CommitCashFlowClassificationImportCommand): CashFlowClassificationImportCommitResult {
    const pending = this.pendingImports.get(command.previewId);
    if (!pending) throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', 'The classification import preview is missing or expired.', { accountRole: 'CHART', accountId: '' });
    const currentRevision = this.repository.getDatabaseRevision();
    if (command.databaseRevision !== currentRevision || pending.revision !== currentRevision) {
      this.pendingImports.delete(command.previewId);
      throw this.failure('CLASSIFICATION_STALE', 'The classification import is stale. Preview it again.', { accountRole: 'CHART', accountId: '' }, true);
    }
    if (pending.issues.length) throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', 'Correct the classification import issues before committing.', { accountRole: 'CHART', accountId: '' });
    const updates = pending.updates.map(update => ({ ...update, modifiedAtUtc: nowUtc() }));
    try {
      this.repository.transaction(() => {
        this.repository.saveCashFlowClassifications(updates, currentRevision);
        this.confirmReviewedFinancialAccounts(updates, 'Confirmed by Cash Flow classification spreadsheet import.');
      });
    } catch (error) {
      this.pendingImports.delete(command.previewId);
      if (error instanceof Error && error.message.toLowerCase().includes('stale')) throw this.failure('CLASSIFICATION_STALE', 'The classification import is stale. Preview it again.', { accountRole: 'CHART', accountId: '' }, true);
      throw this.failure('CASH_FLOW_CLASSIFICATION_INVALID', error instanceof Error ? error.message : 'The classification import could not be committed.', { accountRole: 'CHART', accountId: '' });
    }
    this.pendingImports.delete(command.previewId);
    return { databaseRevision: this.repository.getDatabaseRevision(), appliedRowCount: updates.length, review: this.review(this.defaultQuery()) };
  }

  exportClassifications(command: ExportCashFlowClassificationsCommand): CashFlowClassificationExportResult {
    const currentRevision = this.repository.getDatabaseRevision();
    if (command.databaseRevision !== currentRevision) throw this.failure('CLASSIFICATION_STALE', 'The classification export is stale. Reload the current database.', { accountRole: 'CHART', accountId: '' }, true);
    const rows = [
      ...[...this.repository.accounts.values()].map(account => this.exchangeRow('FINANCIAL_SOURCE', account)),
      ...[...this.repository.chartAccounts.values()].map(account => this.exchangeRow('CHART', account)),
    ].sort((left, right) => normalizePath(left.accountPath).localeCompare(normalizePath(right.accountPath)) || left.accountRole.localeCompare(right.accountRole) || left.accountId.localeCompare(right.accountId));
    return Object.freeze({ databaseRevision: currentRevision, rows: Object.freeze(rows.map(row => Object.freeze({ ...row }))) });
  }

  private confirmReviewedFinancialAccounts(updates: readonly CashFlowClassificationRecord[], reason: string): ReadonlySet<string> {
    const confirmed = new Set<string>();
    for (const update of updates) {
      if (update.accountRole !== 'FINANCIAL_SOURCE' || update.status !== 'CONFIRMED') continue;
      const account = this.repository.accounts.get(update.accountId);
      if (!account || account.classificationStatus !== 'REVIEW_REQUIRED') continue;
      const before = structuredClone(account);
      const after: FinancialAccount = { ...account, classificationStatus: 'CONFIRMED' };
      this.repository.accounts.set(account.id, after);
      this.repository.audit.push({
        id: newId(), timestampUtc: update.modifiedAtUtc ?? nowUtc(), operation: 'CONFIRM_FINANCIAL_ACCOUNT_CLASSIFICATION',
        entityType: 'FinancialAccount', entityId: account.id, before, after: structuredClone(after), reason,
      });
      confirmed.add(account.id);
    }
    return confirmed;
  }

  private exchangeRow(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount): CashFlowClassificationExchangeRow {
    const target = this.targetFor(role, account);
    const existing = this.repository.getCashFlowClassification(role, account.id);
    const classification = existing && this.validClassification(target, existing)
      ? existing
      : this.reviewDefault(target, existing);
    return {
      accountRole: role,
      accountId: account.id,
      accountPath: this.accountPath(role, account),
      accountType: target.accountType,
      detailType: target.detailType,
      ...(classification.cashRole === undefined ? {} : { cashRole: classification.cashRole }),
      treatment: classification.treatment,
      status: classification.status,
      source: classification.source,
      rationale: classification.rationale,
      ...(classification.modifiedAtUtc === undefined ? {} : { modifiedAtUtc: classification.modifiedAtUtc }),
    };
  }

  private resolveImportRow(raw: CashFlowClassificationImportRow, rowNumber: number, issues: CashFlowClassificationImportIssue[]): { row: CashFlowClassificationExchangeRow; update: CashFlowClassificationRecord } | undefined {
    const roleValue = String(raw.accountRole ?? '').trim().toUpperCase();
    if (roleValue !== 'FINANCIAL_SOURCE' && roleValue !== 'CHART') {
      issues.push({ rowNumber, code: 'UNKNOWN_ACCOUNT_ROLE', field: 'accountRole', message: 'Account role must be FINANCIAL_SOURCE or CHART.' });
      return undefined;
    }
    const role = roleValue as 'FINANCIAL_SOURCE' | 'CHART';
    const account = this.resolveImportAccount(role, raw, rowNumber, issues);
    if (!account) return undefined;
    const accountType = account.accountType;
    const detailType = account.detailType;
    if (raw.accountType?.trim() && !ACCOUNT_TYPE_CATALOG.some(definition => definition.accountType === raw.accountType!.trim())) {
      issues.push({ rowNumber, code: 'UNKNOWN_ACCOUNT_TYPE', field: 'accountType', accountRole: role, accountId: account.account.id, message: `Unknown account type: ${raw.accountType}.` });
      return undefined;
    }
    if (raw.accountType?.trim() && raw.accountType.trim() !== accountType) {
      issues.push({ rowNumber, code: 'CLASSIFICATION_STALE', field: 'accountType', accountRole: role, accountId: account.account.id, message: 'The imported account type does not match the current account.' });
      return undefined;
    }
    if (raw.detailType?.trim() && raw.detailType.trim() !== detailType) {
      issues.push({ rowNumber, code: 'CLASSIFICATION_STALE', field: 'detailType', accountRole: role, accountId: account.account.id, message: 'The imported detail type does not match the current account.' });
      return undefined;
    }
    const cashRole = this.enumValue(raw.cashRole, CASH_FLOW_CASH_ROLES);
    const treatment = this.enumValue(raw.treatment, CASH_FLOW_TREATMENTS);
    const status = this.enumValue(raw.status, CASH_FLOW_CLASSIFICATION_STATUSES);
    const source = this.enumValue(raw.source, CASH_FLOW_CLASSIFICATION_SOURCES);
    if (raw.cashRole?.trim() && !cashRole) issues.push({ rowNumber, code: 'UNKNOWN_CASH_ROLE', field: 'cashRole', accountRole: role, accountId: account.account.id, message: `Unknown cash role: ${raw.cashRole}.` });
    if (!treatment) issues.push({ rowNumber, code: 'UNKNOWN_TREATMENT', field: 'treatment', accountRole: role, accountId: account.account.id, message: `Unknown treatment: ${raw.treatment ?? '(blank)'}.` });
    if (!status) issues.push({ rowNumber, code: 'UNKNOWN_STATUS', field: 'status', accountRole: role, accountId: account.account.id, message: `Unknown status: ${raw.status ?? '(blank)'}.` });
    if (!source) issues.push({ rowNumber, code: 'UNKNOWN_SOURCE', field: 'source', accountRole: role, accountId: account.account.id, message: `Unknown source: ${raw.source ?? '(blank)'}.` });
    if (!raw.rationale?.trim()) issues.push({ rowNumber, code: 'RATIONALE_REQUIRED', field: 'rationale', accountRole: role, accountId: account.account.id, message: 'A classification rationale is required.' });
    if (!cashRole && raw.cashRole?.trim()) return undefined;
    if (!treatment || !status || !source || !raw.rationale?.trim()) return undefined;
    const classification: CashFlowClassification = {
      ...(cashRole ? { cashRole } : {}), treatment, status, source, rationale: raw.rationale.trim(),
    };
    const validation = validateCashFlowClassification({ accountRole: role, accountType, detailType, classification });
    if (!validation.ok) {
      issues.push({ rowNumber, code: 'INCOMPATIBLE_CLASSIFICATION', accountRole: role, accountId: account.account.id, message: validation.error.message });
      return undefined;
    }
    const row: CashFlowClassificationExchangeRow = {
      accountRole: role, accountId: account.account.id, accountPath: this.accountPath(role, account.account), accountType, detailType,
      ...(validation.value.classification.cashRole === undefined ? {} : { cashRole: validation.value.classification.cashRole }),
      treatment: validation.value.classification.treatment, status: validation.value.classification.status,
      source: validation.value.classification.source, rationale: validation.value.classification.rationale,
    };
    return { row, update: { ...validation.value.classification, accountRole: role, accountId: account.account.id, accountType, detailType } };
  }

  private resolveImportAccount(role: 'FINANCIAL_SOURCE' | 'CHART', raw: CashFlowClassificationImportRow, rowNumber: number, issues: CashFlowClassificationImportIssue[]): AccountTarget | undefined {
    const id = raw.accountId?.trim();
    if (id) {
      const byId = this.rawAccount(role, id);
      if (!byId) {
        issues.push({ rowNumber, code: 'ACCOUNT_NOT_FOUND', accountRole: role, accountId: id, message: `Account ${id} was not found.` });
        return undefined;
      }
      if (this.isArchived(role, id!)) {
        issues.push({ rowNumber, code: 'ARCHIVED_ACCOUNT', accountRole: role, accountId: id, message: 'Archived accounts cannot receive imported classifications.' });
        return undefined;
      }
      const target = this.targetFor(role, byId);
      if (!this.isCompatibleTarget(target)) {
        issues.push({ rowNumber, code: 'INCOMPATIBLE_CLASSIFICATION', accountRole: role, accountId: id, message: 'The referenced account cannot be used with this Cash Flow account role.' });
        return undefined;
      }
      return target;
    }
    const path = raw.accountPath?.trim();
    if (!path) {
      issues.push({ rowNumber, code: id ? 'ACCOUNT_NOT_FOUND' : 'MISSING_ACCOUNT_REFERENCE', accountRole: role, accountId: id, message: id ? `Account ${id} was not found.` : 'An account ID or account path is required.' });
      return undefined;
    }
    const candidates = this.allTargets(role).filter(candidate => normalizePath(this.accountPath(role, candidate.account)) === normalizePath(path));
    if (candidates.length > 1) {
      issues.push({ rowNumber, code: 'AMBIGUOUS_ACCOUNT_PATH', accountRole: role, message: `Account path ${path} matches more than one account.` });
      return undefined;
    }
    if (!candidates.length) {
      issues.push({ rowNumber, code: 'ACCOUNT_NOT_FOUND', accountRole: role, accountId: id, message: `Account path ${path} was not found.` });
      return undefined;
    }
    const candidate = candidates[0];
    if (this.isArchived(role, candidate.account.id)) {
      issues.push({ rowNumber, code: 'ARCHIVED_ACCOUNT', accountRole: role, accountId: candidate.account.id, message: 'Archived accounts cannot receive imported classifications.' });
      return undefined;
    }
    if (!this.isCompatibleTarget(candidate)) {
      issues.push({ rowNumber, code: 'INCOMPATIBLE_CLASSIFICATION', accountRole: role, accountId: candidate.account.id, message: 'The referenced account cannot be used with this Cash Flow account role.' });
      return undefined;
    }
    return candidate;
  }

  private rawAccount(role: 'FINANCIAL_SOURCE' | 'CHART', id: string): FinancialAccount | ChartAccount | undefined {
    return role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(id) : this.repository.chartAccounts.get(id);
  }

  private isCompatibleTarget(target: AccountTarget): boolean {
    return validateAccountUse({ accountType: target.accountType, requestedRole: target.role }).ok;
  }

  private reviewItem(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount, query: CashFlowQuery, summary: ActivitySummary): CashFlowClassificationReviewItem {
    const target = this.targetFor(role, account);
    const existing = this.repository.getCashFlowClassification(role, account.id);
    const valid = existing ? this.validClassification(target, existing) : false;
    const suggestedClassification = valid ? this.defaultClassification(target) : this.reviewDefault(target, existing);
    const currentClassification = existing;
    const classification = valid ? existing! : suggestedClassification;
    const reviewReasons = this.reviewReasons(role, account, target, existing, valid, suggestedClassification);
    const opening = this.balanceFromSummary(role, account, summary, 'BEFORE_START');
    const ending = this.balanceFromSummary(role, account, summary, 'THROUGH_END');
    const periodActivity = this.activityFor(role, account, summary, query);
    return {
      accountRole: role, accountId: account.id, accountPath: this.accountPath(role, account), accountType: target.accountType, detailType: target.detailType,
      archived: Boolean(account.archived), reviewReasons: Object.freeze(reviewReasons),
      ...(currentClassification ? { currentClassification } : {}),
      suggestedClassification,
      ...(classification.cashRole === undefined ? {} : { cashRole: classification.cashRole }), treatment: classification.treatment,
      status: classification.status, source: classification.source, rationale: classification.rationale,
      openingAmountMinor: opening, endingAmountMinor: ending,
      periodActivityMinor: periodActivity,
      reportImpactMinor: periodActivity,
    };
  }

  private reviewReasons(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount, target: AccountTarget, existing: CashFlowClassificationRecord | undefined, valid: boolean, suggested: CashFlowClassification): CashFlowClassificationReviewReasonCode[] {
    const reasons: CashFlowClassificationReviewReasonCode[] = [];
    if (account.archived) reasons.push('ARCHIVED_ACCOUNT');
    if (!existing) reasons.push('MISSING_CLASSIFICATION');
    else if (!valid) {
      const structureChanged = existing.accountType !== target.accountType || existing.detailType !== target.detailType || existing.accountRole !== role || existing.accountId !== account.id;
      reasons.push(structureChanged ? 'STRUCTURE_CHANGED' : 'INVALID_CLASSIFICATION');
    }
    const reviewClassification = valid ? existing! : suggested;
    if (reviewClassification.status === 'REVIEW_REQUIRED' || reviewClassification.cashRole === 'REVIEW_REQUIRED' || reviewClassification.treatment === 'REVIEW_REQUIRED') {
      reasons.push('CLASSIFICATION_REVIEW_REQUIRED');
    }
    if (suggested.treatment === 'REVIEW_REQUIRED' || suggested.cashRole === 'REVIEW_REQUIRED') reasons.push('AMBIGUOUS_STRUCTURE');
    return [...new Set(reasons)];
  }

  private validClassification(target: AccountTarget, classification: CashFlowClassificationRecord): boolean {
    if (classification.accountRole !== target.role || classification.accountId !== target.account.id || classification.accountType !== target.accountType || classification.detailType !== target.detailType) return false;
    if (classification.modifiedAtUtc !== undefined && !isIsoUtc(classification.modifiedAtUtc)) return false;
    return validateCashFlowClassification({ accountRole: target.role, accountType: target.accountType, detailType: target.detailType, classification }).ok;
  }

  private defaultClassification(target: AccountTarget): CashFlowClassification {
    const seeded = getDefaultCashFlowClassification({ accountRole: target.role, accountType: target.accountType, detailType: target.detailType });
    return seeded.ok ? seeded.value : { treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', source: 'DEFAULT', rationale: 'The account structure requires Cash Flow classification review.', ...(target.role === 'FINANCIAL_SOURCE' ? { cashRole: 'REVIEW_REQUIRED' as const } : {}) };
  }

  private reviewDefault(target: AccountTarget, existing?: CashFlowClassificationRecord): CashFlowClassification {
    const seeded = this.defaultClassification(target);
    const source = existing?.source && (CASH_FLOW_CLASSIFICATION_SOURCES as readonly string[]).includes(existing.source)
      ? existing.source
      : seeded.source;
    return {
      ...seeded,
      treatment: 'REVIEW_REQUIRED',
      status: 'REVIEW_REQUIRED',
      source,
      cashRole: target.role === 'FINANCIAL_SOURCE' ? 'REVIEW_REQUIRED' : undefined,
      rationale: existing?.rationale?.trim() || 'This account requires Cash Flow classification review.',
    };
  }

  private targetFor(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount): AccountTarget {
    return { role, account, accountType: String(account.accountType).trim() as AccountingAccountType, detailType: String(account.detailType).trim() };
  }

  private findTarget(role: 'FINANCIAL_SOURCE' | 'CHART', id: string, includeArchived = false): AccountTarget | undefined {
    const account = role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(id) : this.repository.chartAccounts.get(id);
    if (!account || (!includeArchived && account.archived)) return undefined;
    const target = this.targetFor(role, account);
    const roleValidation = validateAccountUse({ accountType: target.accountType, requestedRole: role });
    return roleValidation.ok ? target : undefined;
  }

  private allTargets(role: 'FINANCIAL_SOURCE' | 'CHART'): readonly AccountTarget[] {
    return (role === 'FINANCIAL_SOURCE' ? [...this.repository.accounts.values()] : [...this.repository.chartAccounts.values()]).map(account => this.targetFor(role, account));
  }

  private accountPath(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount): string {
    if (role === 'FINANCIAL_SOURCE') {
      const definition = getAccountTypeDefinition(account.accountType);
      const group = definition.ok ? definition.value.reportingGroup : 'ASSET';
      const label = definition.ok ? definition.value.label : account.accountType;
      return `${groupLabel(group)} > ${label} > ${account.name}`;
    }
    const parts: string[] = [];
    const visited = new Set<string>();
    let current: ChartAccount | undefined = account as ChartAccount;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      parts.unshift(current.name);
      current = current.parentId ? this.repository.chartAccounts.get(current.parentId) : undefined;
    }
    return parts.join(' > ');
  }

  private isArchived(role: 'FINANCIAL_SOURCE' | 'CHART', id: string): boolean {
    const account = role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(id) : this.repository.chartAccounts.get(id);
    return Boolean(account?.archived);
  }

  /** Aggregate all included transactions once for a review query. */
  private buildActivitySummary(query: CashFlowQuery): ActivitySummary {
    const financialBeforeStart = new Map<string, bigint>();
    const financialThroughEnd = new Map<string, bigint>();
    const financialPeriod = new Map<string, bigint>();
    const chartBeforeStart = new Map<string, bigint>();
    const chartThroughEnd = new Map<string, bigint>();
    const chartPeriod = new Map<string, bigint>();
    const beforeStart = dayBefore(query.startDate);
    for (const transaction of this.includedTransactions()) {
      const date = transaction.postingDate;
      if (date <= query.endDate) {
        addToMap(financialThroughEnd, transaction.accountId, transaction.amount.minorUnits);
        for (const split of transaction.splits) addToMap(chartThroughEnd, split.chartAccountId, split.amount.minorUnits);
      }
      if (date <= beforeStart) {
        addToMap(financialBeforeStart, transaction.accountId, transaction.amount.minorUnits);
        for (const split of transaction.splits) addToMap(chartBeforeStart, split.chartAccountId, split.amount.minorUnits);
      }
      if (date >= query.startDate && date <= query.endDate) {
        addToMap(financialPeriod, transaction.accountId, transaction.amount.minorUnits);
        for (const split of transaction.splits) addToMap(chartPeriod, split.chartAccountId, split.amount.minorUnits);
      }
    }
    return { startDate: query.startDate, endDate: query.endDate, financialBeforeStart, financialThroughEnd, financialPeriod, chartBeforeStart, chartThroughEnd, chartPeriod };
  }

  private balanceFromSummary(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount, summary: ActivitySummary, point: 'BEFORE_START' | 'THROUGH_END'): bigint {
    const definition = getAccountTypeDefinition(account.accountType);
    if (!definition.ok || !definition.value.balanceSheetSection) return 0n;
    if (role === 'FINANCIAL_SOURCE') {
      const source = account as FinancialAccount;
      const transactions = point === 'BEFORE_START' ? summary.financialBeforeStart : summary.financialThroughEnd;
      const openingCutoff = point === 'BEFORE_START' ? dayBefore(summary.startDate) : summary.endDate;
      const opening = source.openingBalanceSource === 'DERIVED_EQUITY' && source.openingBalanceDate <= openingCutoff
        ? source.openingBalance.minorUnits
        : 0n;
      const total = opening + (transactions.get(source.id) ?? 0n);
      return definition.value.naturalBalance === 'CREDIT' ? -total : total;
    }
    const chart = account as ChartAccount;
    const transactions = point === 'BEFORE_START' ? summary.chartBeforeStart : summary.chartThroughEnd;
    const stored = transactions.get(chart.id) ?? 0n;
    return definition.value.naturalBalance === 'CREDIT' ? stored : -stored;
  }

  private activityFor(role: 'FINANCIAL_SOURCE' | 'CHART', account: FinancialAccount | ChartAccount, summary: ActivitySummary, _query: CashFlowQuery): bigint {
    const definition = getAccountTypeDefinition(account.accountType);
    const total = role === 'FINANCIAL_SOURCE'
      ? (summary.financialPeriod.get(account.id) ?? 0n)
      : (summary.chartPeriod.get(account.id) ?? 0n);
    return definition.ok && definition.value.naturalBalance === 'CREDIT'
      ? (role === 'FINANCIAL_SOURCE' ? -total : total)
      : (role === 'FINANCIAL_SOURCE' ? total : -total);
  }

  private includedTransactions(): readonly Transaction[] {
    const confirmedTransfers = new Set(this.repository.transfers.keys());
    return [...this.repository.transactions.values()].filter(transaction => transaction.state === 'POSTED' || (transaction.state === 'MATCHED_TRANSFER' && Boolean(transaction.transferMatchId) && confirmedTransfers.has(transaction.transferMatchId!)));
  }

  private defaultQuery(): CashFlowQuery {
    const year = this.repository.company.activeTaxYear;
    const startMonth = this.repository.company.fiscalYearStartMonth;
    const startYear = startMonth === 1 ? year : year - 1;
    const endMonth = startMonth === 1 ? 12 : startMonth - 1;
    const endYear = startMonth === 1 ? year : year;
    return { startDate: `${startYear.toString().padStart(4, '0')}-${startMonth.toString().padStart(2, '0')}-01`, endDate: `${endYear.toString().padStart(4, '0')}-${endMonth.toString().padStart(2, '0')}-${daysInMonth(endYear, endMonth).toString().padStart(2, '0')}`, includeZeroRows: false };
  }

  private previewFailure(command: PreviewCashFlowClassificationCommand, code: CashFlowClassificationFailure['code'], message: string, rationale = ''): CashFlowClassificationPreview {
    const query = command.query ?? this.defaultQuery();
    return Object.freeze({ valid: false, statementLabel: 'Review required', rationale, query: Object.freeze({ ...query }), failures: Object.freeze([Object.freeze({ code, message, accountRole: command.accountRole, accountId: command.accountId })]) });
  }

  private failure(code: 'CASH_FLOW_CLASSIFICATION_INVALID' | 'CLASSIFICATION_STALE', message: string, target: { accountRole: 'FINANCIAL_SOURCE' | 'CHART'; accountId: string }, retryable = false): CashFlowContractError {
    const contractCode = code === 'CLASSIFICATION_STALE' ? 'CASH_FLOW_CLASSIFICATION_STALE' : 'CASH_FLOW_CLASSIFICATION_INVALID';
    return new CashFlowContractError({ code: contractCode, message, accountRole: target.accountRole, accountId: target.accountId, retryable });
  }

  private mapDomainFailure(code: string): CashFlowClassificationFailure['code'] {
    // The domain uses ACCOUNT_ROLE_REQUIRED both for an unsupported account
    // role and for a financial source that is missing its required cash role.
    // At this boundary the account role itself is already a valid union, so
    // the actionable public failure is the missing cash role.
    if (code === 'ACCOUNT_ROLE_REQUIRED') return 'CASH_ROLE_REQUIRED';
    if (code === 'ACCOUNT_ROLE_PROHIBITED') return 'CASH_ROLE_NOT_ALLOWED';
    if (code === 'CASH_ROLE_NOT_SUPPORTED') return 'CASH_ROLE_NOT_ALLOWED';
    if (code === 'CASH_ROLE_TREATMENT_MISMATCH') return 'TREATMENT_INCOMPATIBLE';
    if (code === 'CLASSIFICATION_RATIONALE_REQUIRED') return 'RATIONALE_REQUIRED';
    return 'TREATMENT_INCOMPATIBLE';
  }

  private enumValue<T extends readonly string[]>(value: string | undefined, values: T): T[number] | undefined {
    const normalized = value?.trim();
    return normalized && (values as readonly string[]).includes(normalized) ? normalized as T[number] : undefined;
  }
}

function normalizePath(path: string): string {
  return path.trim().replace(/\s*[>:|/]\s*/g, ' > ').replace(/\s+/g, ' ').toLowerCase();
}

function groupLabel(group: string): string {
  return ({ ASSET: 'Assets', LIABILITY: 'Liabilities', EQUITY: 'Equity', INCOME: 'Income', EXPENSE: 'Expenses' } as Record<string, string>)[group] ?? group;
}

function dayBefore(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isIsoUtc(value: string): boolean {
  if (!value.endsWith('Z')) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function addToMap(target: Map<string, bigint>, key: string, amount: bigint): void {
  target.set(key, (target.get(key) ?? 0n) + amount);
}
