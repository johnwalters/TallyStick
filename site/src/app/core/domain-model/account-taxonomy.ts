export const REPORTING_GROUPS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type ReportingGroup = typeof REPORTING_GROUPS[number];

export const BALANCE_SHEET_SECTIONS = ['ASSETS', 'LIABILITIES', 'EQUITY', 'RECONCILIATION'] as const;
export type BalanceSheetSection = typeof BALANCE_SHEET_SECTIONS[number];

export const ACCOUNTING_ACCOUNT_TYPES = [
  'BANK',
  'ACCOUNTS_RECEIVABLE',
  'OTHER_CURRENT_ASSET',
  'FIXED_ASSET',
  'OTHER_ASSET',
  'CREDIT_CARD',
  'ACCOUNTS_PAYABLE',
  'OTHER_CURRENT_LIABILITY',
  'LONG_TERM_LIABILITY',
  'EQUITY',
  'INCOME',
  'OTHER_INCOME',
  'COGS',
  'EXPENSE',
  'OTHER_EXPENSE',
] as const;
export type AccountingAccountType = typeof ACCOUNTING_ACCOUNT_TYPES[number];

export const ACCOUNT_ROLES = ['FINANCIAL_SOURCE', 'CHART'] as const;
export type AccountRole = typeof ACCOUNT_ROLES[number];

export const IMPORT_SOURCE_KINDS = ['CSV', 'EXCEL', 'QBO_OFX', 'AMAZON'] as const;
export type ImportSourceKind = typeof IMPORT_SOURCE_KINDS[number];

export const CLASSIFICATION_STATUSES = ['CONFIRMED', 'REVIEW_REQUIRED'] as const;
export type ClassificationStatus = typeof CLASSIFICATION_STATUSES[number];

export type NaturalBalance = 'DEBIT' | 'CREDIT';
export type OpeningBalanceSource = 'DERIVED_EQUITY' | 'LEDGER_ACTIVITY';
export type AccountPlacementBehavior = 'BALANCE_SHEET_LINE' | 'CURRENT_EARNINGS';

export interface ImportCapability {
  readonly enabled: boolean;
  readonly supportedSourceKinds: readonly ImportSourceKind[];
}

export interface DetailTypeDefinition {
  readonly value: string;
  readonly label: string;
  readonly standard: boolean;
  readonly selectableForNewAccounts: boolean;
}

export interface AccountTypeDefinition {
  readonly accountType: AccountingAccountType;
  readonly reportingGroup: ReportingGroup;
  readonly label: string;
  readonly detailTypes: readonly DetailTypeDefinition[];
  readonly naturalBalance: NaturalBalance;
  readonly balanceSheetSection?: BalanceSheetSection;
  readonly placementBehavior: AccountPlacementBehavior;
  readonly validParentAccountTypes: readonly AccountingAccountType[];
  readonly openingBalanceAllowed: boolean;
  readonly importCapabilityDefault: boolean;
  readonly supportedImportSourceKinds: readonly ImportSourceKind[];
}

export interface AccountTypeGroupDefinition {
  readonly reportingGroup: ReportingGroup;
  readonly label: string;
  readonly accountTypes: readonly AccountTypeDefinition[];
}

const detailTypes = (...values: string[]): readonly DetailTypeDefinition[] =>
  values.map(value => ({ value, label: value, standard: true, selectableForNewAccounts: true }));

const BANK_IMPORT_SOURCES = ['CSV', 'EXCEL', 'QBO_OFX'] as const satisfies readonly ImportSourceKind[];
const CLEARING_IMPORT_SOURCES = ['CSV', 'EXCEL', 'AMAZON'] as const satisfies readonly ImportSourceKind[];
const ASSET_TYPES = ['BANK', 'ACCOUNTS_RECEIVABLE', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'OTHER_ASSET'] as const;
const LIABILITY_TYPES = ['CREDIT_CARD', 'ACCOUNTS_PAYABLE', 'OTHER_CURRENT_LIABILITY', 'LONG_TERM_LIABILITY'] as const;
const EQUITY_TYPES = ['EQUITY'] as const;
const INCOME_TYPES = ['INCOME', 'OTHER_INCOME'] as const;
const EXPENSE_TYPES = ['COGS', 'EXPENSE', 'OTHER_EXPENSE'] as const;

