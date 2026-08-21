import { ACCOUNT_TYPE_CATALOG, AccountingAccountType } from './account-taxonomy';

export type Id = string;
export type CurrencyCode = 'USD' | (string & {});

export type AccountType = 'BANK' | 'CREDIT_CARD' | 'ENTITY';
export const FINANCIAL_ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string; detailTypes: readonly string[] }> = [
  { value: 'BANK', label: 'Bank', detailTypes: ['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'] },
  { value: 'CREDIT_CARD', label: 'Credit Card', detailTypes: ['Credit Card'] },
  { value: 'ENTITY', label: 'Entity', detailTypes: ['Marketplace', 'Clearing account', 'Other transactions'] },
];
export type ChartAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE';
export type ChartAccountKind = AccountingAccountType;

export const CHART_ACCOUNT_TYPES: ReadonlyArray<{ value: ChartAccountKind; label: string; reportingType: ChartAccountType; detailTypes: readonly string[] }> =
  ACCOUNT_TYPE_CATALOG.map(definition => ({
    value: definition.accountType,
    label: definition.label,
    reportingType: legacyChartReportingType(definition.accountType),
    detailTypes: definition.detailTypes.map(detail => detail.value),
  }));

function legacyChartReportingType(accountType: AccountingAccountType): ChartAccountType {
  switch (accountType) {
    case 'BANK':
    case 'ACCOUNTS_RECEIVABLE':
    case 'OTHER_CURRENT_ASSET':
    case 'FIXED_ASSET':
    case 'OTHER_ASSET':
      return 'ASSET';
    case 'CREDIT_CARD':
    case 'ACCOUNTS_PAYABLE':
    case 'OTHER_CURRENT_LIABILITY':
    case 'LONG_TERM_LIABILITY':
      return 'LIABILITY';
    case 'EQUITY':
    case 'INCOME':
    case 'OTHER_INCOME':
    case 'COGS':
    case 'EXPENSE':
    case 'OTHER_EXPENSE':
      return accountType;
  }
}
export type TransactionState = 'PENDING' | 'POSTED' | 'EXCLUDED' | 'MATCHED_TRANSFER';
export type CategorizationSource = 'TRANSFER' | 'RULE' | 'PRIOR_MATCH' | 'MANUAL' | 'CLEARED' | 'NONE';

export interface Money {
  readonly minorUnits: bigint;
  readonly currency: CurrencyCode;
}

export function money(minorUnits: bigint | number, currency: CurrencyCode = 'USD'): Money {
  return { minorUnits: BigInt(minorUnits), currency };
}

export function addMoney(left: Money, right: Money): Money {
  assertCurrency(left, right);
  return money(left.minorUnits + right.minorUnits, left.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.minorUnits, value.currency);
}

export function formatMoney(value: Money): string {
  const sign = value.minorUnits < 0n ? '-' : '';
  const absolute = value.minorUnits < 0n ? -value.minorUnits : value.minorUnits;
  const dollars = absolute / 100n;
  const cents = absolute % 100n;
  return `${sign}$${dollars.toString()}.${cents.toString().padStart(2, '0')}`;
}

function assertCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} and ${right.currency}`);
  }
}

export interface Company {
  id: Id;
  name: string;
  currency: CurrencyCode;
  fiscalYearStartMonth: number;
  accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  activeTaxYear: number;
}

export interface FinancialAccount {
  id: Id;
  type: AccountType;
  detailType: string;
  name: string;
  institutionOrEntity: string;
  lastFour?: string;
  parentAccountId?: Id;
  description?: string;
  openingBalance: Money;
  openingBalanceDate: string;
  archived: boolean;
  locked: boolean;
  calculatedBalance?: Money;
  unresolvedCount?: number;
}

export interface ChartAccount {
  id: Id;
  name: string;
  parentId?: Id;
  type: ChartAccountType;
  accountType: ChartAccountKind;
  detailType: string;
  description?: string;
  displayOrder: number;
  archived: boolean;
  locked: boolean;
}

export interface PostingSplit {
  id: Id;
  chartAccountId: Id;
  amount: Money;
  memo?: string;
}

export interface AuditEvent {
  id: Id;
  timestampUtc: string;
  operation: string;
  entityType: string;
  entityId: Id;
  before?: unknown;
  after?: unknown;
  reason?: string;
  correlationId?: Id;
}

export interface Transaction {
  id: Id;
  accountId: Id;
  postingDate: string;
  transactionDate?: string;
  amount: Money;
  rawDescription: string;
  description: string;
  rawPayee?: string;
  payee?: string;
  memo?: string;
  reference?: string;
  state: TransactionState;
  splits: PostingSplit[];
  sourceBatchId?: Id;
  sourceRowNumber?: number;
  categorizationSource: CategorizationSource;
  ruleId?: Id;
  rationale?: string;
  exclusionReason?: string;
  transferMatchId?: Id;
  createdAtUtc: string;
  modifiedAtUtc: string;
  postedAtUtc?: string;
  excludedAtUtc?: string;
  undoneAtUtc?: string;
}

export interface TaxYearSettings {
  taxYear: number;
  federalIncomeTaxAccountIds: Id[];
  stateLocalIncomeTaxAccountIds: Id[];
  includeFederalIncomeTax: boolean;
  includeStateLocalIncomeTax: boolean;
  confirmedAtUtc?: string;
  accountantNote?: string;
}

export interface RuleCondition {
  field: 'ACCOUNT' | 'DIRECTION' | 'DESCRIPTION' | 'PAYEE' | 'MEMO' | 'AMOUNT' | 'SOURCE_TYPE';
  operator: 'EQUALS' | 'CONTAINS' | 'STARTS_WITH' | 'RANGE';
  value: string;
  secondValue?: string;
  negate?: boolean;
}

export interface TransactionRule {
  id: Id;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  chartAccountId?: Id;
  payee?: string;
  memo?: string;
  tags?: string[];
  suggestExclude?: boolean;
  matchMode?: 'ALL' | 'ANY';
}

export interface RuleImportIssue {
  rowNumber: number;
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
}

export interface RuleImportPreview {
  previewToken: string;
  valid: boolean;
  rules: TransactionRule[];
  issues: RuleImportIssue[];
  importedCount: number;
  updatedCount: number;
  disabledCount: number;
}

export interface TransferMatch {
  id: Id;
  leftTransactionId: Id;
  rightTransactionId: Id;
  confidence: number;
  rationale: string;
  confirmedAtUtc: string;
}

export interface ImportRowDisposition {
  rowNumber: number;
  status: 'ACCEPTED' | 'REJECTED' | 'SKIPPED' | 'WARNING';
  code?: string;
  message?: string;
  transaction?: Omit<Transaction, 'id' | 'state' | 'splits' | 'createdAtUtc' | 'modifiedAtUtc'>;
}

export interface ImportBatch {
  id: Id;
  destinationAccountId: Id;
  sourceKind: 'CSV' | 'EXCEL' | 'QBO_OFX' | 'AMAZON';
  sourceName: string;
  sourceHash: string;
  mappingVersion: string;
  acceptedCount: number;
  rejectedCount: number;
  skippedCount: number;
  warningCount: number;
  totalAcceptedAmount: Money;
  committedAtUtc?: string;
}

export interface TransactionQuery {
  accountId?: Id;
  states?: TransactionState[];
  sourceBatchId?: Id;
  startDate?: string;
  endDate?: string;
  search?: string;
  minAmountMinor?: bigint;
  maxAmountMinor?: bigint;
  chartAccountId?: Id;
  sort?: 'DATE_ASC' | 'DATE_DESC' | 'AMOUNT_ASC' | 'AMOUNT_DESC';
  page?: number;
  pageSize?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportPreview {
  batch: ImportBatch;
  rows: ImportRowDisposition[];
  previewToken: string;
}

export function nowUtc(): string {
  return new Date().toISOString();
}

export function newId(): Id {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
