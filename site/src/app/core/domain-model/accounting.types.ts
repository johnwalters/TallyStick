export type Id = string;
export type CurrencyCode = 'USD' | (string & {});

export type AccountType = 'BANK' | 'CREDIT_CARD' | 'ENTITY';
export const FINANCIAL_ACCOUNT_TYPES: ReadonlyArray<{ value: AccountType; label: string; detailTypes: readonly string[] }> = [
  { value: 'BANK', label: 'Bank', detailTypes: ['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'] },
  { value: 'CREDIT_CARD', label: 'Credit Card', detailTypes: ['Credit Card'] },
  { value: 'ENTITY', label: 'Entity', detailTypes: ['Marketplace', 'Clearing account', 'Other transactions'] },
];
export type ChartAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'COGS' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE';
export type ChartAccountKind = 'BANK' | 'ACCOUNTS_RECEIVABLE' | 'OTHER_CURRENT_ASSET' | 'FIXED_ASSET' | 'OTHER_ASSET'
  | 'CREDIT_CARD' | 'ACCOUNTS_PAYABLE' | 'OTHER_CURRENT_LIABILITY' | 'LONG_TERM_LIABILITY'
  | 'EQUITY' | 'INCOME' | 'OTHER_INCOME' | 'COGS' | 'EXPENSE' | 'OTHER_EXPENSE';

export const CHART_ACCOUNT_TYPES: ReadonlyArray<{ value: ChartAccountKind; label: string; reportingType: ChartAccountType; detailTypes: readonly string[] }> = [
  { value: 'BANK', label: 'Bank', reportingType: 'ASSET', detailTypes: ['Checking', 'Savings', 'Cash on hand'] },
  { value: 'ACCOUNTS_RECEIVABLE', label: 'Accounts receivable (A/R)', reportingType: 'ASSET', detailTypes: ['Accounts receivable'] },
  { value: 'OTHER_CURRENT_ASSET', label: 'Other Current Assets', reportingType: 'ASSET', detailTypes: ['Inventory', 'Prepaid expenses', 'Other current assets'] },
  { value: 'FIXED_ASSET', label: 'Fixed Assets', reportingType: 'ASSET', detailTypes: ['Furniture and fixtures', 'Machinery and equipment', 'Vehicles', 'Other fixed assets'] },
  { value: 'OTHER_ASSET', label: 'Other Assets', reportingType: 'ASSET', detailTypes: ['Goodwill', 'Security deposits', 'Other long-term assets'] },
  { value: 'CREDIT_CARD', label: 'Credit Card', reportingType: 'LIABILITY', detailTypes: ['Credit card'] },
  { value: 'ACCOUNTS_PAYABLE', label: 'Accounts payable (A/P)', reportingType: 'LIABILITY', detailTypes: ['Accounts payable'] },
  { value: 'OTHER_CURRENT_LIABILITY', label: 'Other Current Liabilities', reportingType: 'LIABILITY', detailTypes: ['Loan payable', 'Payroll liabilities', 'Sales tax payable', 'Other current liabilities'] },
  { value: 'LONG_TERM_LIABILITY', label: 'Long Term Liabilities', reportingType: 'LIABILITY', detailTypes: ['Notes payable', 'Shareholder notes payable', 'Other long-term liabilities'] },
  { value: 'EQUITY', label: 'Equity', reportingType: 'EQUITY', detailTypes: ['Owner equity', 'Owner draw', 'Retained earnings'] },
  { value: 'INCOME', label: 'Income', reportingType: 'INCOME', detailTypes: ['Sales of product income', 'Service income', 'Other primary income'] },
  { value: 'OTHER_INCOME', label: 'Other Income', reportingType: 'OTHER_INCOME', detailTypes: ['Interest earned', 'Other investment income', 'Other miscellaneous income'] },
  { value: 'COGS', label: 'Cost of Goods Sold', reportingType: 'COGS', detailTypes: ['Cost of labor', 'Shipping, freight and delivery', 'Supplies and materials', 'Other costs of goods sold'] },
  { value: 'EXPENSE', label: 'Expenses', reportingType: 'EXPENSE', detailTypes: ['Advertising', 'Bank charges', 'Insurance', 'Office expenses', 'Other business expenses'] },
  { value: 'OTHER_EXPENSE', label: 'Other Expense', reportingType: 'OTHER_EXPENSE', detailTypes: ['Depreciation', 'Penalties and settlements', 'Other miscellaneous expense'] },
];
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