export const ACCOUNT_TYPE_GROUPS: readonly AccountTypeGroupDefinition[] = [
  {
    reportingGroup: 'ASSET',
    label: 'Asset',
    accountTypes: [
      definition('BANK', 'ASSET', 'Bank', detailTypes('Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'), 'DEBIT', ASSET_TYPES, 'ASSETS', true, BANK_IMPORT_SOURCES),
      definition('ACCOUNTS_RECEIVABLE', 'ASSET', 'Accounts receivable (A/R)', detailTypes('Accounts receivable'), 'DEBIT', ASSET_TYPES, 'ASSETS', true),
      definition('OTHER_CURRENT_ASSET', 'ASSET', 'Other Current Assets', detailTypes('Inventory', 'Prepaid expenses', 'Marketplace clearing', 'Clearing account', 'Other current assets'), 'DEBIT', ASSET_TYPES, 'ASSETS', true, CLEARING_IMPORT_SOURCES),
      definition('FIXED_ASSET', 'ASSET', 'Fixed Assets', detailTypes('Furniture and fixtures', 'Machinery and equipment', 'Vehicles', 'Other fixed assets'), 'DEBIT', ASSET_TYPES, 'ASSETS', true),
      definition('OTHER_ASSET', 'ASSET', 'Other Assets', detailTypes('Goodwill', 'Security deposits', 'Other long-term assets'), 'DEBIT', ASSET_TYPES, 'ASSETS', true),
    ],
  },
  {
    reportingGroup: 'LIABILITY',
    label: 'Liability',
    accountTypes: [
      definition('CREDIT_CARD', 'LIABILITY', 'Credit Card', detailTypes('Credit Card'), 'CREDIT', LIABILITY_TYPES, 'LIABILITIES', true, BANK_IMPORT_SOURCES),
      definition('ACCOUNTS_PAYABLE', 'LIABILITY', 'Accounts payable (A/P)', detailTypes('Accounts payable'), 'CREDIT', LIABILITY_TYPES, 'LIABILITIES', true),
      definition('OTHER_CURRENT_LIABILITY', 'LIABILITY', 'Other Current Liabilities', detailTypes('Loan payable', 'Payroll liabilities', 'Sales tax payable', 'Other current liabilities'), 'CREDIT', LIABILITY_TYPES, 'LIABILITIES', true),
      definition('LONG_TERM_LIABILITY', 'LIABILITY', 'Long Term Liabilities', detailTypes('Notes payable', 'Shareholder notes payable', 'Other long-term liabilities'), 'CREDIT', LIABILITY_TYPES, 'LIABILITIES', true),
    ],
  },
  {
    reportingGroup: 'EQUITY',
    label: 'Equity',
    accountTypes: [
      definition('EQUITY', 'EQUITY', 'Equity', detailTypes('Owner equity', 'Owner draw', 'Retained earnings'), 'CREDIT', EQUITY_TYPES, 'EQUITY', true),
    ],
  },
  {
    reportingGroup: 'INCOME',
    label: 'Income',
    accountTypes: [
      definition('INCOME', 'INCOME', 'Income', detailTypes('Sales of product income', 'Service income', 'Other primary income'), 'CREDIT', INCOME_TYPES),
      definition('OTHER_INCOME', 'INCOME', 'Other Income', detailTypes('Interest earned', 'Other investment income', 'Other miscellaneous income'), 'CREDIT', INCOME_TYPES),
    ],
  },
  {
    reportingGroup: 'EXPENSE',
    label: 'Expense',
    accountTypes: [
      definition('COGS', 'EXPENSE', 'Cost of Goods Sold', detailTypes('Cost of labor', 'Shipping, freight and delivery', 'Supplies and materials', 'Other costs of goods sold'), 'DEBIT', EXPENSE_TYPES),
      definition('EXPENSE', 'EXPENSE', 'Expenses', detailTypes('Advertising', 'Bank charges', 'Insurance', 'Interest paid', 'Office expenses', 'Other business expenses'), 'DEBIT', EXPENSE_TYPES),
      definition('OTHER_EXPENSE', 'EXPENSE', 'Other Expense', detailTypes('Depreciation', 'Penalties and settlements', 'Other miscellaneous expense'), 'DEBIT', EXPENSE_TYPES),
    ],
  },
] as const;

