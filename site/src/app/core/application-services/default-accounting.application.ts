import { Injectable, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import {
  AccountingApplication,
  BackupValidationReport,
  CreateAccountCommand,
  SaveAccountCommand,
  SaveChartAccountCommand,
  ImportSourceInput,
  ProfitLossCell,
  ProfitLossReport,
  ProfitLossSectionKey,
  ReportDrilldownQuery,
  ScheduleCReadyReport,
  ExceptionItem,
  ReconciliationReport,
  ReportDetailRow,
  ReportExportDisclosure,
  TransactionDetail,
  TransactionSuggestion,
} from '../application-interface/accounting.application';
import {
  BalanceSheetDetail,
  BalanceSheetContractError,
  BalanceSheetExportResult,
  BalanceSheetPrintPreviewResult,
  BalanceSheetQuery,
  BalanceSheetReport,
  CompanyProfile,
  ExportBalanceSheetCommand,
  GetBalanceSheetDetailCommand,
  OpenBalanceSheetPrintPreviewCommand,
  PreviewAccountPlacementCommand,
  PreviewAccountPlacementResult,
  RevealCompanyTaxIdentifierResult,
  UpdateCompanyProfileCommand,
} from '../domain-model/balance-sheet.types';
import {
  ACCOUNT_TYPE_CATALOG,
  validateAccountUse,
} from '../domain-model/account-taxonomy';
import {
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_SECTIONS,
  CASH_FLOW_TREATMENTS,
  CashFlowClassificationCatalog,
  CashFlowClassificationCompatibility,
  CashFlowClassificationDefault,
  CashFlowClassificationExportResult,
  CashFlowClassificationImportCommitResult,
  CashFlowClassificationImportPreview,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowContractError,
  CashFlowDetail,
  CashFlowExportResult,
  CashFlowPrintPreviewResult,
  CashFlowQuery,
  CashFlowQueryInput,
  CashFlowReport,
  CommitCashFlowClassificationImportCommand,
  ExportCashFlowClassificationsCommand,
  ExportCashFlowCommand,
  GetCashFlowDetailCommand,
  OpenCashFlowPrintPreviewCommand,
  PreviewCashFlowClassificationCommand,
  PreviewCashFlowClassificationImportCommand,
  SaveCashFlowClassificationCommand,
} from '../domain-model/cash-flow.types';
import { getCashFlowPermittedTreatments, seedDefaultCashFlowClassification, validateCashFlowClassification, CashFlowClassification } from '../domain-model/cash-flow-classification';
import { DATABASE_LIFECYCLE_GATEWAY } from '../database-lifecycle/database-lifecycle.gateway';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { BackupBundleService, CURRENT_BACKUP_SCHEMA_VERSION } from '../backup-services/backup-bundle.service';
import { CompanyProfileService } from './company-profile.service';
import { AccountClassificationService } from './account-classification.service';
import { CashFlowClassificationService } from './cash-flow-classification.service';
import { BalanceSheetReportService } from './balance-sheet-report.service';
import { CashFlowReportService } from './cash-flow-report.service';
import { calculateUnadjustedNetProfit } from './profit-loss-calculation';
import { BalanceSheetOutputService } from './balance-sheet-output.service';
import { ACCOUNTING_REPOSITORY, AccountingRepository, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import {
  addMoney,
  AuditEvent,
  CHART_ACCOUNT_TYPES,
  ChartAccount,
  ChartAccountKind,
  ChartAccountImportIssue,
  ChartAccountImportPreview,
  FinancialAccount,
  FINANCIAL_ACCOUNT_TYPES,
  formatMoney,
  ImportPreview,
  RuleImportIssue,
  RuleImportPreview,
  money,
  newId,
  nowUtc,
  PostingSplit,
  RuleCondition,
  TaxYearSettings,
  Transaction,
  TransactionPage,
  TransactionQuery,
  TransactionRule,
  TransferMatch,
} from '../domain-model/accounting.types';

interface PendingChartAccountImport {
  readonly databaseRevision: string;
  readonly rows: readonly ChartAccount[];
  readonly classifications: ReadonlyMap<string, CashFlowClassification>;
  readonly issues: readonly ChartAccountImportIssue[];
}

export const DEFAULT_OWNER_DRAW_ACCOUNT_ID = 'chart-owner-draw';
export const DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID = 'chart-advertising-marketing';
export const DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID = 'chart-office-expenses';
export const DEFAULT_SOFTWARE_APPS_ACCOUNT_ID = 'chart-software-apps';
export const DEFAULT_INTEREST_PAID_ACCOUNT_ID = 'chart-interest-paid';

function buildCashFlowCatalog(): CashFlowClassificationCatalog {
  const definitions = ACCOUNT_TYPE_CATALOG.map(definition => ({
    definition,
    roles: ['ASSET', 'LIABILITY'].includes(definition.reportingGroup) ? ['FINANCIAL_SOURCE', 'CHART'] as const : ['CHART'] as const,
  }));
  const compatibility: CashFlowClassificationCompatibility[] = definitions.flatMap(({ definition, roles }) => roles.map(accountRole => {
    const permitted = getCashFlowPermittedTreatments({
      accountRole,
      accountType: definition.accountType,
      detailType: definition.detailTypes[0].value,
    });
    return {
      accountRole,
      accountType: definition.accountType,
      permittedCashRoles: accountRole === 'FINANCIAL_SOURCE' ? [...CASH_FLOW_CASH_ROLES] : [],
      permittedTreatments: permitted.ok ? [...permitted.value] : ['REVIEW_REQUIRED'],
    };
  }));
  const defaults: CashFlowClassificationDefault[] = definitions.flatMap(({ definition, roles }) => roles.flatMap(accountRole => definition.detailTypes.map(detail => {
    const seeded = seedDefaultCashFlowClassification({ accountRole, accountType: definition.accountType, detailType: detail.value });
    return seeded.ok ? {
      accountRole,
      accountType: definition.accountType,
      detailType: detail.value,
      classification: seeded.value,
    } : undefined;
  }).filter((value): value is CashFlowClassificationDefault => value !== undefined)));

  return Object.freeze({
    cashRoles: Object.freeze([...CASH_FLOW_CASH_ROLES]),
    treatments: Object.freeze([...CASH_FLOW_TREATMENTS]),
    sections: Object.freeze([...CASH_FLOW_SECTIONS]),
    statuses: Object.freeze([...CASH_FLOW_CLASSIFICATION_STATUSES]),
    sources: Object.freeze([...CASH_FLOW_CLASSIFICATION_SOURCES]),
    compatibility: Object.freeze(compatibility.map(entry => Object.freeze({
      ...entry,
      permittedCashRoles: Object.freeze([...entry.permittedCashRoles]),
      permittedTreatments: Object.freeze([...entry.permittedTreatments]),
    }))),
    labels: Object.freeze({
      cashRoles: Object.freeze({
        CASH: 'Cash',
        CASH_EQUIVALENT: 'Cash equivalent',
        RESTRICTED_CASH: 'Restricted cash',
        NOT_CASH: 'Not cash',
        REVIEW_REQUIRED: 'Review required',
      }),
      treatments: Object.freeze({
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
      }),
      sections: Object.freeze({
        OPERATING: 'Operating',
        INVESTING: 'Investing',
        FINANCING: 'Financing',
        CASH_RECONCILIATION: 'Cash reconciliation',
        NONCASH_DISCLOSURE: 'Noncash disclosure',
      }),
    }),
    defaults: Object.freeze(defaults.map(entry => Object.freeze({
      ...entry,
      classification: Object.freeze({ ...entry.classification }),
    }))),
    method: 'INDIRECT' as const,
  });
}

const CASH_FLOW_CATALOG = buildCashFlowCatalog();

@Injectable()
export class DefaultAccountingApplication implements AccountingApplication {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;
  private readonly importer = inject(ImportPipelineService);
  private readonly backupBundles = inject(BackupBundleService);
  private readonly databaseLifecycle = inject(DATABASE_LIFECYCLE_GATEWAY);
  private readonly companyProfiles = inject(CompanyProfileService);
  private readonly accountClassifications = inject(AccountClassificationService);
  private readonly cashFlowClassifications = inject(CashFlowClassificationService);
  private readonly balanceSheets = inject(BalanceSheetReportService);
  private readonly cashFlowReports = inject(CashFlowReportService);
  private readonly balanceSheetOutputs = inject(BalanceSheetOutputService);
  private readonly previews = new Map<string, ImportPreview>();
  private readonly rulePreviews = new Map<string, RuleImportPreview>();
  private readonly chartAccountPreviews = new Map<string, PendingChartAccountImport>();

  constructor() {
    this.seed();
  }

  getCompany() {
    return structuredClone(this.repository.company);
  }

  getCompanyProfile(): CompanyProfile {
    return this.companyProfiles.getCompanyProfile();
  }

  updateCompanyProfile(command: UpdateCompanyProfileCommand): CompanyProfile {
    return this.companyProfiles.updateCompanyProfile(command);
  }

  revealCompanyTaxIdentifier(): RevealCompanyTaxIdentifierResult {
    return this.companyProfiles.revealCompanyTaxIdentifier();
  }

  getAccountTypeCatalog() {
    return this.accountClassifications.getCatalog();
  }

  validateGenericAccount(command: import('../domain-model/balance-sheet.types').SaveGenericAccountInput) {
    return this.accountClassifications.validate(command);
  }

  saveGenericAccount(command: import('../domain-model/balance-sheet.types').SaveGenericAccountInput) {
    return this.accountClassifications.save(command);
  }

  deleteGenericAccount(accountId: string, role: import('../domain-model/account-taxonomy').AccountRole): void {
    this.accountClassifications.delete(accountId, role);
  }

  previewAccountPlacement(command: PreviewAccountPlacementCommand): PreviewAccountPlacementResult {
    return this.accountClassifications.preview(command);
  }

  getBalanceSheet(query: BalanceSheetQuery): BalanceSheetReport {
    return this.balanceSheets.getBalanceSheet(query);
  }

  getBalanceSheetDetail(command: GetBalanceSheetDetailCommand): BalanceSheetDetail {
    return this.balanceSheets.getBalanceSheetDetail(command);
  }

  async exportBalanceSheet(command: ExportBalanceSheetCommand): Promise<BalanceSheetExportResult> {
    return this.balanceSheetOutputs.export(command);
  }

  async openBalanceSheetPrintPreview(command: OpenBalanceSheetPrintPreviewCommand): Promise<BalanceSheetPrintPreviewResult> {
    return this.balanceSheetOutputs.openPrintPreview(command.report);
  }

  getCashFlowClassificationCatalog(): CashFlowClassificationCatalog {
    return CASH_FLOW_CATALOG;
  }

  previewCashFlowClassification(command: PreviewCashFlowClassificationCommand): CashFlowClassificationPreview {
    return this.cashFlowClassifications.preview(command);
  }

  saveCashFlowClassification(command: SaveCashFlowClassificationCommand): CashFlowClassificationReview {
    return this.cashFlowClassifications.save(command);
  }

  getCashFlowClassificationReview(query: CashFlowQuery): CashFlowClassificationReview {
    return this.cashFlowClassifications.review(query);
  }

  getCashFlowReport(query: CashFlowQueryInput): CashFlowReport {
    return this.cashFlowReports.getCashFlowReport(query);
  }

  getCashFlowDetail(command: GetCashFlowDetailCommand): CashFlowDetail {
    return this.cashFlowReports.getCashFlowDetail(command);
  }

  async exportCashFlow(command: ExportCashFlowCommand): Promise<CashFlowExportResult> {
    this.cashFlowReports.assertCashFlowReportCurrent(command);
    return this.cashFlowNotImplemented(`Export Cash Flow report ${command.reportId} as ${command.format}`);
  }

  async openCashFlowPrintPreview(command: OpenCashFlowPrintPreviewCommand): Promise<CashFlowPrintPreviewResult> {
    this.cashFlowReports.assertCashFlowReportCurrent(command);
    return this.cashFlowNotImplemented(`Open Cash Flow print preview ${command.reportId}`);
  }

  previewCashFlowClassificationImport(command: PreviewCashFlowClassificationImportCommand): CashFlowClassificationImportPreview {
    return this.cashFlowClassifications.previewImport(command);
  }

  commitCashFlowClassificationImport(command: CommitCashFlowClassificationImportCommand): CashFlowClassificationImportCommitResult {
    return this.cashFlowClassifications.commitImport(command);
  }

  exportCashFlowClassifications(command: ExportCashFlowClassificationsCommand): CashFlowClassificationExportResult {
    return this.cashFlowClassifications.exportClassifications(command);
  }

  listAccounts(): FinancialAccount[] {
    return [...this.repository.accounts.values()].map(account => structuredClone({
      ...account,
      calculatedBalance: this.calculateAccountBalance(account.id),
      unresolvedCount: [...this.repository.transactions.values()].filter(transaction => transaction.accountId === account.id && transaction.state === 'PENDING').length,
    }));
  }

  getAccount(id: string): FinancialAccount | undefined {
    const account = this.repository.accounts.get(id);
    if (!account) return undefined;
    return structuredClone({
      ...account,
      calculatedBalance: this.calculateAccountBalance(account.id),
      unresolvedCount: [...this.repository.transactions.values()].filter(transaction => transaction.accountId === account.id && transaction.state === 'PENDING').length,
    });
  }

  createAccount(command: CreateAccountCommand): FinancialAccount {
    return this.repository.transaction(() => {
      const account = this.buildFinancialAccount(newId(), command, false);
      this.validateFinancialAccounts([...this.repository.accounts.values(), account]);
      this.repository.accounts.set(account.id, account);
      this.record('CREATE_ACCOUNT', 'FinancialAccount', account.id, undefined, account);
      return structuredClone(account);
    });
  }

  updateAccount(id: string, command: SaveAccountCommand): FinancialAccount {
    return this.repository.transaction(() => {
      const existing = this.repository.accounts.get(id);
      if (!existing) throw new AccountingError('ACCOUNT_NOT_FOUND', `Account not found: ${id}`);
      const before = structuredClone(existing);
      const updated = this.buildFinancialAccount(id, command, existing.archived);
      this.validateFinancialAccounts([...this.repository.accounts.values()].map(account => account.id === id ? updated : account));
      this.repository.accounts.set(id, updated);
      const classification = this.repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${id}`);
      if (classification?.accountType !== updated.accountType || classification?.detailType !== updated.detailType) {
        this.reclassifyCashFlowAfterStructureChange('FINANCIAL_SOURCE', id, updated.accountType, updated.detailType);
      }
      this.record('UPDATE_ACCOUNT', 'FinancialAccount', id, before, updated);
      return structuredClone(updated);
    });
  }

  archiveAccount(id: string, archived: boolean): FinancialAccount {
    return this.repository.transaction(() => {
      const account = this.repository.accounts.get(id);
      if (!account) throw new AccountingError('ACCOUNT_NOT_FOUND', `Account not found: ${id}`);
      if (archived && account.locked) throw new AccountingError('ACCOUNT_LOCKED', `Locked account cannot be archived: ${account.name}`);
      const before = structuredClone(account);
      const updated = { ...account, archived };
      this.validateFinancialAccounts([...this.repository.accounts.values()].map(item => item.id === id ? updated : item));
      this.repository.accounts.set(id, updated);
      this.record(archived ? 'ARCHIVE_ACCOUNT' : 'RESTORE_ACCOUNT', 'FinancialAccount', id, before, updated);
      return structuredClone(updated);
    });
  }

  listChartAccounts(): ChartAccount[] {
    return [...this.repository.chartAccounts.values()].sort((a, b) => a.displayOrder - b.displayOrder).map(account => structuredClone(account));
  }

  createChartAccount(command: SaveChartAccountCommand): ChartAccount {
    return this.repository.transaction(() => {
      const account = this.buildChartAccount(newId(), command, false);
      this.validateChartRows([...this.repository.chartAccounts.values(), account]);
      this.repository.chartAccounts.set(account.id, account);
      this.record('CREATE_CHART_ACCOUNT', 'ChartAccount', account.id, undefined, account);
      return structuredClone(account);
    });
  }

  updateChartAccount(id: string, command: SaveChartAccountCommand): ChartAccount {
    return this.repository.transaction(() => {
      const current = this.requireChartAccount(id);
      const before = structuredClone(current);
      const updated = this.buildChartAccount(id, command, current.archived);
      const priorPrefix = `${current.name}:`;
      const nextPrefix = `${updated.name}:`;
      const rows = [...this.repository.chartAccounts.values()].map(account => {
        if (account.id === id) return updated;
        if (account.name.startsWith(priorPrefix)) return { ...account, name: `${nextPrefix}${account.name.slice(priorPrefix.length)}` };
        return structuredClone(account);
      });
      this.validateChartRows(rows);
      this.repository.chartAccounts = new Map(rows.map(account => [account.id, account]));
      const classification = this.repository.cashFlowClassifications.get(`CHART:${id}`);
      if (classification?.accountType !== updated.accountType || classification?.detailType !== updated.detailType) {
        this.reclassifyCashFlowAfterStructureChange('CHART', id, updated.accountType, updated.detailType);
      }
      this.record('UPDATE_CHART_ACCOUNT', 'ChartAccount', id, before, updated);
      return structuredClone(updated);
    });
  }

  archiveChartAccount(id: string, archived: boolean): ChartAccount {
    return this.repository.transaction(() => {
      const account = this.requireChartAccount(id);
      if (account.locked && archived) throw new AccountingError('CHART_ACCOUNT_LOCKED', 'Unlock this account before archiving it.');
      if (archived && [...this.repository.chartAccounts.values()].some(candidate => candidate.parentId === id && !candidate.archived)) {
        throw new AccountingError('CHART_ACTIVE_CHILDREN', 'Archive or move active subaccounts before archiving their parent.');
      }
      const before = structuredClone(account);
      account.archived = archived;
      this.record(archived ? 'ARCHIVE_CHART_ACCOUNT' : 'RESTORE_CHART_ACCOUNT', 'ChartAccount', id, before, account);
      return structuredClone(account);
    });
  }

  importChartAccounts(content: string | ArrayBuffer): ChartAccount[] {
    const preview = this.previewChartAccountsImport(content);
    if (preview.issues.length) {
      this.chartAccountPreviews.delete(preview.previewToken);
      throw new AccountingError('CHART_INVALID', preview.issues[0].message);
    }
    return this.commitChartAccountsImport(preview.previewToken);
  }

  previewChartAccountsImport(content: string | ArrayBuffer): ChartAccountImportPreview {
    const workbook = XLSX.read(typeof content === 'string' ? content : new Uint8Array(content), { type: typeof content === 'string' ? 'string' : 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean>>(sheet, { defval: '' });
    const rows: ChartAccount[] = rawRows.map((sourceRow, index) => {
      const row = this.normalizeWorkbookRow(sourceRow);
      const name = String(row['name'] || row['Name'] || row['Account Name'] || row['Account name'] || '').trim();
      const parentName = name.includes(':') ? name.slice(0, name.lastIndexOf(':')) : '';
      const parentPath = String(row['parentName'] || row['Parent Account'] || row['Parent account'] || parentName).trim();
      const sourceAccountType = String(row['accountType'] || row['Account Type'] || row['Account type'] || row['type'] || row['Type'] || 'Expenses').trim();
      const accountType = this.mapChartAccountKind(sourceAccountType);
      const definition = this.chartAccountDefinition(accountType);
      const sourceReportingType = String(row['Reporting Classification'] || row['Reporting classification'] || '').trim();
      return {
        id: String(row['id'] || row['ID'] || row['Account ID'] || this.chartId(name)),
        name,
        ...(String(row['parentId'] || row['Parent ID'] || '').trim() || parentPath
          ? { parentId: String(row['parentId'] || row['Parent ID'] || '').trim() || this.chartId(parentPath) }
          : {}),
        type: sourceReportingType ? this.mapChartType(sourceReportingType) : definition.reportingType,
        accountType,
        detailType: String(row['detailType'] || row['Detail Type'] || row['Detail type'] || definition.detailTypes[0]).trim(),
        ...(String(row['description'] || row['Description'] || '').trim()
          ? { description: String(row['description'] || row['Description']).trim() }
          : {}),
        displayOrder: Number(row['displayOrder'] || row['Display Order'] || index),
        archived: this.workbookBoolean(row['archived'] ?? row['Archived']),
        locked: this.workbookBoolean(row['locked'] ?? row['Locked']),
      };
    });
    const issues: ChartAccountImportIssue[] = [];
    try {
      this.validateChartRows(rows);
      this.validateChartImportReferences(rows);
    } catch (error) {
      issues.push({ rowNumber: 0, code: error instanceof AccountingError && error.code === 'CHART_REFERENCE_ORPHANED' ? 'CHART_REFERENCE_ORPHANED' : 'CHART_INVALID', message: error instanceof Error ? error.message : 'The chart workbook is invalid.' });
    }
    const classifications = new Map<string, CashFlowClassification>();
    rawRows.forEach((sourceRow, index) => {
      const row = this.normalizeWorkbookRow(sourceRow);
      const account = rows[index];
      if (!account || !this.hasCashFlowWorkbookFields(row)) return;
      const parsed = this.parseChartCashFlowClassification(row, account, index + 2, issues);
      if (parsed) classifications.set(account.id, parsed);
      return;
    });
    rows.forEach((account, index) => {
      if (this.hasCashFlowWorkbookFields(this.normalizeWorkbookRow(rawRows[index] ?? {}))) return;
      const existing = this.repository.getCashFlowClassification('CHART', account.id);
      if (existing) {
        if (existing.accountType !== account.accountType || existing.detailType !== account.detailType) {
          issues.push({ rowNumber: index + 2, code: 'CASH_FLOW_CLASSIFICATION_STALE', message: `Cash Flow classification for ${account.name} no longer matches its account structure; include an explicit Cash Flow classification in the workbook.`, accountId: account.id });
        } else if (!validateCashFlowClassification({ accountRole: 'CHART', accountType: account.accountType, detailType: account.detailType, classification: existing }).ok) {
          issues.push({ rowNumber: index + 2, code: 'CASH_FLOW_CLASSIFICATION_INVALID', message: `Cash Flow classification for ${account.name} is invalid; include an explicit corrected classification in the workbook.`, accountId: account.id });
        }
      }
    });
    const previewToken = newId();
    const pending: PendingChartAccountImport = { databaseRevision: this.repository.getDatabaseRevision(), rows: Object.freeze(rows.map(row => Object.freeze({ ...row }))), classifications, issues: Object.freeze(issues.map(issue => Object.freeze({ ...issue }))) };
    this.chartAccountPreviews.set(previewToken, pending);
    const blockedRows = new Set(issues.filter(issue => issue.rowNumber > 0).map(issue => issue.rowNumber));
    const hasGlobalIssue = issues.some(issue => issue.rowNumber === 0);
    return Object.freeze({
      previewToken,
      databaseRevision: pending.databaseRevision,
      rows: pending.rows,
      cashFlowClassifications: Object.freeze([...classifications.entries()].map(([accountId, classification]) => Object.freeze({ accountId, classification: Object.freeze({ ...classification }) }))),
      issues: pending.issues,
      validRowCount: hasGlobalIssue ? 0 : rows.length - blockedRows.size,
      blockedRowCount: hasGlobalIssue ? rows.length : blockedRows.size,
    });
  }

  commitChartAccountsImport(previewToken: string): ChartAccount[] {
    const pending = this.chartAccountPreviews.get(previewToken);
    if (!pending) throw new AccountingError('CHART_INVALID', 'The chart workbook preview is missing or expired.');
    if (pending.databaseRevision !== this.repository.getDatabaseRevision()) {
      this.chartAccountPreviews.delete(previewToken);
      throw new AccountingError('CHART_INVALID', 'The chart workbook preview is stale. Preview it again.');
    }
    if (pending.issues.length) {
      this.chartAccountPreviews.delete(previewToken);
      throw new AccountingError('CHART_INVALID', pending.issues[0].message);
    }
    const rows = pending.rows;
    return this.repository.transaction(() => {
      const priorChart = new Map(this.repository.chartAccounts);
      const priorClassifications = new Map(this.repository.cashFlowClassifications);
      const importedIds = new Set(rows.map(row => row.id));
      this.repository.chartAccounts = new Map(rows.map(row => [row.id, structuredClone(row)]));
      this.repository.cashFlowClassifications = new Map([...priorClassifications.entries()].filter(([key]) => !key.startsWith('CHART:') || importedIds.has(key.slice('CHART:'.length))));
      for (const row of rows) {
        const imported = pending.classifications.get(row.id);
        const existing = priorClassifications.get(`CHART:${row.id}`);
        if (imported) {
          const record: CashFlowClassificationRecord = { ...imported, accountRole: 'CHART', accountId: row.id, accountType: row.accountType, detailType: row.detailType, modifiedAtUtc: nowUtc() };
          this.repository.saveCashFlowClassifications([record]);
        } else if (!existing) {
          const seeded = seedDefaultCashFlowClassification({ accountRole: 'CHART', accountType: row.accountType, detailType: row.detailType });
          if (!seeded.ok) throw new AccountingError('CHART_INVALID', `Unable to seed Cash Flow classification for ${row.name}: ${seeded.error.message}`);
          this.repository.cashFlowClassifications.set(`CHART:${row.id}`, { ...seeded.value, accountRole: 'CHART', accountId: row.id, accountType: row.accountType, detailType: row.detailType });
        } else if (existing.accountType !== row.accountType || existing.detailType !== row.detailType) {
          throw new AccountingError('CHART_INVALID', `Cash Flow classification for ${row.name} no longer matches its account structure; include an explicit Cash Flow classification in the workbook.`);
        }
      }
      for (const settings of this.repository.taxSettings.values()) {
        const priorFederalNames = settings.federalIncomeTaxAccountIds.map(id => priorChart.get(id)?.name).filter((name): name is string => Boolean(name));
        const priorStateNames = settings.stateLocalIncomeTaxAccountIds.map(id => priorChart.get(id)?.name).filter((name): name is string => Boolean(name));
        settings.federalIncomeTaxAccountIds = this.findChartByNames([...priorFederalNames, 'Federal Income Tax', 'Taxes paid:Taxes Paid - Federal']);
        settings.stateLocalIncomeTaxAccountIds = this.findChartByNames([...priorStateNames, 'State and Local Income Tax', 'Taxes paid:Taxes Paid - State and Local']);
      }
      this.record('IMPORT_CHART', 'ChartOfAccounts', this.repository.company.id, undefined, rows);
      this.chartAccountPreviews.delete(previewToken);
      return structuredClone([...rows]);
    });
  }

  exportChartAccounts(): ArrayBuffer {
    const rows = this.listChartAccounts().map(account => ({
      ...(() => {
        const persisted = this.repository.getCashFlowClassification('CHART', account.id);
        const seeded = persisted ?? (() => {
          const result = seedDefaultCashFlowClassification({ accountRole: 'CHART', accountType: account.accountType, detailType: account.detailType });
          return result.ok ? result.value : undefined;
        })();
        return {
          'Cash Flow Cash Role': seeded?.cashRole ?? '',
          'Cash Flow Treatment': seeded?.treatment ?? '',
          'Cash Flow Status': seeded?.status ?? '',
          'Cash Flow Source': seeded?.source ?? '',
          'Cash Flow Rationale': seeded?.rationale ?? '',
        };
      })(),
      'Account ID': account.id,
      'Account Name': account.name,
      'Parent ID': account.parentId ?? '',
      'Parent Account': account.parentId ? this.repository.chartAccounts.get(account.parentId)?.name ?? '' : '',
      'Account Type': this.chartAccountDefinition(account.accountType).label,
      'Reporting Classification': account.type,
      'Detail Type': account.detailType,
      Description: account.description ?? '',
      'Display Order': account.displayOrder,
      Archived: account.archived ? 'TRUE' : 'FALSE',
      Locked: account.locked ? 'TRUE' : 'FALSE',
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Chart of Accounts');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  }

  exportRules(format: 'XLSX' | 'CSV'): ArrayBuffer | string {
    const rows = this.listRules().map(rule => ({
      'Rule ID': rule.id, 'Rule Name': rule.name, Enabled: rule.enabled ? 'TRUE' : 'FALSE', Priority: rule.priority,
      'Match Mode': rule.matchMode ?? 'ALL', 'Conditions JSON': JSON.stringify(this.ruleExchangeConditions(rule)), 'Chart Account ID': rule.chartAccountId ?? '',
      'Chart Account Name': rule.chartAccountId ? this.requireChartAccount(rule.chartAccountId).name : '',
      Payee: rule.payee ?? '', Memo: rule.memo ?? '', 'Tags JSON': JSON.stringify(rule.tags ?? []), 'Suggest Exclude': rule.suggestExclude ? 'TRUE' : 'FALSE',
    }));
    if (format === 'CSV') return XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Rules');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  }

  previewRulesImport(content: string | ArrayBuffer): RuleImportPreview {
    const workbook = XLSX.read(typeof content === 'string' ? content : new Uint8Array(content), { type: typeof content === 'string' ? 'string' : 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const issues: RuleImportIssue[] = [];
    const rules: TransactionRule[] = [];
    rawRows.forEach((row, index) => {
      const rowNumber = index + 2;
      try {
        const rawConditions = JSON.parse(String(row['Conditions JSON'] ?? '[]')) as Array<RuleCondition & {
          accountName?: string;
          accountType?: string;
          institutionOrEntity?: string;
          lastFour?: string;
        }>;
        if (!Array.isArray(rawConditions)) throw new AccountingError('RULE_CONDITIONS_INVALID', 'Conditions JSON must contain an array.');
        const conditions = rawConditions.map(condition => this.resolveImportedRuleCondition(condition, rowNumber, issues));
        const tags = JSON.parse(String(row['Tags JSON'] ?? '[]')) as string[];
        const enabled = String(row['Enabled']).trim().toLowerCase();
        const excluded = String(row['Suggest Exclude']).trim().toLowerCase();
        const chartAccountId = this.resolveImportedRuleChartAccount(
          String(row['Chart Account ID'] ?? '').trim() || undefined,
          String(row['Chart Account Name'] ?? '').trim() || undefined,
          rowNumber,
          issues,
        );
        const rule: TransactionRule = {
          id: String(row['Rule ID'] ?? '').trim(), name: String(row['Rule Name'] ?? '').trim(),
          enabled: ['true', '1', 'yes'].includes(enabled), priority: Number(row['Priority']),
          matchMode: String(row['Match Mode'] ?? 'ALL').trim().toUpperCase() as 'ALL' | 'ANY', conditions,
          chartAccountId,
          payee: String(row['Payee'] ?? '').trim() || undefined, memo: String(row['Memo'] ?? '').trim() || undefined,
          tags, suggestExclude: ['true', '1', 'yes'].includes(excluded),
        };
        this.validateExchangeRule(rule);
        rules.push(rule);
      } catch (error) {
        issues.push({
          rowNumber,
          severity: 'ERROR',
          code: error instanceof AccountingError ? error.code : 'RULE_IMPORT_INVALID',
          message: error instanceof Error ? error.message : 'Invalid rule row.',
        });
      }
    });
    const seenIds = new Set<string>(); const seenPriorities = new Set<number>();
    rules.forEach(rule => {
      if (seenIds.has(rule.id)) issues.push({ rowNumber: rawRows.findIndex(row => String(row['Rule ID']).trim() === rule.id) + 2, severity: 'ERROR', code: 'RULE_ID_DUPLICATE', message: `Rule ID ${rule.id} is duplicated.` });
      seenIds.add(rule.id);
      if (seenPriorities.has(rule.priority)) issues.push({ rowNumber: rawRows.findIndex(row => Number(row['Priority']) === rule.priority) + 2, severity: 'ERROR', code: 'RULE_PRIORITY_DUPLICATE', message: `Priority ${rule.priority} is duplicated.` });
      seenPriorities.add(rule.priority);
    });
    rules.forEach((rule, index) => rules.slice(index + 1).forEach(other => {
      if (rule.enabled && other.enabled && (rule.matchMode ?? 'ALL') === (other.matchMode ?? 'ALL') && JSON.stringify(rule.conditions) === JSON.stringify(other.conditions)) {
        issues.push({ rowNumber: rawRows.findIndex(row => String(row['Rule ID']).trim() === other.id) + 2, severity: 'WARNING', code: 'RULE_COLLISION', message: `Matches the same conditions as ${rule.name}; lower priority wins.` });
      }
    }));
    const existing = new Set(this.repository.rules.keys());
    const preview: RuleImportPreview = { previewToken: newId(), valid: !issues.some(issue => issue.severity === 'ERROR'), rules, issues, importedCount: rules.filter(rule => !existing.has(rule.id)).length, updatedCount: rules.filter(rule => existing.has(rule.id)).length, disabledCount: rules.filter(rule => !rule.enabled).length };
    this.rulePreviews.set(preview.previewToken, structuredClone(preview));
    return structuredClone(preview);
  }

  private ruleExchangeConditions(rule: TransactionRule): Array<RuleCondition & {
    accountName?: string;
    accountType?: string;
    institutionOrEntity?: string;
    lastFour?: string;
  }> {
    return rule.conditions.map(condition => {
      if (condition.field !== 'ACCOUNT') return structuredClone(condition);
      const account = this.repository.accounts.get(condition.value);
      if (!account) return structuredClone(condition);
      return {
        ...structuredClone(condition),
        accountName: account.name,
        accountType: account.accountType,
        institutionOrEntity: account.institutionOrEntity,
        lastFour: account.lastFour,
      };
    });
  }

  private resolveImportedRuleCondition(condition: RuleCondition & {
    accountName?: string;
    accountType?: string;
    institutionOrEntity?: string;
    lastFour?: string;
  }, rowNumber: number, issues: RuleImportIssue[]): RuleCondition {
    const normalized: RuleCondition = {
      field: condition.field,
      operator: condition.operator,
      value: String(condition.value ?? ''),
      ...(condition.secondValue === undefined ? {} : { secondValue: String(condition.secondValue) }),
      ...(condition.negate === undefined ? {} : { negate: Boolean(condition.negate) }),
    };
    if (normalized.field !== 'ACCOUNT') return normalized;

    const accountById = this.repository.accounts.get(normalized.value);
    if (accountById && !accountById.archived) return normalized;

    const normalize = (value?: string): string => String(value ?? '').trim().toLowerCase();
    const accountName = normalize(condition.accountName) || normalize(normalized.value);
    let candidates = [...this.repository.accounts.values()].filter(account => !account.archived && normalize(account.name) === accountName);
    if (condition.accountType) candidates = candidates.filter(account => account.accountType === condition.accountType);
    if (condition.institutionOrEntity) candidates = candidates.filter(account => normalize(account.institutionOrEntity) === normalize(condition.institutionOrEntity));
    if (condition.lastFour) candidates = candidates.filter(account => normalize(account.lastFour) === normalize(condition.lastFour));

    if (!candidates.length) {
      throw new AccountingError('RULE_ACCOUNT_NOT_FOUND', `Account condition ${normalized.value} could not be matched to an active account${condition.accountName ? ` named ${condition.accountName}` : ''}. Re-export the rules with account identity or correct the account.`);
    }
    if (candidates.length > 1) {
      throw new AccountingError('RULE_ACCOUNT_AMBIGUOUS', `Account condition ${normalized.value} matches multiple active accounts named ${condition.accountName || normalized.value}. Use institution and last-four details to make the account unique.`);
    }

    normalized.value = candidates[0].id;
    issues.push({
      rowNumber,
      severity: 'WARNING',
      code: 'RULE_ACCOUNT_REMAPPED_BY_NAME',
      message: `Account condition ${condition.accountName || condition.value} was remapped to ${candidates[0].name} (${candidates[0].id}).`,
    });
    return normalized;
  }

  private resolveImportedRuleChartAccount(
    chartAccountId: string | undefined,
    chartAccountName: string | undefined,
    rowNumber: number,
    issues: RuleImportIssue[],
  ): string | undefined {
    if (!chartAccountId && !chartAccountName) return undefined;
    const accountById = chartAccountId ? this.repository.chartAccounts.get(chartAccountId) : undefined;
    if (accountById && !accountById.archived) return accountById.id;

    const normalizedName = String(chartAccountName ?? '').trim().toLowerCase();
    const candidates = [...this.repository.chartAccounts.values()].filter(account =>
      !account.archived && account.name.trim().toLowerCase() === normalizedName,
    );
    if (!candidates.length) {
      throw new AccountingError(
        'RULE_CHART_ACCOUNT_NOT_FOUND',
        `Rule category ${chartAccountName || chartAccountId} could not be matched to an active chart account. Re-export the rules with category names or correct the chart of accounts.`,
      );
    }
    if (candidates.length > 1) {
      throw new AccountingError(
        'RULE_CHART_ACCOUNT_AMBIGUOUS',
        `Rule category ${chartAccountName || chartAccountId} matches multiple active chart accounts. Use a unique full category name.`,
      );
    }

    issues.push({
      rowNumber,
      severity: 'WARNING',
      code: 'RULE_CHART_ACCOUNT_REMAPPED_BY_NAME',
      message: `Rule category ${chartAccountName || chartAccountId} was remapped to ${candidates[0].name} (${candidates[0].id}).`,
    });
    return candidates[0].id;
  }

  commitRulesImport(previewToken: string): TransactionRule[] {
    const preview = this.rulePreviews.get(previewToken);
    if (!preview) throw new AccountingError('RULE_PREVIEW_NOT_FOUND', 'Rule import preview was not found. Preview the file again.');
    if (!preview.valid) throw new AccountingError('RULE_PREVIEW_INVALID', 'Correct every rule-import error before replacing rules.');
    const imported = this.importRules(preview.rules);
    this.rulePreviews.delete(previewToken);
    return imported;
  }

  importRulesWorkbook(content: string | ArrayBuffer): TransactionRule[] {
    const workbook = XLSX.read(typeof content === 'string' ? content : new Uint8Array(content), { type: typeof content === 'string' ? 'string' : 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
    const rules = rawRows.map((row, index) => {
      const name = String(row['Rule Name'] || row['name'] || `Imported rule ${index + 1}`).trim();
      let conditionPayload: { ruleConditions?: Array<{ ruleType: number; value: string }>; isAndRule?: boolean } = {};
      let actionPayload: { ruleActions?: Array<{ actionType: number; value: unknown }> } = {};
      try { conditionPayload = JSON.parse(String(row['Rule Conditions'] || '{}')); } catch { throw new AccountingError('RULE_IMPORT_INVALID_CONDITIONS', `Invalid conditions JSON for rule ${name}.`); }
      try { actionPayload = JSON.parse(String(row['Rule Outputs'] || '{}')); } catch { throw new AccountingError('RULE_IMPORT_INVALID_ACTIONS', `Invalid outputs JSON for rule ${name}.`); }
      const conditions = (conditionPayload.ruleConditions ?? []).map(condition => this.mapImportedCondition(condition));
      const actions = actionPayload.ruleActions ?? [];
      const chartValue = String(actions.find(action => action.actionType === 0)?.value ?? '').trim();
      const chartAccountId = chartValue ? this.findChartByName(chartValue)[0] : undefined;
      if (chartValue && !chartAccountId) throw new AccountingError('RULE_CATEGORY_NOT_FOUND', `Rule ${name} references a category that is not in the active chart: ${chartValue}`);
      const memo = String(actions.find(action => action.actionType === 1)?.value ?? '').trim() || undefined;
      const payee = String(actions.find(action => action.actionType === 5)?.value ?? '').trim() || undefined;
      return {
        id: this.ruleId(name, index),
        name,
        enabled: true,
        priority: index + 1,
        conditions,
        chartAccountId,
        payee,
        memo,
        // Quicken action type 11 stores account-scope identifiers. It is not
        // an exclusion action, even when its value is a non-empty array.
        suggestExclude: false,
        matchMode: conditionPayload.isAndRule === false ? 'ANY' : 'ALL',
      } satisfies TransactionRule;
    });
    return this.importRules(rules);
  }

  listRules(): TransactionRule[] {
    return [...this.repository.rules.values()].sort((a, b) => a.priority - b.priority).map(rule => structuredClone(rule));
  }

  importRules(rules: TransactionRule[]): TransactionRule[] {
    const activeRules = rules.filter(rule => !this.isRetiredAmazonDuplicateSummaryRule(rule));
    const priorities = new Set<number>();
    activeRules.forEach(rule => {
      this.validateExchangeRule(rule);
      if (priorities.has(rule.priority)) throw new AccountingError('RULE_PRIORITY_DUPLICATE', `Rule priority ${rule.priority} is duplicated.`);
      priorities.add(rule.priority);
      if (rule.chartAccountId) this.requireChartAccount(rule.chartAccountId);
    });
    return this.repository.transaction(() => {
      this.repository.rules = new Map(activeRules.map(rule => [rule.id || newId(), structuredClone(rule)]));
      this.record('IMPORT_RULES', 'TransactionRules', this.repository.company.id, undefined, activeRules);
      return this.listRules();
    });
  }

  saveRule(rule: TransactionRule): TransactionRule {
    return this.repository.transaction(() => {
      const id = rule.id || newId();
      const before = this.repository.rules.get(id) ? structuredClone(this.repository.rules.get(id)!) : undefined;
      const saved = structuredClone({ ...rule, id, name: rule.name.trim(), matchMode: rule.matchMode ?? 'ALL' });
      this.validateExchangeRule(saved);
      const oldPriority = before?.priority;
      if (oldPriority === undefined) {
        for (const other of this.repository.rules.values()) {
          if (other.priority >= saved.priority) other.priority += 1;
        }
      } else if (oldPriority !== saved.priority) {
        for (const other of this.repository.rules.values()) {
          if (other.id === id) continue;
          if (saved.priority < oldPriority && other.priority >= saved.priority && other.priority < oldPriority) other.priority += 1;
          if (saved.priority > oldPriority && other.priority <= saved.priority && other.priority > oldPriority) other.priority -= 1;
        }
      }
      this.repository.rules.set(saved.id, saved);
      this.record('SAVE_RULE', 'TransactionRule', saved.id, before, saved);
      return structuredClone(saved);
    });
  }

  createRuleDraftFromTransaction(transactionId: string, chartAccountId?: string): TransactionRule {
    const transaction = this.requireTransaction(transactionId);
    if (chartAccountId) this.requireChartAccount(chartAccountId);
    const identifyingCondition: RuleCondition = transaction.payee
      ? { field: 'PAYEE', operator: 'CONTAINS', value: transaction.payee }
      : { field: 'DESCRIPTION', operator: 'CONTAINS', value: transaction.description };
    return {
      id: '',
      name: transaction.payee || transaction.description,
      enabled: true,
      priority: Math.max(0, ...this.listRules().map(rule => rule.priority)) + 1,
      conditions: [
        { field: 'ACCOUNT', operator: 'EQUALS', value: transaction.accountId },
        { field: 'DIRECTION', operator: 'EQUALS', value: transaction.amount.minorUnits < 0n ? 'OUT' : 'IN' },
        identifyingCondition,
      ],
      chartAccountId,
      payee: transaction.payee,
      memo: transaction.memo,
      matchMode: 'ALL',
    };
  }

  createRuleFromTransaction(transactionId: string, chartAccountId: string, name?: string): TransactionRule {
    const draft = this.createRuleDraftFromTransaction(transactionId, chartAccountId);
    const accountCondition = draft.conditions.find(condition => condition.field === 'ACCOUNT');
    return this.saveRule({
      ...draft,
      name: name?.trim() || `Learned: ${draft.name}`,
      enabled: false,
      conditions: draft.conditions.filter(condition => condition !== accountCondition),
    });
  }

  setRuleEnabled(id: string, enabled: boolean): TransactionRule {
    return this.repository.transaction(() => {
      const rule = this.repository.rules.get(id);
      if (!rule) throw new AccountingError('RULE_NOT_FOUND', `Rule not found: ${id}`);
      const before = structuredClone(rule);
      rule.enabled = enabled;
      this.record('SET_RULE_ENABLED', 'TransactionRule', id, before, rule);
      return structuredClone(rule);
    });
  }

  duplicateRule(id: string): TransactionRule {
    const source = this.repository.rules.get(id);
    if (!source) throw new AccountingError('RULE_NOT_FOUND', `Rule not found: ${id}`);
    return this.saveRule({ ...structuredClone(source), id: '', name: `${source.name} copy`, enabled: false, priority: Math.max(0, ...this.listRules().map(rule => rule.priority)) + 1 });
  }

  deleteRule(id: string): void {
    this.repository.transaction(() => {
      const rule = this.repository.rules.get(id);
      if (!rule) throw new AccountingError('RULE_NOT_FOUND', `Rule not found: ${id}`);
      const before = structuredClone(rule);
      this.repository.rules.delete(id);
      [...this.repository.rules.values()].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
        .forEach((other, index) => { other.priority = index + 1; });
      this.record('DELETE_RULE', 'TransactionRule', id, before, undefined, 'Deleted through rule management.');
    });
  }

  reorderRule(id: string, priority: number): TransactionRule {
    return this.repository.transaction(() => {
      if (!Number.isInteger(priority) || priority < 1) throw new AccountingError('RULE_PRIORITY_INVALID', 'Rule priority must be a positive integer.');
      const rule = this.repository.rules.get(id);
      if (!rule) throw new AccountingError('RULE_NOT_FOUND', `Rule not found: ${id}`);
      const before = structuredClone(rule);
      const oldPriority = rule.priority;
      for (const other of this.repository.rules.values()) {
        if (other.id === id) continue;
        if (priority < oldPriority && other.priority >= priority && other.priority < oldPriority) other.priority += 1;
        if (priority > oldPriority && other.priority <= priority && other.priority > oldPriority) other.priority -= 1;
      }
      rule.priority = priority;
      this.record('REORDER_RULE', 'TransactionRule', id, before, rule);
      return structuredClone(rule);
    });
  }

  testRule(rule: TransactionRule, transactionIds?: string[]): Array<{ transactionId: string; matched: boolean; rationale: string }> {
    this.validateExchangeRule({ ...structuredClone(rule), id: rule.id || 'unsaved-rule' });
    const transactions = transactionIds?.map(id => this.requireTransaction(id)) ?? [...this.repository.transactions.values()];
    return transactions.map(transaction => {
      const matched = this.ruleMatches(rule, transaction);
      const mode = rule.matchMode === 'ANY' ? 'At least one' : 'All';
      return { transactionId: transaction.id, matched, rationale: matched ? `${mode} of ${rule.conditions.length} condition(s) matched.` : 'The configured condition logic did not match.' };
    });
  }

  suggestTransaction(id: string): TransactionSuggestion {
    const transaction = this.requireTransaction(id);
    const transfer = this.findTransferCandidates(id)[0];
    if (transfer?.confidence >= 0.9) return { source: 'TRANSFER', confidence: transfer.confidence, rationale: transfer.rationale, transferCandidateId: transfer.transaction.id };
    if (transaction.categorizationSource === 'CLEARED') return { source: 'NONE', confidence: 0, rationale: 'The category suggestion was cleared for this Pending transaction.' };
    const rules = this.listRules().filter(rule => rule.enabled);
    for (const rule of rules) {
      if (this.ruleMatches(rule, transaction) && (rule.chartAccountId || rule.suggestExclude)) return {
        source: 'RULE',
        confidence: 1,
        rationale: `Rule "${rule.name}" matched at priority ${rule.priority}.`,
        chartAccountId: rule.chartAccountId,
        ruleId: rule.id,
        payee: rule.payee,
        memo: rule.memo,
        tags: rule.tags,
        suggestExclude: rule.suggestExclude,
      };
    }
    const prior = [...this.repository.transactions.values()]
      .filter(candidate => candidate.id !== transaction.id && candidate.state === 'POSTED' && candidate.accountId === transaction.accountId && candidate.splits.length === 1)
      .filter(candidate => candidate.description.toLowerCase() === transaction.description.toLowerCase() && (candidate.amount.minorUnits < 0n) === (transaction.amount.minorUnits < 0n))
      .sort((left, right) => right.postingDate.localeCompare(left.postingDate))[0];
    if (prior) return { source: 'PRIOR_MATCH', confidence: 0.8, rationale: 'A prior confirmed transaction used the same description and direction.', chartAccountId: prior.splits[0].chartAccountId };
    return { source: 'NONE', confidence: 0, rationale: 'No deterministic rule or high-confidence transfer match applies.' };
  }

  acceptSuggestion(id: string): Transaction {
    const suggestion = this.suggestTransaction(id);
    if (!suggestion.chartAccountId || !['RULE', 'PRIOR_MATCH'].includes(suggestion.source)) {
      throw new AccountingError('SUGGESTION_NOT_CATEGORIZABLE', 'This transaction does not have a category suggestion to accept.');
    }
    return this.repository.transaction(() => {
      const transaction = this.requireTransaction(id);
      this.requireChartAccount(suggestion.chartAccountId!);
      if (transaction.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Only Pending transactions can accept a category suggestion.');
      const before = structuredClone(transaction);
      transaction.splits = [{ id: newId(), chartAccountId: suggestion.chartAccountId!, amount: structuredClone(transaction.amount) }];
      transaction.categorizationSource = suggestion.source;
      transaction.ruleId = suggestion.ruleId;
      transaction.rationale = suggestion.rationale;
      if (suggestion.payee) transaction.payee = suggestion.payee;
      if (suggestion.memo) transaction.memo = suggestion.memo;
      transaction.modifiedAtUtc = nowUtc();
      this.record('ACCEPT_CATEGORY_SUGGESTION', 'Transaction', id, before, transaction, suggestion.rationale);
      return structuredClone(transaction);
    });
  }

  listTransactions(query: TransactionQuery): TransactionPage {
    const page = Math.max(query.page ?? 0, 0);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 500);
    const search = query.search?.toLowerCase().trim();
    const filtered = [...this.repository.transactions.values()]
      .filter(transaction => !query.accountId || transaction.accountId === query.accountId)
      .filter(transaction => !query.states?.length || query.states.includes(transaction.state))
      .filter(transaction => !query.sourceBatchId || transaction.sourceBatchId === query.sourceBatchId)
      .filter(transaction => !query.startDate || transaction.postingDate >= query.startDate)
      .filter(transaction => !query.endDate || transaction.postingDate <= query.endDate)
      .filter(transaction => query.minAmountMinor === undefined || transaction.amount.minorUnits >= query.minAmountMinor)
      .filter(transaction => query.maxAmountMinor === undefined || transaction.amount.minorUnits <= query.maxAmountMinor)
      .filter(transaction => !query.chartAccountId || transaction.splits.some(split => split.chartAccountId === query.chartAccountId))
      .filter(transaction => !search || [transaction.description, transaction.rawDescription, transaction.payee, transaction.memo, transaction.reference, ...this.transactionAmountSearchValues(transaction)]
        .filter(Boolean).some(value => value!.toLowerCase().includes(search)))
      .sort((left, right) => {
        const direction = query.sort === 'DATE_ASC' || query.sort === 'AMOUNT_ASC' ? 1 : -1;
        if (query.sort === 'AMOUNT_ASC' || query.sort === 'AMOUNT_DESC') return direction * Number(left.amount.minorUnits - right.amount.minorUnits) || left.id.localeCompare(right.id);
        return direction * left.postingDate.localeCompare(right.postingDate) || left.id.localeCompare(right.id);
      });
    return {
      items: structuredClone(filtered.slice(page * pageSize, (page + 1) * pageSize)),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  getTransaction(id: string): Transaction | undefined {
    const transaction = this.repository.transactions.get(id);
    return transaction ? structuredClone(transaction) : undefined;
  }

  getTransactionDetail(id: string): TransactionDetail {
    const transaction = this.requireTransaction(id);
    return {
      transaction: structuredClone(transaction),
      suggestion: this.suggestTransaction(id),
      audit: this.repository.audit.filter(event => event.entityType === 'Transaction' && event.entityId === id).map(event => ({ id: event.id, timestampUtc: event.timestampUtc, operation: event.operation, reason: event.reason })),
    };
  }

  updateTransaction(id: string, patch: Partial<Pick<Transaction, 'postingDate' | 'payee' | 'memo' | 'reference' | 'description'>> & { expectedModifiedAtUtc?: string }): Transaction {
    return this.repository.transaction(() => {
      const existing = this.requireTransaction(id);
      if (existing.state === 'MATCHED_TRANSFER') throw new AccountingError('STATE_CONFLICT', 'Unmatch a transfer before editing it.');
      if (patch.expectedModifiedAtUtc && patch.expectedModifiedAtUtc !== existing.modifiedAtUtc) throw new AccountingError('STALE_TRANSACTION', 'The transaction changed since it was loaded. Refresh before editing it.');
      const before = structuredClone(existing);
      Object.assign(existing, patch, { modifiedAtUtc: nowUtc() });
      this.validateTransaction(existing, false);
      this.record('UPDATE_TRANSACTION', 'Transaction', id, before, existing);
      return structuredClone(existing);
    });
  }

  categorize(id: string, chartAccountId: string, rationale = 'Manual categorization'): Transaction {
    return this.repository.transaction(() => {
      const transaction = this.requireTransaction(id);
      this.requireChartAccount(chartAccountId);
      if (transaction.state === 'MATCHED_TRANSFER') throw new AccountingError('STATE_CONFLICT', 'Unmatch a transfer before categorizing it.');
      const before = structuredClone(transaction);
      transaction.splits = [{ id: newId(), chartAccountId, amount: structuredClone(transaction.amount) }];
      transaction.categorizationSource = 'MANUAL';
      transaction.ruleId = undefined;
      transaction.rationale = rationale;
      transaction.modifiedAtUtc = nowUtc();
      this.record('CATEGORIZE_TRANSACTION', 'Transaction', id, before, transaction);
      return structuredClone(transaction);
    });
  }

  categorizeMany(ids: string[], chartAccountId: string, rationale = 'Manual bulk categorization'): Transaction[] {
    return this.repository.transaction(() => {
      const correlationId = newId();
      this.requireChartAccount(chartAccountId);
      const transactions = ids.map(id => this.requireTransaction(id));
      transactions.forEach(transaction => {
        if (transaction.state === 'MATCHED_TRANSFER') throw new AccountingError('STATE_CONFLICT', 'Unmatch a transfer before categorizing it.');
      });
      transactions.forEach(transaction => {
        const before = structuredClone(transaction);
        transaction.splits = [{ id: newId(), chartAccountId, amount: structuredClone(transaction.amount) }];
        transaction.categorizationSource = 'MANUAL';
        transaction.ruleId = undefined;
        transaction.rationale = rationale;
        transaction.modifiedAtUtc = nowUtc();
        this.record('CATEGORIZE_TRANSACTION', 'Transaction', transaction.id, before, transaction, rationale, correlationId);
      });
      return structuredClone(transactions);
    });
  }

  clearCategorization(id: string, rationale = 'Cleared manual Pending categorization'): Transaction {
    return this.repository.transaction(() => {
      const transaction = this.requireTransaction(id);
      if (transaction.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Only Pending transaction categorization can be cleared.');
      const before = structuredClone(transaction);
      transaction.splits = [];
      transaction.categorizationSource = 'CLEARED';
      transaction.ruleId = undefined;
      transaction.rationale = rationale;
      transaction.modifiedAtUtc = nowUtc();
      this.record('CLEAR_TRANSACTION_CATEGORIZATION', 'Transaction', id, before, transaction, rationale);
      return structuredClone(transaction);
    });
  }

  split(id: string, splits: Array<{ chartAccountId: string; amountMinor: bigint; memo?: string }>): Transaction {
    return this.repository.transaction(() => {
      const transaction = this.requireTransaction(id);
      if (transaction.state === 'MATCHED_TRANSFER') throw new AccountingError('STATE_CONFLICT', 'Unmatch a transfer before splitting it.');
      const result: PostingSplit[] = splits.map(split => {
        this.requireChartAccount(split.chartAccountId);
        return { id: newId(), chartAccountId: split.chartAccountId, amount: money(split.amountMinor), memo: split.memo };
      });
      const total = result.reduce((sum, split) => sum + split.amount.minorUnits, 0n);
      if (total !== transaction.amount.minorUnits) throw new AccountingError('SPLIT_UNBALANCED', `Split total ${total} does not equal transaction amount ${transaction.amount.minorUnits}.`);
      const before = structuredClone(transaction);
      transaction.splits = result;
      transaction.categorizationSource = 'MANUAL';
      transaction.modifiedAtUtc = nowUtc();
      this.record('SPLIT_TRANSACTION', 'Transaction', id, before, transaction);
      return structuredClone(transaction);
    });
  }

  correctAmount(id: string, amountMinor: bigint, rationale: string, expectedModifiedAtUtc?: string): Transaction {
    return this.repository.transaction(() => {
      if (!rationale.trim()) throw new AccountingError('AMOUNT_CORRECTION_REASON_REQUIRED', 'An amount correction reason is required.');
      const transaction = this.requireTransaction(id);
      if (expectedModifiedAtUtc && expectedModifiedAtUtc !== transaction.modifiedAtUtc) throw new AccountingError('STALE_TRANSACTION', 'The transaction changed since it was loaded. Refresh before editing it.');
      if (transaction.state !== 'POSTED') throw new AccountingError('STATE_CONFLICT', 'Only Posted transactions may receive an accounting amount correction.');
      if (transaction.splits.length !== 1) throw new AccountingError('AMOUNT_CORRECTION_SPLIT_COMPLEX', 'Correct multi-split amounts through an explicit replacement split operation.');
      const before = structuredClone(transaction);
      transaction.amount = money(amountMinor, transaction.amount.currency);
      transaction.splits[0].amount = structuredClone(transaction.amount);
      transaction.modifiedAtUtc = nowUtc();
      this.record('CORRECT_POSTED_AMOUNT', 'Transaction', id, before, transaction, rationale);
      return structuredClone(transaction);
    });
  }

  post(ids: string[]): Transaction[] {
    return this.repository.transaction(() => {
      const correlationId = newId();
      const transactions = ids.map(id => this.requireTransaction(id));
      transactions.forEach(transaction => {
        if (transaction.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Only Pending transactions can be posted.');
        this.validateTransaction(transaction, true);
      });
      transactions.forEach(transaction => {
        const before = structuredClone(transaction);
        transaction.state = 'POSTED';
        transaction.postedAtUtc = nowUtc();
        transaction.modifiedAtUtc = nowUtc();
        this.record('POST_TRANSACTION', 'Transaction', transaction.id, before, transaction, undefined, correlationId);
      });
      return structuredClone(transactions);
    });
  }

  postWithCategory(id: string, chartAccountId: string): Transaction {
    const suggestion = this.suggestTransaction(id);
    return this.repository.transaction(() => {
      const transaction = this.requireTransaction(id);
      this.requireChartAccount(chartAccountId);
      if (transaction.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Only Pending transactions can be posted.');
      const before = structuredClone(transaction);
      transaction.splits = [{ id: newId(), chartAccountId, amount: structuredClone(transaction.amount) }];
      const acceptsSuggestion = suggestion.chartAccountId === chartAccountId && ['RULE', 'PRIOR_MATCH'].includes(suggestion.source);
      if (acceptsSuggestion) {
        transaction.categorizationSource = suggestion.source as 'RULE' | 'PRIOR_MATCH';
        transaction.ruleId = suggestion.ruleId;
        transaction.rationale = suggestion.rationale;
        if (suggestion.payee) transaction.payee = suggestion.payee;
        if (suggestion.memo) transaction.memo = suggestion.memo;
      } else {
        transaction.categorizationSource = 'MANUAL';
        transaction.ruleId = undefined;
        transaction.rationale = suggestion.chartAccountId
          ? `User selected ${this.requireChartAccount(chartAccountId).name} instead of the suggested category.`
          : 'User selected the category while posting.';
      }
      this.validateTransaction(transaction, true);
      transaction.state = 'POSTED';
      transaction.postedAtUtc = nowUtc();
      transaction.modifiedAtUtc = nowUtc();
      this.record('POST_TRANSACTION', 'Transaction', transaction.id, before, transaction, transaction.rationale);
      return structuredClone(transaction);
    });
  }

  postWithCategories(items: Array<{ id: string; chartAccountId: string }>): Transaction[] {
    if (!items.length) throw new AccountingError('TRANSACTION_SELECTION_REQUIRED', 'Select at least one Pending transaction to post.');
    if (new Set(items.map(item => item.id)).size !== items.length) throw new AccountingError('TRANSACTION_SELECTION_DUPLICATE', 'A transaction may be posted only once per batch.');
    const suggestions = new Map(items.map(item => [item.id, this.suggestTransaction(item.id)]));
    return this.repository.transaction(() => {
      const correlationId = newId();
      const transactions = items.map(item => ({ transaction: this.requireTransaction(item.id), chartAccountId: item.chartAccountId }));
      transactions.forEach(({ transaction, chartAccountId }) => {
        this.requireChartAccount(chartAccountId);
        if (transaction.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Only Pending transactions can be posted.');
      });
      transactions.forEach(({ transaction, chartAccountId }) => {
        const before = structuredClone(transaction);
        const suggestion = suggestions.get(transaction.id)!;
        transaction.splits = [{ id: newId(), chartAccountId, amount: structuredClone(transaction.amount) }];
        const acceptsSuggestion = suggestion.chartAccountId === chartAccountId && ['RULE', 'PRIOR_MATCH'].includes(suggestion.source);
        transaction.categorizationSource = acceptsSuggestion ? suggestion.source as 'RULE' | 'PRIOR_MATCH' : 'MANUAL';
        transaction.ruleId = acceptsSuggestion ? suggestion.ruleId : undefined;
        transaction.rationale = acceptsSuggestion
          ? suggestion.rationale
          : suggestion.chartAccountId
            ? `User selected ${this.requireChartAccount(chartAccountId).name} instead of the suggested category.`
            : 'User selected the category while posting.';
        if (acceptsSuggestion && suggestion.payee) transaction.payee = suggestion.payee;
        if (acceptsSuggestion && suggestion.memo) transaction.memo = suggestion.memo;
        this.validateTransaction(transaction, true);
        transaction.state = 'POSTED';
        transaction.postedAtUtc = nowUtc();
        transaction.modifiedAtUtc = nowUtc();
        this.record('POST_TRANSACTION', 'Transaction', transaction.id, before, transaction, transaction.rationale, correlationId);
      });
      return transactions.map(({ transaction }) => structuredClone(transaction));
    });
  }

  exclude(ids: string[], reason: string): Transaction[] {
    if (!reason.trim()) throw new AccountingError('EXCLUSION_REASON_REQUIRED', 'An exclusion reason is required.');
    return this.repository.transaction(() => {
      const correlationId = newId();
      const transactions = ids.map(id => this.requireTransaction(id));
      transactions.forEach(transaction => {
        if (!['PENDING', 'MATCHED_TRANSFER'].includes(transaction.state)) throw new AccountingError('STATE_CONFLICT', 'Only Pending or Matched Transfer transactions can be excluded.');
      });
      transactions.filter(transaction => transaction.state === 'MATCHED_TRANSFER').forEach(transaction => {
        const match = this.repository.transfers.get(transaction.transferMatchId ?? '');
        if (match) this.resetTransfer(match);
      });
      transactions.forEach(transaction => {
        const before = structuredClone(transaction);
        transaction.state = 'EXCLUDED';
        transaction.exclusionReason = reason.trim();
        transaction.excludedAtUtc = nowUtc();
        transaction.modifiedAtUtc = nowUtc();
        this.record('EXCLUDE_TRANSACTION', 'Transaction', transaction.id, before, transaction, reason, correlationId);
      });
      return structuredClone(transactions);
    });
  }

  deleteExcluded(ids: string[]): void {
    if (!ids.length) throw new AccountingError('TRANSACTION_SELECTION_REQUIRED', 'Select at least one excluded transaction to delete.');
    this.repository.transaction(() => {
      const transactions = ids.map(id => this.requireTransaction(id));
      if (transactions.some(transaction => transaction.state !== 'EXCLUDED')) {
        throw new AccountingError('STATE_CONFLICT', 'Only Excluded transactions can be permanently deleted.');
      }
      const deletedIds = new Set(ids);
      transactions.forEach(transaction => {
        const match = transaction.transferMatchId ? this.repository.transfers.get(transaction.transferMatchId) : undefined;
        if (match) this.resetTransfer(match);
      });
      for (const id of deletedIds) this.repository.transactions.delete(id);
      this.repository.audit = this.repository.audit.filter(event => !(event.entityType === 'Transaction' && deletedIds.has(event.entityId)));
    });
  }

  undo(ids: string[]): Transaction[] {
    return this.repository.transaction(() => {
      const correlationId = newId();
      const transactions = ids.map(id => this.requireTransaction(id));
      transactions.forEach(transaction => {
        if (transaction.state === 'MATCHED_TRANSFER') {
          const match = this.repository.transfers.get(transaction.transferMatchId ?? '');
          if (match) this.resetTransfer(match);
        } else if (!['POSTED', 'EXCLUDED'].includes(transaction.state)) {
          throw new AccountingError('STATE_CONFLICT', 'Only Posted, Excluded, or Matched Transfer transactions can be undone.');
        }
      });
      transactions.forEach(transaction => {
        const current = this.requireTransaction(transaction.id);
        if (current.state !== 'PENDING') {
          const before = structuredClone(current);
          current.state = 'PENDING';
          current.exclusionReason = undefined;
          current.transferMatchId = undefined;
          current.undoneAtUtc = nowUtc();
          current.modifiedAtUtc = nowUtc();
          this.record('UNDO_TRANSACTION', 'Transaction', current.id, before, current, undefined, correlationId);
        }
      });
      return ids.map(id => structuredClone(this.requireTransaction(id)));
    });
  }

  findTransferCandidates(id: string, dateWindowDays = 5): Array<{ transaction: Transaction; confidence: number; rationale: string }> {
    const source = this.requireTransaction(id);
    if (source.state !== 'PENDING') return [];
    const account = this.repository.accounts.get(source.accountId);
    if (!account || account.archived || !['BANK', 'CREDIT_CARD'].includes(account.type)) return [];
    return [...this.repository.transactions.values()]
      .filter(candidate => candidate.id !== source.id && candidate.state === 'PENDING')
      .filter(candidate => candidate.amount.minorUnits === -source.amount.minorUnits)
      .filter(candidate => candidate.accountId !== source.accountId)
      .filter(candidate => {
        const candidateAccount = this.repository.accounts.get(candidate.accountId);
        return Boolean(candidateAccount && !candidateAccount.archived && ['BANK', 'CREDIT_CARD'].includes(candidateAccount.type));
      })
      .map(candidate => {
        const days = Math.abs((Date.parse(candidate.postingDate) - Date.parse(source.postingDate)) / 86_400_000);
        if (days > Math.max(0, dateWindowDays)) return undefined;
        const samePayee = Boolean(candidate.payee && source.payee && candidate.payee.toLowerCase() === source.payee.toLowerCase());
        const confidence = Math.max(0, 1 - Math.min(days, 30) / 60) + (samePayee ? 0.35 : 0);
        return { transaction: structuredClone(candidate), confidence: Math.min(confidence, 1), rationale: `${days} day(s) apart; ${samePayee ? 'payee matches' : 'amount/sign match'}.` };
      })
      .filter((candidate): candidate is { transaction: Transaction; confidence: number; rationale: string } => candidate !== undefined)
      .sort((left, right) => right.confidence - left.confidence);
  }

  confirmTransfer(leftId: string, rightId: string): TransferMatch {
    return this.repository.transaction(() => {
      const left = this.requireTransaction(leftId);
      const right = this.requireTransaction(rightId);
      if (left.state !== 'PENDING' || right.state !== 'PENDING') throw new AccountingError('STATE_CONFLICT', 'Both transactions must be Pending.');
      if (left.accountId === right.accountId || left.amount.minorUnits !== -right.amount.minorUnits) throw new AccountingError('TRANSFER_NOT_ELIGIBLE', 'Transfers require different accounts and equal-and-opposite amounts.');
      const match: TransferMatch = { id: newId(), leftTransactionId: left.id, rightTransactionId: right.id, confidence: 1, rationale: 'User confirmed equal-and-opposite account movement.', confirmedAtUtc: nowUtc() };
      const beforeLeft = structuredClone(left);
      const beforeRight = structuredClone(right);
      left.state = 'MATCHED_TRANSFER'; left.transferMatchId = match.id; left.modifiedAtUtc = nowUtc();
      right.state = 'MATCHED_TRANSFER'; right.transferMatchId = match.id; right.modifiedAtUtc = nowUtc();
      this.repository.transfers.set(match.id, match);
      this.record('CONFIRM_TRANSFER', 'Transaction', left.id, beforeLeft, left, undefined, match.id);
      this.record('CONFIRM_TRANSFER', 'Transaction', right.id, beforeRight, right, undefined, match.id);
      return structuredClone(match);
    });
  }

  unmatchTransfer(matchId: string): void {
    this.repository.transaction(() => {
      const match = this.repository.transfers.get(matchId);
      if (!match) throw new AccountingError('TRANSFER_NOT_FOUND', 'Transfer match was not found.');
      this.resetTransfer(match);
    });
  }

  getProfitLoss(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds: string[] = []): ProfitLossReport {
    this.validateDateRange(startDate, endDate);
    return this.buildReport(startDate, endDate, grouping, new Set(excludedChartAccountIds));
  }

  getScheduleCReadyReport(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds: string[] = []): ScheduleCReadyReport {
    this.validateDateRange(startDate, endDate);
    const taxYear = Number(startDate.slice(0, 4));
    const settings = this.getTaxYearSettings(taxYear);
    const excluded = new Set<string>(excludedChartAccountIds);
    if (!settings.includeFederalIncomeTax) settings.federalIncomeTaxAccountIds.forEach(id => excluded.add(id));
    if (!settings.includeStateLocalIncomeTax) settings.stateLocalIncomeTaxAccountIds.forEach(id => excluded.add(id));
    const full = this.buildReport(startDate, endDate, grouping, new Set(excludedChartAccountIds));
    const adjusted = this.buildReport(startDate, endDate, grouping, excluded);
    const removedFederalMinor = settings.includeFederalIncomeTax ? 0n : this.sumTaxAccounts(settings.federalIncomeTaxAccountIds, startDate, endDate);
    const removedStateLocalMinor = settings.includeStateLocalIncomeTax ? 0n : this.sumTaxAccounts(settings.stateLocalIncomeTaxAccountIds, startDate, endDate);
    return { ...adjusted, taxYear, includeFederalIncomeTax: settings.includeFederalIncomeTax, includeStateLocalIncomeTax: settings.includeStateLocalIncomeTax, removedFederalMinor, removedStateLocalMinor, removedTotalMinor: adjusted.netProfitMinor - full.netProfitMinor };
  }

  getReportDetail(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds: string[] = []): ReportDetailRow[] {
    this.validateDateRange(startDate, endDate);
    const excluded = new Set(excludedChartAccountIds);
    return [...this.repository.transactions.values()]
      .filter(transaction => transaction.state === 'POSTED' && transaction.postingDate >= startDate && transaction.postingDate <= endDate)
      .flatMap(transaction => transaction.splits
        .filter(split => {
          const chart = this.repository.chartAccounts.get(split.chartAccountId);
          return Boolean(chart && !['ASSET', 'LIABILITY', 'EQUITY'].includes(chart.type) && !excluded.has(split.chartAccountId) && (!chartAccountId || split.chartAccountId === chartAccountId));
        })
        .map(split => {
          const chart = this.repository.chartAccounts.get(split.chartAccountId);
          const amountMinor = chart && ['INCOME', 'OTHER_INCOME'].includes(chart.type) ? split.amount.minorUnits : -split.amount.minorUnits;
          const reportContributionMinor = chart ? this.netProfitContribution(chart.type, amountMinor) : amountMinor;
          return { transactionId: transaction.id, accountId: transaction.accountId, postingDate: transaction.postingDate, description: transaction.description, payee: transaction.payee, memo: transaction.memo, chartAccountId: split.chartAccountId, amountMinor, reportContributionMinor, sourceBatchId: transaction.sourceBatchId };
        }))
      .sort((left, right) => left.postingDate.localeCompare(right.postingDate) || left.transactionId.localeCompare(right.transactionId) || left.chartAccountId.localeCompare(right.chartAccountId));
  }

  getProfitLossDrilldown(query: ReportDrilldownQuery): ReportDetailRow[] {
    this.validateDateRange(query.startDate, query.endDate);
    const categoryIds = query.categoryIds ? new Set(query.categoryIds) : undefined;
    const needle = query.search?.trim().toLowerCase();
    return this.getReportDetail(query.startDate, query.endDate, undefined, query.excludedChartAccountIds ?? [])
      .filter(row => !query.period || row.postingDate.slice(0, query.grouping === 'MONTH' ? 7 : 4) === query.period)
      .filter(row => !query.chartAccountId || row.chartAccountId === query.chartAccountId)
      .filter(row => !categoryIds || categoryIds.has(row.chartAccountId))
      .filter(row => !query.sectionKey || this.matchesDrilldownSection(row.chartAccountId, query.sectionKey))
      .filter(row => !query.accountId || row.accountId === query.accountId)
      .filter(row => {
        if (!needle) return true;
        const account = this.repository.accounts.get(row.accountId);
        const chart = this.repository.chartAccounts.get(row.chartAccountId);
        return [row.description, row.payee, row.memo, account?.name, chart?.name, this.chartAccountPath(row.chartAccountId)].some(value => value?.toLowerCase().includes(needle));
      })
      .map(row => ({
        ...row,
        reportContributionMinor: this.drilldownContribution(row, query),
      }));
  }

  getExceptions(startDate: string, endDate: string): ExceptionItem[] {
    this.validateDateRange(startDate, endDate);
    const result: ExceptionItem[] = [];
    for (const transaction of this.repository.transactions.values()) {
      if (transaction.postingDate < startDate || transaction.postingDate > endDate) continue;
      if (transaction.state === 'PENDING') result.push({ transactionId: transaction.id, kind: 'PENDING', message: 'Transaction is still pending review.' });
      if (transaction.state === 'PENDING' && transaction.splits.length === 0) result.push({ transactionId: transaction.id, kind: 'UNRESOLVED', message: 'Transaction has no accounting category or split.' });
      const editedAudit = this.repository.audit.some(event => event.entityType === 'Transaction' && event.entityId === transaction.id && ['UPDATE_TRANSACTION', 'CORRECT_POSTED_AMOUNT'].includes(event.operation));
      if ((transaction.postedAtUtc && transaction.modifiedAtUtc > transaction.postedAtUtc) || editedAudit) result.push({ transactionId: transaction.id, kind: 'EDITED_AFTER_POSTING', message: 'Posted transaction was edited after posting.' });
    }
    for (const batch of this.repository.batches.values()) {
      if (batch.warningCount > 0 && (!batch.committedAtUtc || batch.committedAtUtc.slice(0, 10) >= startDate && batch.committedAtUtc.slice(0, 10) <= endDate)) result.push({ batchId: batch.id, kind: 'PARSE_WARNING', message: `${batch.warningCount} import warning(s) require review.` });
    }
    return result;
  }

  getReconciliation(accountId: string, startDate: string, endDate: string, statementEndingBalanceMinor?: bigint): ReconciliationReport {
    this.validateDateRange(startDate, endDate);
    const account = this.repository.accounts.get(accountId);
    if (!account) throw new AccountingError('ACCOUNT_NOT_FOUND', `Account not found: ${accountId}`);
    const activity = [...this.repository.transactions.values()].filter(transaction => transaction.accountId === accountId && transaction.postingDate >= startDate && transaction.postingDate <= endDate);
    const postedActivityMinor = activity.filter(transaction => transaction.state === 'POSTED').reduce((sum, transaction) => sum + transaction.amount.minorUnits, 0n);
    const matchedTransferActivityMinor = activity.filter(transaction => transaction.state === 'MATCHED_TRANSFER').reduce((sum, transaction) => sum + transaction.amount.minorUnits, 0n);
    const calculatedEndingBalanceMinor = account.openingBalance.minorUnits + postedActivityMinor + matchedTransferActivityMinor;
    return { accountId, startDate, endDate, openingBalanceMinor: account.openingBalance.minorUnits, postedActivityMinor, matchedTransferActivityMinor, calculatedEndingBalanceMinor, statementEndingBalanceMinor, differenceMinor: statementEndingBalanceMinor === undefined ? undefined : statementEndingBalanceMinor - calculatedEndingBalanceMinor };
  }

  exportAccountantPackage(startDate: string, endDate: string): string {
    const grouping: 'MONTH' | 'YEAR' = 'YEAR';
    const payload = {
      manifestVersion: 1,
      exportedAtUtc: nowUtc(),
      company: this.getCompany(),
      unadjustedProfitLoss: this.getProfitLoss(startDate, endDate, grouping),
      scheduleCReady: this.getScheduleCReadyReport(startDate, endDate, grouping),
      taxSettings: this.getTaxYearSettings(Number(startDate.slice(0, 4))),
      detail: this.getReportDetail(startDate, endDate),
      exceptions: this.getExceptions(startDate, endDate),
      accounts: this.listAccounts(),
    };
    return JSON.stringify(payload, (_key, value) => typeof value === 'bigint' ? `${value}n` : value);
  }

  getTaxYearSettings(taxYear: number): TaxYearSettings {
    return structuredClone(this.repository.taxSettings.get(taxYear) ?? {
      taxYear,
      federalIncomeTaxAccountIds: this.findChartByNames(['Federal Income Tax', 'Taxes paid:Taxes Paid - Federal']),
      stateLocalIncomeTaxAccountIds: this.findChartByNames(['State and Local Income Tax', 'Taxes paid:Taxes Paid - State and Local']),
      includeFederalIncomeTax: false,
      includeStateLocalIncomeTax: true,
    });
  }

  saveTaxYearSettings(settings: TaxYearSettings): void {
    this.repository.transaction(() => {
      this.repository.taxSettings.set(settings.taxYear, structuredClone(settings));
      this.record('SAVE_TAX_SETTINGS', 'TaxYearSettings', String(settings.taxYear), undefined, settings);
    });
  }

  previewImport(source: ImportSourceInput): ImportPreview {
    const destination = this.repository.accounts.get(source.destinationAccountId);
    if (!destination) throw new AccountingError('ACCOUNT_NOT_FOUND', 'Import destination account was not found.');
    if (destination.archived) throw new AccountingError('ACCOUNT_ARCHIVED', 'Archived accounts cannot receive new imports.');
    const preview = this.importer.parse(source, this.repository.accounts.get(source.destinationAccountId)?.name ?? '');
    this.previews.set(preview.previewToken, structuredClone(preview));
    return structuredClone(preview);
  }

  commitImport(previewToken: string): ImportPreview {
    const preview = this.previews.get(previewToken);
    if (!preview) throw new AccountingError('PREVIEW_NOT_FOUND', 'Import preview is missing or stale.');
    return this.repository.transaction(() => {
      const destination = this.repository.accounts.get(preview.batch.destinationAccountId);
      if (!destination || destination.archived) throw new AccountingError('ACCOUNT_ARCHIVED', 'The import destination is no longer active. Regenerate the preview for an active account.');
      const batch = structuredClone(preview.batch);
      batch.committedAtUtc = nowUtc();
      this.repository.batches.set(batch.id, batch);
      preview.rows.filter(row => row.status === 'ACCEPTED' && row.transaction).forEach(row => {
        const source = row.transaction!;
        const transaction: Transaction = {
          ...source,
          id: newId(),
          state: 'PENDING',
          splits: [],
          sourceBatchId: batch.id,
          createdAtUtc: nowUtc(),
          modifiedAtUtc: nowUtc(),
        };
        this.repository.transactions.set(transaction.id, transaction);
        row.transaction = { ...source, sourceBatchId: batch.id };
        this.record('IMPORT_TRANSACTION', 'Transaction', transaction.id, undefined, transaction, undefined, batch.id);
      });
      this.record('COMMIT_IMPORT', 'ImportBatch', batch.id, undefined, batch);
      this.previews.delete(previewToken);
      return structuredClone({ ...preview, batch });
    });
  }

  exportAllData(): string {
    const payload = {
      version: 1,
      schemaVersion: CURRENT_BACKUP_SCHEMA_VERSION,
      exportedAtUtc: nowUtc(),
      company: this.repository.company,
      companyProfile: this.repository.exportCompanyProfile(),
      accounts: [...this.repository.accounts.values()],
      chartAccounts: [...this.repository.chartAccounts.values()],
      transactions: [...this.repository.transactions.values()],
      batches: [...this.repository.batches.values()],
      rules: [...this.repository.rules.values()],
      transfers: [...this.repository.transfers.values()],
      taxSettings: [...this.repository.taxSettings.entries()],
      cashFlowClassifications: [...this.repository.cashFlowClassifications.values()],
      audit: this.repository.audit,
    };
    return JSON.stringify(payload, (_key, value) => typeof value === 'bigint' ? `${value}n` : value);
  }

  importAllData(payload: string): void {
    let parsed: any;
    try { parsed = JSON.parse(payload); } catch { throw new AccountingError('BACKUP_INVALID_JSON', 'Backup is not valid JSON.'); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.accounts) || !Array.isArray(parsed.transactions)) throw new AccountingError('BACKUP_INVALID_VERSION', 'Backup version or required records are unsupported.');
    const schemaVersion = Number.isInteger(parsed.schemaVersion) ? Number(parsed.schemaVersion) : 0;
    if (schemaVersion < 0 || schemaVersion > CURRENT_BACKUP_SCHEMA_VERSION) {
      throw new AccountingError('BACKUP_INVALID_VERSION', `Unsupported portable schema version: ${schemaVersion}.`);
    }
    this.validatePortableClassifications(parsed, schemaVersion);
    this.repository.transaction(() => {
      this.repository.company = this.hydrate(parsed.company);
      if (parsed.companyProfile) {
        const persisted = this.hydrate(parsed.companyProfile);
        const { taxIdentifier, ...profile } = persisted;
        this.repository.saveCompanyProfile(
          { ...profile, maskedTaxIdentifier: this.maskTaxIdentifier(taxIdentifier) },
          taxIdentifier ? { mode: 'SET', value: taxIdentifier } : { mode: 'CLEAR' },
        );
      }
      this.repository.accounts = new Map(parsed.accounts.map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.chartAccounts = new Map((parsed.chartAccounts ?? []).map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.transactions = new Map(parsed.transactions.map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.batches = new Map((parsed.batches ?? []).map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.rules = new Map((parsed.rules ?? []).map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.transfers = new Map((parsed.transfers ?? []).map((item: any) => [item.id, this.hydrate(item)]));
      this.repository.taxSettings = new Map((parsed.taxSettings ?? []).map((entry: any[]) => [Number(entry[0]), this.hydrate(entry[1])]));
      this.repository.cashFlowClassifications = new Map((parsed.cashFlowClassifications ?? []).map((item: any) => {
        const account = item.accountRole === 'FINANCIAL_SOURCE'
          ? this.repository.accounts.get(item.accountId)
          : this.repository.chartAccounts.get(item.accountId);
        return [`${item.accountRole}:${item.accountId}`, {
          ...this.hydrate(item),
          accountRole: item.accountRole,
          accountId: item.accountId,
          accountType: account?.accountType ?? item.accountType,
          detailType: account?.detailType ?? item.detailType,
        }];
      }));
      // Schema-6/older portable data has no authoritative classification
      // coverage. Preserve any valid imported rows and seed only the missing
      // rows from the imported account structure.
      if (!Array.isArray(parsed.cashFlowClassifications) || schemaVersion < CURRENT_BACKUP_SCHEMA_VERSION) {
        for (const account of this.repository.accounts.values()) {
          const key = `FINANCIAL_SOURCE:${account.id}`;
          if (this.repository.cashFlowClassifications.has(key)) continue;
          const seeded = seedDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: account.accountType, detailType: account.detailType });
          if (seeded.ok) this.repository.cashFlowClassifications.set(key, { ...seeded.value, accountRole: 'FINANCIAL_SOURCE', accountId: account.id, accountType: account.accountType, detailType: account.detailType });
        }
        for (const account of this.repository.chartAccounts.values()) {
          const key = `CHART:${account.id}`;
          if (this.repository.cashFlowClassifications.has(key)) continue;
          const seeded = seedDefaultCashFlowClassification({ accountRole: 'CHART', accountType: account.accountType, detailType: account.detailType });
          if (seeded.ok) this.repository.cashFlowClassifications.set(key, { ...seeded.value, accountRole: 'CHART', accountId: account.id, accountType: account.accountType, detailType: account.detailType });
        }
      }
      this.repository.audit = this.hydrate(parsed.audit ?? []);
      this.record('RESTORE_DATA', 'Company', this.repository.company.id, undefined, { version: 1 });
    });
  }

  createBackupBundle(): string {
    return this.backupBundles.create(this.exportAllData(), CURRENT_BACKUP_SCHEMA_VERSION, {
      companyId: this.repository.company.id,
      databaseBytes: this.repository.exportDatabaseBytes?.(),
    });
  }

  verifyBackupBundle(bundle: string): { valid: boolean; reason?: string } { const result = this.backupBundles.verify(bundle); return { valid: result.valid, reason: result.reason }; }

  validateBackupBundle(bundle: string): BackupValidationReport {
    const result = this.backupBundles.verify(bundle);
    if (!result.valid || !result.bundle) return { valid: false, reason: result.reason ?? 'Backup failed verification.' };
    try {
      const payload = JSON.parse(result.bundle.data) as { company?: { id?: string }; schemaVersion?: number; accounts?: unknown[]; chartAccounts?: unknown[]; transactions?: unknown[]; batches?: unknown[]; rules?: unknown[]; transfers?: unknown[]; taxSettings?: unknown[]; cashFlowClassifications?: unknown[]; audit?: unknown[] };
      if (payload.schemaVersion !== result.bundle.schemaVersion) return { valid: false, reason: 'Backup manifest and payload schema versions do not match.' };
      const recordCounts = {
        accounts: payload.accounts?.length ?? 0,
        chartAccounts: payload.chartAccounts?.length ?? 0,
        transactions: payload.transactions?.length ?? 0,
        batches: payload.batches?.length ?? 0,
        rules: payload.rules?.length ?? 0,
        transfers: payload.transfers?.length ?? 0,
        taxSettings: payload.taxSettings?.length ?? 0,
        cashFlowClassifications: payload.cashFlowClassifications?.length ?? 0,
        audit: payload.audit?.length ?? 0,
      };
      if (payload.company?.id !== this.repository.company.id) return { valid: false, reason: 'Backup belongs to a different company.', companyId: payload.company?.id, recordCounts };
      try {
        this.validatePortableClassifications(payload, result.bundle.schemaVersion);
      } catch (error) {
        return { valid: false, reason: error instanceof Error ? error.message : 'Backup Cash Flow classifications are invalid.', companyId: payload.company?.id, recordCounts };
      }
      return { valid: true, companyId: payload.company.id, recordCounts };
    } catch { return { valid: false, reason: 'Backup data could not be inspected.' }; }
  }

  restoreBackupBundle(bundle: string): void {
    const result = this.backupBundles.verify(bundle);
    if (!result.valid || !result.bundle) throw new AccountingError('BACKUP_INVALID', result.reason ?? 'Backup failed verification.');
    const validation = this.validateBackupBundle(bundle);
    if (!validation.valid) throw new AccountingError('BACKUP_INVALID', validation.reason ?? 'Backup Cash Flow classifications are invalid.');
    this.importAllData(result.bundle.data);
  }

  private validatePortableClassifications(payload: {
    accounts?: readonly any[];
    chartAccounts?: readonly any[];
    cashFlowClassifications?: readonly any[];
  }, schemaVersion: number): void {
    const currentSchema = schemaVersion >= CURRENT_BACKUP_SCHEMA_VERSION;
    const hasClassifications = Array.isArray(payload.cashFlowClassifications);
    if (currentSchema && (!Array.isArray(payload.accounts) || !Array.isArray(payload.chartAccounts) || !hasClassifications)) {
      throw new Error('Current-schema backup must include complete Cash Flow classifications.');
    }
    if (!hasClassifications) return;

    const accounts = new Map<string, { accountRole: 'FINANCIAL_SOURCE' | 'CHART'; accountType: string; detailType: string }>();
    for (const account of payload.accounts ?? []) {
      if (!account?.id || typeof account.accountType !== 'string' || typeof account.detailType !== 'string') throw new Error('Backup contains an invalid financial account structure.');
      const key = `FINANCIAL_SOURCE:${String(account.id)}`;
      if (accounts.has(key)) throw new Error(`Backup contains duplicate financial account ${key}.`);
      accounts.set(key, { accountRole: 'FINANCIAL_SOURCE', accountType: account.accountType, detailType: account.detailType });
    }
    for (const account of payload.chartAccounts ?? []) {
      if (!account?.id || typeof account.accountType !== 'string' || typeof account.detailType !== 'string') throw new Error('Backup contains an invalid Chart account structure.');
      const key = `CHART:${String(account.id)}`;
      if (accounts.has(key)) throw new Error(`Backup contains duplicate Chart account ${key}.`);
      accounts.set(key, { accountRole: 'CHART', accountType: account.accountType, detailType: account.detailType });
    }
    const seen = new Set<string>();
    for (const raw of payload.cashFlowClassifications!) {
      const role = raw?.accountRole;
      const accountId = raw?.accountId;
      if ((role !== 'FINANCIAL_SOURCE' && role !== 'CHART') || typeof accountId !== 'string') throw new Error('Backup contains a Cash Flow classification with an invalid account reference.');
      const key = `${role}:${accountId}`;
      if (seen.has(key)) throw new Error(`Backup contains duplicate Cash Flow classification ${key}.`);
      seen.add(key);
      const structure = accounts.get(key);
      if (!structure) throw new Error(`Backup contains a Cash Flow classification for unknown account ${key}.`);
      const accountUse = validateAccountUse({ accountType: structure.accountType, requestedRole: role });
      if (!accountUse.ok) throw new Error(`Backup contains an incompatible Cash Flow account structure for ${key}: ${accountUse.error.code}.`);
      const classification: CashFlowClassification = {
        ...(raw.cashRole === undefined ? {} : { cashRole: raw.cashRole }),
        treatment: raw.treatment,
        status: raw.status,
        source: raw.source,
        rationale: raw.rationale,
        ...(raw.modifiedAtUtc === undefined ? {} : { modifiedAtUtc: raw.modifiedAtUtc }),
      };
      const validation = validateCashFlowClassification({ ...structure, classification });
      if (!validation.ok) throw new Error(`Backup contains an invalid Cash Flow classification for ${key}: ${validation.error.code}.`);
      if (raw.accountType !== undefined && raw.accountType !== structure.accountType) throw new Error(`Backup Cash Flow classification ${key} has a stale account type.`);
      if (raw.detailType !== undefined && raw.detailType !== structure.detailType) throw new Error(`Backup Cash Flow classification ${key} has a stale detail type.`);
      if (raw.modifiedAtUtc !== undefined && (typeof raw.modifiedAtUtc !== 'string' || new Date(raw.modifiedAtUtc).toISOString() !== raw.modifiedAtUtc)) throw new Error(`Backup Cash Flow classification ${key} has an invalid modification timestamp.`);
    }
    if (currentSchema && seen.size !== accounts.size) throw new Error(`Current-schema backup has incomplete Cash Flow classification coverage (${seen.size}/${accounts.size}).`);
  }

  getDatabaseLocations() { return this.databaseLifecycle.getLocations(); }
  chooseBackupDirectory() { return this.databaseLifecycle.chooseBackupDirectory(); }
  backupDatabaseNow() { return this.databaseLifecycle.backupNow(); }
  relocateCurrentDatabase() { return this.databaseLifecycle.relocateCurrentDatabase(); }
  restoreDatabaseBackup() { return this.databaseLifecycle.restoreDatabaseBackup(); }

  exportReportCsv(report: ProfitLossReport, disclosure?: ReportExportDisclosure): string {
    const periods = this.reportDisplayPeriods(report);
    const lines = [
      ['Report', 'Profit and Loss'].map(value => this.csv(value)).join(','),
      ['From', report.startDate].map(value => this.csv(value)).join(','),
      ['Through', report.endDate].map(value => this.csv(value)).join(','),
      ['Grouping', report.grouping].map(value => this.csv(value)).join(','),
      '',
      'Section,Category,Period,Amount USD',
    ];
    this.reportExportRows(report).filter(row => row.showAmounts).forEach(row => {
      periods.forEach(period => lines.push([row.section, row.category, period, this.decimalAmount(row.values[period] ?? 0n)].map(value => this.csv(value)).join(',')));
      lines.push([row.section, row.category, 'TOTAL', this.decimalAmount(row.totalMinor)].map(value => this.csv(value)).join(','));
    });
    if (disclosure) lines.push('', ...this.reportDisclosureRows(disclosure).map(row => row.map(value => this.csv(value)).join(',')));
    return lines.join('\n');
  }

  exportReportXlsx(report: ProfitLossReport, disclosure?: ReportExportDisclosure): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    const rows = this.reportExportRows(report);
    const periods = this.reportDisplayPeriods(report);
    const matrix: Array<Array<string | number>> = [
      ['Profit and Loss', ...periods, 'Total'],
      ...rows.map(row => [`${'   '.repeat(row.depth)}${row.label}`, ...periods.map(period => row.showAmounts ? this.dollarNumber(row.values[period] ?? 0n) : ''), row.showAmounts ? this.dollarNumber(row.totalMinor) : '']),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    this.formatCurrencyColumns(sheet, 1, periods.length + 1, 1, matrix.length - 1);
    rows.forEach((row, index) => {
      if (!['SUBTOTAL', 'SYNTHETIC'].includes(row.kind)) return;
      for (let column = 0; column <= periods.length + 1; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
        if (cell) cell.s = { ...(cell.s ?? {}), font: { bold: true } };
      }
    });
    XLSX.utils.book_append_sheet(workbook, sheet, 'P&L Summary');
    const metadata = [
      ['From', report.startDate],
      ['Through', report.endDate],
      ['Grouping', report.grouping],
      ...(disclosure ? this.reportDisclosureRows(disclosure) : []),
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadata), 'Report Settings');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  }

  exportReportPrintHtml(report: ProfitLossReport, disclosure?: ReportExportDisclosure): string {
    const periods = this.reportDisplayPeriods(report);
    const heading = `<tr><th>Profit and loss</th>${periods.map(period => `<th>${this.html(period)}</th>`).join('')}<th>Total</th></tr>`;
    const rows = this.reportExportRows(report).map(row => `<tr class="${row.kind.toLowerCase()}"><${row.showAmounts ? (['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td') : 'th'} style="padding-left:${10 + row.depth * 18}px">${this.html(row.label)}</${row.showAmounts ? (['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td') : 'th'}>${row.showAmounts ? periods.map(period => `<${['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td'}>${this.html(formatMoney(money(row.values[period] ?? 0n)))}</${['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td'}>`).join('') + `<${['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td'}>${this.html(formatMoney(money(row.totalMinor)))}</${['SUBTOTAL', 'SYNTHETIC'].includes(row.kind) ? 'th' : 'td'}>` : `<td colspan="${periods.length + 1}"></td>`}</tr>`).join('');
    const disclosureHtml = disclosure ? `<section><h2>Schedule C disclosure</h2><dl>${this.reportDisclosureRows(disclosure).map(([label, value]) => `<dt>${this.html(label)}</dt><dd>${this.html(value)}</dd>`).join('')}</dl></section>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>Profit and Loss</title><style>body{font-family:Arial,sans-serif;color:#182b27;margin:32px}table{width:100%;border-collapse:collapse}td,th{padding:7px 10px;border-bottom:1px solid #d8dedb;text-align:right}td:first-child,th:first-child{text-align:left}.group th,.group td:first-child{background:#f4f7f4;font-weight:700}.subtotal th,.synthetic th{font-weight:800;border-top:1px solid #8b9a95}.synthetic th{background:#eef4ee}dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 16px}dt{font-weight:700}dd{margin:0}@media print{body{margin:0}}</style></head><body><h1>Profit and Loss</h1><p>${this.html(report.startDate)} through ${this.html(report.endDate)} · grouped by ${this.html(report.grouping.toLowerCase())}</p><table><thead>${heading}</thead><tbody>${rows}</tbody></table>${disclosureHtml}</body></html>`;
  }

  exportReportDetailCsv(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds: string[] = []): string {
    return this.exportProfitLossDrilldownCsv({ startDate, endDate, grouping: 'YEAR', chartAccountId, excludedChartAccountIds });
  }

  exportReportDetailXlsx(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds: string[] = []): ArrayBuffer {
    return this.exportProfitLossDrilldownXlsx({ startDate, endDate, grouping: 'YEAR', chartAccountId, excludedChartAccountIds });
  }

  exportProfitLossDrilldownCsv(query: ReportDrilldownQuery): string {
    const rows = this.getProfitLossDrilldown(query);
    return ['Transaction ID,Account ID,Posting Date,Description,Payee,Memo,Chart Account ID,Category Amount USD,P/L Contribution USD,Source Batch ID', ...rows.map(row => [row.transactionId, row.accountId, row.postingDate, row.description ?? '', row.payee ?? '', row.memo ?? '', row.chartAccountId, this.decimalAmount(row.amountMinor), this.decimalAmount(row.reportContributionMinor), row.sourceBatchId ?? ''].map(value => this.csv(String(value))).join(','))].join('\n');
  }

  exportProfitLossDrilldownXlsx(query: ReportDrilldownQuery): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    const rows = this.getProfitLossDrilldown(query).map(row => ({
      transactionId: row.transactionId,
      accountId: row.accountId,
      postingDate: row.postingDate,
      description: row.description ?? '',
      payee: row.payee ?? '',
      memo: row.memo ?? '',
      chartAccountId: row.chartAccountId,
      categoryAmountUsd: this.dollarNumber(row.amountMinor),
      profitLossContributionUsd: this.dollarNumber(row.reportContributionMinor),
      sourceBatchId: row.sourceBatchId ?? '',
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    this.formatCurrencyColumns(sheet, 7, 8, 1, rows.length);
    XLSX.utils.book_append_sheet(workbook, sheet, 'P&L Detail');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  }

  private reportDisplayPeriods(report: ProfitLossReport): string[] {
    return report.grouping === 'YEAR' && report.periods.length === 1 ? [] : report.periods;
  }

  private reportExportRows(report: ProfitLossReport): Array<{ label: string; section: string; category: string; values: Record<string, bigint>; totalMinor: bigint; kind: 'GROUP' | 'ACCOUNT' | 'SUBTOTAL' | 'SYNTHETIC'; depth: number; showAmounts: boolean }> {
    type ExportRow = { label: string; section: string; category: string; values: Record<string, bigint>; totalMinor: bigint; kind: 'GROUP' | 'ACCOUNT' | 'SUBTOTAL' | 'SYNTHETIC'; depth: number; showAmounts: boolean };
    const result: ExportRow[] = [];
    const addAccount = (cell: ProfitLossCell, section: ProfitLossCell, depth: number): void => {
      const path = this.chartAccountPath(cell.key) || cell.label;
      if (!cell.children.length) {
        result.push({ label: cell.label, section: section.label, category: path, values: cell.values, totalMinor: cell.totalMinor, kind: 'ACCOUNT', depth, showAmounts: true });
        return;
      }
      const hasDirectActivity = (cell.directTotalMinor ?? 0n) !== 0n || Object.values(cell.directValues ?? {}).some(value => value !== 0n);
      result.push({ label: cell.label, section: section.label, category: path, values: cell.directValues ?? {}, totalMinor: cell.directTotalMinor ?? 0n, kind: 'GROUP', depth, showAmounts: hasDirectActivity });
      cell.children.forEach(child => addAccount(child, section, depth + 1));
      result.push({ label: `Total for ${cell.label}`, section: section.label, category: `Total for ${path}`, values: cell.values, totalMinor: cell.totalMinor, kind: 'SUBTOTAL', depth, showAmounts: true });
    };
    report.sections.forEach(section => {
      result.push({ label: section.label, section: section.label, category: '', values: {}, totalMinor: 0n, kind: 'GROUP', depth: 0, showAmounts: false });
      section.children.forEach(child => addAccount(child, section, 1));
      result.push({ label: `Total for ${section.label}`, section: section.label, category: `Total for ${section.label}`, values: section.values, totalMinor: section.totalMinor, kind: 'SUBTOTAL', depth: 0, showAmounts: true });
      if (section.key === 'COGS') {
        result.push({
          label: 'Gross Profit',
          section: 'Gross Profit',
          category: '',
          values: Object.fromEntries(report.periods.map(period => [period, this.reportSectionValue(report, 'INCOME', period) - this.reportSectionValue(report, 'COGS', period)])),
          totalMinor: this.reportSectionValue(report, 'INCOME') - this.reportSectionValue(report, 'COGS'),
          kind: 'SYNTHETIC',
          depth: 0,
          showAmounts: true,
        });
      }
    });
    result.push({
      label: 'Net Profit',
      section: 'Net Profit',
      category: '',
      values: Object.fromEntries(report.periods.map(period => [period, this.netProfitForPeriod(report, period)])),
      totalMinor: report.netProfitMinor,
      kind: 'SYNTHETIC',
      depth: 0,
      showAmounts: true,
    });
    return result;
  }

  private reportSectionValue(report: ProfitLossReport, key: string, period?: string): bigint {
    const section = report.sections.find(item => item.key === key);
    return period ? section?.values[period] ?? 0n : section?.totalMinor ?? 0n;
  }

  private reportDisclosureRows(disclosure: ReportExportDisclosure): string[][] {
    return [
      ['Schedule C tax year', disclosure.taxYear.toString()],
      ['Federal income-tax expense', disclosure.includeFederalIncomeTax ? 'Included' : 'Excluded'],
      ['State/local income-tax expense', disclosure.includeStateLocalIncomeTax ? 'Included' : 'Excluded'],
      ['Removed tax', formatMoney(money(disclosure.removedTaxMinor))],
      ['Configured tax accounts', disclosure.configuredTaxAccounts.join(', ') || 'None'],
    ];
  }

  private chartAccountPath(chartAccountId: string): string {
    const parts: string[] = [];
    const visited = new Set<string>();
    let current = this.repository.chartAccounts.get(chartAccountId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      parts.unshift(this.reportAccountLabel(current.name));
      current = current.parentId ? this.repository.chartAccounts.get(current.parentId) : undefined;
    }
    return parts.join(':');
  }

  private decimalAmount(minorUnits: bigint): string {
    const sign = minorUnits < 0n ? '-' : '';
    const absolute = minorUnits < 0n ? -minorUnits : minorUnits;
    return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  private dollarNumber(minorUnits: bigint): number { return Number(minorUnits) / 100; }

  private formatCurrencyColumns(sheet: XLSX.WorkSheet, firstColumn: number, lastColumn: number, firstRow: number, lastRow: number): void {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell?.t === 'n') cell.z = '$#,##0.00;[Red]-$#,##0.00';
      }
    }
  }

  private buildReport(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excluded: Set<string>): ProfitLossReport {
    const periods = this.periods(startDate, endDate, grouping);
    const included = [...this.repository.transactions.values()].filter(transaction => transaction.state === 'POSTED' && transaction.postingDate >= startDate && transaction.postingDate <= endDate);
    const sectionNames = ['Income', 'COGS', 'Expenses', 'Other Income', 'Other Expense'];
    const sections = sectionNames.map(name => this.makeCell(name, name.toUpperCase().replace(' ', '_'), periods));
    this.currentSections = sections;
    const chartById = this.repository.chartAccounts;
    const cellByChartId = new Map<string, ProfitLossCell>();
    const ensureCell = (chart: ChartAccount, section: ProfitLossCell): ProfitLossCell => {
      const existing = cellByChartId.get(chart.id);
      if (existing) return existing;
      const cell = this.makeCell(this.reportAccountLabel(chart.name), chart.id, periods);
      cellByChartId.set(chart.id, cell);
      const parentChart = chart.parentId ? chartById.get(chart.parentId) : undefined;
      const parentSection = parentChart ? this.sectionFor(parentChart.type) : undefined;
      if (parentChart && parentSection?.key === section.key) {
        ensureCell(parentChart, section).children.push(cell);
      } else {
        section.children.push(cell);
      }
      return cell;
    };
    included.forEach(transaction => transaction.splits.forEach(split => {
      if (excluded.has(split.chartAccountId)) return;
      const chart = chartById.get(split.chartAccountId);
      if (!chart) return;
      const section = this.sectionFor(chart.type);
      if (!section) return;
      const period = grouping === 'MONTH' ? transaction.postingDate.slice(0, 7) : transaction.postingDate.slice(0, 4);
      const amount = ['INCOME', 'OTHER_INCOME'].includes(chart.type) ? split.amount.minorUnits : -split.amount.minorUnits;
      section.values[period] = (section.values[period] ?? 0n) + amount;
      section.totalMinor += amount;
      const directCell = ensureCell(chart, section);
      directCell.directValues![period] = (directCell.directValues![period] ?? 0n) + amount;
      directCell.directTotalMinor = (directCell.directTotalMinor ?? 0n) + amount;
      const visited = new Set<string>();
      let aggregateChart: ChartAccount | undefined = chart;
      while (aggregateChart && !visited.has(aggregateChart.id) && this.sectionFor(aggregateChart.type)?.key === section.key) {
        visited.add(aggregateChart.id);
        const aggregateCell = ensureCell(aggregateChart, section);
        aggregateCell.values[period] = (aggregateCell.values[period] ?? 0n) + amount;
        aggregateCell.totalMinor += amount;
        aggregateChart = aggregateChart.parentId ? chartById.get(aggregateChart.parentId) : undefined;
      }
    }));
    const sortCells = (cells: ProfitLossCell[]): void => {
      cells.sort((left, right) => (chartById.get(left.key)?.displayOrder ?? Number.MAX_SAFE_INTEGER) - (chartById.get(right.key)?.displayOrder ?? Number.MAX_SAFE_INTEGER) || left.label.localeCompare(right.label));
      cells.forEach(cell => sortCells(cell.children));
    };
    sections.forEach(section => sortCells(section.children));
    const income = this.sectionByKey(sections, 'INCOME').totalMinor;
    const cogs = this.sectionByKey(sections, 'COGS').totalMinor;
    const expenses = this.sectionByKey(sections, 'EXPENSES').totalMinor;
    const otherIncome = this.sectionByKey(sections, 'OTHER_INCOME').totalMinor;
    const otherExpense = this.sectionByKey(sections, 'OTHER_EXPENSE').totalMinor;
    const netProfitMinor = calculateUnadjustedNetProfit([...this.repository.transactions.values()], [...this.repository.chartAccounts.values()], startDate, endDate, excluded);
    if (netProfitMinor !== income - cogs - expenses + otherIncome - otherExpense) throw new AccountingError('REPORT_RECONCILIATION_FAILED', 'Profit and Loss sections do not reconcile to transaction detail.');
    return { startDate, endDate, grouping, periods, sections, netProfitMinor, reconciliationDifferenceMinor: 0n };
  }

  private netProfitForPeriod(report: ProfitLossReport, period: string): bigint {
    const value = (key: string): bigint => report.sections.find(section => section.key === key)?.values[period] ?? 0n;
    return value('INCOME') - value('COGS') - value('EXPENSES') + value('OTHER_INCOME') - value('OTHER_EXPENSE');
  }

  private matchesDrilldownSection(chartAccountId: string, sectionKey: ProfitLossSectionKey): boolean {
    if (sectionKey === 'TAX_REMOVED') return true;
    const type = this.repository.chartAccounts.get(chartAccountId)?.type;
    if (!type) return false;
    if (sectionKey === 'GROSS_PROFIT') return type === 'INCOME' || type === 'COGS';
    if (sectionKey === 'NET_PROFIT') return ['INCOME', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE'].includes(type);
    const typeBySection: Record<Exclude<ProfitLossSectionKey, 'GROSS_PROFIT' | 'NET_PROFIT' | 'TAX_REMOVED'>, ChartAccount['type']> = {
      INCOME: 'INCOME',
      COGS: 'COGS',
      EXPENSES: 'EXPENSE',
      OTHER_INCOME: 'OTHER_INCOME',
      OTHER_EXPENSE: 'OTHER_EXPENSE',
    };
    return type === typeBySection[sectionKey];
  }

  private drilldownContribution(row: ReportDetailRow, query: ReportDrilldownQuery): bigint {
    const type = this.repository.chartAccounts.get(row.chartAccountId)?.type;
    if (!type) return row.amountMinor;
    if (query.sectionKey === 'GROSS_PROFIT') return type === 'COGS' ? -row.amountMinor : row.amountMinor;
    if (query.sectionKey === 'NET_PROFIT' || (!query.sectionKey && !query.chartAccountId && !query.categoryIds)) return this.netProfitContribution(type, row.amountMinor);
    return row.amountMinor;
  }

  private netProfitContribution(type: ChartAccount['type'], amountMinor: bigint): bigint {
    return ['COGS', 'EXPENSE', 'OTHER_EXPENSE'].includes(type) ? -amountMinor : amountMinor;
  }

  private makeCell(label: string, key: string, periods: string[]): ProfitLossCell {
    return { label, key, values: Object.fromEntries(periods.map(period => [period, 0n])), totalMinor: 0n, children: [], directValues: Object.fromEntries(periods.map(period => [period, 0n])), directTotalMinor: 0n };
  }

  private reportAccountLabel(name: string): string { return name.split(':').at(-1)?.trim() || name; }

  private sectionFor(type: ChartAccount['type']): ProfitLossCell | undefined {
    const key = type === 'INCOME' ? 'INCOME' : type === 'COGS' ? 'COGS' : type === 'EXPENSE' ? 'EXPENSES' : type === 'OTHER_INCOME' ? 'OTHER_INCOME' : 'OTHER_EXPENSE';
    if (['ASSET', 'LIABILITY', 'EQUITY'].includes(type)) return undefined;
    return this.sectionByKey(this.currentSections, key);
  }

  private currentSections: ProfitLossCell[] = [];

  private sectionByKey(sections: ProfitLossCell[], key: string): ProfitLossCell {
    return sections.find(section => section.key === key) ?? { label: key, key, values: {}, totalMinor: 0n, children: [] };
  }

  private periods(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR'): string[] {
    const result: string[] = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    while (cursor <= end) {
      const value = grouping === 'MONTH' ? cursor.toISOString().slice(0, 7) : cursor.toISOString().slice(0, 4);
      if (!result.includes(value)) result.push(value);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return result;
  }

  private validateDateRange(startDate: string, endDate: string): void {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    if (!valid || startDate > endDate) throw new AccountingError('REPORT_DATE_RANGE_INVALID', 'Report dates must be valid YYYY-MM-DD values with start on or before end.');
  }

  private sumTaxAccounts(accountIds: string[], startDate: string, endDate: string): bigint {
    return [...this.repository.transactions.values()].filter(transaction => transaction.state === 'POSTED' && transaction.postingDate >= startDate && transaction.postingDate <= endDate)
      .flatMap(transaction => transaction.splits).filter(split => accountIds.includes(split.chartAccountId)).reduce((sum, split) => sum - split.amount.minorUnits, 0n);
  }

  private buildFinancialAccount(id: string, command: SaveAccountCommand, archived: boolean): FinancialAccount {
    const definition = FINANCIAL_ACCOUNT_TYPES.find(type => type.value === command.type);
    const accountType = command.type === 'BANK' ? 'BANK' : command.type === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'OTHER_CURRENT_ASSET';
    const supportedSourceKinds = command.type === 'ENTITY' ? ['CSV', 'EXCEL', 'AMAZON'] as const : ['CSV', 'EXCEL', 'QBO_OFX'] as const;
    return {
      id,
      type: command.type,
      accountType,
      classificationStatus: 'CONFIRMED',
      importEnabled: true,
      supportedSourceKinds: [...supportedSourceKinds],
      openingBalanceSource: 'DERIVED_EQUITY',
      detailType: command.detailType?.trim() || definition?.detailTypes[0] || '',
      name: command.name.trim(),
      institutionOrEntity: command.institutionOrEntity.trim(),
      lastFour: command.lastFour?.trim() || undefined,
      parentAccountId: command.parentAccountId || undefined,
      description: command.description?.trim() || undefined,
      openingBalance: money(command.openingBalanceMinor),
      openingBalanceDate: command.openingBalanceDate,
      archived,
      locked: Boolean(command.locked),
    };
  }

  private validateFinancialAccounts(accounts: FinancialAccount[]): void {
    const byId = new Map(accounts.map(account => [account.id, account]));
    const names = new Set<string>();
    for (const account of accounts) {
      if (!account.name) throw new AccountingError('ACCOUNT_NAME_REQUIRED', 'Account name is required.');
      const normalizedName = account.name.toLocaleLowerCase();
      if (names.has(normalizedName)) throw new AccountingError('ACCOUNT_NAME_DUPLICATE', `Account already exists: ${account.name}`);
      names.add(normalizedName);
      const definition = FINANCIAL_ACCOUNT_TYPES.find(type => type.value === account.type);
      if (!definition) throw new AccountingError('ACCOUNT_TYPE_INVALID', 'Account type must be Bank, Credit Card, or Entity.');
      if (!definition.detailTypes.includes(account.detailType)) throw new AccountingError('ACCOUNT_DETAIL_TYPE_INVALID', `${account.detailType || 'Blank detail type'} is not valid for ${definition.label}.`);
      if (account.lastFour && !/^\d{4}$/.test(account.lastFour)) throw new AccountingError('ACCOUNT_LAST_FOUR_INVALID', 'Last four must contain exactly four digits.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(account.openingBalanceDate) || Number.isNaN(Date.parse(`${account.openingBalanceDate}T00:00:00Z`))) throw new AccountingError('ACCOUNT_DATE_INVALID', 'Opening balance date must be a valid YYYY-MM-DD date.');
      if (account.archived && account.locked) throw new AccountingError('ACCOUNT_LOCKED', `Archived account cannot remain locked: ${account.name}`);
      if (account.parentAccountId) {
        if (account.parentAccountId === account.id) throw new AccountingError('ACCOUNT_PARENT_SELF', 'An account cannot be its own parent.');
        const parent = byId.get(account.parentAccountId);
        if (!parent) throw new AccountingError('ACCOUNT_PARENT_NOT_FOUND', `Parent account not found for ${account.name}.`);
        if (parent.type !== account.type) throw new AccountingError('ACCOUNT_PARENT_TYPE_INVALID', 'A subaccount must have the same account type as its parent.');
        if (!account.archived && parent.archived) throw new AccountingError('ACCOUNT_PARENT_ARCHIVED', 'An active subaccount cannot belong to an archived parent.');
      }
      const visited = new Set<string>([account.id]);
      let current = account.parentAccountId ? byId.get(account.parentAccountId) : undefined;
      while (current) {
        if (visited.has(current.id)) throw new AccountingError('ACCOUNT_PARENT_CYCLE', `Account hierarchy contains a cycle at ${account.name}.`);
        visited.add(current.id);
        current = current.parentAccountId ? byId.get(current.parentAccountId) : undefined;
      }
    }
  }

  private calculateAccountBalance(accountId: string): ReturnType<typeof money> {
    const account = this.repository.accounts.get(accountId)!;
    const activity = [...this.repository.transactions.values()].filter(transaction => transaction.accountId === accountId && ['POSTED', 'MATCHED_TRANSFER'].includes(transaction.state)).reduce((sum, transaction) => sum + transaction.amount.minorUnits, 0n);
    return money(account.openingBalance.minorUnits + activity, account.openingBalance.currency);
  }

  private requireTransaction(id: string): Transaction {
    const transaction = this.repository.transactions.get(id);
    if (!transaction) throw new AccountingError('TRANSACTION_NOT_FOUND', `Transaction not found: ${id}`);
    return transaction;
  }

  private validateChartRows(rows: ChartAccount[]): void {
    const allowed = new Set<ChartAccount['type']>(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE']);
    const ids = new Set<string>();
    const names = new Set<string>();
    rows.forEach(row => {
      const definition = CHART_ACCOUNT_TYPES.find(item => item.value === row.accountType);
      if (!row.name || ids.has(row.id) || names.has(row.name.toLowerCase()) || !allowed.has(row.type) || !definition || definition.reportingType !== row.type || !row.detailType.trim() || !Number.isInteger(row.displayOrder)) throw new AccountingError('CHART_INVALID', `Invalid chart row: ${row.name || row.id}`);
      ids.add(row.id);
      names.add(row.name.toLowerCase());
    });
    rows.forEach(row => {
      if (!row.parentId) return;
      const parent = rows.find(candidate => candidate.id === row.parentId);
      if (!parent) throw new AccountingError('CHART_PARENT_INVALID', `Missing chart parent: ${row.parentId}`);
      if (parent.id === row.id) throw new AccountingError('CHART_PARENT_SELF', 'An account cannot be its own parent.');
      if (parent.accountType !== row.accountType) throw new AccountingError('CHART_PARENT_TYPE_INVALID', `${row.name} must use a parent with the same account type.`);
    });
    rows.forEach(row => {
      const visited = new Set<string>();
      let current = row;
      while (current.parentId) {
        if (visited.has(current.id)) throw new AccountingError('CHART_CYCLE', `Chart hierarchy cycle at ${current.id}.`);
        visited.add(current.id);
        current = rows.find(candidate => candidate.id === current.parentId)!;
      }
    });
  }

  private validateChartImportReferences(rows: readonly ChartAccount[]): void {
    const priorChart = new Map(this.repository.chartAccounts);
    const referenced = [
      ...[...this.repository.transactions.values()].flatMap(transaction => transaction.splits.map(split => split.chartAccountId)),
      ...[...this.repository.rules.values()].filter(rule => rule.enabled).map(rule => rule.chartAccountId).filter((id): id is string => Boolean(id)),
    ];
    const importedIds = new Set(rows.map(row => row.id));
    const importedNames = new Set(rows.map(row => row.name.toLowerCase()));
    const defaultTaxNames = new Set(['federal income tax', 'state and local income tax']);
    const configuredTaxReferences = [...this.repository.taxSettings.values()]
      .flatMap(settings => [...settings.federalIncomeTaxAccountIds, ...settings.stateLocalIncomeTaxAccountIds])
      .filter(id => {
        const priorName = priorChart.get(id)?.name.toLowerCase();
        return priorName && !defaultTaxNames.has(priorName) && !importedIds.has(id) && !importedNames.has(priorName);
      });
    if (referenced.some(id => !importedIds.has(id)) || configuredTaxReferences.length) {
      throw new AccountingError('CHART_REFERENCE_ORPHANED', 'The workbook would orphan an existing transaction, rule, or configured tax-setting account reference.');
    }
  }

  private hasCashFlowWorkbookFields(row: Record<string, string | number | boolean>): boolean {
    return ['Cash Flow Cash Role', 'Cash Flow Treatment', 'Cash Flow Status', 'Cash Flow Source', 'Cash Flow Rationale'].some(key => Object.prototype.hasOwnProperty.call(row, key) && String(row[key] ?? '').trim() !== '');
  }

  private parseChartCashFlowClassification(row: Record<string, string | number | boolean>, account: ChartAccount, rowNumber: number, issues: ChartAccountImportIssue[]): CashFlowClassification | undefined {
    const cashRole = String(row['Cash Flow Cash Role'] ?? '').trim();
    const treatment = String(row['Cash Flow Treatment'] ?? '').trim();
    const status = String(row['Cash Flow Status'] ?? '').trim();
    const source = String(row['Cash Flow Source'] ?? '').trim();
    const rationale = String(row['Cash Flow Rationale'] ?? '').trim();
    const classification = {
      ...(cashRole ? { cashRole: cashRole as CashFlowClassification['cashRole'] } : {}),
      treatment: treatment as CashFlowClassification['treatment'],
      status: status as CashFlowClassification['status'],
      source: source as CashFlowClassification['source'],
      rationale,
    };
    const validation = validateCashFlowClassification({ accountRole: 'CHART', accountType: account.accountType, detailType: account.detailType, classification });
    if (!validation.ok) {
      issues.push({ rowNumber, code: 'CASH_FLOW_CLASSIFICATION_INVALID', message: `Invalid Cash Flow classification for ${account.name}: ${validation.error.message}`, accountId: account.id });
      return undefined;
    }
    return validation.value.classification;
  }

  private hydrate(value: any): any {
    if (typeof value === 'string' && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1));
    if (Array.isArray(value)) return value.map(item => this.hydrate(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.hydrate(item)]));
    return value;
  }

  private mapChartType(value: string): ChartAccount['type'] {
    const normalized = value.toLowerCase().replaceAll('_', ' ');
    if (normalized.includes('income') && !normalized.includes('other')) return 'INCOME';
    if (normalized.includes('cost of goods') || normalized === 'cogs') return 'COGS';
    if (normalized === 'expenses' || normalized === 'expense') return 'EXPENSE';
    if (normalized.includes('other income')) return 'OTHER_INCOME';
    if (normalized.includes('other expense')) return 'OTHER_EXPENSE';
    if (normalized.includes('liabilit') || normalized.includes('payable') || normalized.includes('credit card')) return 'LIABILITY';
    if (normalized.includes('equity')) return 'EQUITY';
    return 'ASSET';
  }

  private mapChartAccountKind(value: string): ChartAccountKind {
    const normalized = value.trim().toLowerCase().replaceAll('_', ' ').replace(/[()]/g, '');
    if (normalized.includes('receivable') || normalized === 'a/r') return 'ACCOUNTS_RECEIVABLE';
    if (normalized.includes('payable') || normalized === 'a/p') return 'ACCOUNTS_PAYABLE';
    if (normalized.includes('credit card')) return 'CREDIT_CARD';
    if (normalized.includes('bank') || normalized.includes('cash on hand')) return 'BANK';
    if (normalized.includes('other current asset')) return 'OTHER_CURRENT_ASSET';
    if (normalized.includes('fixed asset')) return 'FIXED_ASSET';
    if (normalized.includes('other asset') || normalized === 'asset' || normalized === 'assets') return 'OTHER_ASSET';
    if (normalized.includes('long term liabil')) return 'LONG_TERM_LIABILITY';
    if (normalized.includes('other current liabil') || normalized === 'liability' || normalized === 'liabilities') return 'OTHER_CURRENT_LIABILITY';
    if (normalized.includes('equity')) return 'EQUITY';
    if (normalized.includes('cost of goods') || normalized === 'cogs') return 'COGS';
    if (normalized.includes('other income')) return 'OTHER_INCOME';
    if (normalized.includes('other expense')) return 'OTHER_EXPENSE';
    if (normalized.includes('income')) return 'INCOME';
    if (normalized.includes('expense')) return 'EXPENSE';
    throw new AccountingError('CHART_ACCOUNT_TYPE_INVALID', `Unsupported chart account type: ${value}.`);
  }

  private chartAccountDefinition(accountType: ChartAccountKind) {
    const definition = CHART_ACCOUNT_TYPES.find(item => item.value === accountType);
    if (!definition) throw new AccountingError('CHART_ACCOUNT_TYPE_INVALID', `Unsupported chart account type: ${accountType}.`);
    return definition;
  }

  private buildChartAccount(id: string, command: SaveChartAccountCommand, archived: boolean): ChartAccount {
    const leafName = command.name.trim().split(':').pop()?.trim() ?? '';
    if (!leafName) throw new AccountingError('CHART_NAME_REQUIRED', 'Account name is required.');
    const definition = this.chartAccountDefinition(command.accountType);
    if (!command.detailType.trim()) throw new AccountingError('CHART_DETAIL_TYPE_REQUIRED', 'Detail type is required.');
    if (!Number.isInteger(command.displayOrder)) throw new AccountingError('CHART_DISPLAY_ORDER_INVALID', 'Display order must be a whole number.');
    const parent = command.parentId ? this.requireChartAccount(command.parentId) : undefined;
    if (parent?.id === id) throw new AccountingError('CHART_PARENT_SELF', 'An account cannot be its own parent.');
    if (parent && parent.accountType !== command.accountType) throw new AccountingError('CHART_PARENT_TYPE_INVALID', 'The parent must use the same account type.');
    return {
      id,
      name: parent ? `${parent.name}:${leafName}` : leafName,
      parentId: parent?.id,
      type: definition.reportingType,
      accountType: command.accountType,
      detailType: command.detailType.trim(),
      description: command.description?.trim() || undefined,
      displayOrder: command.displayOrder,
      archived,
      locked: command.locked,
    };
  }

  private workbookBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return ['true', 'yes', '1', 'active', 'locked'].includes(String(value ?? '').trim().toLowerCase());
  }

  private chartId(name: string): string {
    return `chart-${this.stableHash(name)}`;
  }

  private ruleId(name: string, index: number): string {
    return `rule-${this.stableHash(`${index}:${name}`)}`;
  }

  private stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }

  private mapImportedCondition(condition: { ruleType: number; value: string }): RuleCondition {
    if (condition.ruleType === 10) return { field: 'DIRECTION', operator: 'EQUALS', value: condition.value === '-1' ? 'OUT' : 'IN' };
    if (condition.ruleType === 6) return { field: 'PAYEE', operator: 'CONTAINS', value: condition.value };
    if (condition.ruleType === 8) return { field: 'MEMO', operator: 'CONTAINS', value: condition.value };
    return { field: 'DESCRIPTION', operator: 'CONTAINS', value: condition.value };
  }

  private csv(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
  private html(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

  private transactionAmountSearchValues(transaction: Transaction): string[] {
    const display = formatMoney(transaction.amount);
    const decimal = display.replace('$', '');
    const sign = transaction.amount.minorUnits < 0n ? '-' : '';
    const positivePrefix = transaction.amount.minorUnits >= 0n ? '+' : '';
    const unsigned = decimal.replace(/^[+-]/, '');
    const [whole, cents] = unsigned.split('.');
    const grouped = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
    return [
      display,
      decimal,
      `${sign}$${grouped}`,
      `${sign}${grouped}`,
      `${positivePrefix}$${unsigned}`,
      `${positivePrefix}${unsigned}`,
      `${positivePrefix}$${grouped}`,
      `${positivePrefix}${grouped}`,
    ];
  }

  private requireChartAccount(id: string): ChartAccount {
    const chart = this.repository.chartAccounts.get(id);
    if (!chart || chart.archived) throw new AccountingError('CHART_ACCOUNT_INVALID', `Chart account not found or archived: ${id}`);
    return chart;
  }

  private validateTransaction(transaction: Transaction, requireSplit: boolean): void {
    if (!transaction.postingDate || !transaction.amount) throw new AccountingError('TRANSACTION_INVALID', 'Posting date and amount are required.');
    if (requireSplit && !transaction.splits.length) throw new AccountingError('SPLIT_REQUIRED', 'A posted transaction requires at least one split.');
    const total = transaction.splits.reduce((sum, split) => sum + split.amount.minorUnits, 0n);
    if (requireSplit && total !== transaction.amount.minorUnits) throw new AccountingError('SPLIT_UNBALANCED', 'Posting splits must equal the transaction amount exactly.');
    transaction.splits.forEach(split => this.requireChartAccount(split.chartAccountId));
  }

  private validateExchangeRule(rule: TransactionRule): void {
    if (!rule.id.trim()) throw new AccountingError('RULE_ID_REQUIRED', 'Rule ID is required.');
    if (!rule.name.trim()) throw new AccountingError('RULE_NAME_REQUIRED', 'Rule name is required.');
    if (!Number.isInteger(rule.priority) || rule.priority < 1) throw new AccountingError('RULE_PRIORITY_INVALID', 'Rule priority must be a positive integer.');
    if (!['ALL', 'ANY'].includes(rule.matchMode ?? 'ALL')) throw new AccountingError('RULE_MATCH_MODE_INVALID', 'Match mode must be ALL or ANY.');
    if (!rule.conditions.length) throw new AccountingError('RULE_CONDITIONS_REQUIRED', 'At least one rule condition is required.');
    rule.conditions.forEach(condition => {
      if (!['ACCOUNT', 'DIRECTION', 'DESCRIPTION', 'PAYEE', 'MEMO', 'AMOUNT', 'SOURCE_TYPE'].includes(condition.field)) throw new AccountingError('RULE_CONDITION_FIELD_INVALID', `Unsupported rule condition field: ${condition.field}.`);
      if (!['EQUALS', 'CONTAINS', 'STARTS_WITH', 'RANGE'].includes(condition.operator)) throw new AccountingError('RULE_CONDITION_OPERATOR_INVALID', `Unsupported rule condition operator: ${condition.operator}.`);
      if (!condition.value.trim()) throw new AccountingError('RULE_CONDITION_VALUE_REQUIRED', 'Every rule condition requires a value.');
      if (condition.operator === 'RANGE' && (!condition.secondValue?.trim() || !Number.isFinite(Number(condition.value)) || !Number.isFinite(Number(condition.secondValue)))) throw new AccountingError('RULE_RANGE_INVALID', 'A range condition requires two numeric values.');
    });
    if (rule.chartAccountId) this.requireChartAccount(rule.chartAccountId);
  }

  private ruleMatches(rule: TransactionRule, transaction: Transaction): boolean {
    const results = rule.conditions.map(condition => {
      const actual = condition.field === 'ACCOUNT' ? transaction.accountId
        : condition.field === 'DIRECTION' ? (transaction.amount.minorUnits >= 0n ? 'IN' : 'OUT')
          : condition.field === 'DESCRIPTION' ? transaction.description
              : condition.field === 'PAYEE' ? transaction.payee ?? transaction.rawPayee ?? transaction.description
                : condition.field === 'MEMO' ? transaction.memo ?? transaction.description
                : condition.field === 'AMOUNT' ? transaction.amount.minorUnits.toString()
                : transaction.sourceBatchId ? 'IMPORT' : 'MANUAL';
      let matched = condition.operator === 'EQUALS' ? actual.toLowerCase() === condition.value.toLowerCase()
        : condition.operator === 'CONTAINS' ? actual.toLowerCase().includes(condition.value.toLowerCase())
          : condition.operator === 'STARTS_WITH' ? actual.toLowerCase().startsWith(condition.value.toLowerCase())
            : transaction.amount.minorUnits >= BigInt(condition.value) && transaction.amount.minorUnits <= BigInt(condition.secondValue ?? condition.value);
      if (condition.negate) matched = !matched;
      return matched;
    });
    return rule.matchMode === 'ANY' ? results.some(Boolean) : results.every(Boolean);
  }

  private record(operation: string, entityType: string, entityId: string, before?: unknown, after?: unknown, reason?: string, correlationId?: string): void {
    const event: AuditEvent = { id: newId(), timestampUtc: nowUtc(), operation, entityType, entityId, before: structuredClone(before), after: structuredClone(after), reason, correlationId };
    this.repository.audit.push(event);
  }

  /**
   * Structural account edits are an explicit Cash Flow reclassification, not a
   * repository-side defaulting opportunity.  Keep the replacement auditable so
   * a malformed or legacy classification can never be silently erased by a
   * normal account save.
   */
  private reclassifyCashFlowAfterStructureChange(
    accountRole: 'FINANCIAL_SOURCE' | 'CHART',
    accountId: string,
    accountType: string,
    detailType: string,
  ): void {
    const seeded = seedDefaultCashFlowClassification({ accountRole, accountType, detailType });
    if (!seeded.ok) throw new AccountingError('ACCOUNT_CLASSIFICATION_INVALID', `Unable to reclassify Cash Flow account ${accountId}: ${seeded.error.code}.`);
    const key = `${accountRole}:${accountId}`;
    const before = this.repository.cashFlowClassifications.get(key);
    const modifiedAtUtc = nowUtc();
    const classification: CashFlowClassification = {
      ...seeded.value,
      source: 'USER',
      modifiedAtUtc,
      rationale: 'User changed the account structure; apply the new structural Cash Flow default and review if ambiguous.',
    };
    const normalized = { ...classification, accountRole, accountId, accountType, detailType: detailType.trim() };
    this.repository.cashFlowClassifications.set(key, normalized);
    this.repository.audit.push({
      id: newId(), timestampUtc: modifiedAtUtc, operation: 'RECLASSIFY_CASH_FLOW_CLASSIFICATION',
      entityType: accountRole === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
      entityId: accountId, before: structuredClone(before), after: structuredClone(normalized), reason: classification.rationale,
    });
  }

  private resetTransfer(match: TransferMatch): void {
    [match.leftTransactionId, match.rightTransactionId].forEach(id => {
      const transaction = this.requireTransaction(id);
      const before = structuredClone(transaction);
      transaction.state = 'PENDING';
      transaction.transferMatchId = undefined;
      transaction.modifiedAtUtc = nowUtc();
      this.record('UNMATCH_TRANSFER', 'Transaction', id, before, transaction, undefined, match.id);
    });
    this.repository.transfers.delete(match.id);
  }

  private findChartByName(name: string): string[] {
    return [...this.repository.chartAccounts.values()].filter(account => account.name === name).map(account => account.id);
  }

  private isRetiredAmazonDuplicateSummaryRule(rule: TransactionRule): boolean {
    return rule.name.trim().toLowerCase() === 'amazon duplicate summary payments';
  }

  private findChartByNames(names: string[]): string[] {
    const candidates = new Set(names.map(name => name.toLowerCase()));
    return [...this.repository.chartAccounts.values()].filter(account => candidates.has(account.name.toLowerCase())).map(account => account.id);
  }

  private normalizeWorkbookRow(row: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/^\uFEFF/, '').trim(), value]));
  }

  private seed(): void {
    const ownerDrawExists = [...this.repository.chartAccounts.values()].some(account => account.accountType === 'EQUITY' && account.detailType === 'Owner draw' && !account.archived);
    const advertisingMarketingExists = [...this.repository.chartAccounts.values()].some(account => account.accountType === 'EXPENSE' && account.detailType === 'Advertising' && account.name.trim().toLowerCase() === 'advertising and marketing' && !account.archived);
    const interestPaidExists = [...this.repository.chartAccounts.values()].some(account => account.accountType === 'EXPENSE' && account.detailType === 'Interest paid' && account.name.trim().toLowerCase() === 'interest paid' && !account.parentId && !account.archived);
    const officeExpenseHierarchyExists = this.hasOfficeExpenseHierarchy();
    if (this.repository.accounts.size && this.repository.getCompanyProfile() && ownerDrawExists && advertisingMarketingExists && interestPaidExists && officeExpenseHierarchyExists) return;
    this.repository.transaction(() => {
      if (!this.repository.getCompanyProfile()) {
        const timestamp = nowUtc();
        this.repository.saveCompanyProfile({
          companyId: this.repository.company.id,
          legalName: this.repository.company.name,
          displayName: this.repository.company.name,
          currencyCode: this.repository.company.currency,
          fiscalYearStartMonth: this.repository.company.fiscalYearStartMonth,
          accountingBasis: this.repository.company.accountingBasis,
          activeTaxYear: this.repository.company.activeTaxYear,
          createdAt: timestamp,
          modifiedAt: timestamp,
        }, { mode: 'PRESERVE' });
      }
      if (this.repository.accounts.size) {
        this.ensureOwnerDrawAccount(true);
        this.ensureAdvertisingMarketingAccount(true);
        this.ensureInterestPaidAccount(true);
        this.ensureOfficeExpenseHierarchy(true);
        return;
      }
      for (const [name, type] of [['Operating Checking', 'BANK'], ['Business Card', 'CREDIT_CARD'], ['Reserve Checking', 'BANK'], ['Marketplace', 'ENTITY'], ['Other Transactions', 'ENTITY']] as const) {
        const accountType = type === 'BANK' ? 'BANK' : type === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'OTHER_CURRENT_ASSET';
        const account: FinancialAccount = {
          id: newId(), type, accountType, classificationStatus: type === 'ENTITY' && name === 'Other Transactions' ? 'REVIEW_REQUIRED' : 'CONFIRMED',
          importEnabled: true, supportedSourceKinds: type === 'ENTITY' ? ['CSV', 'EXCEL', 'AMAZON'] : ['CSV', 'EXCEL', 'QBO_OFX'],
          openingBalanceSource: 'DERIVED_EQUITY', name, institutionOrEntity: name.split(' ')[0],
          detailType: type === 'BANK' ? 'Checking' : type === 'CREDIT_CARD' ? 'Credit Card' : name === 'Marketplace' ? 'Marketplace' : 'Other transactions',
          openingBalance: money(0n), openingBalanceDate: '2026-01-01', archived: false, locked: false,
        };
        this.repository.accounts.set(account.id, account);
      }
      const chartSeed: Array<[string, ChartAccount['type']]> = [
        ['Online Sales', 'INCOME'], ['Cost of Goods Sold', 'COGS'], ['Marketplace Fees', 'EXPENSE'], ['Operating Expenses', 'EXPENSE'], ['Other Income', 'OTHER_INCOME'], ['Other Expense', 'OTHER_EXPENSE'], ['Federal Income Tax', 'EXPENSE'], ['State and Local Income Tax', 'EXPENSE'],
      ];
      chartSeed.forEach(([name, type], displayOrder) => {
        const accountType = this.mapChartAccountKind(type);
        const account: ChartAccount = { id: newId(), name, type, accountType, detailType: this.chartAccountDefinition(accountType).detailTypes[0], displayOrder, archived: false, locked: false };
        this.repository.chartAccounts.set(account.id, account);
      });
      this.ensureOwnerDrawAccount(false);
      this.ensureAdvertisingMarketingAccount(false);
      this.ensureInterestPaidAccount(false);
      this.ensureOfficeExpenseHierarchy(false);
      const feeAccount = this.findChartByName('Marketplace Fees')[0];
      const defaultRuleId = newId();
      this.repository.rules.set(defaultRuleId, { id: defaultRuleId, name: 'Example: marketplace fee labels', enabled: false, priority: 10, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Marketplace fee' }], chartAccountId: feeAccount });
      this.repository.taxSettings.set(this.repository.company.activeTaxYear, this.getTaxYearSettings(this.repository.company.activeTaxYear));
    });
  }

  private ensureOwnerDrawAccount(recordAudit: boolean): void {
    const existing = [...this.repository.chartAccounts.values()].find(account => account.accountType === 'EQUITY' && account.detailType === 'Owner draw');
    if (existing) {
      if (!existing.archived) return;
      const before = structuredClone(existing);
      existing.archived = false;
      this.repository.chartAccounts.set(existing.id, existing);
      if (recordAudit) this.record('RESTORE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', existing.id, before, existing, 'Keep the standard Owner\'s Draw equity account available.');
      return;
    }
    const conflicting = this.repository.chartAccounts.get(DEFAULT_OWNER_DRAW_ACCOUNT_ID);
    if (conflicting) throw new AccountingError('DEFAULT_ACCOUNT_ID_CONFLICT', `${DEFAULT_OWNER_DRAW_ACCOUNT_ID} is already assigned to ${conflicting.name}.`);
    const account: ChartAccount = {
      id: DEFAULT_OWNER_DRAW_ACCOUNT_ID,
      name: "Owner's Draw",
      type: 'EQUITY',
      accountType: 'EQUITY',
      detailType: 'Owner draw',
      description: 'Owner withdrawals and distributions that reduce equity without affecting profit.',
      displayOrder: Math.max(-1, ...[...this.repository.chartAccounts.values()].map(item => item.displayOrder)) + 1,
      archived: false,
      locked: false,
    };
    this.repository.chartAccounts.set(account.id, account);
    if (recordAudit) this.record('CREATE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', account.id, undefined, account, 'Add the standard Owner\'s Draw equity account.');
  }

  private ensureAdvertisingMarketingAccount(recordAudit: boolean): void {
    const existing = [...this.repository.chartAccounts.values()].find(account =>
      account.accountType === 'EXPENSE'
      && account.detailType === 'Advertising'
      && account.name.trim().toLowerCase() === 'advertising and marketing',
    );
    if (existing) {
      if (!existing.archived) return;
      const before = structuredClone(existing);
      existing.archived = false;
      this.repository.chartAccounts.set(existing.id, existing);
      if (recordAudit) this.record('RESTORE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', existing.id, before, existing, 'Keep the standard Advertising and Marketing expense account available.');
      return;
    }
    const conflicting = this.repository.chartAccounts.get(DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID);
    if (conflicting) throw new AccountingError('DEFAULT_ACCOUNT_ID_CONFLICT', `${DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID} is already assigned to ${conflicting.name}.`);
    const account: ChartAccount = {
      id: DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID,
      name: 'Advertising and Marketing',
      type: 'EXPENSE',
      accountType: 'EXPENSE',
      detailType: 'Advertising',
      description: 'Advertising, promotions, sponsored listings, and other marketing costs.',
      displayOrder: Math.max(-1, ...[...this.repository.chartAccounts.values()].map(item => item.displayOrder)) + 1,
      archived: false,
      locked: false,
    };
    this.repository.chartAccounts.set(account.id, account);
    if (recordAudit) this.record('CREATE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', account.id, undefined, account, 'Add the standard Advertising and Marketing expense account.');
  }

  private hasOfficeExpenseHierarchy(): boolean {
    const operatingExpenses = [...this.repository.chartAccounts.values()].find(account =>
      account.accountType === 'EXPENSE' && account.name.trim().toLowerCase() === 'operating expenses' && !account.parentId && !account.archived,
    );
    if (!operatingExpenses) return false;
    const officeExpenses = [...this.repository.chartAccounts.values()].find(account =>
      account.accountType === 'EXPENSE'
      && account.detailType === 'Office expenses'
      && account.name.trim().toLowerCase() === 'office expenses'
      && account.parentId === operatingExpenses.id
      && !account.archived,
    );
    if (!officeExpenses) return false;
    return [...this.repository.chartAccounts.values()].some(account =>
      account.accountType === 'EXPENSE'
      && account.detailType === 'Office expenses'
      && account.name.trim().toLowerCase() === 'software and apps'
      && account.parentId === officeExpenses.id
      && !account.archived,
    );
  }

  private ensureInterestPaidAccount(recordAudit: boolean): void {
    this.ensureDefaultExpenseAccount({
      id: DEFAULT_INTEREST_PAID_ACCOUNT_ID,
      name: 'Interest Paid',
      detailType: 'Interest paid',
      description: 'Interest paid on business credit cards, loans, and other business debt.',
      recordAudit,
    });
  }

  private ensureOfficeExpenseHierarchy(recordAudit: boolean): void {
    const operatingExpenses = this.ensureDefaultExpenseAccount({
      id: 'chart-operating-expenses',
      name: 'Operating Expenses',
      detailType: 'Other business expenses',
      description: 'General expenses incurred while operating the business.',
      recordAudit,
    });
    const officeExpenses = this.ensureDefaultExpenseAccount({
      id: DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID,
      name: 'Office Expenses',
      detailType: 'Office expenses',
      parentId: operatingExpenses.id,
      description: 'Office supplies, services, and general administrative costs.',
      recordAudit,
    });
    this.ensureDefaultExpenseAccount({
      id: DEFAULT_SOFTWARE_APPS_ACCOUNT_ID,
      name: 'Software and apps',
      detailType: 'Office expenses',
      parentId: officeExpenses.id,
      description: 'Software subscriptions, applications, and online business tools.',
      recordAudit,
    });
  }

  private ensureDefaultExpenseAccount(command: {
    id: string;
    name: string;
    detailType: string;
    description: string;
    recordAudit: boolean;
    parentId?: string;
  }): ChartAccount {
    const candidates = [...this.repository.chartAccounts.values()].filter(account =>
      account.accountType === 'EXPENSE' && account.name.trim().toLowerCase() === command.name.toLowerCase(),
    );
    const existing = candidates.find(account => account.parentId === command.parentId) ?? candidates[0];
    if (existing) {
      const before = structuredClone(existing);
      existing.name = command.name;
      existing.type = 'EXPENSE';
      existing.accountType = 'EXPENSE';
      existing.detailType = command.detailType;
      existing.parentId = command.parentId;
      existing.archived = false;
      this.repository.chartAccounts.set(existing.id, existing);
      if (command.recordAudit && JSON.stringify(before) !== JSON.stringify(existing)) {
        this.record(before.archived ? 'RESTORE_DEFAULT_CHART_ACCOUNT' : 'UPDATE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', existing.id, before, existing, `Keep the standard ${command.name} expense account available in the default hierarchy.`);
      }
      return existing;
    }
    const conflicting = this.repository.chartAccounts.get(command.id);
    if (conflicting) throw new AccountingError('DEFAULT_ACCOUNT_ID_CONFLICT', `${command.id} is already assigned to ${conflicting.name}.`);
    const account: ChartAccount = {
      id: command.id,
      name: command.name,
      type: 'EXPENSE',
      accountType: 'EXPENSE',
      detailType: command.detailType,
      parentId: command.parentId,
      description: command.description,
      displayOrder: Math.max(-1, ...[...this.repository.chartAccounts.values()].map(item => item.displayOrder)) + 1,
      archived: false,
      locked: false,
    };
    this.repository.chartAccounts.set(account.id, account);
    if (command.recordAudit) this.record('CREATE_DEFAULT_CHART_ACCOUNT', 'ChartAccount', account.id, undefined, account, `Add the standard ${command.name} expense account.`);
    return account;
  }

  private balanceSheetNotImplemented<T>(operation: string): T {
    throw new BalanceSheetContractError({
      code: 'BALANCE_SHEET_NOT_IMPLEMENTED',
      message: `${operation} is defined by the Balance Sheet contract but is not implemented yet.`,
      retryable: false,
    });
  }

  private cashFlowNotImplemented<T>(operation: string): T {
    throw new CashFlowContractError({
      code: 'CASH_FLOW_NOT_IMPLEMENTED',
      message: `${operation} is defined by the Cash Flow public contract but is not implemented in the current slice.`,
      retryable: false,
    });
  }

  private maskTaxIdentifier(value?: string): string | undefined {
    if (!value) return undefined;
    const visible = value.replace(/\W/g, '').slice(-4);
    return visible ? `•••• ${visible}` : '••••';
  }
}

export class AccountingError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AccountingError';
  }
}
