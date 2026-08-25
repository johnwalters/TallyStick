import {
  ACCOUNTING_ACCOUNT_TYPES,
  ACCOUNT_TYPE_CATALOG,
  AccountRole,
  AccountingAccountType,
  getAccountTypeDefinition,
} from './account-taxonomy';

export const CASH_FLOW_CASH_ROLES = [
  'CASH',
  'CASH_EQUIVALENT',
  'RESTRICTED_CASH',
  'NOT_CASH',
  'REVIEW_REQUIRED',
] as const;
export type CashFlowCashRole = typeof CASH_FLOW_CASH_ROLES[number];

export const CASH_FLOW_TREATMENTS = [
  'CASH_BALANCE',
  'OPERATING_REVENUE_EXPENSE',
  'OPERATING_ASSET',
  'OPERATING_LIABILITY',
  'NONCASH_PNL_ADJUSTMENT',
  'INVESTING',
  'FINANCING',
  'NONCASH_DISCLOSURE',
  'EXCLUDED',
  'REVIEW_REQUIRED',
] as const;
export type CashFlowTreatment = typeof CASH_FLOW_TREATMENTS[number];

export const CASH_FLOW_CLASSIFICATION_STATUSES = ['CONFIRMED', 'REVIEW_REQUIRED'] as const;
export type CashFlowClassificationStatus = typeof CASH_FLOW_CLASSIFICATION_STATUSES[number];

export const CASH_FLOW_CLASSIFICATION_SOURCES = ['DEFAULT', 'MIGRATED', 'USER'] as const;
export type CashFlowClassificationSource = typeof CASH_FLOW_CLASSIFICATION_SOURCES[number];

export interface CashFlowClassification {
  readonly cashRole?: CashFlowCashRole;
  readonly treatment: CashFlowTreatment;
  readonly status: CashFlowClassificationStatus;
  readonly source: CashFlowClassificationSource;
  readonly rationale: string;
  readonly modifiedAtUtc?: string;
}

export interface CashFlowAccountStructure {
  readonly accountRole: AccountRole;
  readonly accountType: string;
  readonly detailType: string;
  readonly existingClassification?: CashFlowClassification;
}

export interface ValidateCashFlowClassificationCommand extends CashFlowAccountStructure {
  readonly classification: CashFlowClassification;
}

export interface CashFlowClassificationValidation {
  readonly accountType: AccountingAccountType;
  readonly accountRole: AccountRole;
  readonly detailType: string;
  readonly permittedTreatments: readonly CashFlowTreatment[];
  readonly classification: CashFlowClassification;
}

export type CashFlowClassificationFailureCode =
  | 'UNKNOWN_ACCOUNT_TYPE'
  | 'ACCOUNT_ROLE_REQUIRED'
  | 'ACCOUNT_ROLE_PROHIBITED'
  | 'CASH_ROLE_NOT_SUPPORTED'
  | 'CASH_ROLE_TREATMENT_MISMATCH'
  | 'TREATMENT_NOT_ALLOWED'
  | 'DETAIL_TYPE_REQUIRED'
  | 'CLASSIFICATION_STATUS_REQUIRED'
  | 'CLASSIFICATION_SOURCE_INVALID'
  | 'CLASSIFICATION_RATIONALE_REQUIRED';

export interface CashFlowClassificationFailure {
  readonly code: CashFlowClassificationFailureCode;
  readonly message: string;
  readonly accountType?: string;
  readonly detailType?: string;
  readonly referenceIds?: readonly string[];
}

export type CashFlowClassificationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CashFlowClassificationFailure };

const success = <T>(value: T): CashFlowClassificationResult<T> => ({ ok: true, value });
const failure = <T>(error: CashFlowClassificationFailure): CashFlowClassificationResult<T> => ({ ok: false, error });

const isCashRole = (role: CashFlowCashRole | undefined): boolean => role === 'CASH' || role === 'CASH_EQUIVALENT';
const isClassificationStatus = (value: string): value is CashFlowClassificationStatus => (CASH_FLOW_CLASSIFICATION_STATUSES as readonly string[]).includes(value);
const isClassificationSource = (value: string): value is CashFlowClassificationSource => (CASH_FLOW_CLASSIFICATION_SOURCES as readonly string[]).includes(value);
const isTreatment = (value: string): value is CashFlowTreatment => (CASH_FLOW_TREATMENTS as readonly string[]).includes(value);
const isCashRoleValue = (value: string): value is CashFlowCashRole => (CASH_FLOW_CASH_ROLES as readonly string[]).includes(value);

