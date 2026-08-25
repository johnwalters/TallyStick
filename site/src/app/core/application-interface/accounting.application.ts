import { InjectionToken } from '@angular/core';
import {
  ChartAccount,
  ChartAccountKind,
  Company,
  FinancialAccount,
  ImportPreview,
  RuleImportPreview,
  TaxYearSettings,
  Transaction,
  TransactionPage,
  TransactionQuery,
  TransactionRule,
  TransferMatch,
} from '../domain-model/accounting.types';
import {
  BalanceSheetDetail,
  BalanceSheetExportResult,
  BalanceSheetPrintPreviewResult,
  BalanceSheetQuery,
  BalanceSheetReport,
  CompanyProfile,
  ExportBalanceSheetCommand,
  GetAccountTypeCatalogResult,
  GetBalanceSheetDetailCommand,
  OpenBalanceSheetPrintPreviewCommand,
  PreviewAccountPlacementCommand,
  PreviewAccountPlacementResult,
  RevealCompanyTaxIdentifierResult,
  UpdateCompanyProfileCommand,
  SaveGenericAccountInput,
  SaveGenericAccountResult,
  ValidateGenericAccountResult,
} from '../domain-model/balance-sheet.types';
import {
  CashFlowClassificationCatalog,
  CashFlowClassificationExportResult,
  CashFlowClassificationImportCommitResult,
  CashFlowClassificationImportPreview,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowDetail,
  CashFlowExportResult,
  CashFlowQuery,
  CashFlowReport,
  CommitCashFlowClassificationImportCommand,
  CashFlowPrintPreviewResult,
  ExportCashFlowCommand,
  ExportCashFlowClassificationsCommand,
  GetCashFlowDetailCommand,
  OpenCashFlowPrintPreviewCommand,
  PreviewCashFlowClassificationCommand,
  PreviewCashFlowClassificationImportCommand,
  SaveCashFlowClassificationCommand,
} from '../domain-model/cash-flow.types';

export interface SaveAccountCommand {
  type: FinancialAccount['type'];
  detailType?: string;
  name: string;
  institutionOrEntity: string;
  lastFour?: string;
  parentAccountId?: string;
  description?: string;
  openingBalanceMinor: bigint;
  openingBalanceDate: string;
  locked?: boolean;
}

export type CreateAccountCommand = SaveAccountCommand;

export interface SaveChartAccountCommand {
  name: string;
  accountType: ChartAccountKind;
  detailType: string;
  parentId?: string;
  description?: string;
  displayOrder: number;
  locked: boolean;
}

export interface ImportSourceInput {
  fileName: string;
  content: string | ArrayBuffer;
  kind: 'CSV' | 'EXCEL' | 'QBO_OFX' | 'AMAZON';
  destinationAccountId: string;
}

export interface DatabaseLocations {
  currentDatabasePath: string;
  backupDirectory?: string;
  latestVerifiedBackupPath?: string;
  latestVerifiedBackupAtUtc?: string;
  backupTimeZone?: string;
  desktopAvailable: boolean;
}

export interface DatabaseFileOperationResult {
  operation: 'BACKUP' | 'RELOCATE' | 'RESTORE';
  path: string;
  completedAtUtc: string;
  safetyBackupPath?: string;
  restartRequired: boolean;
}