export const ACCOUNT_TYPE_CATALOG: readonly AccountTypeDefinition[] = ACCOUNT_TYPE_GROUPS.flatMap(group => group.accountTypes);

function definition(
  accountType: AccountingAccountType,
  reportingGroup: ReportingGroup,
  label: string,
  details: readonly DetailTypeDefinition[],
  naturalBalance: NaturalBalance,
  validParentAccountTypes: readonly AccountingAccountType[],
  balanceSheetSection?: BalanceSheetSection,
  openingBalanceAllowed = false,
  supportedImportSourceKinds: readonly ImportSourceKind[] = [],
): AccountTypeDefinition {
  return {
    accountType,
    reportingGroup,
    label,
    detailTypes: details,
    naturalBalance,
    balanceSheetSection,
    placementBehavior: balanceSheetSection ? 'BALANCE_SHEET_LINE' : 'CURRENT_EARNINGS',
    validParentAccountTypes,
    openingBalanceAllowed,
    importCapabilityDefault: accountType === 'BANK' || accountType === 'CREDIT_CARD',
    supportedImportSourceKinds,
  };
}

export type TaxonomyFailureCode =
  | 'UNKNOWN_ACCOUNT_TYPE'
  | 'DETAIL_TYPE_REQUIRED'
  | 'DETAIL_TYPE_MISMATCH'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_INACTIVE'
  | 'PARENT_REPORTING_GROUP_MISMATCH'
  | 'PARENT_CYCLE'
  | 'ACCOUNT_ROLE_TYPE_MISMATCH'
  | 'ACCOUNT_ROLE_CHANGE_UNSUPPORTED'
  | 'IMPORT_NOT_SUPPORTED'
  | 'IMPORT_DISABLED_WITH_SOURCES'
  | 'IMPORT_SOURCE_KINDS_REQUIRED'
  | 'IMPORT_SOURCE_KIND_NOT_SUPPORTED'
  | 'OPENING_BALANCE_NOT_ALLOWED'
  | 'OPENING_BALANCE_MODE_CONFLICT'
  | 'PLACEMENT_MISMATCH';

export interface TaxonomyFailure {
  readonly code: TaxonomyFailureCode;
  readonly message: string;
  readonly accountType?: string;
  readonly referenceIds?: readonly string[];
}

export type TaxonomyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TaxonomyFailure };

const success = <T>(value: T): TaxonomyResult<T> => ({ ok: true, value });
const failure = <T>(error: TaxonomyFailure): TaxonomyResult<T> => ({ ok: false, error });

export function getAccountTypeDefinition(accountType: string): TaxonomyResult<AccountTypeDefinition> {
  const found = ACCOUNT_TYPE_CATALOG.find(definition => definition.accountType === accountType);
  return found
    ? success(found)
    : failure({ code: 'UNKNOWN_ACCOUNT_TYPE', accountType, message: `Unknown accounting account type: ${accountType || '(blank)'}.` });
}

export function getReportingGroup(accountType: string): TaxonomyResult<ReportingGroup> {
  const found = getAccountTypeDefinition(accountType);
  return found.ok ? success(found.value.reportingGroup) : found;
}

export interface DetailTypeClassification {
  readonly detailType: DetailTypeDefinition;
  readonly classificationStatus: ClassificationStatus;
}