const OPERATING_REVENUE_EXPENSE_TYPES: readonly AccountingAccountType[] = ['INCOME', 'OTHER_INCOME', 'COGS', 'EXPENSE', 'OTHER_EXPENSE'];

const baseTreatments = (accountType: AccountingAccountType): readonly CashFlowTreatment[] => {
  if (accountType === 'BANK') return ['INVESTING', 'FINANCING', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (['ACCOUNTS_RECEIVABLE', 'OTHER_CURRENT_ASSET'].includes(accountType)) return ['OPERATING_ASSET', 'INVESTING', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (['FIXED_ASSET', 'OTHER_ASSET'].includes(accountType)) return ['INVESTING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (['CREDIT_CARD', 'ACCOUNTS_PAYABLE', 'OTHER_CURRENT_LIABILITY'].includes(accountType)) return ['OPERATING_LIABILITY', 'FINANCING', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (accountType === 'LONG_TERM_LIABILITY') return ['FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (accountType === 'EQUITY') return ['FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'];
  if (OPERATING_REVENUE_EXPENSE_TYPES.includes(accountType)) return ['OPERATING_REVENUE_EXPENSE', 'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'EXCLUDED', 'REVIEW_REQUIRED'];
  return ['REVIEW_REQUIRED'];
};

const permittedTreatmentsFor = (structure: CashFlowAccountStructure, accountType: AccountingAccountType): readonly CashFlowTreatment[] => {
  if (structure.accountRole === 'CHART') return baseTreatments(accountType);
  if (structure.accountRole !== 'FINANCIAL_SOURCE') return [];

  // Financial-source accounts always carry a cash role once persisted. This function
  // exposes the structurally available treatments before that role is selected.
  return ['CASH_BALANCE', ...baseTreatments(accountType)];
};

export function getCashFlowPermittedTreatments(structure: CashFlowAccountStructure): CashFlowClassificationResult<readonly CashFlowTreatment[]> {
  const found = getAccountTypeDefinition(structure.accountType);
  if (!found.ok) {
    return failure({ code: 'UNKNOWN_ACCOUNT_TYPE', accountType: structure.accountType, detailType: structure.detailType, message: found.error.message });
  }
  if (structure.accountRole !== 'FINANCIAL_SOURCE' && structure.accountRole !== 'CHART') {
    return failure({ code: 'ACCOUNT_ROLE_REQUIRED', accountType: found.value.accountType, message: 'A Cash Flow classification requires a supported account role.' });
  }
  return success(permittedTreatmentsFor(structure, found.value.accountType));
}

const reviewClassification = (source: CashFlowClassificationSource, rationale: string, cashRole?: CashFlowCashRole): CashFlowClassification => ({
  ...(cashRole ? { cashRole } : {}),
  treatment: 'REVIEW_REQUIRED',
  status: 'REVIEW_REQUIRED',
  source,
  rationale,
});

const confirmedClassification = (treatment: CashFlowTreatment, source: CashFlowClassificationSource, rationale: string, cashRole?: CashFlowCashRole): CashFlowClassification => ({
  ...(cashRole ? { cashRole } : {}),
  treatment,
  status: 'CONFIRMED',
  source,
  rationale,
});

function defaultFinancialClassification(structure: CashFlowAccountStructure, accountType: AccountingAccountType): CashFlowClassification {
  const detail = structure.detailType.trim();
  if (accountType === 'BANK') {
    if (['Cash on hand', 'Checking'].includes(detail)) return confirmedClassification('CASH_BALANCE', 'DEFAULT', 'Bank detail structurally identifies unrestricted cash.', 'CASH');
    if (detail === 'Savings') return confirmedClassification('CASH_BALANCE', 'DEFAULT', 'Savings is structurally eligible as a cash equivalent and remains user-reviewable.', 'CASH_EQUIVALENT');
    if (detail === 'Money Market') return reviewClassification('DEFAULT', 'Money Market requires user review before it can be treated as cash or a cash equivalent.', 'REVIEW_REQUIRED');
    if (['Rents Held in Trust', 'Trust account'].includes(detail)) return confirmedClassification('CASH_BALANCE', 'DEFAULT', 'Trust-held funds are restricted cash and are disclosed separately.', 'RESTRICTED_CASH');
    return reviewClassification('DEFAULT', 'The Bank detail is custom or ambiguous; choose a cash role and treatment.', 'REVIEW_REQUIRED');
  }
  if (accountType === 'CREDIT_CARD') return confirmedClassification('OPERATING_LIABILITY', 'DEFAULT', 'Credit Card financial sources are liabilities for Cash Flow working-capital reconciliation.', 'NOT_CASH');
  if (accountType === 'OTHER_CURRENT_ASSET' && ['Marketplace clearing', 'Clearing account'].includes(detail)) return confirmedClassification('OPERATING_ASSET', 'DEFAULT', 'Clearing detail is a noncash operating asset.', 'NOT_CASH');
  return reviewClassification('DEFAULT', 'This financial-source structure does not identify a safe cash role or treatment without review.', 'REVIEW_REQUIRED');
}

function defaultChartClassification(structure: CashFlowAccountStructure, accountType: AccountingAccountType): CashFlowClassification {
  const detail = structure.detailType.trim();
  if (accountType === 'ACCOUNTS_RECEIVABLE') return confirmedClassification('OPERATING_ASSET', 'DEFAULT', 'Accounts receivable detail is an operating asset.');
  if (accountType === 'OTHER_CURRENT_ASSET' && ['Inventory', 'Prepaid expenses'].includes(detail)) return confirmedClassification('OPERATING_ASSET', 'DEFAULT', 'The standard current-asset detail is an operating asset.');
  if (accountType === 'FIXED_ASSET') return confirmedClassification('INVESTING', 'DEFAULT', 'Fixed assets are investing activity when cash-side activity is recorded.');
  if (accountType === 'OTHER_ASSET') return confirmedClassification('INVESTING', 'DEFAULT', 'Other long-term assets are investing activity and remain user-reviewable.', undefined);
  if (['CREDIT_CARD', 'ACCOUNTS_PAYABLE'].includes(accountType)) return confirmedClassification('OPERATING_LIABILITY', 'DEFAULT', 'Current operating liabilities reconcile accrued activity to cash.');
  if (accountType === 'OTHER_CURRENT_LIABILITY') {
    if (detail === 'Loan payable') return confirmedClassification('FINANCING', 'DEFAULT', 'Loan payable activity is financing activity.');
    return confirmedClassification('OPERATING_LIABILITY', 'DEFAULT', 'Current operating liabilities reconcile accrued activity to cash.');
  }
  if (accountType === 'LONG_TERM_LIABILITY') return confirmedClassification('FINANCING', 'DEFAULT', 'Long-term liabilities are financing activity.');
  if (accountType === 'EQUITY') {
    if (detail === 'Retained earnings') return confirmedClassification('EXCLUDED', 'DEFAULT', 'Retained earnings is an accumulated equity balance, not a period cash flow.');
    if (['Owner equity', 'Owner draw'].includes(detail)) return confirmedClassification('FINANCING', 'DEFAULT', 'Owner equity activity is financing activity.');
  }
  if (OPERATING_REVENUE_EXPENSE_TYPES.includes(accountType)) {
    if (accountType === 'OTHER_EXPENSE' && detail === 'Depreciation') return confirmedClassification('NONCASH_PNL_ADJUSTMENT', 'DEFAULT', 'Depreciation is reversed as a noncash P/L adjustment.');
    if (accountType === 'OTHER_EXPENSE') return reviewClassification('DEFAULT', 'This Other Expense detail has no safe structural Cash Flow default; choose a treatment.', undefined);
    return confirmedClassification('OPERATING_REVENUE_EXPENSE', 'DEFAULT', 'Income and expense activity is included through the indirect-method P/L starting point.');
  }
  return reviewClassification('DEFAULT', 'The account detail is custom or structurally ambiguous; choose a Cash Flow treatment.', undefined);
}

/** Seed a new account from structural metadata only. Existing classifications are intentionally not consulted. */
export function seedDefaultCashFlowClassification(structure: Omit<CashFlowAccountStructure, 'existingClassification'>): CashFlowClassificationResult<CashFlowClassification> {
  const found = getAccountTypeDefinition(structure.accountType);
  if (!found.ok) return failure({ code: 'UNKNOWN_ACCOUNT_TYPE', accountType: structure.accountType, detailType: structure.detailType, message: found.error.message });
  if (structure.accountRole !== 'FINANCIAL_SOURCE' && structure.accountRole !== 'CHART') {
    return failure({ code: 'ACCOUNT_ROLE_REQUIRED', accountType: found.value.accountType, message: 'A Cash Flow classification requires a supported account role.' });
  }
  const detailType = structure.detailType.trim();
  if (!detailType) return failure({ code: 'DETAIL_TYPE_REQUIRED', accountType: found.value.accountType, detailType, message: 'A structural Cash Flow default requires a detail type.' });
  const standardDetail = found.value.detailTypes.some(detail => detail.value === detailType);
  if (!standardDetail) {
    return success(structure.accountRole === 'FINANCIAL_SOURCE'
      ? reviewClassification('DEFAULT', 'The financial-source detail is custom or ambiguous; choose a cash role and treatment.', 'REVIEW_REQUIRED')
      : reviewClassification('DEFAULT', 'The Chart detail is custom or ambiguous; choose a Cash Flow treatment.', undefined));
  }
  return success(structure.accountRole === 'FINANCIAL_SOURCE'
    ? defaultFinancialClassification(structure, found.value.accountType)
    : defaultChartClassification(structure, found.value.accountType));
}

/** Validate an existing classification without replacing its source, rationale, or modification metadata. */
export function validateAndPreserveExistingCashFlowClassification(command: CashFlowAccountStructure & { readonly existingClassification: CashFlowClassification }): CashFlowClassificationResult<CashFlowClassificationValidation> {
  const { existingClassification, ...structure } = command;
  return validateCashFlowClassification({ ...structure, classification: existingClassification });
}

/** Return a default classification, honoring an existing valid classification when one is supplied. */
export function getDefaultCashFlowClassification(structure: CashFlowAccountStructure): CashFlowClassificationResult<CashFlowClassification> {
  if (structure.existingClassification !== undefined) {
    const preserved = validateAndPreserveExistingCashFlowClassification(structure as CashFlowAccountStructure & { readonly existingClassification: CashFlowClassification });
    return preserved.ok ? success(preserved.value.classification) : failure(preserved.error);
  }
  return seedDefaultCashFlowClassification(structure);
}

export function validateCashFlowClassification(command: ValidateCashFlowClassificationCommand): CashFlowClassificationResult<CashFlowClassificationValidation> {
  const found = getAccountTypeDefinition(command.accountType);
  if (!found.ok) return failure({ code: 'UNKNOWN_ACCOUNT_TYPE', accountType: command.accountType, detailType: command.detailType, message: found.error.message });
  if (command.accountRole !== 'FINANCIAL_SOURCE' && command.accountRole !== 'CHART') {
    return failure({ code: 'ACCOUNT_ROLE_REQUIRED', accountType: found.value.accountType, message: 'A Cash Flow classification requires a supported account role.' });
  }
  const detailType = command.detailType.trim();
  if (!detailType) return failure({ code: 'DETAIL_TYPE_REQUIRED', accountType: found.value.accountType, detailType, message: 'A detail type is required for Cash Flow classification.' });

  const classification = command.classification;
  if (typeof classification.treatment !== 'string' || !isTreatment(classification.treatment)) return failure({ code: 'TREATMENT_NOT_ALLOWED', accountType: found.value.accountType, detailType, message: `Unknown Cash Flow treatment: ${classification.treatment}.` });
  if (typeof classification.status !== 'string' || !isClassificationStatus(classification.status)) return failure({ code: 'CLASSIFICATION_STATUS_REQUIRED', accountType: found.value.accountType, detailType, message: 'A valid Cash Flow classification status is required.' });
  if (typeof classification.source !== 'string' || !isClassificationSource(classification.source)) return failure({ code: 'CLASSIFICATION_SOURCE_INVALID', accountType: found.value.accountType, detailType, message: 'A valid Cash Flow classification source is required.' });
  if (typeof classification.rationale !== 'string' || !classification.rationale.trim()) return failure({ code: 'CLASSIFICATION_RATIONALE_REQUIRED', accountType: found.value.accountType, detailType, message: 'A rationale is required for a Cash Flow classification.' });

  if (command.accountRole === 'CHART' && classification.cashRole !== undefined) {
    return failure({ code: 'ACCOUNT_ROLE_PROHIBITED', accountType: found.value.accountType, detailType, message: 'Chart accounts cannot carry a financial cash role.' });
  }
  if (command.accountRole === 'FINANCIAL_SOURCE' && classification.cashRole === undefined) {
    return failure({ code: 'ACCOUNT_ROLE_REQUIRED', accountType: found.value.accountType, detailType, message: 'Financial-source accounts require a Cash Flow cash role.' });
  }
  if (classification.cashRole !== undefined && !isCashRoleValue(classification.cashRole)) {
    return failure({ code: 'CASH_ROLE_NOT_SUPPORTED', accountType: found.value.accountType, detailType, message: `Unknown Cash Flow cash role: ${classification.cashRole}.` });
  }

  if (isCashRole(classification.cashRole) && classification.treatment !== 'CASH_BALANCE') {
    return failure({ code: 'CASH_ROLE_TREATMENT_MISMATCH', accountType: found.value.accountType, detailType, message: 'Cash and cash-equivalent roles can use only the Cash balance treatment.' });
  }
  if (classification.cashRole === 'RESTRICTED_CASH' && !['CASH_BALANCE', 'REVIEW_REQUIRED'].includes(classification.treatment)) {
    return failure({ code: 'CASH_ROLE_TREATMENT_MISMATCH', accountType: found.value.accountType, detailType, message: 'Restricted cash can use only Cash balance or Review required treatment.' });
  }
  if (classification.cashRole === 'REVIEW_REQUIRED' && classification.treatment !== 'REVIEW_REQUIRED') {
    return failure({ code: 'CASH_ROLE_TREATMENT_MISMATCH', accountType: found.value.accountType, detailType, message: 'A Review-required cash role must use Review required treatment.' });
  }

  const permitted = command.accountRole === 'FINANCIAL_SOURCE'
    ? (() => {
      const role = classification.cashRole;
      if (isCashRole(role)) return ['CASH_BALANCE'] as const;
      if (role === 'RESTRICTED_CASH') return ['CASH_BALANCE', 'REVIEW_REQUIRED'] as const;
      if (role === 'REVIEW_REQUIRED') return ['REVIEW_REQUIRED'] as const;
      return baseTreatments(found.value.accountType);
    })()
    : baseTreatments(found.value.accountType);
  if (!permitted.includes(classification.treatment)) {
    return failure({ code: 'TREATMENT_NOT_ALLOWED', accountType: found.value.accountType, detailType, message: `${classification.treatment} is not compatible with this account structure and cash role.` });
  }
  if ((classification.cashRole === 'REVIEW_REQUIRED' || classification.treatment === 'REVIEW_REQUIRED') && classification.status !== 'REVIEW_REQUIRED') {
    return failure({ code: 'CLASSIFICATION_STATUS_REQUIRED', accountType: found.value.accountType, detailType, message: 'Review-required cash roles and treatments require Review-required status.' });
  }
  return success({
    accountType: found.value.accountType,
    accountRole: command.accountRole,
    detailType,
    permittedTreatments: permitted,
    classification: { ...classification, rationale: classification.rationale.trim() },
  });
}

export function classifyCashFlowAccount(command: CashFlowAccountStructure): CashFlowClassificationResult<CashFlowClassificationValidation> {
  if (command.existingClassification !== undefined) return validateAndPreserveExistingCashFlowClassification(command as CashFlowAccountStructure & { readonly existingClassification: CashFlowClassification });
  return reclassifyCashFlowAccount(command);
}

/** Reclassify an account from its current structure, intentionally ignoring any persisted classification. */
export function reclassifyCashFlowAccount(command: Omit<CashFlowAccountStructure, 'existingClassification'>): CashFlowClassificationResult<CashFlowClassificationValidation> {
  const classification = seedDefaultCashFlowClassification(command);
  if (!classification.ok) return classification;
  return validateCashFlowClassification({ ...command, classification: classification.value });
}

export const CASH_FLOW_ACCOUNT_TYPES = [...ACCOUNTING_ACCOUNT_TYPES] as readonly AccountingAccountType[];
export const CASH_FLOW_ACCOUNT_TYPE_CATALOG = ACCOUNT_TYPE_CATALOG;
