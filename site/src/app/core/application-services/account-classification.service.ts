import { Injectable, inject } from '@angular/core';
import {
  ACCOUNT_TYPE_GROUPS,
  AccountChangeValidation,
  AccountReference,
  AccountRole,
  AccountingAccountType,
  GenericAccountSaveResult,
  GetAccountPlacementPreviewCommand,
  ImportCapability,
  SaveGenericAccountCommand,
  classifyAccount,
  getAccountPlacement,
  getAccountTypeDefinition,
  validateAccountUse,
  validateImportCapability,
  validateOpeningBalance,
  validateParent,
} from '../domain-model/account-taxonomy';
import { AuditEvent, ChartAccount, ChartAccountType, FinancialAccount, money, newId, nowUtc } from '../domain-model/accounting.types';
import { BalanceSheetContractError, PreviewAccountPlacementResult } from '../domain-model/balance-sheet.types';
import { CashFlowClassification, seedDefaultCashFlowClassification } from '../domain-model/cash-flow-classification';
import { ACCOUNTING_REPOSITORY, AccountingRepository } from '../repository-gateways/accounting.repository';

@Injectable({ providedIn: 'root' })
export class AccountClassificationService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;

  getCatalog() { return structuredClone(ACCOUNT_TYPE_GROUPS); }

  validate(command: SaveGenericAccountCommand): AccountChangeValidation {
    const context = this.context(command);
    const blockingReferences: AccountReference[] = [];
    if (context.existing?.locked && context.classificationChanged) {
      blockingReferences.push({ kind: 'LOCK_STATE', referenceId: context.existing.id, label: `Locked account: ${context.existing.name}` });
    }

    const parentResult = validateParent({
      accountId: context.accountId,
      accountType: command.accountType,
      parentId: command.parentId,
      accounts: context.parentAccounts,
    });
    if (!parentResult.ok) {
      for (const referenceId of parentResult.error.referenceIds ?? [command.parentId ?? context.accountId]) {
        blockingReferences.push({ kind: 'PARENT', referenceId, label: parentResult.error.message });
      }
    }

    if (context.existing && context.classificationChanged) {
      for (const child of context.children) {
        const childResult = validateParent({
          accountId: child.id,
          accountType: child.accountType,
          parentId: context.accountId,
          accounts: context.parentAccounts,
        });
        if (!childResult.ok) blockingReferences.push({ kind: 'CHILD', referenceId: child.id, label: `Child account would be incompatible: ${child.name}` });
      }
      if (command.requestedRole === 'CHART' && context.reportingGroup !== 'EXPENSE') {
        blockingReferences.push(...context.references.filter(reference => reference.kind === 'TAX_SETTING'));
      }
      if (command.requestedRole === 'FINANCIAL_SOURCE') {
        const supported = new Set(command.importCapability.enabled ? command.importCapability.supportedSourceKinds : []);
        blockingReferences.push(...context.references.filter(reference => reference.kind === 'IMPORT_MAPPING' && !supported.has(this.repository.batches.get(reference.referenceId)?.sourceKind ?? 'CSV')));
      }
    }

    const uniqueBlocking = this.uniqueReferences(blockingReferences);
    const blockingKeys = new Set(uniqueBlocking.map(reference => `${reference.kind}:${reference.referenceId}`));
    const confirmationReferences = context.classificationChanged
      ? context.references.filter(reference => !blockingKeys.has(`${reference.kind}:${reference.referenceId}`) && reference.kind !== 'LOCK_STATE')
      : [];
    return {
      valid: uniqueBlocking.length === 0,
      blockingReferences: Object.freeze(uniqueBlocking),
      confirmationReferences: Object.freeze(this.uniqueReferences(confirmationReferences)),
    };
  }

  save(command: SaveGenericAccountCommand): GenericAccountSaveResult {
    const context = this.context(command);
    const validation = this.validate(command);
    if (validation.blockingReferences.length) {
      this.fail('ACCOUNT_REFERENCE_CONFLICT', 'The account change would invalidate existing references.', context.accountId, validation.blockingReferences);
    }
    const confirmed = new Set(command.confirmedReferenceIds ?? []);
    const unconfirmed = validation.confirmationReferences.filter(reference => !confirmed.has(reference.referenceId));
    if (unconfirmed.length) {
      this.fail('ACCOUNT_REFERENCE_CONFLICT', 'Review and confirm every affected reference before saving this account change.', context.accountId, unconfirmed);
    }

    return this.repository.transaction(() => {
      const before = context.existing ? structuredClone(context.existing) : undefined;
      if (command.requestedRole === 'FINANCIAL_SOURCE') this.repository.accounts.set(context.accountId, this.financialAccount(command, context));
      else this.repository.chartAccounts.set(context.accountId, this.chartAccount(command, context));
      const key = `${command.requestedRole}:${context.accountId}`;
      const existingClassification = this.repository.cashFlowClassifications.get(key);
      const structureChanged = Boolean(context.existing && (
        context.existing.accountType !== command.accountType || context.existing.detailType !== command.detailType.trim()
      ));
      const classificationNeedsReclassification = Boolean(context.existing && (
        !existingClassification || existingClassification.accountType !== command.accountType || existingClassification.detailType !== command.detailType.trim()
      ));
      if (structureChanged || classificationNeedsReclassification) this.reclassifyAfterStructureChange(command, context);
      const after = command.requestedRole === 'FINANCIAL_SOURCE'
        ? this.repository.accounts.get(context.accountId)
        : this.repository.chartAccounts.get(context.accountId);
      const event: AuditEvent = {
        id: newId(), timestampUtc: nowUtc(), operation: context.existing ? 'UPDATE_GENERIC_ACCOUNT' : 'CREATE_GENERIC_ACCOUNT',
        entityType: command.requestedRole === 'FINANCIAL_SOURCE' ? 'FinancialAccount' : 'ChartAccount', entityId: context.accountId,
        before, after: structuredClone(after), reason: 'Save generic account classification.',
      };
      this.repository.audit.push(event);
      return {
        role: command.requestedRole,
        accountId: context.accountId,
        created: !context.existing,
        classificationStatus: context.classificationStatus,
        affectedReferences: validation.confirmationReferences,
      };
    });
  }

  private reclassifyAfterStructureChange(command: SaveGenericAccountCommand, context: ReturnType<AccountClassificationService['context']>): void {
    const role = command.requestedRole;
    const seeded = seedDefaultCashFlowClassification({ accountRole: role, accountType: command.accountType, detailType: command.detailType });
    if (!seeded.ok) this.fail('ACCOUNT_CLASSIFICATION_INVALID', seeded.error.message, context.accountId);
    const before = this.repository.cashFlowClassifications.get(`${role}:${context.accountId}`);
    const classification: CashFlowClassification = {
      ...seeded.value,
      source: 'USER',
      modifiedAtUtc: nowUtc(),
      rationale: 'User changed the account structure; apply the new structural Cash Flow default and review if ambiguous.',
    };
    this.repository.cashFlowClassifications.set(`${role}:${context.accountId}`, {
      ...classification,
      accountRole: role,
      accountId: context.accountId,
      accountType: command.accountType,
      detailType: command.detailType.trim(),
    });
    this.repository.audit.push({
      id: newId(), timestampUtc: classification.modifiedAtUtc!, operation: 'RECLASSIFY_CASH_FLOW_CLASSIFICATION',
      entityType: role === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
      entityId: context.accountId, before: structuredClone(before), after: structuredClone(this.repository.cashFlowClassifications.get(`${role}:${context.accountId}`)),
      reason: classification.rationale,
    });
  }

  delete(accountId: string, role: AccountRole): void {
    const existing = role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(accountId) : this.repository.chartAccounts.get(accountId);
    if (!existing) this.fail('ACCOUNT_CLASSIFICATION_INVALID', `Account not found: ${accountId}.`, accountId);
    const references = this.references(role, accountId);
    if (existing.locked) references.unshift({ kind: 'LOCK_STATE', referenceId: accountId, label: `Locked account: ${existing.name}` });
    const uniqueReferences = this.uniqueReferences(references);
    if (uniqueReferences.length) {
      this.fail('ACCOUNT_REFERENCE_CONFLICT', 'Only an unused, unlocked account with a zero balance can be deleted.', accountId, uniqueReferences);
    }
    this.repository.transaction(() => {
      const before = structuredClone(existing);
      const classificationKey = `${role}:${accountId}`;
      const classification = this.repository.cashFlowClassifications.get(classificationKey);
      if (classification) {
        this.repository.cashFlowClassifications.delete(classificationKey);
        this.repository.audit.push({
          id: newId(), timestampUtc: nowUtc(), operation: 'DELETE_CASH_FLOW_CLASSIFICATION',
          entityType: role === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
          entityId: accountId, before: structuredClone(classification),
          reason: 'The parent account was permanently deleted; remove its classification with an audit trail.',
        });
      }
      if (role === 'FINANCIAL_SOURCE') this.repository.accounts.delete(accountId);
      else this.repository.chartAccounts.delete(accountId);
      this.repository.audit.push({
        id: newId(), timestampUtc: nowUtc(), operation: 'DELETE_GENERIC_ACCOUNT',
        entityType: role === 'FINANCIAL_SOURCE' ? 'FinancialAccount' : 'ChartAccount', entityId: accountId,
        before, after: undefined, reason: 'Permanently delete an unused account.',
      });
    });
  }

  preview(command: GetAccountPlacementPreviewCommand): PreviewAccountPlacementResult {
    if (!this.businessDate(command.asOfDate)) this.fail('ACCOUNT_PLACEMENT_INVALID', 'Placement preview requires a valid YYYY-MM-DD as-of date.', command.accountId);
    const placement = getAccountPlacement(command.accountType);
    if (!placement.ok) this.fail('ACCOUNT_PLACEMENT_INVALID', placement.error.message, command.accountId);
    const definition = getAccountTypeDefinition(command.accountType);
    if (!definition.ok) this.fail('ACCOUNT_PLACEMENT_INVALID', definition.error.message, command.accountId);
    const role = command.accountRole ?? (command.accountId && this.repository.accounts.has(command.accountId) ? 'FINANCIAL_SOURCE' : 'CHART');
    const account = command.accountId
      ? role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(command.accountId) : this.repository.chartAccounts.get(command.accountId)
      : undefined;
    const name = command.accountName?.trim() || account?.name.split(':').pop() || 'New account';
    const parent = command.parentId
      ? role === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(command.parentId) : this.repository.chartAccounts.get(command.parentId)
      : undefined;
    const root = placement.value.behavior === 'CURRENT_EARNINGS' ? 'Current Earnings' : this.sectionLabel(placement.value.section);
    const fullPath = [root, definition.value.label, parent?.name, name].filter(Boolean).join(' > ');
    const currentBalanceMinor = placement.value.behavior === 'BALANCE_SHEET_LINE' && account
      ? this.currentBalance(role, account.id, command.asOfDate)
      : undefined;
    const warnings = [];
    if ('classificationStatus' in (account ?? {}) && (account as FinancialAccount).classificationStatus === 'REVIEW_REQUIRED') {
      warnings.push({ code: 'REVIEW_REQUIRED' as const, message: 'This imported classification requires review.' });
    }
    if (account?.archived && currentBalanceMinor) warnings.push({ code: 'ARCHIVED_NONZERO' as const, message: 'This archived account has a nonzero balance.' });
    return {
      reportingGroup: placement.value.reportingGroup,
      section: placement.value.section,
      fullPath,
      asOfDate: command.asOfDate,
      currentBalanceMinor,
      behavior: placement.value.behavior,
      warnings: Object.freeze(warnings),
    };
  }

  private context(command: SaveGenericAccountCommand) {
    const use = validateAccountUse({ accountType: command.accountType, requestedRole: command.requestedRole, currentRole: command.currentRole });
    if (!use.ok) this.fail('ACCOUNT_CLASSIFICATION_INVALID', use.error.message, command.accountId);
    const existing = command.accountId
      ? command.requestedRole === 'FINANCIAL_SOURCE' ? this.repository.accounts.get(command.accountId) : this.repository.chartAccounts.get(command.accountId)
      : undefined;
    if (command.accountId && !existing) {
      const otherRoleExists = command.requestedRole === 'FINANCIAL_SOURCE' ? this.repository.chartAccounts.has(command.accountId) : this.repository.accounts.has(command.accountId);
      this.fail('ACCOUNT_CLASSIFICATION_INVALID', otherRoleExists ? 'Converting an existing account between persistence roles is not supported.' : `Account not found: ${command.accountId}.`, command.accountId);
    }
    const accountId = command.accountId ?? newId();
    const classified = classifyAccount({ accountType: command.accountType, detailType: command.detailType, existingAccount: Boolean(existing), classificationStatus: existing && 'classificationStatus' in existing ? existing.classificationStatus : undefined });
    if (!classified.ok) this.fail('ACCOUNT_CLASSIFICATION_INVALID', classified.error.message, command.accountId);
    const requestedCapability = validateImportCapability({ accountType: command.accountType, detailType: command.detailType, role: command.requestedRole, capability: command.importCapability });
    const preservesLegacyCapability = Boolean(existing && command.requestedRole === 'FINANCIAL_SOURCE' && 'importEnabled' in existing
      && existing.accountType === command.accountType && existing.detailType.trim() === command.detailType.trim()
      && existing.importEnabled === command.importCapability.enabled
      && this.sameValues(existing.supportedSourceKinds, command.importCapability.supportedSourceKinds));
    if (!requestedCapability.ok && !preservesLegacyCapability) this.fail('ACCOUNT_CLASSIFICATION_INVALID', requestedCapability.error.message, command.accountId);
    const capability = requestedCapability.ok
      ? requestedCapability.value
      : { enabled: command.importCapability.enabled, supportedSourceKinds: [...command.importCapability.supportedSourceKinds] };
    if (command.requestedRole === 'FINANCIAL_SOURCE') {
      const opening = validateOpeningBalance({ accountType: command.accountType, role: command.requestedRole, openingBalanceSource: command.openingBalanceSource, storedOpeningBalanceMinor: command.openingBalanceMinor });
      if (!opening.ok) this.fail('ACCOUNT_CLASSIFICATION_INVALID', opening.error.message, command.accountId);
      if (!this.businessDate(command.openingBalanceDate)) this.fail('ACCOUNT_CLASSIFICATION_INVALID', 'Opening balance date must be a valid YYYY-MM-DD date.', command.accountId);
      if (command.lastFour?.trim() && !/^\d{4}$/.test(command.lastFour.trim())) this.fail('ACCOUNT_CLASSIFICATION_INVALID', 'Last four must contain exactly four digits.', command.accountId);
    }
    if (!command.name.trim()) this.fail('ACCOUNT_CLASSIFICATION_INVALID', 'Account name is required.', command.accountId);
    if (command.requestedRole === 'CHART' && !Number.isInteger(command.displayOrder)) this.fail('ACCOUNT_CLASSIFICATION_INVALID', 'Chart display order must be a whole number.', command.accountId);
    const duplicate = command.requestedRole === 'FINANCIAL_SOURCE'
      ? [...this.repository.accounts.values()].find(account => account.id !== accountId && account.name.toLowerCase() === command.name.trim().toLowerCase())
      : [...this.repository.chartAccounts.values()].find(account => account.id !== accountId && account.name.split(':').pop()?.toLowerCase() === command.name.trim().split(':').pop()?.toLowerCase());
    if (duplicate) this.fail('ACCOUNT_CLASSIFICATION_INVALID', `Account already exists: ${command.name.trim()}.`, command.accountId);
    const parentAccounts = command.requestedRole === 'FINANCIAL_SOURCE'
      ? [...this.repository.accounts.values()].map(account => ({ id: account.id, accountType: account.accountType, parentId: account.parentAccountId, active: !account.archived }))
      : [...this.repository.chartAccounts.values()].map(account => ({ id: account.id, accountType: account.accountType, parentId: account.parentId, active: !account.archived }));
    if (!existing) parentAccounts.push({ id: accountId, accountType: command.accountType, parentId: command.parentId, active: true });
    else {
      const index = parentAccounts.findIndex(account => account.id === accountId);
      parentAccounts[index] = { id: accountId, accountType: command.accountType, parentId: command.parentId, active: !existing.archived };
    }
    const children = command.requestedRole === 'FINANCIAL_SOURCE'
      ? [...this.repository.accounts.values()].filter(account => account.parentAccountId === accountId)
      : [...this.repository.chartAccounts.values()].filter(account => account.parentId === accountId);
    const classificationChanged = Boolean(existing && (
      existing.accountType !== command.accountType || existing.detailType !== command.detailType.trim()
      || (command.requestedRole === 'FINANCIAL_SOURCE' ? (existing as FinancialAccount).parentAccountId : (existing as ChartAccount).parentId) !== command.parentId
    ));
    return {
      accountId, existing, classificationStatus: classified.value.classificationStatus, reportingGroup: classified.value.reportingGroup,
      importCapability: capability, parentAccounts, children, classificationChanged,
      references: existing ? this.references(command.requestedRole, existing.id) : [],
    };
  }

  private financialAccount(command: SaveGenericAccountCommand, context: ReturnType<AccountClassificationService['context']>): FinancialAccount {
    const existing = context.existing as FinancialAccount | undefined;
    return {
      id: context.accountId,
      type: command.accountType === 'BANK' ? 'BANK' : command.accountType === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'ENTITY',
      accountType: command.accountType,
      classificationStatus: context.classificationStatus,
      importEnabled: context.importCapability.enabled,
      supportedSourceKinds: [...context.importCapability.supportedSourceKinds],
      openingBalanceSource: command.openingBalanceSource,
      detailType: command.detailType.trim(), name: command.name.trim(),
      institutionOrEntity: command.institutionOrEntity?.trim() || command.name.trim(),
      lastFour: command.lastFour?.trim() || undefined, parentAccountId: command.parentId,
      description: command.description?.trim() || undefined, openingBalance: money(command.openingBalanceMinor),
      openingBalanceDate: command.openingBalanceDate, archived: existing?.archived ?? false, locked: Boolean(command.locked),
    };
  }

  private chartAccount(command: SaveGenericAccountCommand, context: ReturnType<AccountClassificationService['context']>): ChartAccount {
    const existing = context.existing as ChartAccount | undefined;
    const parent = command.parentId ? this.repository.chartAccounts.get(command.parentId) : undefined;
    const leafName = command.name.trim().split(':').pop()!;
    return {
      id: context.accountId, name: parent ? `${parent.name}:${leafName}` : leafName, parentId: command.parentId,
      type: this.legacyChartType(command.accountType), accountType: command.accountType, detailType: command.detailType.trim(),
      description: command.description?.trim() || undefined, displayOrder: command.displayOrder!, archived: existing?.archived ?? false,
      locked: Boolean(command.locked),
    };
  }

  private references(role: AccountRole, accountId: string): AccountReference[] {
    const references: AccountReference[] = [];
    if (role === 'FINANCIAL_SOURCE') {
      const transactions = [...this.repository.transactions.values()].filter(transaction => transaction.accountId === accountId);
      for (const transaction of transactions) references.push({ kind: 'TRANSACTION', referenceId: transaction.id, label: `Transaction: ${transaction.description}` });
      for (const batch of this.repository.batches.values()) if (batch.destinationAccountId === accountId) references.push({ kind: 'IMPORT_MAPPING', referenceId: batch.id, label: `Import: ${batch.sourceName}` });
      for (const rule of this.repository.rules.values()) if (rule.conditions.some(condition => condition.field === 'ACCOUNT' && condition.value === accountId)) references.push({ kind: 'RULE', referenceId: rule.id, label: `Rule: ${rule.name}` });
      const transactionIds = new Set(transactions.map(transaction => transaction.id));
      for (const transfer of this.repository.transfers.values()) if (transactionIds.has(transfer.leftTransactionId) || transactionIds.has(transfer.rightTransactionId)) references.push({ kind: 'TRANSFER', referenceId: transfer.id, label: `Transfer: ${transfer.id}` });
      const account = this.repository.accounts.get(accountId);
      if (account?.parentAccountId) references.push({ kind: 'PARENT', referenceId: account.parentAccountId, label: `Parent account: ${this.repository.accounts.get(account.parentAccountId)?.name ?? account.parentAccountId}` });
      for (const child of this.repository.accounts.values()) if (child.parentAccountId === accountId) references.push({ kind: 'CHILD', referenceId: child.id, label: `Child account: ${child.name}` });
    } else {
      for (const transaction of this.repository.transactions.values()) for (const split of transaction.splits) if (split.chartAccountId === accountId) references.push({ kind: 'SPLIT', referenceId: split.id, label: `Posting split: ${transaction.description}` });
      for (const rule of this.repository.rules.values()) if (rule.chartAccountId === accountId) references.push({ kind: 'RULE', referenceId: rule.id, label: `Rule: ${rule.name}` });
      for (const settings of this.repository.taxSettings.values()) if ([...settings.federalIncomeTaxAccountIds, ...settings.stateLocalIncomeTaxAccountIds].includes(accountId)) references.push({ kind: 'TAX_SETTING', referenceId: String(settings.taxYear), label: `Tax settings: ${settings.taxYear}` });
      const account = this.repository.chartAccounts.get(accountId);
      if (account?.parentId) references.push({ kind: 'PARENT', referenceId: account.parentId, label: `Parent account: ${this.repository.chartAccounts.get(account.parentId)?.name ?? account.parentId}` });
      for (const child of this.repository.chartAccounts.values()) if (child.parentId === accountId) references.push({ kind: 'CHILD', referenceId: child.id, label: `Child account: ${child.name}` });
    }
    const currentBalance = this.currentBalance(role, accountId, '9999-12-31');
    if (currentBalance !== 0n) references.push({ kind: 'REPORT_EFFECT', referenceId: accountId, label: 'This change affects report placement for a nonzero account.' });
    return this.uniqueReferences(references);
  }

  private currentBalance(role: AccountRole, accountId: string, asOfDate: string): bigint {
    if (role === 'FINANCIAL_SOURCE') {
      const account = this.repository.accounts.get(accountId);
      if (!account) return 0n;
      const opening = account.openingBalanceDate <= asOfDate && account.openingBalanceSource === 'DERIVED_EQUITY' ? account.openingBalance.minorUnits : 0n;
      return [...this.repository.transactions.values()]
        .filter(transaction => transaction.accountId === accountId && transaction.postingDate <= asOfDate && ['POSTED', 'MATCHED_TRANSFER'].includes(transaction.state))
        .reduce((total, transaction) => total + transaction.amount.minorUnits, opening);
    }
    return [...this.repository.transactions.values()]
      .filter(transaction => transaction.postingDate <= asOfDate && ['POSTED', 'MATCHED_TRANSFER'].includes(transaction.state))
      .flatMap(transaction => transaction.splits)
      .filter(split => split.chartAccountId === accountId)
      .reduce((total, split) => total - split.amount.minorUnits, 0n);
  }

  private sectionLabel(section?: string): string { return section === 'ASSETS' ? 'Assets' : section === 'LIABILITIES' ? 'Liabilities' : 'Equity'; }

  private legacyChartType(accountType: AccountingAccountType): ChartAccountType {
    if (['BANK', 'ACCOUNTS_RECEIVABLE', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'OTHER_ASSET'].includes(accountType)) return 'ASSET';
    if (['CREDIT_CARD', 'ACCOUNTS_PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'].includes(accountType)) return 'LIABILITY';
    return accountType as ChartAccountType;
  }

  private businessDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  private uniqueReferences(references: readonly AccountReference[]): AccountReference[] {
    return [...new Map(references.map(reference => [`${reference.kind}:${reference.referenceId}`, reference])).values()];
  }

  private sameValues(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every(value => right.includes(value));
  }

  private fail(code: 'ACCOUNT_CLASSIFICATION_INVALID' | 'ACCOUNT_REFERENCE_CONFLICT' | 'ACCOUNT_PLACEMENT_INVALID', message: string, accountId?: string, references?: readonly AccountReference[]): never {
    throw new BalanceSheetContractError({ code, message, accountId, references, retryable: false });
  }
}