export interface AccountingApplication {
  getCompany(): Company;
  getCompanyProfile(): CompanyProfile;
  updateCompanyProfile(command: UpdateCompanyProfileCommand): CompanyProfile;
  revealCompanyTaxIdentifier(): RevealCompanyTaxIdentifierResult;
  getAccountTypeCatalog(): GetAccountTypeCatalogResult;
  validateGenericAccount(command: SaveGenericAccountInput): ValidateGenericAccountResult;
  saveGenericAccount(command: SaveGenericAccountInput): SaveGenericAccountResult;
  deleteGenericAccount(accountId: string, role: 'FINANCIAL_SOURCE' | 'CHART'): void;
  previewAccountPlacement(command: PreviewAccountPlacementCommand): PreviewAccountPlacementResult;
  getBalanceSheet(query: BalanceSheetQuery): BalanceSheetReport;
  getBalanceSheetDetail(command: GetBalanceSheetDetailCommand): BalanceSheetDetail;
  exportBalanceSheet(command: ExportBalanceSheetCommand): Promise<BalanceSheetExportResult>;
  openBalanceSheetPrintPreview(command: OpenBalanceSheetPrintPreviewCommand): Promise<BalanceSheetPrintPreviewResult>;
  getCashFlowClassificationCatalog(): CashFlowClassificationCatalog;
  previewCashFlowClassification(command: PreviewCashFlowClassificationCommand): CashFlowClassificationPreview;
  saveCashFlowClassification(command: SaveCashFlowClassificationCommand): CashFlowClassificationReview;
  getCashFlowClassificationReview(query: CashFlowQuery): CashFlowClassificationReview;
  getCashFlowReport(query: CashFlowQuery): CashFlowReport;
  getCashFlowDetail(command: GetCashFlowDetailCommand): CashFlowDetail;
  exportCashFlow(command: ExportCashFlowCommand): Promise<CashFlowExportResult>;
  openCashFlowPrintPreview(command: OpenCashFlowPrintPreviewCommand): Promise<CashFlowPrintPreviewResult>;
  previewCashFlowClassificationImport(command: PreviewCashFlowClassificationImportCommand): CashFlowClassificationImportPreview;
  commitCashFlowClassificationImport(command: CommitCashFlowClassificationImportCommand): CashFlowClassificationImportCommitResult;
  exportCashFlowClassifications(command: ExportCashFlowClassificationsCommand): CashFlowClassificationExportResult;
  listAccounts(): FinancialAccount[];
  createAccount(command: CreateAccountCommand): FinancialAccount;
  getAccount(id: string): FinancialAccount | undefined;
  updateAccount(id: string, command: SaveAccountCommand): FinancialAccount;
  archiveAccount(id: string, archived: boolean): FinancialAccount;
  listChartAccounts(): ChartAccount[];
  createChartAccount(command: SaveChartAccountCommand): ChartAccount;
  updateChartAccount(id: string, command: SaveChartAccountCommand): ChartAccount;
  archiveChartAccount(id: string, archived: boolean): ChartAccount;
  importChartAccounts(content: string | ArrayBuffer): ChartAccount[];
  exportChartAccounts(): ArrayBuffer;
  exportRules(format: 'XLSX' | 'CSV'): ArrayBuffer | string;
  previewRulesImport(content: string | ArrayBuffer): RuleImportPreview;
  commitRulesImport(previewToken: string): TransactionRule[];
  importRulesWorkbook(content: string | ArrayBuffer): TransactionRule[];
  listRules(): TransactionRule[];
  importRules(rules: TransactionRule[]): TransactionRule[];
  saveRule(rule: TransactionRule): TransactionRule;
  setRuleEnabled(id: string, enabled: boolean): TransactionRule;
  duplicateRule(id: string): TransactionRule;
  deleteRule(id: string): void;
  reorderRule(id: string, priority: number): TransactionRule;
  createRuleDraftFromTransaction(transactionId: string, chartAccountId?: string): TransactionRule;
  createRuleFromTransaction(transactionId: string, chartAccountId: string, name?: string): TransactionRule;
  testRule(rule: TransactionRule, transactionIds?: string[]): Array<{ transactionId: string; matched: boolean; rationale: string }>;
  suggestTransaction(id: string): TransactionSuggestion;
  acceptSuggestion(id: string): Transaction;
  listTransactions(query: TransactionQuery): TransactionPage;
  getTransaction(id: string): Transaction | undefined;
  getTransactionDetail(id: string): TransactionDetail;
  updateTransaction(id: string, patch: Partial<Pick<Transaction, 'postingDate' | 'payee' | 'memo' | 'reference' | 'description'>> & { expectedModifiedAtUtc?: string }): Transaction;
  categorize(id: string, chartAccountId: string, rationale?: string): Transaction;
  categorizeMany(ids: string[], chartAccountId: string, rationale?: string): Transaction[];
  clearCategorization(id: string, rationale?: string): Transaction;
  split(id: string, splits: Array<{ chartAccountId: string; amountMinor: bigint; memo?: string }>): Transaction;
  correctAmount(id: string, amountMinor: bigint, rationale: string, expectedModifiedAtUtc?: string): Transaction;
  post(ids: string[]): Transaction[];
  postWithCategory(id: string, chartAccountId: string): Transaction;
  postWithCategories(items: Array<{ id: string; chartAccountId: string }>): Transaction[];
  exclude(ids: string[], reason: string): Transaction[];
  deleteExcluded(ids: string[]): void;
  undo(ids: string[]): Transaction[];
  findTransferCandidates(id: string, dateWindowDays?: number): Array<{ transaction: Transaction; confidence: number; rationale: string }>;
  confirmTransfer(leftId: string, rightId: string): TransferMatch;
  unmatchTransfer(matchId: string): void;
  getProfitLoss(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds?: string[]): ProfitLossReport;
  getScheduleCReadyReport(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds?: string[]): ScheduleCReadyReport;
  getReportDetail(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds?: string[]): ReportDetailRow[];
  getProfitLossDrilldown(query: ReportDrilldownQuery): ReportDetailRow[];
  getExceptions(startDate: string, endDate: string): ExceptionItem[];
  getReconciliation(accountId: string, startDate: string, endDate: string, statementEndingBalanceMinor?: bigint): ReconciliationReport;
  exportAccountantPackage(startDate: string, endDate: string): string;
  getTaxYearSettings(taxYear: number): TaxYearSettings;
  saveTaxYearSettings(settings: TaxYearSettings): void;
  previewImport(source: ImportSourceInput): ImportPreview;
  commitImport(previewToken: string): ImportPreview;
  exportAllData(): string;
  importAllData(payload: string): void;
  createBackupBundle(): string;
  verifyBackupBundle(bundle: string): { valid: boolean; reason?: string };
  validateBackupBundle(bundle: string): BackupValidationReport;
  restoreBackupBundle(bundle: string): void;
  getDatabaseLocations(): Promise<DatabaseLocations>;
  chooseBackupDirectory(): Promise<DatabaseLocations | undefined>;
  backupDatabaseNow(): Promise<DatabaseFileOperationResult>;
  relocateCurrentDatabase(): Promise<DatabaseFileOperationResult | undefined>;
  restoreDatabaseBackup(): Promise<DatabaseFileOperationResult | undefined>;
  exportReportCsv(report: ProfitLossReport, disclosure?: ReportExportDisclosure): string;
  exportReportXlsx(report: ProfitLossReport, disclosure?: ReportExportDisclosure): ArrayBuffer;
  exportReportPrintHtml(report: ProfitLossReport, disclosure?: ReportExportDisclosure): string;
  exportReportDetailCsv(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds?: string[]): string;
  exportReportDetailXlsx(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds?: string[]): ArrayBuffer;
  exportProfitLossDrilldownCsv(query: ReportDrilldownQuery): string;
  exportProfitLossDrilldownXlsx(query: ReportDrilldownQuery): ArrayBuffer;
}