export function validateDetailType(accountType: string, detailType: string, existingAccount = false): TaxonomyResult<DetailTypeClassification> {
  const found = getAccountTypeDefinition(accountType);
  if (!found.ok) return found;
  const normalized = detailType.trim();
  if (!normalized) return failure({ code: 'DETAIL_TYPE_REQUIRED', accountType, message: 'Detail type is required.' });
  const standard = found.value.detailTypes.find(detail => detail.value === normalized);
  if (standard) return success({ detailType: standard, classificationStatus: 'CONFIRMED' });
  if (!existingAccount) {
    return failure({ code: 'DETAIL_TYPE_MISMATCH', accountType, message: `${normalized} is not a selectable detail type for ${found.value.label}.` });
  }
  return success({
    detailType: { value: normalized, label: normalized, standard: false, selectableForNewAccounts: false },
    classificationStatus: 'CONFIRMED',
  });
}

export interface ParentAccountReference {
  readonly id: string;
  readonly accountType: string;
  readonly parentId?: string;
  readonly active: boolean;
}

export interface ValidateParentCommand {
  readonly accountId: string;
  readonly accountType: string;
  readonly parentId?: string;
  readonly accounts: readonly ParentAccountReference[];
}

export function validateParent(command: ValidateParentCommand): TaxonomyResult<undefined> {
  const accountDefinition = getAccountTypeDefinition(command.accountType);
  if (!accountDefinition.ok) return accountDefinition;
  if (!command.parentId) return success(undefined);
  const parent = command.accounts.find(account => account.id === command.parentId);
  if (!parent) return failure({ code: 'PARENT_NOT_FOUND', referenceIds: [command.parentId], message: `Parent account ${command.parentId} does not exist.` });
  if (!parent.active) return failure({ code: 'PARENT_INACTIVE', referenceIds: [parent.id], message: `Parent account ${parent.id} is archived.` });
  const parentDefinition = getAccountTypeDefinition(parent.accountType);
  if (!parentDefinition.ok) return parentDefinition;
  if (!accountDefinition.value.validParentAccountTypes.includes(parentDefinition.value.accountType)) {
    return failure({ code: 'PARENT_REPORTING_GROUP_MISMATCH', referenceIds: [parent.id], message: 'A parent account must use the same reporting group.' });
  }
  const byId = new Map(command.accounts.map(account => [account.id, account]));
  const visited = new Set<string>();
  let cursor: ParentAccountReference | undefined = parent;
  while (cursor) {
    if (cursor.id === command.accountId || visited.has(cursor.id)) {
      return failure({ code: 'PARENT_CYCLE', referenceIds: [cursor.id], message: 'The selected parent would create an account hierarchy cycle.' });
    }
    visited.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return success(undefined);
}

export interface ValidateAccountUseCommand {
  readonly accountType: string;
  readonly requestedRole: AccountRole;
  readonly currentRole?: AccountRole;
}

export interface AccountUseValidation {
  readonly accountType: AccountingAccountType;
  readonly role: AccountRole;
  readonly reportingGroup: ReportingGroup;
}

export function validateAccountUse(command: ValidateAccountUseCommand): TaxonomyResult<AccountUseValidation> {
  const found = getAccountTypeDefinition(command.accountType);
  if (!found.ok) return found;
  if (command.currentRole && command.currentRole !== command.requestedRole) {
    return failure({ code: 'ACCOUNT_ROLE_CHANGE_UNSUPPORTED', accountType: command.accountType, message: 'Converting an existing account between financial-source and Chart roles is not supported.' });
  }
  if (command.requestedRole === 'FINANCIAL_SOURCE' && !['ASSET', 'LIABILITY'].includes(found.value.reportingGroup)) {
    return failure({ code: 'ACCOUNT_ROLE_TYPE_MISMATCH', accountType: command.accountType, message: 'Financial-source accounts must use an Asset or Liability account type.' });
  }
  return success({ accountType: found.value.accountType, role: command.requestedRole, reportingGroup: found.value.reportingGroup });
}

export interface ValidateImportCapabilityCommand {
  readonly accountType: string;
  readonly detailType: string;
  readonly role: AccountRole;
  readonly capability: ImportCapability;
}

export function defaultImportCapability(accountType: string): TaxonomyResult<ImportCapability> {
  const found = getAccountTypeDefinition(accountType);
  if (!found.ok) return found;
  return success({
    enabled: found.value.importCapabilityDefault,
    supportedSourceKinds: found.value.importCapabilityDefault ? found.value.supportedImportSourceKinds : [],
  });
}

export function validateImportCapability(command: ValidateImportCapabilityCommand): TaxonomyResult<ImportCapability> {
  const found = getAccountTypeDefinition(command.accountType);
  if (!found.ok) return found;
  if (!command.capability.enabled) {
    if (command.capability.supportedSourceKinds.length > 0) {
      return failure({ code: 'IMPORT_DISABLED_WITH_SOURCES', accountType: command.accountType, message: 'A disabled import capability cannot declare source kinds.' });
    }
    return success({ enabled: false, supportedSourceKinds: [] });
  }
  if (command.role !== 'FINANCIAL_SOURCE' || found.value.supportedImportSourceKinds.length === 0) {
    return failure({ code: 'IMPORT_NOT_SUPPORTED', accountType: command.accountType, message: `${found.value.label} does not support imported source transactions for this account use.` });
  }
  if (found.value.accountType === 'OTHER_CURRENT_ASSET' && !['Marketplace clearing', 'Clearing account'].includes(command.detailType.trim())) {
    return failure({ code: 'IMPORT_NOT_SUPPORTED', accountType: command.accountType, message: 'Only marketplace or clearing Other Current Asset accounts may receive imports.' });
  }
  if (command.capability.supportedSourceKinds.length === 0) {
    return failure({ code: 'IMPORT_SOURCE_KINDS_REQUIRED', accountType: command.accountType, message: 'At least one supported source kind is required when import is enabled.' });
  }
  const unsupported = command.capability.supportedSourceKinds.filter(kind => !found.value.supportedImportSourceKinds.includes(kind));
  if (unsupported.length > 0) {
    return failure({ code: 'IMPORT_SOURCE_KIND_NOT_SUPPORTED', accountType: command.accountType, message: `Unsupported import source kinds: ${unsupported.join(', ')}.` });
  }
  return success({ enabled: true, supportedSourceKinds: [...new Set(command.capability.supportedSourceKinds)] });
}

export interface ValidateOpeningBalanceCommand {
  readonly accountType: string;
  readonly role: AccountRole;
  readonly openingBalanceSource: OpeningBalanceSource;
  readonly storedOpeningBalanceMinor: bigint;
}

export function validateOpeningBalance(command: ValidateOpeningBalanceCommand): TaxonomyResult<OpeningBalanceSource> {
  const found = getAccountTypeDefinition(command.accountType);
  if (!found.ok) return found;
  if (command.role !== 'FINANCIAL_SOURCE' || !found.value.openingBalanceAllowed) {
    return failure({ code: 'OPENING_BALANCE_NOT_ALLOWED', accountType: command.accountType, message: 'Stored opening balances are available only for supported financial-source accounts.' });
  }
  if (command.openingBalanceSource === 'LEDGER_ACTIVITY' && command.storedOpeningBalanceMinor !== 0n) {
    return failure({ code: 'OPENING_BALANCE_MODE_CONFLICT', accountType: command.accountType, message: 'Ledger-activity opening mode requires a zero stored opening balance.' });
  }
  return success(command.openingBalanceSource);
}

export interface AccountPlacement {
  readonly reportingGroup: ReportingGroup;
  readonly section?: BalanceSheetSection;
  readonly behavior: AccountPlacementBehavior;
}

export function getAccountPlacement(accountType: string): TaxonomyResult<AccountPlacement> {
  const found = getAccountTypeDefinition(accountType);
  return found.ok
    ? success({ reportingGroup: found.value.reportingGroup, section: found.value.balanceSheetSection, behavior: found.value.placementBehavior })
    : found;
}

export function validatePlacementCompatibility(accountType: string, placement: AccountPlacement): TaxonomyResult<AccountPlacement> {
  const expected = getAccountPlacement(accountType);
  if (!expected.ok) return expected;
  if (expected.value.reportingGroup !== placement.reportingGroup || expected.value.section !== placement.section || expected.value.behavior !== placement.behavior) {
    return failure({ code: 'PLACEMENT_MISMATCH', accountType, message: `${accountType} is not compatible with the requested report placement.` });
  }
  return expected;
}

export interface AccountClassificationCommand {
  readonly accountType: string;
  readonly detailType: string;
  readonly existingAccount: boolean;
  readonly classificationStatus?: ClassificationStatus;
}

export interface AccountClassificationResult {
  readonly accountType: AccountingAccountType;
  readonly reportingGroup: ReportingGroup;
  readonly detailType: DetailTypeDefinition;
  readonly classificationStatus: ClassificationStatus;
}

export function classifyAccount(command: AccountClassificationCommand): TaxonomyResult<AccountClassificationResult> {
  const found = getAccountTypeDefinition(command.accountType);
  if (!found.ok) return found;
  const detail = validateDetailType(command.accountType, command.detailType, command.existingAccount);
  if (!detail.ok) return detail;
  return success({
    accountType: found.value.accountType,
    reportingGroup: found.value.reportingGroup,
    detailType: detail.value.detailType,
    classificationStatus: command.existingAccount && command.classificationStatus
      ? command.classificationStatus
      : detail.value.classificationStatus,
  });
}

export interface AccountPlacementWarning {
  readonly code: 'REVIEW_REQUIRED' | 'ARCHIVED_NONZERO';
  readonly message: string;
}

export interface GetAccountPlacementPreviewCommand {
  readonly accountType: AccountingAccountType;
  readonly accountRole?: AccountRole;
  readonly accountId?: string;
  readonly accountName?: string;
  readonly parentId?: string;
  readonly asOfDate: string;
}

export interface AccountPlacementPreview {
  readonly reportingGroup: ReportingGroup;
  readonly section?: BalanceSheetSection;
  readonly fullPath: string;
  readonly asOfDate: string;
  readonly currentBalanceMinor?: bigint;
  readonly behavior: AccountPlacementBehavior;
  readonly warnings: readonly AccountPlacementWarning[];
}

export type AccountReferenceKind = 'TRANSACTION' | 'SPLIT' | 'RULE' | 'TAX_SETTING' | 'PARENT' | 'CHILD' | 'IMPORT_MAPPING' | 'TRANSFER' | 'LOCK_STATE' | 'REPORT_EFFECT';

export interface AccountReference {
  readonly kind: AccountReferenceKind;
  readonly referenceId: string;
  readonly label: string;
}

export interface ValidateAccountReferencesCommand {
  readonly accountId: string;
  readonly proposedAccountType: AccountingAccountType;
  readonly proposedDetailType: string;
}

export interface SaveGenericAccountCommand {
  readonly accountId?: string;
  readonly currentRole?: AccountRole;
  readonly requestedRole: AccountRole;
  readonly accountType: AccountingAccountType;
  readonly detailType: string;
  readonly name: string;
  readonly parentId?: string;
  readonly description?: string;
  readonly importCapability: ImportCapability;
  readonly openingBalanceSource: OpeningBalanceSource;
  readonly openingBalanceMinor: bigint;
  readonly openingBalanceDate: string;
  readonly institutionOrEntity?: string;
  readonly lastFour?: string;
  readonly displayOrder?: number;
  readonly locked?: boolean;
  readonly confirmedReferenceIds?: readonly string[];
}

export interface AccountChangeValidation {
  readonly valid: boolean;
  readonly blockingReferences: readonly AccountReference[];
  readonly confirmationReferences: readonly AccountReference[];
}

export interface GenericAccountSaveResult {
  readonly role: AccountRole;
  readonly accountId: string;
  readonly created: boolean;
  readonly classificationStatus: ClassificationStatus;
  readonly affectedReferences: readonly AccountReference[];
}

export interface AccountReferenceValidationResult {
  readonly valid: boolean;
  readonly invalidReferences: readonly AccountReference[];
}
