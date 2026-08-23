import { Component, ElementRef, Inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { ACCOUNTING_APPLICATION, AccountingApplication, ProfitLossCell, ProfitLossReport, ProfitLossSectionKey, ReportDetailRow, ReportDrilldownQuery, ReportExportDisclosure, SaveAccountCommand, SaveChartAccountCommand, ScheduleCReadyReport, TransactionSuggestion } from './core/application-interface/accounting.application';
import { AccountType, CHART_ACCOUNT_TYPES, ChartAccount, ChartAccountKind, FINANCIAL_ACCOUNT_TYPES, formatMoney, FinancialAccount, ImportPreview, ImportRowDisposition, money, RuleCondition, TaxYearSettings, Transaction, TransactionRule, TransactionState } from './core/domain-model/accounting.types';
import { AccountFacade } from './features/accounts/account.facade';
import { ImportFacade } from './features/imports/import.facade';
import { ReportFacade } from './features/reports/report.facade';
import { TransactionFacade } from './features/transactions/transaction.facade';
import { SetupFacade } from './features/setup/setup.facade';
import { RuleFacade } from './features/rules/rule.facade';
import { BackupFacade } from './features/backups/backup.facade';
import { ChartAccountFacade } from './features/chart-accounts/chart-account.facade';
import { BalanceSheetContractError, BalanceSheetDetail, BalanceSheetReport, CompanyProfile, balanceSheetShortcutDate, normalizeBalanceSheetQuery, reportCompanyIdentity, ReportCompanyIdentity, UpdateCompanyProfileCommand } from './core/domain-model/balance-sheet.types';
import { AccountChangeValidation, AccountRole, AccountingAccountType, AccountTypeGroupDefinition, ImportSourceKind, SaveGenericAccountCommand } from './core/domain-model/account-taxonomy';
import { BalanceSheetFacade } from './features/balance-sheet/balance-sheet.facade';

type TransactionSortColumn = 'DATE_ACCOUNT' | 'SOURCE' | 'CATEGORY' | 'AMOUNT';
type TransactionSortDirection = 'ASC' | 'DESC';
type WorkspaceView = 'TRANSACTIONS' | 'CHART' | 'RULES' | 'REPORTS' | 'BALANCE_SHEET' | 'DATA';
type ChartSortColumn = 'ORDER' | 'NAME' | 'TYPE' | 'DETAIL' | 'STATUS';
type RuleStatusFilter = 'ALL' | 'ENABLED' | 'DISABLED';
type ReportView = 'SUMMARY' | 'DETAIL';
type ReportBasis = 'UNADJUSTED' | 'SCHEDULE_C';
type ReportSortColumn = 'DATE' | 'ACCOUNT' | 'DESCRIPTION' | 'CATEGORY' | 'AMOUNT';
type ReportSortDirection = 'ASC' | 'DESC';
type ReportSummaryRowKind = 'GROUP' | 'ACCOUNT' | 'SUBTOTAL' | 'SYNTHETIC';

interface ReportSummaryDisplayRow {
  id: string;
  label: string;
  cell: ProfitLossCell;
  valueCell: ProfitLossCell;
  depth: number;
  kind: ReportSummaryRowKind;
  showAmounts: boolean;
  directOnly?: boolean;
}

interface StoredTransactionView {
  selectedAccountId: string;
  selectedTransactionState: Extract<TransactionState, 'PENDING' | 'POSTED' | 'EXCLUDED'>;
  startDate: string;
  endDate: string;
  search: string;
  bulkCategoryId: string;
  transactionSortColumn: TransactionSortColumn;
  transactionSortDirection: TransactionSortDirection;
}

interface ChartAccountDraft extends SaveChartAccountCommand {
  id?: string;
  archived: boolean;
}

interface FinancialAccountDraft extends Omit<SaveAccountCommand, 'openingBalanceMinor'> {
  id?: string;
  openingBalanceText: string;
  archived: boolean;
}

interface CompanyProfileDraft {
  expectedModifiedAt: string;
  legalName: string;
  displayName: string;
  doingBusinessAs: string;
  entityType: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  phone: string;
  email: string;
  website: string;
  currencyCode: string;
  fiscalYearStartMonth: number;
  accountingBasis: CompanyProfile['accountingBasis'];
  activeTaxYear: number;
}

interface GenericAccountDraft {
  accountId?: string;
  currentRole?: AccountRole;
  requestedRole: AccountRole;
  accountType: AccountingAccountType;
  detailType: string;
  name: string;
  parentId?: string;
  description: string;
  importEnabled: boolean;
  supportedSourceKinds: ImportSourceKind[];
  openingBalanceSource: 'DERIVED_EQUITY' | 'LEDGER_ACTIVITY';
  openingBalanceText: string;
  openingBalanceDate: string;
  institutionOrEntity: string;
  lastFour: string;
  displayOrder: number;
  locked: boolean;
}

const TRANSACTION_VIEW_STORAGE_KEY = 'accounting.transaction-view.v1';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild('categorySearchInput') categorySearchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('transactionFileInput') transactionFileInput?: ElementRef<HTMLInputElement>;
  readonly title = 'TallyStick';
  companyProfile: CompanyProfile;
  companyDraft?: CompanyProfileDraft;
  companyTaxIdentifier = '';
  companyTaxIdentifierRevealed = false;
  companyTaxIdentifierDirty = false;
  companyEditorError = '';
  genericAccountCatalog: readonly AccountTypeGroupDefinition[] = [];
  genericAccountDraft?: GenericAccountDraft;
  genericAccountPreview?: ReturnType<AccountingApplication['previewAccountPlacement']>;
  genericAccountValidation?: AccountChangeValidation;
  genericAccountError = '';
  genericAccountReferencesConfirmed = false;
  private genericAccountPriorType?: AccountingAccountType;
  accounts: FinancialAccount[] = [];
  financialAccountDraft?: FinancialAccountDraft;
  transactions: Transaction[] = [];
  pendingReviewCount = 0;
  selectedAccountId = '';
  selectedTransactionState: Extract<TransactionState, 'PENDING' | 'POSTED' | 'EXCLUDED'> = 'PENDING';
  startDate = '';
  endDate = '';
  transactionMonth = '';
  dateFilterError = '';
  search = '';
  statusMessage = 'Ready';
  importPreview?: ImportPreview;
  selectedFileName = '';
  report!: ScheduleCReadyReport;
  profitLossReport!: ProfitLossReport;
  reportExceptions = 0;
  reportDetailCount = 0;
  reportView: ReportView = 'SUMMARY';
  reportBasis: ReportBasis = 'SCHEDULE_C';
  reportStartDate = '';
  reportEndDate = '';
  reportGrouping: 'MONTH' | 'YEAR' = 'YEAR';
  reportExcludedCategoryIds = new Set<string>();
  reportSelectedCell?: Pick<ReportDrilldownQuery, 'period' | 'sectionKey' | 'chartAccountId' | 'categoryIds'> & { label?: string };
  reportDetailRows: ReportDetailRow[] = [];
  reportDetailSearch = '';
  reportDetailAccountId = '';
  reportDetailCategoryId = '';
  reportDetailSortColumn: ReportSortColumn = 'DATE';
  reportDetailSortDirection: ReportSortDirection = 'ASC';
  workspaceView: WorkspaceView = 'TRANSACTIONS';
  balanceSheet?: BalanceSheetReport;
  balanceSheetDetail?: BalanceSheetDetail;
  balanceSheetAsOf = '';
  balanceSheetIncludeZero = false;
  balanceSheetLoading = false;
  private balanceSheetReturnFocus?: HTMLElement;
  navigationExpanded = true;
  reportTaxSettings!: TaxYearSettings;
  selectedTransactionIds = new Set<string>();
  suggestions: Record<string, TransactionSuggestion> = {};
  selectedCategoryIds: Record<string, string> = {};
  bulkCategoryId = '';
  activeCategoryPicker = '';
  categorySearch = '';
  categoryPickerIndex = 0;
  transactionSortColumn: TransactionSortColumn = 'DATE_ACCOUNT';
  transactionSortDirection: TransactionSortDirection = 'ASC';
  ruleSearch = '';
  ruleStatusFilter: RuleStatusFilter = 'ALL';
  ruleDraft?: TransactionRule;
  ruleEditorSourceTransactionId = '';
  ruleTagsText = '';
  ruleTestMessage = '';
  chartSearch = '';
  chartTypeFilter: ChartAccountKind | 'ALL' = 'ALL';
  chartStatusFilter: 'ALL' | 'ACTIVE' | 'ARCHIVED' = 'ACTIVE';
  chartDraft?: ChartAccountDraft;
  chartSortColumn: ChartSortColumn = 'ORDER';
  chartSortDirection: 'ASC' | 'DESC' = 'ASC';
  readonly chartAccountTypes = CHART_ACCOUNT_TYPES;
  readonly financialAccountTypes = FINANCIAL_ACCOUNT_TYPES;
  readonly ruleConditionFields: RuleCondition['field'][] = ['ACCOUNT', 'DIRECTION', 'DESCRIPTION', 'PAYEE', 'MEMO', 'AMOUNT', 'SOURCE_TYPE'];
  readonly ruleConditionOperators: RuleCondition['operator'][] = ['EQUALS', 'CONTAINS', 'STARTS_WITH', 'RANGE'];

  constructor(
    @Inject(ACCOUNTING_APPLICATION) private readonly accounting: AccountingApplication,
    private readonly accountFacade: AccountFacade,
    private readonly importFacade: ImportFacade,
    private readonly transactionFacade: TransactionFacade,
    private readonly reportFacade: ReportFacade,
    private readonly setupFacade: SetupFacade,
    private readonly ruleFacade: RuleFacade,
    private readonly backupFacade: BackupFacade,
    private readonly chartAccountFacade: ChartAccountFacade,
    readonly balanceSheetFacade: BalanceSheetFacade,
  ) {
    this.companyProfile = this.accounting.getCompanyProfile();
    this.genericAccountCatalog = this.accounting.getAccountTypeCatalog();
    const reportYear = this.accounting.getCompany().activeTaxYear;
    this.reportStartDate = `${reportYear}-01-01`;
    this.reportEndDate = `${reportYear}-12-31`;
    const balanceQuery = normalizeBalanceSheetQuery({}, this.accounting.getCompany());
    this.balanceSheetAsOf = balanceQuery.ok ? balanceQuery.value.asOfDate : `${reportYear}-12-31`;
    this.reportTaxSettings = this.accounting.getTaxYearSettings(reportYear);
    this.restoreTransactionView();
    this.report = this.accountingReport();
    this.refresh();
    void this.backupFacade.loadLocations();
  }

  loadBalanceSheet(): void {
    this.balanceSheetLoading = true;
    this.balanceSheetFacade.loadReport({ asOfDate: this.balanceSheetAsOf, includeZeroBalanceAccounts: this.balanceSheetIncludeZero });
    this.balanceSheet = this.balanceSheetFacade.report();
    this.balanceSheetDetail = undefined;
    this.balanceSheetLoading = false;
  }

  applyBalanceSheetShortcut(shortcut: 'TODAY' | 'PREVIOUS_MONTH_END' | 'CURRENT_MONTH_END' | 'FISCAL_YEAR_END'): void {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const result = balanceSheetShortcutDate(shortcut, today, this.accounting.getCompany());
    if (result.ok) { this.balanceSheetAsOf = result.value; this.loadBalanceSheet(); }
  }

  openBalanceSheetDetail(row: BalanceSheetReport['rows'][number], event: Event): void {
    if (!this.balanceSheet || !row.detailKey) return;
    this.balanceSheetReturnFocus = event.currentTarget as HTMLElement;
    this.balanceSheetFacade.loadDetail({ reportId: this.balanceSheet.reportId, databaseRevision: this.balanceSheet.databaseRevision, detailKey: row.detailKey });
    this.balanceSheetDetail = this.balanceSheetFacade.detail();
  }

  closeBalanceSheetDetail(): void { this.balanceSheetDetail = undefined; queueMicrotask(() => this.balanceSheetReturnFocus?.focus()); }
  balanceSheetMoney(value = 0n): string { return formatMoney(money(value)); }
  balanceSheetOutOfBalance(): boolean { return (this.balanceSheet?.differenceMinor ?? 0n) !== 0n; }
  async exportBalanceSheet(format: 'CSV' | 'XLSX'): Promise<void> { if (this.balanceSheet) await this.balanceSheetFacade.export({ report: this.balanceSheet, format }); }
  async openBalanceSheetPrintPreview(): Promise<void> { if (this.balanceSheet) await this.balanceSheetFacade.openPrintPreview({ report: this.balanceSheet }); }

  refresh(): void {
    this.transactionMonth = this.transactionMonthForRange();
    this.accountFacade.load();
    this.accounts = this.accountFacade.accounts();
    this.setupFacade.load();
    this.chartAccountFacade.load();
    this.ruleFacade.load();
    if (this.selectedAccountId && !this.accounts.some(account => account.id === this.selectedAccountId)) this.selectedAccountId = '';
    if (this.bulkCategoryId && !this.setupFacade.chartAccounts().some(account => account.id === this.bulkCategoryId && !account.archived)) this.bulkCategoryId = '';
    this.pendingReviewCount = this.accounting.listTransactions({
      accountId: this.selectedAccountId || undefined,
      states: ['PENDING'],
      pageSize: 1,
    }).total;
    this.dateFilterError = Boolean(this.startDate && this.endDate && this.startDate > this.endDate)
      ? 'Start date must be on or before end date.'
      : '';
    if (this.dateFilterError) {
      this.transactions = [];
    } else {
      this.transactionFacade.load({
        accountId: this.selectedAccountId || undefined,
        states: this.selectedTransactionState === 'POSTED' ? ['POSTED', 'MATCHED_TRANSFER'] : [this.selectedTransactionState],
        startDate: this.startDate || undefined,
        endDate: this.endDate || undefined,
        search: this.search,
        sort: this.transactionQuerySort,
        pageSize: 500,
      });
      this.transactions = this.transactionFacade.items();
    }
    this.suggestions = Object.fromEntries(this.transactions
      .filter(transaction => transaction.state === 'PENDING')
      .map(transaction => [transaction.id, this.accounting.suggestTransaction(transaction.id)]));
    this.selectedCategoryIds = Object.fromEntries(this.transactions.map(transaction => [
      transaction.id,
      transaction.splits[0]?.chartAccountId ?? this.suggestions[transaction.id]?.chartAccountId ?? '',
    ]));
    if (this.selectedTransactionState === 'PENDING' && this.bulkCategoryId) {
      this.transactions = this.transactions.filter(transaction => this.selectedCategoryIds[transaction.id] === this.bulkCategoryId);
    }
    this.applyTransactionSort();
    const visibleTransactionIds = new Set(this.transactions.map(transaction => transaction.id));
    this.selectedTransactionIds = new Set([...this.selectedTransactionIds].filter(id => visibleTransactionIds.has(id)));
    this.loadReports();
    this.persistTransactionView();
  }

  loadReports(): void {
    if (!this.reportStartDate || !this.reportEndDate || this.reportStartDate > this.reportEndDate) return;
    const excluded = [...this.reportExcludedCategoryIds];
    this.reportFacade.loadProfitLoss(this.reportStartDate, this.reportEndDate, this.reportGrouping, excluded);
    this.profitLossReport = this.reportFacade.profitLoss() ?? this.accounting.getProfitLoss(this.reportStartDate, this.reportEndDate, this.reportGrouping, excluded);
    this.reportFacade.loadScheduleCReady(this.reportStartDate, this.reportEndDate, this.reportGrouping, excluded);
    this.report = this.reportFacade.report() ?? this.accounting.getScheduleCReadyReport(this.reportStartDate, this.reportEndDate, this.reportGrouping, excluded);
    this.reportTaxSettings = this.accounting.getTaxYearSettings(this.report.taxYear);
    this.reportFacade.loadExceptions(this.reportStartDate, this.reportEndDate);
    this.reportExceptions = this.reportFacade.exceptions().length;
    this.reportSelectedCell = undefined;
    this.reportFacade.loadDrilldown(this.reportDrilldownQuery(false));
    this.reportDetailCount = this.reportFacade.detail().length;
    this.loadReportDetailSelection();
  }

  reportDateChanged(): void {
    if (this.reportStartDate > this.reportEndDate) return;
    this.loadReports();
  }

  selectTransactionMonth(month: string): void {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const [year, monthNumber] = month.split('-').map(Number);
    if (monthNumber < 1 || monthNumber > 12) return;
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    this.startDate = `${month}-01`;
    this.endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
    this.refresh();
  }

  transactionDateChanged(): void {
    this.transactionMonth = this.transactionMonthForRange();
    this.refresh();
  }

  selectWorkspace(view: WorkspaceView): void {
    this.workspaceView = view;
    this.closeCategoryPicker();
    if (view === 'BALANCE_SHEET') this.loadBalanceSheet();
    if (view === 'REPORTS') this.loadReports();
    if (view === 'RULES') this.ruleFacade.load();
    if (view === 'CHART') this.chartAccountFacade.load();
    if (view === 'DATA') void this.backupFacade.loadLocations();
  }

  toggleNavigation(): void { this.navigationExpanded = !this.navigationExpanded; }

  openCompanySettings(): void {
    const profile = this.accounting.getCompanyProfile();
    this.companyProfile = profile;
    this.companyDraft = {
      expectedModifiedAt: profile.modifiedAt,
      legalName: profile.legalName,
      displayName: profile.displayName,
      doingBusinessAs: profile.doingBusinessAs ?? '',
      entityType: profile.entityType ?? '',
      addressLine1: profile.address?.line1 ?? '',
      addressLine2: profile.address?.line2 ?? '',
      locality: profile.address?.locality ?? '',
      region: profile.address?.region ?? '',
      postalCode: profile.address?.postalCode ?? '',
      countryCode: profile.address?.countryCode ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      website: profile.website ?? '',
      currencyCode: profile.currencyCode,
      fiscalYearStartMonth: profile.fiscalYearStartMonth,
      accountingBasis: profile.accountingBasis,
      activeTaxYear: profile.activeTaxYear,
    };
    this.companyTaxIdentifier = '';
    this.companyTaxIdentifierRevealed = false;
    this.companyTaxIdentifierDirty = false;
    this.companyEditorError = '';
  }

  closeCompanySettings(): void {
    this.companyDraft = undefined;
    this.companyTaxIdentifier = '';
    this.companyTaxIdentifierRevealed = false;
    this.companyTaxIdentifierDirty = false;
    this.companyEditorError = '';
  }

  revealCompanyTaxIdentifier(): void {
    const result = this.accounting.revealCompanyTaxIdentifier();
    this.companyTaxIdentifier = result.taxIdentifier ?? '';
    this.companyTaxIdentifierRevealed = true;
    this.companyTaxIdentifierDirty = false;
    this.companyEditorError = '';
  }

  markCompanyTaxIdentifierDirty(value: string): void {
    this.companyTaxIdentifier = value;
    this.companyTaxIdentifierDirty = true;
  }

  saveCompanySettings(): void {
    const draft = this.companyDraft;
    if (!draft || !this.companyDraftValid) return;
    const command: UpdateCompanyProfileCommand = {
      expectedModifiedAt: draft.expectedModifiedAt,
      legalName: draft.legalName,
      displayName: draft.displayName,
      doingBusinessAs: draft.doingBusinessAs,
      entityType: draft.entityType,
      address: {
        line1: draft.addressLine1,
        line2: draft.addressLine2,
        locality: draft.locality,
        region: draft.region,
        postalCode: draft.postalCode,
        countryCode: draft.countryCode,
      },
      phone: draft.phone,
      email: draft.email,
      website: draft.website,
      taxIdentifier: this.companyTaxIdentifierDirty ? this.companyTaxIdentifier : undefined,
      currencyCode: draft.currencyCode,
      fiscalYearStartMonth: Number(draft.fiscalYearStartMonth),
      accountingBasis: draft.accountingBasis,
      activeTaxYear: Number(draft.activeTaxYear),
    };
    try {
      this.companyProfile = this.accounting.updateCompanyProfile(command);
      this.statusMessage = `Saved company information for ${this.companyProfile.displayName}.`;
      this.closeCompanySettings();
    } catch (error) {
      this.companyEditorError = error instanceof BalanceSheetContractError ? error.failure.message : 'Unable to save company information.';
    }
  }

  reloadCompanySettings(): void { this.openCompanySettings(); }

  get companyReportIdentity(): ReportCompanyIdentity { return reportCompanyIdentity(this.companyProfile); }

  get companyDraftValid(): boolean {
    const draft = this.companyDraft;
    if (!draft?.legalName.trim()) return false;
    if (!/^[A-Za-z]{3}$/.test(draft.currencyCode.trim())) return false;
    if (!Number.isInteger(Number(draft.fiscalYearStartMonth)) || Number(draft.fiscalYearStartMonth) < 1 || Number(draft.fiscalYearStartMonth) > 12) return false;
    if (!Number.isInteger(Number(draft.activeTaxYear)) || Number(draft.activeTaxYear) < 1000 || Number(draft.activeTaxYear) > 9999) return false;
    if (draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return false;
    if (draft.countryCode.trim() && !/^[A-Za-z]{2}$/.test(draft.countryCode.trim())) return false;
    if (draft.website.trim()) {
      try {
        const url = new URL(draft.website.trim());
        if (!['http:', 'https:'].includes(url.protocol)) return false;
      } catch { return false; }
    }
    if (this.companyTaxIdentifierDirty && this.companyTaxIdentifier.trim()) {
      const value = this.companyTaxIdentifier.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 .-]{2,31}$/.test(value) || value.replace(/[^A-Za-z0-9]/g, '').length < 4) return false;
    }
    return true;
  }

  openNewGenericAccount(role: AccountRole): void {
    const year = this.accounting.getCompany().activeTaxYear;
    const accountType: AccountingAccountType = role === 'FINANCIAL_SOURCE' ? 'BANK' : 'EXPENSE';
    const definition = this.genericAccountDefinition(accountType)!;
    this.genericAccountDraft = {
      requestedRole: role, accountType, detailType: definition.detailTypes[0].value, name: '', parentId: undefined,
      description: '', importEnabled: role === 'FINANCIAL_SOURCE' && definition.importCapabilityDefault,
      supportedSourceKinds: role === 'FINANCIAL_SOURCE' && definition.importCapabilityDefault ? [...definition.supportedImportSourceKinds] : [],
      openingBalanceSource: 'DERIVED_EQUITY', openingBalanceText: '0.00', openingBalanceDate: `${year}-01-01`,
      institutionOrEntity: '', lastFour: '', displayOrder: 100, locked: false,
    };
    this.genericAccountPriorType = accountType;
    this.genericAccountReferencesConfirmed = false;
    this.refreshGenericAccountReview();
  }

  editGenericFinancialAccount(id: string): void {
    const account = this.accounts.find(candidate => candidate.id === id);
    if (!account) { this.statusMessage = 'That account no longer exists.'; return; }
    this.genericAccountDraft = {
      accountId: account.id, currentRole: 'FINANCIAL_SOURCE', requestedRole: 'FINANCIAL_SOURCE', accountType: account.accountType,
      detailType: account.detailType, name: account.name, parentId: account.parentAccountId, description: account.description ?? '',
      importEnabled: account.importEnabled, supportedSourceKinds: [...account.supportedSourceKinds], openingBalanceSource: account.openingBalanceSource,
      openingBalanceText: this.minorUnitsToInput(account.openingBalance.minorUnits), openingBalanceDate: account.openingBalanceDate,
      institutionOrEntity: account.institutionOrEntity, lastFour: account.lastFour ?? '', displayOrder: 100, locked: account.locked,
    };
    this.genericAccountPriorType = account.accountType;
    this.genericAccountReferencesConfirmed = false;
    this.refreshGenericAccountReview();
  }

  editGenericChartAccount(id: string): void {
    const account = this.chartAccountFacade.accounts().find(candidate => candidate.id === id);
    if (!account) { this.statusMessage = 'That account no longer exists.'; return; }
    this.genericAccountDraft = {
      accountId: account.id, currentRole: 'CHART', requestedRole: 'CHART', accountType: account.accountType,
      detailType: account.detailType, name: this.chartAccountLeafName(account), parentId: account.parentId, description: account.description ?? '',
      importEnabled: false, supportedSourceKinds: [], openingBalanceSource: 'DERIVED_EQUITY', openingBalanceText: '0.00',
      openingBalanceDate: `${this.accounting.getCompany().activeTaxYear}-01-01`, institutionOrEntity: '', lastFour: '',
      displayOrder: account.displayOrder, locked: account.locked,
    };
    this.genericAccountPriorType = account.accountType;
    this.genericAccountReferencesConfirmed = false;
    this.refreshGenericAccountReview();
  }

  closeGenericAccountEditor(): void {
    this.genericAccountDraft = undefined;
    this.genericAccountPreview = undefined;
    this.genericAccountValidation = undefined;
    this.genericAccountError = '';
    this.genericAccountReferencesConfirmed = false;
  }

  genericAccountRoleChanged(): void {
    const draft = this.genericAccountDraft;
    if (!draft || draft.currentRole) return;
    if (draft.requestedRole === 'FINANCIAL_SOURCE' && !['ASSET', 'LIABILITY'].includes(this.genericAccountDefinition(draft.accountType)?.reportingGroup ?? '')) {
      draft.accountType = 'BANK';
    }
    this.applyGenericAccountTypeDefaults();
  }

  genericAccountTypeChanged(): void {
    const draft = this.genericAccountDraft;
    if (!draft) return;
    const detailCompatible = this.genericAccountDefinition(draft.accountType)?.detailTypes.some(detail => detail.value === draft.detailType);
    const parentCompatible = !draft.parentId || this.genericCompatibleParents.some(parent => parent.id === draft.parentId);
    if (draft.accountId && (!detailCompatible || !parentCompatible)) {
      const confirmed = window.confirm('Changing Account Type will clear an incompatible Detail Type or parent. Continue?');
      if (!confirmed && this.genericAccountPriorType) {
        draft.accountType = this.genericAccountPriorType;
        this.refreshGenericAccountReview();
        return;
      }
    }
    this.genericAccountPriorType = draft.accountType;
    this.applyGenericAccountTypeDefaults();
  }

  genericImportEnabledChanged(): void {
    const draft = this.genericAccountDraft;
    if (!draft) return;
    const definition = this.genericAccountDefinition(draft.accountType);
    draft.supportedSourceKinds = draft.importEnabled ? [...(definition?.supportedImportSourceKinds ?? [])] : [];
    this.refreshGenericAccountReview();
  }

  toggleGenericImportKind(kind: ImportSourceKind, enabled: boolean): void {
    const draft = this.genericAccountDraft;
    if (!draft) return;
    const selected = new Set(draft.supportedSourceKinds);
    if (enabled) selected.add(kind); else selected.delete(kind);
    draft.supportedSourceKinds = [...selected];
    this.refreshGenericAccountReview();
  }

  refreshGenericAccountReview(): void {
    const command = this.genericAccountCommand();
    this.genericAccountError = '';
    this.genericAccountPreview = undefined;
    this.genericAccountValidation = undefined;
    this.genericAccountReferencesConfirmed = false;
    if (!command) { this.genericAccountError = 'Opening balance must be a valid amount with no more than two decimal places.'; return; }
    try {
      this.genericAccountPreview = this.accounting.previewAccountPlacement({
        accountType: command.accountType, accountRole: command.requestedRole, accountId: command.accountId,
        accountName: command.name || 'New account', parentId: command.parentId, asOfDate: `${this.accounting.getCompany().activeTaxYear}-12-31`,
      });
      this.genericAccountValidation = this.accounting.validateGenericAccount(command);
    } catch (error) {
      this.genericAccountError = error instanceof Error ? error.message : 'The account settings are not valid.';
    }
  }

  saveGenericAccount(): void {
    const command = this.genericAccountCommand();
    if (!command || !this.genericAccountDraftValid) return;
    const confirmedReferenceIds = this.genericAccountReferencesConfirmed
      ? this.genericAccountValidation?.confirmationReferences.map(reference => reference.referenceId)
      : undefined;
    try {
      const result = this.accounting.saveGenericAccount({ ...command, confirmedReferenceIds });
      this.statusMessage = `${result.created ? 'Created' : 'Updated'} ${result.role === 'FINANCIAL_SOURCE' ? 'source' : 'Chart'} account ${command.name.trim()}.`;
      this.closeGenericAccountEditor();
      this.refresh();
    } catch (error) {
      if (error instanceof BalanceSheetContractError && error.failure.references) {
        this.genericAccountValidation = { valid: false, blockingReferences: error.failure.references, confirmationReferences: [] };
      }
      this.genericAccountError = error instanceof Error ? error.message : 'Unable to save account.';
    }
  }

  deleteGenericAccount(): void {
    const draft = this.genericAccountDraft;
    if (!draft?.accountId || !draft.currentRole) return;
    if (!window.confirm(`Permanently delete ${draft.name}? Only an unused account with no balance, transactions, imports, rules, transfers, or hierarchy links can be deleted.`)) return;
    try {
      this.accounting.deleteGenericAccount(draft.accountId, draft.currentRole);
      this.statusMessage = `Deleted unused account ${draft.name}.`;
      this.closeGenericAccountEditor();
      this.refresh();
    } catch (error) {
      if (error instanceof BalanceSheetContractError && error.failure.references) {
        this.genericAccountValidation = { valid: false, blockingReferences: error.failure.references, confirmationReferences: [] };
      }
      this.genericAccountError = error instanceof Error ? error.message : 'Unable to delete account.';
    }
  }

  get genericAccountTypeOptions(): readonly AccountTypeGroupDefinition[] {
    if (this.genericAccountDraft?.requestedRole !== 'FINANCIAL_SOURCE') return this.genericAccountCatalog;
    return this.genericAccountCatalog.map(group => ({ ...group, accountTypes: group.accountTypes.filter(type => ['ASSET', 'LIABILITY'].includes(type.reportingGroup)) })).filter(group => group.accountTypes.length);
  }

  get genericDetailOptions(): Array<{ value: string; custom: boolean }> {
    const draft = this.genericAccountDraft;
    if (!draft) return [];
    const options = (this.genericAccountDefinition(draft.accountType)?.detailTypes ?? []).map(detail => ({ value: detail.value, custom: false }));
    if (draft.accountId && draft.detailType && !options.some(option => option.value === draft.detailType)) options.unshift({ value: draft.detailType, custom: true });
    return options;
  }

  get genericCompatibleParents(): Array<{ id: string; name: string }> {
    const draft = this.genericAccountDraft;
    const definition = draft ? this.genericAccountDefinition(draft.accountType) : undefined;
    if (!draft || !definition) return [];
    const source = draft.requestedRole === 'FINANCIAL_SOURCE'
      ? this.accounts.map(account => ({ id: account.id, name: account.name, accountType: account.accountType, archived: account.archived }))
      : this.chartAccountFacade.accounts().map(account => ({ id: account.id, name: account.name, accountType: account.accountType, archived: account.archived }));
    return source.filter(account => account.id !== draft.accountId && !account.archived && definition.validParentAccountTypes.includes(account.accountType));
  }

  get genericAccountIsCustomDetail(): boolean { return Boolean(this.genericDetailOptions.find(option => option.value === this.genericAccountDraft?.detailType)?.custom); }
  get genericSupportedImportKinds(): readonly ImportSourceKind[] { return this.genericAccountDefinition(this.genericAccountDraft?.accountType)?.supportedImportSourceKinds ?? []; }
  get genericAccountCurrentBalance(): string { return this.genericAccountPreview?.currentBalanceMinor === undefined ? '' : formatMoney(money(this.genericAccountPreview.currentBalanceMinor)); }
  get genericAccountDraftValid(): boolean {
    const draft = this.genericAccountDraft;
    if (!draft || !draft.name.trim() || !draft.detailType || !this.genericAccountPreview || !this.genericAccountValidation?.valid || this.genericAccountValidation.blockingReferences.length) return false;
    if (this.genericAccountValidation.confirmationReferences.length && !this.genericAccountReferencesConfirmed) return false;
    return true;
  }

  private applyGenericAccountTypeDefaults(): void {
    const draft = this.genericAccountDraft;
    const definition = draft ? this.genericAccountDefinition(draft.accountType) : undefined;
    if (!draft || !definition) return;
    if (!definition.detailTypes.some(detail => detail.value === draft.detailType)) draft.detailType = definition.detailTypes[0]?.value ?? '';
    if (!this.genericCompatibleParents.some(parent => parent.id === draft.parentId)) draft.parentId = undefined;
    draft.importEnabled = draft.requestedRole === 'FINANCIAL_SOURCE' && definition.importCapabilityDefault;
    draft.supportedSourceKinds = draft.importEnabled ? [...definition.supportedImportSourceKinds] : [];
    this.refreshGenericAccountReview();
  }

  private genericAccountDefinition(accountType?: AccountingAccountType) {
    return this.genericAccountCatalog.flatMap(group => group.accountTypes).find(type => type.accountType === accountType);
  }

  private genericAccountCommand(): SaveGenericAccountCommand | undefined {
    const draft = this.genericAccountDraft;
    const openingBalanceMinor = draft ? this.parseMoneyInput(draft.openingBalanceText) : undefined;
    if (!draft || openingBalanceMinor === undefined) return undefined;
    return {
      accountId: draft.accountId, currentRole: draft.currentRole, requestedRole: draft.requestedRole,
      accountType: draft.accountType, detailType: draft.detailType, name: draft.name, parentId: draft.parentId,
      description: draft.description, importCapability: { enabled: draft.importEnabled, supportedSourceKinds: draft.importEnabled ? draft.supportedSourceKinds : [] },
      openingBalanceSource: draft.openingBalanceSource, openingBalanceMinor, openingBalanceDate: draft.openingBalanceDate,
      institutionOrEntity: draft.institutionOrEntity, lastFour: draft.lastFour, displayOrder: draft.displayOrder, locked: draft.locked,
    };
  }

  async chooseBackupDirectory(): Promise<void> {
    const locations = await this.backupFacade.chooseBackupDirectory();
    if (this.backupFacade.error()) { this.statusMessage = this.backupFacade.error()!; return; }
    if (locations?.backupDirectory) this.statusMessage = `Backup folder set to ${locations.backupDirectory}.`;
  }

  async backupDatabaseNow(): Promise<void> {
    const result = await this.backupFacade.backupNow();
    if (this.backupFacade.error()) { this.statusMessage = this.backupFacade.error()!; return; }
    if (result) this.statusMessage = `Verified database backup created: ${result.path}`;
  }

  async relocateCurrentDatabase(): Promise<void> {
    if (!window.confirm('Move the current database? A verified safety backup will be created first. The application will restart after the new database is validated.')) return;
    const result = await this.backupFacade.relocateCurrentDatabase();
    if (this.backupFacade.error()) { this.statusMessage = this.backupFacade.error()!; return; }
    if (result) this.statusMessage = `Current database moved to ${result.path}. Restarting…`;
  }

  async restoreDatabaseBackup(): Promise<void> {
    if (!window.confirm('Restore from a SQLite backup? The selected backup will be validated and left unchanged. A safety backup of the current books will be created before replacement, then the application will restart.')) return;
    const result = await this.backupFacade.restoreDatabaseBackup();
    if (this.backupFacade.error()) { this.statusMessage = this.backupFacade.error()!; return; }
    if (result) this.statusMessage = `Restored the database from a verified backup. Restarting…`;
  }

  openNewRule(): void {
    this.ruleDraft = {
      id: '',
      name: '',
      enabled: true,
      priority: Math.max(0, ...this.ruleFacade.rules().map(rule => rule.priority)) + 1,
      conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: '' }],
      matchMode: 'ALL',
      tags: [],
    };
    this.ruleEditorSourceTransactionId = '';
    this.ruleTagsText = '';
    this.ruleTestMessage = '';
  }

  editRule(ruleId: string): void {
    const rule = this.ruleFacade.rules().find(candidate => candidate.id === ruleId);
    if (!rule) {
      this.statusMessage = 'That rule no longer exists.';
      return;
    }
    this.openRuleDraft(rule);
  }

  copyRule(ruleId: string): void {
    const duplicate = this.ruleFacade.duplicate(ruleId);
    if (!duplicate || this.ruleFacade.error()) {
      this.statusMessage = this.ruleFacade.error() ?? 'Unable to copy rule.';
      return;
    }
    this.setupFacade.load();
    this.openRuleDraft(duplicate);
    this.statusMessage = `Copied ${duplicate.name}. The copy is disabled until you enable it.`;
  }

  toggleRuleEnabled(rule: TransactionRule): void {
    this.ruleFacade.enable(rule.id, !rule.enabled);
    if (this.ruleFacade.error()) {
      this.statusMessage = this.ruleFacade.error()!;
      return;
    }
    this.statusMessage = `${rule.enabled ? 'Disabled' : 'Enabled'} ${rule.name}.`;
    this.refreshAfterRuleChange();
  }

  deleteRule(rule: TransactionRule): void {
    if (!window.confirm(`Delete rule “${rule.name}”? Existing Posted transactions and their audit history will not change.`)) return;
    this.ruleFacade.delete(rule.id);
    if (this.ruleFacade.error()) {
      this.statusMessage = this.ruleFacade.error()!;
      return;
    }
    this.statusMessage = `Deleted rule ${rule.name}.`;
    this.refreshAfterRuleChange();
  }

  openRuleForTransaction(transaction: Transaction): void {
    const suggestion = this.suggestionFor(transaction.id);
    if (suggestion.source === 'RULE' && suggestion.ruleId && this.ruleFacade.rules().some(rule => rule.id === suggestion.ruleId)) {
      this.ruleEditorSourceTransactionId = transaction.id;
      this.editRule(suggestion.ruleId);
      this.ruleEditorSourceTransactionId = transaction.id;
      return;
    }
    const draft = this.ruleFacade.draftFromTransaction(transaction.id, this.selectedCategoryIds[transaction.id] || undefined);
    if (!draft || this.ruleFacade.error()) {
      this.statusMessage = this.ruleFacade.error() ?? 'Unable to create a rule from this transaction.';
      return;
    }
    this.openRuleDraft(draft, transaction.id);
  }

  closeRuleEditor(): void {
    this.closeCategoryPicker();
    this.ruleDraft = undefined;
    this.ruleEditorSourceTransactionId = '';
    this.ruleTagsText = '';
    this.ruleTestMessage = '';
    this.ruleFacade.testResults.set([]);
  }

  addRuleCondition(): void {
    this.ruleDraft?.conditions.push({ field: 'DESCRIPTION', operator: 'CONTAINS', value: '' });
  }

  removeRuleCondition(index: number): void {
    if (!this.ruleDraft || this.ruleDraft.conditions.length === 1) return;
    this.ruleDraft.conditions.splice(index, 1);
  }

  ruleConditionFieldChanged(condition: RuleCondition): void {
    if (condition.field === 'ACCOUNT') { condition.operator = 'EQUALS'; condition.value = this.selectedAccountId || this.accounts[0]?.id || ''; }
    else if (condition.field === 'DIRECTION') { condition.operator = 'EQUALS'; condition.value = 'OUT'; }
    else if (condition.field === 'SOURCE_TYPE') { condition.operator = 'EQUALS'; condition.value = 'IMPORT'; }
    else if (condition.field === 'AMOUNT') { condition.operator = 'EQUALS'; condition.value = '0'; }
    else { condition.operator = 'CONTAINS'; condition.value = ''; }
    condition.secondValue = undefined;
  }

  testRuleDraft(): void {
    if (!this.ruleDraft) return;
    this.applyRuleTags();
    this.ruleFacade.test(this.ruleDraft);
    if (this.ruleFacade.error()) {
      this.ruleTestMessage = this.ruleFacade.error()!;
      return;
    }
    const matches = this.ruleFacade.testResults().filter(result => result.matched);
    this.ruleTestMessage = `${matches.length} transaction${matches.length === 1 ? '' : 's'} match this unsaved rule.`;
  }

  saveRuleDraft(): void {
    if (!this.ruleDraft) return;
    this.applyRuleTags();
    const saved = this.ruleFacade.save(this.ruleDraft);
    if (!saved || this.ruleFacade.error()) {
      this.statusMessage = this.ruleFacade.error() ?? 'Unable to save rule.';
      return;
    }
    this.statusMessage = `Saved rule ${saved.name}. Pending suggestions were refreshed.`;
    this.closeRuleEditor();
    this.refreshAfterRuleChange();
  }

  selectReportView(view: ReportView): void {
    this.reportView = view;
    if (view === 'DETAIL') this.loadReportDetailSelection();
  }

  selectReportBasis(basis: ReportBasis): void {
    if (this.reportBasis === basis) return;
    this.reportBasis = basis;
    this.reportSelectedCell = undefined;
    this.loadReportDetailSelection();
  }

  toggleReportCategory(categoryId: string): void {
    if (this.reportExcludedCategoryIds.has(categoryId)) this.reportExcludedCategoryIds.delete(categoryId);
    else this.reportExcludedCategoryIds.add(categoryId);
    this.loadReports();
  }

  clearReportExclusions(): void {
    this.reportExcludedCategoryIds.clear();
    this.loadReports();
  }

  selectReportCell(cell: ProfitLossCell, period?: string): void {
    const chartAccountId = this.chartAccounts.some(account => account.id === cell.key) ? cell.key : undefined;
    this.reportSelectedCell = {
      period,
      sectionKey: chartAccountId ? undefined : cell.key as ProfitLossSectionKey,
      chartAccountId: chartAccountId && !cell.children.length ? chartAccountId : undefined,
      categoryIds: chartAccountId && cell.children.length ? this.reportCellCategoryIds(cell) : undefined,
      label: cell.label,
    };
    this.reportView = 'DETAIL';
    this.loadReportDetailSelection();
  }

  selectReportSummaryRow(row: ReportSummaryDisplayRow, period?: string): void {
    const isChartAccount = this.chartAccounts.some(account => account.id === row.cell.key);
    this.reportSelectedCell = {
      period,
      sectionKey: isChartAccount ? undefined : row.cell.key as ProfitLossSectionKey,
      chartAccountId: isChartAccount && (row.directOnly || !row.cell.children.length) ? row.cell.key : undefined,
      categoryIds: isChartAccount && !row.directOnly && row.cell.children.length ? this.reportCellCategoryIds(row.cell) : undefined,
      label: row.kind === 'SUBTOTAL' ? row.label.replace(/^Total for /, '') : row.label,
    };
    this.reportView = 'DETAIL';
    this.loadReportDetailSelection();
  }

  clearReportDetailSelection(): void {
    this.reportSelectedCell = undefined;
    this.loadReportDetailSelection();
  }

  loadReportDetailSelection(): void {
    if (!this.reportStartDate || !this.reportEndDate || this.reportStartDate > this.reportEndDate) return;
    this.reportFacade.loadDrilldown(this.reportDrilldownQuery());
    this.reportDetailRows = this.reportFacade.detail();
  }

  showRemovedTaxDetail(): void {
    const categoryIds = [...new Set([
      ...(this.report?.includeFederalIncomeTax ? [] : this.reportTaxSettings.federalIncomeTaxAccountIds),
      ...(this.report?.includeStateLocalIncomeTax ? [] : this.reportTaxSettings.stateLocalIncomeTaxAccountIds),
    ])];
    this.reportSelectedCell = { sectionKey: 'TAX_REMOVED', categoryIds };
    this.reportView = 'DETAIL';
    this.loadReportDetailSelection();
  }

  saveReportTaxSettings(): void {
    try {
      this.accounting.saveTaxYearSettings({ ...this.reportTaxSettings, confirmedAtUtc: undefined, accountantNote: undefined });
      this.reportBasis = 'SCHEDULE_C';
      this.statusMessage = `Saved Schedule C tax settings for ${this.reportTaxSettings.taxYear}.`;
      this.loadReports();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Unable to save Schedule C tax settings.';
    }
  }

  downloadReport(format: 'CSV' | 'XLSX' | 'PRINT'): void {
    const activeReport = this.activeProfitLossReport;
    if (!activeReport) return;
    const disclosure = this.reportExportDisclosure();
    const reportName = this.reportBasis === 'SCHEDULE_C' ? 'schedule-c-ready' : 'profit-loss';
    if (format === 'CSV') {
      this.downloadFile(this.accounting.exportReportCsv(activeReport, disclosure), `${reportName}-summary-${this.reportStartDate}-${this.reportEndDate}.csv`, 'text/csv;charset=utf-8');
    } else if (format === 'XLSX') {
      this.downloadFile(this.accounting.exportReportXlsx(activeReport, disclosure), `${reportName}-summary-${this.reportStartDate}-${this.reportEndDate}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      const html = this.accounting.exportReportPrintHtml(activeReport, disclosure);
      const popup = window.open('', '_blank');
      if (popup) {
        popup.document.write(html);
        popup.document.close();
        popup.focus();
      } else {
        this.downloadFile(html, `${reportName}-summary-${this.reportStartDate}-${this.reportEndDate}.html`, 'text/html;charset=utf-8');
      }
    }
    this.statusMessage = format === 'PRINT' ? 'Opened the print-ready P/L Summary. Review it, then choose File → Print or press ⌘P.' : `Downloaded the P/L Summary ${format} export.`;
  }

  downloadDetail(format: 'CSV' | 'XLSX'): void {
    const query = this.reportDrilldownQuery();
    const reportName = this.reportBasis === 'SCHEDULE_C' ? 'schedule-c-ready' : 'profit-loss';
    if (format === 'CSV') {
      this.downloadFile(this.accounting.exportProfitLossDrilldownCsv(query), `${reportName}-detail-${this.reportStartDate}-${this.reportEndDate}.csv`, 'text/csv;charset=utf-8');
    } else {
      this.downloadFile(this.accounting.exportProfitLossDrilldownXlsx(query), `${reportName}-detail-${this.reportStartDate}-${this.reportEndDate}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    this.statusMessage = `Downloaded the P/L Detail ${format} export.`;
  }

  sortReportDetail(column: ReportSortColumn): void {
    if (this.reportDetailSortColumn === column) this.reportDetailSortDirection = this.reportDetailSortDirection === 'ASC' ? 'DESC' : 'ASC';
    else { this.reportDetailSortColumn = column; this.reportDetailSortDirection = 'ASC'; }
  }

  reportDetailSortAria(column: ReportSortColumn): 'ascending' | 'descending' | null {
    if (column !== this.reportDetailSortColumn) return null;
    return this.reportDetailSortDirection === 'ASC' ? 'ascending' : 'descending';
  }

  reportDetailSortAction(column: ReportSortColumn, label: string): string {
    const next = this.reportDetailSortColumn === column && this.reportDetailSortDirection === 'ASC' ? 'descending' : 'ascending';
    return `Sort report detail by ${label} ${next}`;
  }

  reportCellValue(cell: ProfitLossCell, period?: string): ReturnType<typeof formatMoney> {
    return formatMoney({ minorUnits: period ? cell.values[period] ?? 0n : cell.totalMinor, currency: 'USD' });
  }

  reportMoney(value: bigint): string { return formatMoney({ minorUnits: value, currency: 'USD' }); }
  get activeProfitLossReport(): ProfitLossReport { return this.reportBasis === 'SCHEDULE_C' ? this.report : this.profitLossReport; }
  reportNetProfitMoney(): string { return this.reportMoney(this.activeProfitLossReport?.netProfitMinor ?? 0n); }
  reportRemovedTaxMoney(): string { return this.reportMoney(this.report?.removedTotalMinor ?? 0n); }
  get hasRemovedTax(): boolean { return (this.report?.removedTotalMinor ?? 0n) !== 0n; }
  reportReconciliationMoney(): string { return this.reportMoney(this.activeProfitLossReport?.reconciliationDifferenceMinor ?? 0n); }
  detailAmountMoney(row: ReportDetailRow): string { return this.reportMoney(row.reportContributionMinor); }
  get reportPeriods(): string[] { return this.activeProfitLossReport?.periods ?? []; }

  get reportVisiblePeriods(): string[] {
    return this.reportGrouping === 'YEAR' && this.reportPeriods.length === 1 ? [] : this.reportPeriods;
  }
  get reportTaxYear(): number { return this.report?.taxYear ?? this.accounting.getCompany().activeTaxYear; }
  get reportTaxAccountNames(): string {
    const ids = [...new Set([...this.reportTaxSettings.federalIncomeTaxAccountIds, ...this.reportTaxSettings.stateLocalIncomeTaxAccountIds])];
    return ids.map(id => this.categoryPath(id)).join(', ') || 'No configured income-tax accounts';
  }

  reportSectionValue(key: string, period?: string): bigint {
    const report = this.activeProfitLossReport;
    const value = (sectionKey: string): bigint => {
      const section = report?.sections.find(item => item.key === sectionKey);
      return period ? section?.values[period] ?? 0n : section?.totalMinor ?? 0n;
    };
    if (key === 'GROSS_PROFIT') return value('INCOME') - value('COGS');
    if (key === 'NET_PROFIT') return value('INCOME') - value('COGS') - value('EXPENSES') + value('OTHER_INCOME') - value('OTHER_EXPENSE');
    return value(key);
  }

  reportSyntheticCell(key: 'GROSS_PROFIT' | 'NET_PROFIT'): ProfitLossCell {
    const report = this.activeProfitLossReport;
    const values = Object.fromEntries((report?.periods ?? []).map(period => [period, this.reportSectionValue(key, period)]));
    return { key, label: key === 'GROSS_PROFIT' ? 'Gross Profit' : 'Net Profit', values, totalMinor: this.reportSectionValue(key), children: [] };
  }

  get reportSelectionLabel(): string {
    if (!this.reportSelectedCell) return 'All included posted detail';
    const category = this.reportSelectedCell.label ?? (this.reportSelectedCell.sectionKey === 'TAX_REMOVED' ? 'Schedule C removed tax' : this.reportSelectedCell.chartAccountId ? this.categoryPath(this.reportSelectedCell.chartAccountId) : this.reportSelectedCell.sectionKey === 'GROSS_PROFIT' ? 'Gross Profit' : this.reportSelectedCell.sectionKey === 'NET_PROFIT' ? 'Net Profit' : this.reportSelectedCell.sectionKey ?? 'Selected report cell');
    return this.reportSelectedCell.period ? `${category} · ${this.reportSelectedCell.period}` : category;
  }

  get reportSummaryRows(): ProfitLossCell[] {
    const report = this.activeProfitLossReport;
    if (!report) return [];
    return [...report.sections.slice(0, 2), this.reportSyntheticCell('GROSS_PROFIT'), ...report.sections.slice(2), this.reportSyntheticCell('NET_PROFIT')];
  }

  get reportSummaryDisplayRows(): ReportSummaryDisplayRow[] {
    const report = this.activeProfitLossReport;
    if (!report) return [];
    const rows: ReportSummaryDisplayRow[] = [];
    const addAccountRows = (cell: ProfitLossCell, depth: number): void => {
      if (!cell.children.length) {
        rows.push({ id: `account:${cell.key}`, label: cell.label, cell, valueCell: cell, depth, kind: 'ACCOUNT', showAmounts: true });
        return;
      }
      const hasDirectActivity = (cell.directTotalMinor ?? 0n) !== 0n || Object.values(cell.directValues ?? {}).some(value => value !== 0n);
      const directCell: ProfitLossCell = { key: `${cell.key}:direct`, label: cell.label, values: cell.directValues ?? {}, totalMinor: cell.directTotalMinor ?? 0n, children: [] };
      rows.push({ id: `group:${cell.key}`, label: cell.label, cell, valueCell: directCell, depth, kind: 'GROUP', showAmounts: hasDirectActivity, directOnly: hasDirectActivity });
      cell.children.forEach(child => addAccountRows(child, depth + 1));
      rows.push({ id: `subtotal:${cell.key}`, label: `Total for ${cell.label}`, cell, valueCell: cell, depth, kind: 'SUBTOTAL', showAmounts: true });
    };
    report.sections.forEach(section => {
      rows.push({ id: `section:${section.key}`, label: section.label, cell: section, valueCell: section, depth: 0, kind: 'GROUP', showAmounts: false });
      section.children.forEach(child => addAccountRows(child, 1));
      rows.push({ id: `section-total:${section.key}`, label: `Total for ${section.label}`, cell: section, valueCell: section, depth: 0, kind: 'SUBTOTAL', showAmounts: true });
      if (section.key === 'COGS') {
        const grossProfit = this.reportSyntheticCell('GROSS_PROFIT');
        rows.push({ id: 'synthetic:GROSS_PROFIT', label: grossProfit.label, cell: grossProfit, valueCell: grossProfit, depth: 0, kind: 'SYNTHETIC', showAmounts: true });
      }
    });
    const netProfit = this.reportSyntheticCell('NET_PROFIT');
    rows.push({ id: 'synthetic:NET_PROFIT', label: netProfit.label, cell: netProfit, valueCell: netProfit, depth: 0, kind: 'SYNTHETIC', showAmounts: true });
    return rows;
  }

  private reportCellCategoryIds(cell: ProfitLossCell): string[] {
    return [cell.key, ...cell.children.flatMap(child => this.reportCellCategoryIds(child))];
  }

  get reportCategoryOptions() {
    return this.chartAccounts.filter(account => ['INCOME', 'COGS', 'EXPENSE', 'OTHER_INCOME', 'OTHER_EXPENSE'].includes(account.type)).sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name));
  }

  private reportDrilldownQuery(includeSelectionAndFilters = true): ReportDrilldownQuery {
    const selected = includeSelectionAndFilters ? this.reportSelectedCell : undefined;
    let categoryIds = selected?.categoryIds ? [...selected.categoryIds] : undefined;
    if (includeSelectionAndFilters && this.reportDetailCategoryId) {
      categoryIds = categoryIds ? categoryIds.filter(id => id === this.reportDetailCategoryId) : [this.reportDetailCategoryId];
    }
    return {
      startDate: this.reportStartDate,
      endDate: this.reportEndDate,
      grouping: this.reportGrouping,
      period: selected?.period,
      sectionKey: selected?.sectionKey,
      chartAccountId: selected?.chartAccountId,
      categoryIds,
      excludedChartAccountIds: this.reportDrilldownExcludedCategoryIds(selected?.sectionKey),
      accountId: includeSelectionAndFilters ? this.reportDetailAccountId || undefined : undefined,
      search: includeSelectionAndFilters ? this.reportDetailSearch || undefined : undefined,
    };
  }

  private reportDrilldownExcludedCategoryIds(sectionKey?: ProfitLossSectionKey): string[] {
    const excluded = new Set(this.reportExcludedCategoryIds);
    if (this.reportBasis === 'SCHEDULE_C' && sectionKey !== 'TAX_REMOVED') {
      if (!this.report.includeFederalIncomeTax) this.reportTaxSettings.federalIncomeTaxAccountIds.forEach(id => excluded.add(id));
      if (!this.report.includeStateLocalIncomeTax) this.reportTaxSettings.stateLocalIncomeTaxAccountIds.forEach(id => excluded.add(id));
    }
    return [...excluded];
  }

  private reportExportDisclosure(): ReportExportDisclosure {
    const configuredTaxAccounts = [...new Set([...this.reportTaxSettings.federalIncomeTaxAccountIds, ...this.reportTaxSettings.stateLocalIncomeTaxAccountIds])].map(id => this.categoryPath(id));
    return {
      taxYear: this.reportTaxYear,
      includeFederalIncomeTax: this.report.includeFederalIncomeTax,
      includeStateLocalIncomeTax: this.report.includeStateLocalIncomeTax,
      removedTaxMinor: this.report.removedTotalMinor,
      configuredTaxAccounts,
    };
  }

  get filteredReportDetailRows(): ReportDetailRow[] {
    const direction = this.reportDetailSortDirection === 'ASC' ? 1 : -1;
    return [...this.reportDetailRows].sort((left, right) => direction * (this.compareReportDetail(left, right) || left.transactionId.localeCompare(right.transactionId)));
  }

  private compareReportDetail(left: ReportDetailRow, right: ReportDetailRow): number {
    if (this.reportDetailSortColumn === 'DATE') return left.postingDate.localeCompare(right.postingDate);
    if (this.reportDetailSortColumn === 'ACCOUNT') return this.compareText(this.accountName(left.accountId), this.accountName(right.accountId));
    if (this.reportDetailSortColumn === 'DESCRIPTION') return this.compareText(left.description ?? '', right.description ?? '');
    if (this.reportDetailSortColumn === 'CATEGORY') return this.compareText(this.categoryPath(left.chartAccountId), this.categoryPath(right.chartAccountId));
    return left.reportContributionMinor < right.reportContributionMinor ? -1 : left.reportContributionMinor > right.reportContributionMinor ? 1 : 0;
  }

  private downloadFile(content: string | ArrayBuffer, fileName: string, type: string): void {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async inspectFile(event: Event): Promise<void> {
    if (!this.requireSelectedAccount('importing a statement')) {
      (event.target as HTMLInputElement).value = '';
      return;
    }
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const destinationAccountId = this.selectedAccountId;
    const extension = file.name.toLowerCase().split('.').pop();
    const kind = file.name.toLowerCase().includes('amazon') ? 'AMAZON' : extension === 'csv' ? 'CSV' : extension === 'qbo' || extension === 'ofx' || extension === 'qfx' ? 'QBO_OFX' : 'EXCEL';
    const content = kind === 'EXCEL' ? await file.arrayBuffer() : await file.text();
    try {
      this.importPreview = this.importFacade.inspect({ fileName: file.name, content, kind, destinationAccountId });
      if (!this.importPreview) throw new Error(this.importFacade.error() ?? 'Unable to inspect file.');
      this.selectedFileName = file.name;
      this.statusMessage = `Preview ready: ${this.importPreview.batch.acceptedCount} accepted, ${this.importPreview.batch.rejectedCount} rejected, ${this.importPreview.batch.skippedCount} skipped.`;
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Unable to inspect file.';
    }
  }

  openTransactionFilePicker(): void {
    if (!this.requireSelectedAccount('importing a statement')) return;
    this.transactionFileInput?.nativeElement.click();
  }

  commitImport(): void {
    if (!this.importPreview) return;
    if (!this.requireSelectedAccount('committing an import')) return;
    try {
      if (!this.importFacade.commit()) throw new Error(this.importFacade.error() ?? 'Unable to commit import.');
      this.statusMessage = `Imported ${this.selectedFileName} into Pending.`;
      this.importPreview = undefined;
      this.selectedFileName = '';
      this.selectWorkspace('TRANSACTIONS');
      this.clearTransactionFilters();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Unable to commit import.';
    }
  }

  async importChartFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const content = file.name.toLowerCase().endsWith('.csv') ? await file.text() : await file.arrayBuffer();
    const accounts = this.chartAccountFacade.import(content);
    if (this.chartAccountFacade.error()) this.statusMessage = this.chartAccountFacade.error()!;
    else this.statusMessage = `Loaded ${accounts?.length ?? 0} accounting categories from ${file.name}.`;
    input.value = '';
    this.refresh();
  }

  exportChartAccounts(): void {
    this.downloadFile(this.chartAccountFacade.export(), 'tallystick-chart-of-accounts.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    this.statusMessage = 'Exported the complete Chart of Accounts workbook.';
  }

  openNewChartAccount(): void {
    const accountType: ChartAccountKind = 'EXPENSE';
    this.chartDraft = {
      name: '', accountType, detailType: this.chartAccountTypes.find(item => item.value === accountType)!.detailTypes[0],
      description: '', displayOrder: Math.max(-1, ...this.chartAccountFacade.accounts().map(account => account.displayOrder)) + 1,
      locked: false, archived: false,
    };
  }

  editChartAccount(id: string): void {
    const account = this.chartAccountFacade.accounts().find(item => item.id === id);
    if (!account) return;
    this.chartDraft = {
      id: account.id,
      name: this.chartAccountLeafName(account),
      accountType: account.accountType,
      detailType: account.detailType,
      parentId: account.parentId,
      description: account.description ?? '',
      displayOrder: account.displayOrder,
      locked: account.locked,
      archived: account.archived,
    };
  }

  closeChartAccountEditor(): void { this.chartDraft = undefined; }

  chartAccountTypeChanged(): void {
    if (!this.chartDraft) return;
    const definition = this.chartAccountTypes.find(item => item.value === this.chartDraft!.accountType)!;
    this.chartDraft.detailType = definition.detailTypes[0];
    if (!this.compatibleChartParents.some(account => account.id === this.chartDraft?.parentId)) this.chartDraft.parentId = undefined;
  }

  saveChartAccount(): void {
    if (!this.chartDraft || !this.chartDraftValid) return;
    const { id, archived, ...command } = this.chartDraft;
    const saved = id ? this.chartAccountFacade.update(id, command) : this.chartAccountFacade.create(command);
    if (!saved) { this.statusMessage = this.chartAccountFacade.error() ?? 'Unable to save chart account.'; return; }
    if (id && saved.archived !== archived) {
      const archiveResult = this.chartAccountFacade.archive(id, archived);
      if (!archiveResult) {
        this.statusMessage = this.chartAccountFacade.error() ?? 'Unable to change the account archive state.';
        return;
      }
    }
    this.setupFacade.load();
    this.statusMessage = `${id ? 'Updated' : 'Created'} ${saved.name}.`;
    this.chartDraft = undefined;
  }

  toggleChartAccountArchived(account: ChartAccount): void {
    const action = account.archived ? 'restore' : 'archive';
    if (!window.confirm(`${action === 'archive' ? 'Archive' : 'Restore'} ${account.name}? Historical transactions and reports will retain this account.`)) return;
    const result = this.chartAccountFacade.archive(account.id, !account.archived);
    if (!result) { this.statusMessage = this.chartAccountFacade.error() ?? `Unable to ${action} account.`; return; }
    this.setupFacade.load();
    this.statusMessage = `${account.archived ? 'Restored' : 'Archived'} ${account.name}.`;
  }

  chartAccountLeafName(account: ChartAccount): string { return account.name.split(':').pop() ?? account.name; }

  chartAccountTypeLabel(accountType: ChartAccountKind): string { return this.chartAccountTypes.find(item => item.value === accountType)?.label ?? accountType; }

  sortChartAccounts(column: Exclude<ChartSortColumn, 'ORDER'>): void {
    if (this.chartSortColumn === column) this.chartSortDirection = this.chartSortDirection === 'ASC' ? 'DESC' : 'ASC';
    else { this.chartSortColumn = column; this.chartSortDirection = 'ASC'; }
  }

  chartSortAria(column: Exclude<ChartSortColumn, 'ORDER'>): 'ascending' | 'descending' | null {
    if (this.chartSortColumn !== column) return null;
    return this.chartSortDirection === 'ASC' ? 'ascending' : 'descending';
  }

  chartSortAction(column: Exclude<ChartSortColumn, 'ORDER'>, label: string): string {
    const next = this.chartSortColumn === column && this.chartSortDirection === 'ASC' ? 'descending' : 'ascending';
    return `Sort chart accounts by ${label} ${next}`;
  }

  chartAccountDepth(account: ChartAccount): number {
    let depth = 0;
    let current = account;
    const visited = new Set<string>();
    while (current.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      depth += 1;
      const parent = this.chartAccountFacade.accounts().find(item => item.id === current.parentId);
      if (!parent) break;
      current = parent;
    }
    return depth;
  }

  get filteredChartAccounts(): ChartAccount[] {
    const needle = this.chartSearch.trim().toLowerCase();
    return this.chartAccountFacade.accounts().filter(account => {
      if (this.chartTypeFilter !== 'ALL' && account.accountType !== this.chartTypeFilter) return false;
      if (this.chartStatusFilter === 'ACTIVE' && account.archived) return false;
      if (this.chartStatusFilter === 'ARCHIVED' && !account.archived) return false;
      return !needle || `${account.name} ${this.chartAccountTypeLabel(account.accountType)} ${account.detailType} ${account.description ?? ''}`.toLowerCase().includes(needle);
    }).sort((left, right) => {
      const values: Record<ChartSortColumn, [string | number, string | number]> = {
        ORDER: [left.displayOrder, right.displayOrder],
        NAME: [left.name, right.name],
        TYPE: [this.chartAccountTypeLabel(left.accountType), this.chartAccountTypeLabel(right.accountType)],
        DETAIL: [left.detailType, right.detailType],
        STATUS: [left.archived ? 1 : 0, right.archived ? 1 : 0],
      };
      const [leftValue, rightValue] = values[this.chartSortColumn];
      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
      return (this.chartSortDirection === 'ASC' ? comparison : -comparison) || left.displayOrder - right.displayOrder || left.name.localeCompare(right.name);
    });
  }

  get compatibleChartParents(): ChartAccount[] {
    if (!this.chartDraft) return [];
    const edited = this.chartDraft.id ? this.chartAccountFacade.accounts().find(account => account.id === this.chartDraft?.id) : undefined;
    const descendantPrefix = edited ? `${edited.name}:` : '';
    return this.chartAccountFacade.accounts().filter(account => !account.archived
      && account.accountType === this.chartDraft?.accountType
      && account.id !== this.chartDraft?.id
      && (!descendantPrefix || !account.name.startsWith(descendantPrefix)));
  }

  get chartDraftValid(): boolean {
    return Boolean(this.chartDraft?.name.trim()
      && this.chartDraft.detailType.trim()
      && Number.isInteger(this.chartDraft.displayOrder)
      && !(this.chartDraft.locked && this.chartDraft.archived));
  }

  get chartDraftPath(): string {
    if (!this.chartDraft?.name.trim()) return 'Enter an account name to preview its position.';
    const parent = this.chartAccountFacade.accounts().find(account => account.id === this.chartDraft?.parentId);
    return parent ? `${parent.name}:${this.chartDraft.name.trim().split(':').pop()}` : this.chartDraft.name.trim().split(':').pop()!;
  }

  get managedChartAccountCount(): number { return this.chartAccountFacade.accounts().length; }
  get chartAccountError(): string { return this.chartAccountFacade.error() ?? ''; }
  get chartDetailTypes(): readonly string[] {
    return this.chartAccountTypes.find(type => type.value === this.chartDraft?.accountType)?.detailTypes ?? [];
  }

  async importRulesFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const content = file.name.toLowerCase().endsWith('.csv') ? await file.text() : await file.arrayBuffer();
    this.setupFacade.previewRulesImport(content);
    const preview = this.setupFacade.ruleImportPreview();
    if (this.setupFacade.error()) this.statusMessage = this.setupFacade.error()!;
    else if (preview?.valid) this.statusMessage = `Rule preview ready: ${preview.importedCount} new, ${preview.updatedCount} updated, ${preview.disabledCount} disabled. Confirm to replace the current rules.`;
    else this.statusMessage = `Rule preview has ${preview?.issues.filter(issue => issue.severity === 'ERROR').length ?? 0} error(s). Correct the file before importing.`;
    input.value = '';
  }

  commitRulesImport(): void {
    const preview = this.setupFacade.ruleImportPreview();
    if (!preview?.valid || !window.confirm(`Replace all current rules with this validated rule file? ${preview.importedCount} new and ${preview.updatedCount} updated rules will be applied.`)) return;
    this.setupFacade.commitRulesImport();
    if (this.setupFacade.error()) this.statusMessage = this.setupFacade.error()!;
    else { this.statusMessage = `Replaced rules from validated file: ${this.setupFacade.rules().length} rules loaded.`; this.refresh(); }
  }

  exportRules(format: 'XLSX' | 'CSV'): void {
    const content = this.setupFacade.exportRules(format);
    const blob = new Blob([content], { type: format === 'CSV' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `accounting-rules.${format.toLowerCase()}`; link.click(); URL.revokeObjectURL(link.href);
  }

  selectAccount(accountId: string): void {
    this.selectedAccountId = accountId;
    this.refresh();
  }

  openNewFinancialAccount(): void {
    const year = this.accounting.getCompany().activeTaxYear;
    this.financialAccountDraft = {
      type: 'BANK', detailType: 'Checking', name: '', institutionOrEntity: '', lastFour: undefined,
      parentAccountId: undefined, description: '', openingBalanceText: '0.00', openingBalanceDate: `${year}-01-01`,
      locked: false, archived: false,
    };
  }

  editFinancialAccount(id: string): void {
    const account = this.accounts.find(item => item.id === id);
    if (!account) { this.statusMessage = 'That account no longer exists.'; return; }
    this.financialAccountDraft = {
      id: account.id, type: account.type, detailType: account.detailType, name: account.name,
      institutionOrEntity: account.institutionOrEntity, lastFour: account.lastFour,
      parentAccountId: account.parentAccountId, description: account.description ?? '',
      openingBalanceText: this.minorUnitsToInput(account.openingBalance.minorUnits), openingBalanceDate: account.openingBalanceDate,
      locked: account.locked, archived: account.archived,
    };
  }

  closeFinancialAccountEditor(): void { this.financialAccountDraft = undefined; }

  financialAccountTypeChanged(): void {
    if (!this.financialAccountDraft) return;
    const definition = this.financialAccountTypes.find(type => type.value === this.financialAccountDraft?.type);
    this.financialAccountDraft.detailType = definition?.detailTypes[0] ?? '';
    if (!this.compatibleFinancialAccountParents.some(parent => parent.id === this.financialAccountDraft?.parentAccountId)) this.financialAccountDraft.parentAccountId = undefined;
  }

  saveFinancialAccount(): void {
    const draft = this.financialAccountDraft;
    const openingBalanceMinor = draft ? this.parseMoneyInput(draft.openingBalanceText) : undefined;
    if (!draft || openingBalanceMinor === undefined || !this.financialAccountDraftValid) return;
    const command: SaveAccountCommand = {
      type: draft.type, detailType: draft.detailType, name: draft.name, institutionOrEntity: draft.institutionOrEntity,
      lastFour: draft.lastFour?.trim() || undefined, parentAccountId: draft.parentAccountId,
      description: draft.description?.trim() || undefined, openingBalanceMinor, openingBalanceDate: draft.openingBalanceDate,
      locked: Boolean(draft.locked),
    };
    const existing = draft.id ? this.accounts.find(account => account.id === draft.id) : undefined;
    if (existing?.archived && !draft.archived) {
      this.accountFacade.archive(existing.id, false);
      if (this.accountFacade.error()) { this.statusMessage = this.accountFacade.error()!; return; }
    }
    const saved = draft.id ? this.accountFacade.update(draft.id, command) : this.accountFacade.create(command);
    if (!saved || this.accountFacade.error()) { this.statusMessage = this.accountFacade.error() ?? 'Unable to save account.'; return; }
    if (draft.id && !existing?.archived && draft.archived) this.accountFacade.archive(saved.id, true);
    if (this.accountFacade.error()) { this.statusMessage = this.accountFacade.error()!; return; }
    this.statusMessage = `${draft.id ? 'Updated' : 'Created'} account ${saved.name}.`;
    this.financialAccountDraft = undefined;
    this.refresh();
  }

  get financialAccountDetailTypes(): readonly string[] {
    return this.financialAccountTypes.find(type => type.value === this.financialAccountDraft?.type)?.detailTypes ?? [];
  }

  get compatibleFinancialAccountParents(): FinancialAccount[] {
    const draft = this.financialAccountDraft;
    if (!draft) return [];
    return this.accounts.filter(account => account.id !== draft.id && account.type === draft.type && !account.archived);
  }

  get financialAccountDraftPath(): string {
    const draft = this.financialAccountDraft;
    if (!draft) return '';
    const parent = this.accounts.find(account => account.id === draft.parentAccountId);
    return [parent?.name, draft.name.trim() || 'New account'].filter(Boolean).join(':');
  }

  get financialAccountDraftValid(): boolean {
    const draft = this.financialAccountDraft;
    if (!draft || !draft.name.trim() || !draft.detailType || !draft.openingBalanceDate || this.parseMoneyInput(draft.openingBalanceText) === undefined) return false;
    if (draft.lastFour?.trim() && !/^\d{4}$/.test(draft.lastFour.trim())) return false;
    if (draft.locked && draft.archived) return false;
    return this.financialAccountDetailTypes.includes(draft.detailType);
  }

  get financialAccountError(): string { return this.accountFacade.error() ?? ''; }

  get financialAccountEditorAccount(): FinancialAccount | undefined {
    return this.accounts.find(account => account.id === this.financialAccountDraft?.id);
  }

  get financialAccountCurrentBalance(): string {
    const account = this.financialAccountEditorAccount;
    return account ? formatMoney(account.calculatedBalance ?? account.openingBalance) : '$0.00';
  }

  get financialAccountLastFourInvalid(): boolean {
    const value = this.financialAccountDraft?.lastFour?.trim();
    return Boolean(value && !/^\d{4}$/.test(value));
  }

  financialAccountTypeLabel(type: AccountType): string {
    return this.financialAccountTypes.find(item => item.value === type)?.label ?? type;
  }

  private parseMoneyInput(value: string): bigint | undefined {
    const normalized = value.trim().replace(/[$,]/g, '');
    if (!/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) return undefined;
    const negative = normalized.startsWith('-');
    const [whole, decimal = ''] = normalized.replace('-', '').split('.');
    const minor = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
    return negative ? -minor : minor;
  }

  private minorUnitsToInput(value: bigint): string {
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  }

  toggleTransaction(transactionId: string): void {
    if (!this.requireTransactionScope([transactionId], 'selecting transactions')) return;
    if (this.selectedTransactionIds.has(transactionId)) this.selectedTransactionIds.delete(transactionId);
    else this.selectedTransactionIds.add(transactionId);
  }

  sortTransactions(column: TransactionSortColumn): void {
    if (this.transactionSortColumn === column) {
      this.transactionSortDirection = this.transactionSortDirection === 'ASC' ? 'DESC' : 'ASC';
    } else {
      this.transactionSortColumn = column;
      this.transactionSortDirection = 'ASC';
    }
    this.applyTransactionSort();
    this.persistTransactionView();
  }

  transactionSortAria(column: TransactionSortColumn): 'ascending' | 'descending' | null {
    if (this.transactionSortColumn !== column) return null;
    return this.transactionSortDirection === 'ASC' ? 'ascending' : 'descending';
  }

  transactionSortIndicator(column: TransactionSortColumn): string {
    if (this.transactionSortColumn !== column) return '↕';
    return this.transactionSortDirection === 'ASC' ? '↑' : '↓';
  }

  transactionSortAction(column: TransactionSortColumn, label: string): string {
    const nextDirection = this.transactionSortColumn === column && this.transactionSortDirection === 'ASC' ? 'descending' : 'ascending';
    return `Sort by ${label} ${nextDirection}`;
  }

  toggleAllVisibleTransactions(): void {
    if (!this.requireTransactionScope(this.transactions.map(transaction => transaction.id), 'selecting transactions')) return;
    if (this.allVisibleTransactionsSelected) {
      this.transactions.forEach(transaction => this.selectedTransactionIds.delete(transaction.id));
      return;
    }
    this.transactions.forEach(transaction => this.selectedTransactionIds.add(transaction.id));
  }

  get allVisibleTransactionsSelected(): boolean {
    return this.transactions.length > 0 && this.transactions.every(transaction => this.selectedTransactionIds.has(transaction.id));
  }

  get someVisibleTransactionsSelected(): boolean {
    return !this.allVisibleTransactionsSelected && this.transactions.some(transaction => this.selectedTransactionIds.has(transaction.id));
  }

  clearSelection(): void { this.selectedTransactionIds.clear(); }

  clearTransactionFilters(): void {
    this.startDate = '';
    this.endDate = '';
    this.transactionMonth = '';
    this.selectedTransactionState = 'PENDING';
    this.search = '';
    this.bulkCategoryId = '';
    this.activeCategoryPicker = '';
    this.categorySearch = '';
    this.clearSelection();
    this.refresh();
  }

  private restoreTransactionView(): void {
    try {
      const raw = globalThis.localStorage?.getItem(TRANSACTION_VIEW_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<StoredTransactionView>;
      if (typeof stored.selectedAccountId === 'string') this.selectedAccountId = stored.selectedAccountId;
      if (stored.selectedTransactionState && ['PENDING', 'POSTED', 'EXCLUDED'].includes(stored.selectedTransactionState)) this.selectedTransactionState = stored.selectedTransactionState;
      if (typeof stored.startDate === 'string') this.startDate = stored.startDate;
      if (typeof stored.endDate === 'string') this.endDate = stored.endDate;
      if (typeof stored.search === 'string') this.search = stored.search;
      if (typeof stored.bulkCategoryId === 'string') this.bulkCategoryId = stored.bulkCategoryId;
      if (stored.transactionSortColumn && ['DATE_ACCOUNT', 'SOURCE', 'CATEGORY', 'AMOUNT'].includes(stored.transactionSortColumn)) this.transactionSortColumn = stored.transactionSortColumn;
      if (stored.transactionSortDirection && ['ASC', 'DESC'].includes(stored.transactionSortDirection)) this.transactionSortDirection = stored.transactionSortDirection;
    } catch {
      try { globalThis.localStorage?.removeItem(TRANSACTION_VIEW_STORAGE_KEY); } catch { /* unavailable storage falls back to default view state */ }
    }
  }

  private persistTransactionView(): void {
    try {
      const stored: StoredTransactionView = {
        selectedAccountId: this.selectedAccountId,
        selectedTransactionState: this.selectedTransactionState,
        startDate: this.startDate,
        endDate: this.endDate,
        search: this.search,
        bulkCategoryId: this.bulkCategoryId,
        transactionSortColumn: this.transactionSortColumn,
        transactionSortDirection: this.transactionSortDirection,
      };
      globalThis.localStorage?.setItem(TRANSACTION_VIEW_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // View preferences are optional; accounting data remains in SQLite.
    }
  }

  private transactionMonthForRange(): string {
    const match = /^(\d{4})-(\d{2})-01$/.exec(this.startDate);
    if (!match) return '';
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) return '';
    const month = `${match[1]}-${match[2]}`;
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return this.endDate === `${month}-${String(lastDay).padStart(2, '0')}` ? month : '';
  }

  openCategoryPicker(target: string): void {
    if (target !== 'bulk' && target !== 'rule' && !this.requireTransactionScope([target], 'changing categories')) return;
    if (this.activeCategoryPicker === target) { this.closeCategoryPicker(); return; }
    this.activeCategoryPicker = target;
    this.categorySearch = '';
    const selectedId = target === 'bulk' ? this.bulkCategoryId : target === 'rule' ? this.ruleDraft?.chartAccountId : this.selectedCategoryIds[target];
    const selectedIndex = this.filteredCategoryAccounts.findIndex(category => category.id === selectedId);
    this.categoryPickerIndex = Math.max(0, selectedIndex);
    setTimeout(() => this.categorySearchInput?.nativeElement.focus());
  }

  closeCategoryPicker(): void {
    this.activeCategoryPicker = '';
    this.categorySearch = '';
    this.categoryPickerIndex = 0;
  }

  chooseCategory(target: string, categoryId: string): void {
    if (target !== 'bulk' && target !== 'rule' && !this.requireTransactionScope([target], 'changing categories')) return;
    if (target === 'bulk') {
      this.bulkCategoryId = categoryId;
      this.closeCategoryPicker();
      this.refresh();
      return;
    }
    if (target === 'rule') {
      if (this.ruleDraft) this.ruleDraft.chartAccountId = categoryId;
      this.closeCategoryPicker();
      return;
    }
    this.closeCategoryPicker();
    this.transactionFacade.categorize([target], categoryId, 'Manual categorization from Pending review');
    if (this.transactionFacade.error()) {
      this.statusMessage = this.transactionFacade.error()!;
      return;
    }
    this.statusMessage = `Categorized Pending transaction as ${this.categoryName(categoryId)}.`;
    this.refresh();
  }

  clearCategory(target: string): void {
    if (target !== 'bulk' && target !== 'rule' && !this.requireTransactionScope([target], 'clearing categories')) return;
    if (target === 'bulk') {
      this.bulkCategoryId = '';
      this.closeCategoryPicker();
      this.refresh();
      return;
    }
    if (target === 'rule') {
      if (this.ruleDraft) this.ruleDraft.chartAccountId = undefined;
      this.closeCategoryPicker();
      return;
    }
    this.closeCategoryPicker();
    this.transactionFacade.clearCategorization(target);
    if (this.transactionFacade.error()) {
      this.statusMessage = this.transactionFacade.error()!;
      return;
    }
    this.statusMessage = 'Cleared the Pending transaction category.';
    this.refresh();
  }

  handleCategoryPickerKeydown(event: KeyboardEvent, target: string): void {
    const matches = this.filteredCategoryAccounts;
    if (event.key === 'Escape') { event.preventDefault(); this.closeCategoryPicker(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); this.categoryPickerIndex = Math.min(this.categoryPickerIndex + 1, matches.length - 1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); this.categoryPickerIndex = Math.max(this.categoryPickerIndex - 1, 0); return; }
    if (event.key === 'Enter' && matches[this.categoryPickerIndex]) { event.preventDefault(); this.chooseCategory(target, matches[this.categoryPickerIndex].id); }
  }

  bulkExclude(): void {
    if (!this.requireTransactionScope([...this.selectedTransactionIds], 'excluding transactions')) return;
    const count = this.selectedTransactionIds.size;
    if (!count || !window.confirm(`Exclude ${count} selected Pending transaction${count === 1 ? '' : 's'}?`)) return;
    this.transactionFacade.exclude([...this.selectedTransactionIds], 'Excluded from review queue');
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.clearSelection();
    this.statusMessage = `Excluded ${count} Pending transaction${count === 1 ? '' : 's'}.`;
    this.refresh();
  }

  bulkCategorize(): void {
    if (!this.requireTransactionScope([...this.selectedTransactionIds], 'categorizing transactions')) return;
    if (!this.selectedTransactionIds.size || !this.bulkCategoryId) return;
    const count = this.selectedTransactionIds.size;
    if (!window.confirm(`Categorize ${count} selected Pending transaction${count === 1 ? '' : 's'} as ${this.categoryName(this.bulkCategoryId)}?`)) return;
    this.transactionFacade.categorize([...this.selectedTransactionIds], this.bulkCategoryId, 'Manual bulk categorization from Pending review');
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.clearSelection();
    this.statusMessage = `Categorized ${count} Pending transactions as ${this.categoryName(this.bulkCategoryId)}.`;
    this.refresh();
  }

  bulkUndo(): void {
    if (!this.requireTransactionScope([...this.selectedTransactionIds], 'undoing transactions')) return;
    if (!this.selectedTransactionIds.size) return;
    const count = this.selectedTransactionIds.size;
    if (!window.confirm(`Undo ${count} selected transaction${count === 1 ? '' : 's'} to Pending?`)) return;
    this.transactionFacade.undo([...this.selectedTransactionIds]);
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.clearSelection();
    this.statusMessage = `Returned ${count} transactions to Pending.`;
    this.refresh();
  }

  bulkPost(): void {
    const ids = [...this.selectedTransactionIds];
    if (!ids.length) return;
    if (!this.requireTransactionScope(ids, 'posting transactions')) return;
    const exclusionSuggestedIds = ids.filter(id => this.hasExclusionSuggestionById(id));
    const postableIds = ids.filter(id => Boolean(this.selectedCategoryIds[id]) && !this.hasExclusionSuggestionById(id));
    const unresolvedCount = ids.length - postableIds.length - exclusionSuggestedIds.length;
    if (!postableIds.length) {
      this.statusMessage = exclusionSuggestedIds.length
        ? `The selected transaction${exclusionSuggestedIds.length === 1 ? ' is' : 's are'} recommended for exclusion and ${exclusionSuggestedIds.length === 1 ? 'was' : 'were'} not posted.`
        : 'None of the selected Pending transactions has a category. Choose a category before posting.';
      return;
    }
    const unresolvedMessage = unresolvedCount ? ` ${unresolvedCount} uncategorized transaction${unresolvedCount === 1 ? '' : 's'} will remain Pending.` : '';
    const exclusionMessage = exclusionSuggestedIds.length ? ` ${exclusionSuggestedIds.length} transaction${exclusionSuggestedIds.length === 1 ? '' : 's'} recommended for exclusion will remain Pending.` : '';
    this.transactionFacade.postWithCategories(postableIds.map(id => ({ id, chartAccountId: this.selectedCategoryIds[id] })));
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.clearSelection();
    this.statusMessage = `Posted ${postableIds.length} Pending transaction${postableIds.length === 1 ? '' : 's'}.${unresolvedMessage}${exclusionMessage}`;
    this.refresh();
  }

  deleteSelectedExcluded(): void {
    if (!this.requireTransactionScope([...this.selectedTransactionIds], 'deleting transactions')) return;
    const count = this.selectedTransactionIds.size;
    if (!count || !window.confirm(`Permanently delete ${count} excluded transaction${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    this.transactionFacade.deleteExcluded([...this.selectedTransactionIds]);
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.clearSelection();
    this.statusMessage = `Permanently deleted ${count} excluded transaction${count === 1 ? '' : 's'}.`;
    this.refresh();
  }

  post(transaction: Transaction): void {
    if (!this.requireTransactionScope([transaction.id], 'posting transactions')) return;
    try {
      if (this.hasExclusionSuggestion(transaction)) {
        throw new Error('This transaction is recommended for exclusion and was not posted. Use Exclude to confirm the recommendation.');
      }
      const chartAccountId = this.selectedCategoryIds[transaction.id];
      if (!chartAccountId) throw new Error('Choose an accounting category before posting.');
      this.transactionFacade.postWithCategory(transaction.id, chartAccountId);
      if (this.transactionFacade.error()) throw new Error(this.transactionFacade.error());
      this.statusMessage = `Posted ${formatMoney(transaction.amount)} as ${this.categoryName(chartAccountId)}.`;
      this.refresh();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Unable to post transaction.';
    }
  }

  matchTransfer(transaction: Transaction): void {
    if (!this.requireTransactionScope([transaction.id], 'matching transfers')) return;
    const suggestion = this.suggestionFor(transaction.id);
    const candidate = suggestion.transferCandidateId ? this.accounting.getTransaction(suggestion.transferCandidateId) : undefined;
    if (!candidate) { this.statusMessage = 'The transfer candidate is no longer available. Refresh and try again.'; return; }
    if (!window.confirm(`Match ${formatMoney(transaction.amount)} with ${candidate.description} in ${this.accountName(candidate.accountId)}? This will keep both transactions out of the profit and loss report.`)) return;
    this.transactionFacade.confirmTransfer(transaction.id, candidate.id);
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.statusMessage = `Matched transfer with ${this.accountName(candidate.accountId)}. Neither transaction affects profit and loss.`;
    this.refresh();
  }

  exclude(transaction: Transaction): void {
    if (!this.requireTransactionScope([transaction.id], 'excluding transactions')) return;
    try {
      this.transactionFacade.exclude([transaction.id], 'Excluded from review queue');
      if (this.transactionFacade.error()) throw new Error(this.transactionFacade.error());
      this.statusMessage = `Excluded ${formatMoney(transaction.amount)}`;
      this.refresh();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : 'Unable to exclude transaction.';
    }
  }

  undo(transaction: Transaction): void {
    if (!this.requireTransactionScope([transaction.id], 'undoing transactions')) return;
    this.transactionFacade.undo([transaction.id]);
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.statusMessage = `Returned ${formatMoney(transaction.amount)} to Pending.`;
    this.refresh();
  }

  deleteExcluded(transaction: Transaction): void {
    if (!this.requireTransactionScope([transaction.id], 'deleting transactions')) return;
    if (!window.confirm(`Permanently delete excluded transaction ${formatMoney(transaction.amount)}? This cannot be undone.`)) return;
    this.transactionFacade.deleteExcluded([transaction.id]);
    if (this.transactionFacade.error()) { this.statusMessage = this.transactionFacade.error()!; return; }
    this.statusMessage = `Permanently deleted ${formatMoney(transaction.amount)}.`;
    this.refresh();
  }

  money = formatMoney;

  accountName(accountId: string): string {
    return this.accounts.find(account => account.id === accountId)?.name ?? 'Unknown';
  }

  get selectedAccount(): FinancialAccount | undefined {
    return this.accounts.find(account => account.id === this.selectedAccountId);
  }

  get hasSelectedAccount(): boolean {
    return Boolean(this.selectedAccountId);
  }

  get transactionAccountOwner(): string {
    return this.selectedAccount?.institutionOrEntity ?? 'All account owners';
  }

  suggestionFor(transactionId: string): TransactionSuggestion {
    return this.suggestions[transactionId] ?? { source: 'NONE', confidence: 0, rationale: 'No suggestion available.' };
  }

  categoryName(chartAccountId?: string): string {
    if (!chartAccountId) return 'Unresolved';
    return this.setupFacade.chartAccounts().find(account => account.id === chartAccountId)?.name ?? 'Unknown category';
  }

  categoryPickerLabel(chartAccountId?: string): string {
    return chartAccountId ? this.categoryPath(chartAccountId) : 'Choose category';
  }

  categoryPath(chartAccountId: string): string {
    const accounts = new Map(this.chartAccounts.map(account => [account.id, account]));
    const path: string[] = [];
    let current = accounts.get(chartAccountId);
    while (current) {
      path.unshift(current.name.split(':').at(-1)?.trim() || current.name);
      current = current.parentId ? accounts.get(current.parentId) : undefined;
    }
    return path.join(' › ') || 'Unknown category';
  }

  get filteredCategoryAccounts() {
    const needle = this.categorySearch.trim().toLowerCase();
    return this.chartAccounts.filter(category => !category.archived).filter(category => !needle || `${this.categoryPath(category.id)} ${category.type}`.toLowerCase().includes(needle));
  }

  selectedCategoryName(transaction: Transaction): string {
    return this.categoryName(transaction.splits[0]?.chartAccountId);
  }

  suggestedCategoryName(transactionId: string): string {
    return this.categoryName(this.suggestionFor(transactionId).chartAccountId);
  }

  categorySelectionNote(transaction: Transaction): string {
    const suggestion = this.suggestionFor(transaction.id);
    const selectedCategoryId = this.selectedCategoryIds[transaction.id];
    if (suggestion.source === 'TRANSFER' && suggestion.transferCandidateId) {
      const candidate = this.accounting.getTransaction(suggestion.transferCandidateId);
      return `Transfer candidate: ${candidate ? this.accountName(candidate.accountId) : 'another account'} — ${suggestion.rationale} Confirm the transfer instead of posting it.`;
    }
    if (!selectedCategoryId) return 'Choose a category before posting.';
    if (suggestion.chartAccountId === selectedCategoryId && ['RULE', 'PRIOR_MATCH'].includes(suggestion.source)) return suggestion.rationale;
    if (suggestion.chartAccountId) return `Changed from suggested category: ${this.categoryName(suggestion.chartAccountId)}.`;
    return 'Selected category will be applied when posted.';
  }

  hasExclusionSuggestion(transaction: Transaction): boolean {
    return this.hasExclusionSuggestionById(transaction.id);
  }

  exclusionSuggestionNote(transaction: Transaction): string {
    const suggestion = this.suggestionFor(transaction.id);
    return `${suggestion.rationale} This rule recommends keeping the transaction out of the books.`;
  }

  private hasExclusionSuggestionById(transactionId: string): boolean {
    const suggestion = this.suggestionFor(transactionId);
    return suggestion.source === 'RULE' && suggestion.suggestExclude === true;
  }

  canAcceptSuggestion(transactionId: string): boolean {
    const suggestion = this.suggestionFor(transactionId);
    return Boolean(suggestion.chartAccountId && ['RULE', 'PRIOR_MATCH'].includes(suggestion.source));
  }

  hasTransferSuggestion(transaction: Transaction): boolean {
    return this.suggestionFor(transaction.id).source === 'TRANSFER' && Boolean(this.suggestionFor(transaction.id).transferCandidateId);
  }

  transactionRuleActionLabel(transaction: Transaction): string {
    const suggestion = this.suggestionFor(transaction.id);
    return suggestion.source === 'RULE' && Boolean(suggestion.ruleId) ? 'Edit rule' : 'Create rule';
  }

  get filteredRules(): TransactionRule[] {
    const needle = this.ruleSearch.trim().toLowerCase();
    return this.ruleFacade.rules().filter(rule => {
      if (this.ruleStatusFilter === 'ENABLED' && !rule.enabled) return false;
      if (this.ruleStatusFilter === 'DISABLED' && rule.enabled) return false;
      if (!needle) return true;
      return `${rule.name} ${this.ruleAccountScope(rule)} ${this.ruleConditionsSummary(rule)} ${this.ruleOutputSummary(rule)}`.toLowerCase().includes(needle);
    });
  }

  ruleAccountScope(rule: TransactionRule): string {
    const accountConditions = rule.conditions.filter(condition => condition.field === 'ACCOUNT' && !condition.negate);
    if (!accountConditions.length) return 'All accounts';
    return accountConditions.map(condition => this.accountName(condition.value)).join(', ');
  }

  ruleConditionsSummary(rule: TransactionRule): string {
    return rule.conditions.map(condition => {
      const value = condition.field === 'ACCOUNT' ? this.accountName(condition.value)
        : condition.field === 'DIRECTION' ? (condition.value === 'OUT' ? 'Money out' : 'Money in')
          : condition.operator === 'RANGE' ? `${condition.value} to ${condition.secondValue}` : `“${condition.value}”`;
      return `${condition.negate ? 'not ' : ''}${this.ruleFieldLabel(condition.field)} ${this.ruleOperatorLabel(condition.operator)} ${value}`;
    }).join(rule.matchMode === 'ANY' ? ' OR ' : ' AND ');
  }

  ruleOutputSummary(rule: TransactionRule): string {
    const outputs: string[] = [];
    if (rule.chartAccountId) outputs.push(`Category: ${this.categoryPath(rule.chartAccountId)}`);
    if (rule.payee) outputs.push(`Payee: ${rule.payee}`);
    if (rule.memo) outputs.push(`Memo: ${rule.memo}`);
    if (rule.tags?.length) outputs.push(`Tags: ${rule.tags.join(', ')}`);
    if (rule.suggestExclude) outputs.push('Suggest exclusion');
    return outputs.join(' · ') || 'No output configured';
  }

  ruleFieldLabel(field: RuleCondition['field']): string {
    return ({ ACCOUNT: 'Account', DIRECTION: 'Direction', DESCRIPTION: 'Description', PAYEE: 'Payee', MEMO: 'Memo', AMOUNT: 'Amount (cents)', SOURCE_TYPE: 'Source type' } as const)[field];
  }

  ruleOperatorLabel(operator: RuleCondition['operator']): string {
    return ({ EQUALS: 'equals', CONTAINS: 'contains', STARTS_WITH: 'starts with', RANGE: 'is between' } as const)[operator];
  }

  ruleOperatorsFor(condition: RuleCondition): RuleCondition['operator'][] {
    if (['ACCOUNT', 'DIRECTION', 'SOURCE_TYPE'].includes(condition.field)) return ['EQUALS'];
    if (condition.field === 'AMOUNT') return ['EQUALS', 'RANGE'];
    return this.ruleConditionOperators.filter(operator => operator !== 'RANGE');
  }

  get ruleDraftValid(): boolean {
    return Boolean(this.ruleDraft?.name.trim()
      && Number.isInteger(this.ruleDraft.priority) && this.ruleDraft.priority > 0
      && this.ruleDraft.conditions.length
      && this.ruleDraft.conditions.every(condition => condition.value.trim() && (condition.operator !== 'RANGE' || condition.secondValue?.trim()))
      && (this.ruleDraft.chartAccountId || this.ruleDraft.suggestExclude));
  }

  get ruleEditorTitle(): string {
    if (!this.ruleDraft?.id) return this.ruleEditorSourceTransactionId ? 'Create rule from transaction' : 'New rule';
    return 'Edit rule';
  }

  get matchingRuleTestTransactions(): Transaction[] {
    return this.ruleFacade.testResults().filter(result => result.matched).slice(0, 8)
      .map(result => this.accounting.getTransaction(result.transactionId)).filter((transaction): transaction is Transaction => Boolean(transaction));
  }

  get chartAccounts() { return this.setupFacade.chartAccounts(); }
  get ruleCount(): number { return this.ruleFacade.rules().length; }
  get databaseLocations() { return this.backupFacade.locations(); }
  get databaseOperationBusy(): boolean { return this.backupFacade.busy(); }
  get databaseOperationError(): string { return this.backupFacade.error() ?? ''; }
  get ruleImportPreview() { return this.setupFacade.ruleImportPreview(); }
  get ruleImportErrorCount(): number { return this.ruleImportPreview?.issues.filter(issue => issue.severity === 'ERROR').length ?? 0; }
  get rejectedImportRows(): ImportRowDisposition[] { return this.importPreview?.rows.filter(row => row.status === 'REJECTED') ?? []; }

  private get transactionQuerySort(): 'DATE_ASC' | 'DATE_DESC' | 'AMOUNT_ASC' | 'AMOUNT_DESC' {
    if (this.transactionSortColumn === 'AMOUNT') return this.transactionSortDirection === 'ASC' ? 'AMOUNT_ASC' : 'AMOUNT_DESC';
    if (this.transactionSortColumn === 'DATE_ACCOUNT') return this.transactionSortDirection === 'ASC' ? 'DATE_ASC' : 'DATE_DESC';
    return 'DATE_ASC';
  }

  private applyTransactionSort(): void {
    const direction = this.transactionSortDirection === 'ASC' ? 1 : -1;
    this.transactions = [...this.transactions].sort((left, right) => {
      let primary = 0;
      if (this.transactionSortColumn === 'DATE_ACCOUNT') {
        primary = left.postingDate.localeCompare(right.postingDate)
          || this.compareText(this.accountName(left.accountId), this.accountName(right.accountId));
      } else if (this.transactionSortColumn === 'SOURCE') {
        primary = this.compareText(left.description, right.description)
          || this.compareText(left.payee ?? '', right.payee ?? '');
      } else if (this.transactionSortColumn === 'CATEGORY') {
        primary = this.compareText(this.transactionCategorySortLabel(left), this.transactionCategorySortLabel(right));
      } else {
        primary = left.amount.minorUnits < right.amount.minorUnits ? -1 : left.amount.minorUnits > right.amount.minorUnits ? 1 : 0;
      }
      const tieBreak = left.postingDate.localeCompare(right.postingDate)
        || this.compareText(left.description, right.description)
        || left.id.localeCompare(right.id);
      return direction * (primary || tieBreak);
    });
  }

  private transactionCategorySortLabel(transaction: Transaction): string {
    if (transaction.state === 'MATCHED_TRANSFER') return 'Matched transfer';
    if (transaction.state === 'EXCLUDED') return 'Excluded';
    return this.categoryName(this.selectedCategoryIds[transaction.id] || transaction.splits[0]?.chartAccountId);
  }

  private compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  }

  private openRuleDraft(rule: TransactionRule, transactionId = ''): void {
    this.ruleDraft = structuredClone(rule);
    this.ruleEditorSourceTransactionId = transactionId;
    this.ruleTagsText = rule.tags?.join(', ') ?? '';
    this.ruleTestMessage = '';
    this.ruleFacade.testResults.set([]);
  }

  private applyRuleTags(): void {
    if (!this.ruleDraft) return;
    this.ruleDraft.tags = this.ruleTagsText.split(',').map(tag => tag.trim()).filter(Boolean);
  }

  private refreshAfterRuleChange(): void {
    this.ruleFacade.load();
    this.setupFacade.load();
    this.refresh();
  }

  private accountingReport() {
    return this.accounting.getScheduleCReadyReport(this.reportStartDate || '2026-01-01', this.reportEndDate || '2026-12-31', this.reportGrouping);
  }

  private requireSelectedAccount(action: string): boolean {
    if (this.hasSelectedAccount) return true;
    this.statusMessage = `Select an account before ${action}.`;
    return false;
  }

  private requireTransactionScope(transactionIds: string[], action: string): boolean {
    if (!this.requireSelectedAccount(action)) return false;
    if (transactionIds.some(transactionId => this.accounting.getTransaction(transactionId)?.accountId !== this.selectedAccountId)) {
      this.statusMessage = `Select the account that owns every transaction before ${action}.`;
      return false;
    }
    return true;
  }
}