export interface TransactionSuggestion {
  source: 'TRANSFER' | 'RULE' | 'PRIOR_MATCH' | 'NONE';
  confidence: number;
  rationale: string;
  chartAccountId?: string;
  ruleId?: string;
  transferCandidateId?: string;
  payee?: string;
  memo?: string;
  tags?: string[];
  suggestExclude?: boolean;
}

export interface TransactionDetail {
  transaction: Transaction;
  suggestion: TransactionSuggestion;
  audit: Array<{ id: string; timestampUtc: string; operation: string; reason?: string }>;
}

export interface ProfitLossCell {
  key: string;
  label: string;
  values: Record<string, bigint>;
  totalMinor: bigint;
  children: ProfitLossCell[];
  directValues?: Record<string, bigint>;
  directTotalMinor?: bigint;
}

export interface ProfitLossReport {
  startDate: string;
  endDate: string;
  grouping: 'MONTH' | 'YEAR';
  periods: string[];
  sections: ProfitLossCell[];
  netProfitMinor: bigint;
  reconciliationDifferenceMinor: bigint;
}

export interface ScheduleCReadyReport extends ProfitLossReport {
  taxYear: number;
  includeFederalIncomeTax: boolean;
  includeStateLocalIncomeTax: boolean;
  removedFederalMinor: bigint;
  removedStateLocalMinor: bigint;
  removedTotalMinor: bigint;
}

export interface ReportDetailRow {
  transactionId: string;
  accountId: string;
  postingDate: string;
  description?: string;
  payee?: string;
  memo?: string;
  chartAccountId: string;
  amountMinor: bigint;
  reportContributionMinor: bigint;
  sourceBatchId?: string;
}

export type ProfitLossSectionKey = 'INCOME' | 'COGS' | 'GROSS_PROFIT' | 'EXPENSES' | 'OTHER_INCOME' | 'OTHER_EXPENSE' | 'NET_PROFIT' | 'TAX_REMOVED';

export interface ReportDrilldownQuery {
  startDate: string;
  endDate: string;
  grouping: 'MONTH' | 'YEAR';
  period?: string;
  sectionKey?: ProfitLossSectionKey;
  chartAccountId?: string;
  categoryIds?: string[];
  excludedChartAccountIds?: string[];
  accountId?: string;
  search?: string;
}

export interface ReportExportDisclosure {
  taxYear: number;
  includeFederalIncomeTax: boolean;
  includeStateLocalIncomeTax: boolean;
  removedTaxMinor: bigint;
  configuredTaxAccounts: string[];
}

export interface ExceptionItem {
  transactionId?: string;
  batchId?: string;
  kind: 'PENDING' | 'UNRESOLVED' | 'PARSE_WARNING' | 'EDITED_AFTER_POSTING';
  message: string;
}

export interface ReconciliationReport {
  accountId: string;
  startDate: string;
  endDate: string;
  openingBalanceMinor: bigint;
  postedActivityMinor: bigint;
  matchedTransferActivityMinor: bigint;
  calculatedEndingBalanceMinor: bigint;
  statementEndingBalanceMinor?: bigint;
  differenceMinor?: bigint;
}

export interface BackupValidationReport {
  valid: boolean;
  reason?: string;
  companyId?: string;
  recordCounts?: Record<string, number>;
}

export const ACCOUNTING_APPLICATION = new InjectionToken<AccountingApplication>('AccountingApplication');
