import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from './core/application-interface/accounting.application';
import { DefaultAccountingApplication } from './core/application-services/default-accounting.application';
import { ImportPipelineService } from './core/import-services/import-pipeline.service';
import { InMemoryAccountingRepository } from './core/repository-gateways/in-memory-accounting.repository';
import { AppComponent } from './app.component';
import { BackupBundleService } from './core/backup-services/backup-bundle.service';
import { ACCOUNTING_REPOSITORY } from './core/repository-gateways/accounting.repository';
import { ImportFacade } from './features/imports/import.facade';
import * as XLSX from 'xlsx';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem('accounting.transaction-view.v1');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        InMemoryAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    delete (globalThis as { localAccounting?: unknown }).localAccounting;
  });

  it('creates the local bookkeeping shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.title).toBe('TallyStick');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('TallyStick');
    expect(fixture.nativeElement.querySelector('.hero')).toBeNull();
    expect([...fixture.nativeElement.querySelectorAll('button')].some((button: HTMLButtonElement) => button.textContent?.trim() === 'Refresh')).toBeFalse();
    expect(fixture.nativeElement.querySelector('.pending-review-count')?.textContent).toContain('Pending review');
    expect(fixture.componentInstance.reportGrouping).toBe('YEAR');
    expect(fixture.componentInstance.profitLossReport.grouping).toBe('YEAR');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.account-card')).toHaveSize(5);
    expect(fixture.nativeElement.querySelector('.import-strip h3')?.textContent.trim()).toBe('Upload file');
    expect(fixture.nativeElement.querySelector('#reports-workspace')).toBeNull();
  });

  it('adds and edits a populated financial account without changing its stable identity', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelectorAll('.account-card').length).toBe(5);
    expect(fixture.nativeElement.querySelector('.setup-strip')).toBeNull();
    expect(fixture.nativeElement.querySelector('.import-strip h3')?.textContent.trim()).toBe('Upload file');

    component.openNewFinancialAccount();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.account-editor-panel')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.account-editor-panel h2')?.textContent).toContain('Add account');
    expect(component.financialAccountDetailTypes).toContain('Savings');
    Object.assign(component.financialAccountDraft!, {
      type: 'BANK', detailType: 'Savings', name: 'Reserve Savings', institutionOrEntity: 'BofA',
      lastFour: '9090', description: 'Cash reserve', openingBalanceText: '500.25', openingBalanceDate: '2026-02-01',
    });
    component.saveFinancialAccount();
    fixture.detectChanges();

    const created = component.accounts.find(account => account.name === 'Reserve Savings')!;
    expect(created).toEqual(jasmine.objectContaining({ detailType: 'Savings', institutionOrEntity: 'BofA', lastFour: '9090', description: 'Cash reserve' }));
    expect(fixture.nativeElement.querySelectorAll('.account-card')).toHaveSize(6);
    expect(fixture.nativeElement.textContent).toContain('Reserve Savings');

    component.editFinancialAccount(created.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.account-editor-panel h2')?.textContent).toContain('Edit account');
    expect(component.financialAccountDraft).toEqual(jasmine.objectContaining({ id: created.id, name: 'Reserve Savings', openingBalanceText: '500.25' }));
    Object.assign(component.financialAccountDraft!, { name: 'Operating Reserve', detailType: 'Money Market', description: 'Updated reserve' });
    component.saveFinancialAccount();
    fixture.detectChanges();

    const updated = component.accounts.find(account => account.id === created.id)!;
    expect(updated).toEqual(jasmine.objectContaining({ id: created.id, name: 'Operating Reserve', detailType: 'Money Market', description: 'Updated reserve' }));
    expect(component.statusMessage).toBe('Updated account Operating Reserve.');
  });

  it('shows exactly one icon-led Transactions, Chart, Rules, Profit & Loss, or Backups sidebar workspace', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const tabs = [...fixture.nativeElement.querySelectorAll('.workspace-tab')] as HTMLButtonElement[];
    const transactionsTab = tabs.find(tab => tab.textContent?.trim() === 'Transactions')!;
    const chartTab = tabs.find(tab => tab.textContent?.trim() === 'Chart of Accounts')!;
    const rulesTab = tabs.find(tab => tab.textContent?.trim() === 'Rules')!;
    const reportsTab = tabs.find(tab => tab.textContent?.trim() === 'Profit & Loss')!;
    const dataTab = tabs.find(tab => tab.textContent?.trim() === 'Backups')!;
    expect(tabs).toHaveSize(5);
    expect(fixture.nativeElement.querySelector('.workspace-switcher select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-sidebar')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.workspace-switcher')?.getAttribute('aria-orientation')).toBe('vertical');
    expect(transactionsTab.querySelector('.bi-list')).toBeTruthy();
    expect(chartTab.querySelector('.bi-bar-chart-steps')).toBeTruthy();
    expect(reportsTab.querySelector('.bi-file-ruled')).toBeTruthy();
    expect(dataTab.querySelector('.bi-database')).toBeTruthy();
    expect(transactionsTab.getAttribute('aria-selected')).toBe('true');
    expect(reportsTab.getAttribute('aria-selected')).toBe('false');

    const navigationToggle = fixture.nativeElement.querySelector('.navigation-toggle') as HTMLButtonElement;
    navigationToggle.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.navigationExpanded).toBeFalse();
    expect(fixture.nativeElement.querySelector('.app-frame').classList).toContain('navigation-collapsed');

    chartTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceView).toBe('CHART');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#chart-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#rules-workspace')).toBeNull();
    expect(chartTab.getAttribute('aria-selected')).toBe('true');

    rulesTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceView).toBe('RULES');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#rules-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#reports-workspace')).toBeNull();
    expect(rulesTab.getAttribute('aria-selected')).toBe('true');

    reportsTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceView).toBe('REPORTS');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#rules-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#reports-workspace')).toBeTruthy();
    expect(reportsTab.getAttribute('aria-selected')).toBe('true');

    dataTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceView).toBe('DATA');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#rules-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#reports-workspace')).toBeNull();
    expect(fixture.nativeElement.querySelector('#data-workspace')).toBeTruthy();
    expect(dataTab.getAttribute('aria-selected')).toBe('true');

  });

  it('lists, filters, creates, edits, and archives chart accounts through the dedicated workspace', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CHART');
    fixture.detectChanges();
    const workspace = fixture.nativeElement.querySelector('#chart-workspace') as HTMLElement;
    expect(workspace.querySelector('.chart-table')).toBeTruthy();
    expect(workspace.textContent).toContain('Operating Expenses');
    component.sortChartAccounts('NAME');
    const namesAscending = component.filteredChartAccounts.map(account => account.name);
    expect(namesAscending).toEqual([...namesAscending].sort((left, right) => left.localeCompare(right)));
    component.sortChartAccounts('NAME');
    expect(component.filteredChartAccounts.map(account => account.name)).toEqual([...namesAscending].reverse());

    component.openNewChartAccount();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chart-editor-panel')).toBeTruthy();
    component.chartDraft!.name = 'Subscriptions';
    component.chartDraft!.accountType = 'EXPENSE';
    component.chartDraft!.detailType = 'Other business expenses';
    component.chartDraft!.description = 'Recurring software';
    component.saveChartAccount();
    fixture.detectChanges();
    const created = component.filteredChartAccounts.find(account => account.name === 'Subscriptions')!;
    expect(created.description).toBe('Recurring software');

    component.editChartAccount(created.id);
    component.chartDraft!.name = 'Software subscriptions';
    component.saveChartAccount();
    fixture.detectChanges();
    const updated = component.filteredChartAccounts.find(account => account.id === created.id)!;
    expect(updated.name).toBe('Software subscriptions');

    spyOn(window, 'confirm').and.returnValue(true);
    component.toggleChartAccountArchived(updated);
    component.chartStatusFilter = 'ARCHIVED';
    fixture.detectChanges();
    expect(component.filteredChartAccounts.some(account => account.id === created.id && account.archived)).toBeTrue();
  });

  it('shows configured database locations and runs a verified desktop backup from Data & Backups', async () => {
    let locations = {
      currentDatabasePath: '/books/tallystick.sqlite',
      backupDirectory: '/backups',
      latestVerifiedBackupPath: undefined as string | undefined,
      latestVerifiedBackupAtUtc: undefined as string | undefined,
    };
    const backupNow = jasmine.createSpy('backupNow').and.callFake(async () => {
      locations = { ...locations, latestVerifiedBackupPath: '/backups/tallystick-2026-08-11-170405.sqlite', latestVerifiedBackupAtUtc: '2026-08-11T17:04:05.000Z' };
      return { operation: 'BACKUP' as const, path: locations.latestVerifiedBackupPath, completedAtUtc: locations.latestVerifiedBackupAtUtc, restartRequired: false };
    });
    const restoreDatabaseBackup = jasmine.createSpy('restoreDatabaseBackup').and.resolveTo({
      operation: 'RESTORE' as const, path: '/books/tallystick.sqlite', completedAtUtc: '2026-08-11T17:05:00.000Z',
      safetyBackupPath: '/backups/tallystick-2026-08-11-170500-pre-restore.sqlite', restartRequired: true,
    });
    (globalThis as { localAccounting?: unknown }).localAccounting = {
      databaseLifecycle: {
        getLocations: async () => locations,
        chooseBackupDirectory: async () => locations,
        backupNow,
        relocateCurrentDatabase: async () => undefined,
        restoreDatabaseBackup,
      },
    };
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectWorkspace('DATA');
    await fixture.whenStable();
    fixture.detectChanges();

    const workspace = fixture.nativeElement.querySelector('.data-safety-workspace') as HTMLElement;
    expect(workspace.textContent).toContain('/books/tallystick.sqlite');
    expect(workspace.textContent).toContain('/backups');
    const actionLabels = Array.from(workspace.querySelectorAll('button')).map(button => button.textContent?.trim());
    expect(actionLabels).toEqual(jasmine.arrayContaining(['Move database', 'Choose folder', 'Back Up Now', 'Restore from backup']));

    (workspace.querySelectorAll('button')[2] as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(backupNow).toHaveBeenCalled();
    expect(workspace.textContent).toContain('tallystick-2026-08-11-170405.sqlite');
    expect(fixture.componentInstance.statusMessage).toContain('Verified database backup created');

    const confirm = spyOn(window, 'confirm').and.returnValue(true);
    (Array.from(workspace.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Restore from backup') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalled();
    expect(restoreDatabaseBackup).toHaveBeenCalled();
    expect(fixture.componentInstance.statusMessage).toContain('Restarting');
  });

  it('manages rules through the list, populated editor, test action, and destructive delete boundary', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const batch = application.commitImport(application.previewImport({
      fileName: 'rules-ui.csv', content: 'Date,Description,Amount\n2026-02-08,UI RULE VENDOR,-18.00', kind: 'CSV', destinationAccountId: account.id,
    }).previewToken).batch;
    const transaction = application.listTransactions({ sourceBatchId: batch.id }).items[0];
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('RULES');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.rules-workspace')?.textContent).toContain('Categorization rules');
    (fixture.nativeElement.querySelector('.new-rule-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rule-editor-panel')).toBeTruthy();
    component.ruleDraft!.name = 'UI vendor rule';
    component.ruleDraft!.priority = 1;
    component.ruleDraft!.conditions = [
      { field: 'ACCOUNT', operator: 'EQUALS', value: account.id },
      { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'UI RULE VENDOR' },
    ];
    fixture.detectChanges();
    const categoryTrigger = fixture.nativeElement.querySelector('.rule-output-grid .category-picker-trigger') as HTMLButtonElement;
    expect(categoryTrigger.textContent).toContain('Choose category');
    categoryTrigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[aria-label="Find rule category"]')).toBeTruthy();
    const categoryOptions = fixture.nativeElement.querySelectorAll('[aria-label="Rule categories"] [role="option"]') as NodeListOf<HTMLButtonElement>;
    const categoryOption = Array.from(categoryOptions).find(button => button.textContent?.includes('Operating Expenses'))!;
    categoryOption.click();
    fixture.detectChanges();
    expect(component.ruleDraft!.chartAccountId).toBe(category.id);
    expect(categoryTrigger.textContent).toContain('Operating Expenses');
    component.testRuleDraft();
    fixture.detectChanges();
    expect(component.matchingRuleTestTransactions.map(item => item.id)).toContain(transaction.id);
    expect(fixture.nativeElement.querySelector('.rule-test-panel')?.textContent).toContain('1 transaction');
    component.saveRuleDraft();
    fixture.detectChanges();

    const saved = application.listRules().find(rule => rule.name === 'UI vendor rule')!;
    expect(saved).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.rules-table')?.textContent).toContain('UI vendor rule');
    component.copyRule(saved.id);
    fixture.detectChanges();
    expect(component.ruleDraft?.name).toBe('UI vendor rule copy');
    expect(component.ruleDraft?.enabled).toBeFalse();
    component.closeRuleEditor();

    const confirm = spyOn(window, 'confirm').and.returnValue(true);
    component.deleteRule(saved);
    fixture.detectChanges();
    expect(confirm).toHaveBeenCalled();
    expect(application.listRules().some(rule => rule.id === saved.id)).toBeFalse();
  });

  it('opens the applied rule or a populated new-rule draft from Pending transactions', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const rule = application.saveRule({
      id: '', name: 'Applied pending rule', enabled: true, priority: 1,
      conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'MATCHED RULE ROW' }], chartAccountId: category.id, matchMode: 'ALL',
    });
    const batch = application.commitImport(application.previewImport({
      fileName: 'transaction-rule-links.csv',
      content: 'Date,Description,Amount\n2026-03-01,MATCHED RULE ROW,-11.00\n2026-03-02,NEW RULE ROW,-12.00',
      kind: 'CSV', destinationAccountId: account.id,
    }).previewToken).batch;
    const pending = application.listTransactions({ sourceBatchId: batch.id, states: ['PENDING'] }).items;
    const matched = pending.find(item => item.description === 'MATCHED RULE ROW')!;
    const unmatched = pending.find(item => item.description === 'NEW RULE ROW')!;
    application.categorize(unmatched.id, category.id);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    fixture.detectChanges();
    const rows = [...fixture.nativeElement.querySelectorAll('.pending-ledger tbody tr')] as HTMLTableRowElement[];
    const matchedRow = rows.find(row => row.textContent?.includes('MATCHED RULE ROW'))!;
    const unmatchedRow = rows.find(row => row.textContent?.includes('NEW RULE ROW'))!;
    expect((matchedRow.querySelector('.rule-link-button') as HTMLButtonElement).textContent?.trim()).toBe('Edit rule');
    expect((unmatchedRow.querySelector('.rule-link-button') as HTMLButtonElement).textContent?.trim()).toBe('Create rule');

    (matchedRow.querySelector('.rule-link-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.ruleDraft?.id).toBe(rule.id);
    expect(component.ruleDraft?.conditions[0].value).toBe('MATCHED RULE ROW');
    component.closeRuleEditor();
    fixture.detectChanges();
    (unmatchedRow.querySelector('.rule-link-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.ruleDraft?.id).toBe('');
    expect(component.ruleDraft?.chartAccountId).toBe(category.id);
    expect(component.ruleDraft?.conditions).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ field: 'ACCOUNT', value: account.id }),
      jasmine.objectContaining({ field: 'DIRECTION', value: 'OUT' }),
      jasmine.objectContaining({ field: 'DESCRIPTION', value: 'NEW RULE ROW' }),
    ]));
  });

  it('clearly recommends exclusion and prevents single or bulk posting when an exclusion rule matches', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.saveRule({
      id: '', name: 'Exclude duplicate settlement', enabled: true, priority: 1,
      conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'DUPLICATE SETTLEMENT' }],
      chartAccountId: category.id, matchMode: 'ALL', suggestExclude: true,
    });
    application.commitImport(application.previewImport({
      fileName: 'exclusion-suggestion.csv',
      content: 'Date,Description,Amount\n2026-03-03,DUPLICATE SETTLEMENT,-15.00',
      kind: 'CSV', destinationAccountId: account.id,
    }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    fixture.detectChanges();
    const transaction = component.transactions[0];
    const row = fixture.nativeElement.querySelector('.pending-ledger tbody tr') as HTMLTableRowElement;
    const postButton = row.querySelector('.post-action') as HTMLButtonElement;
    const excludeButton = row.querySelector('.suggested-exclude-action') as HTMLButtonElement;

    expect(component.hasExclusionSuggestion(transaction)).toBeTrue();
    expect(row.classList.contains('exclusion-suggested-row')).toBeTrue();
    expect(row.querySelector('.exclusion-suggestion')?.textContent).toContain('Suggested action: Exclude');
    expect(row.querySelector('.exclusion-suggestion')?.textContent).toContain('Rule "Exclude duplicate settlement" matched');
    expect(postButton.disabled).toBeTrue();
    expect(postButton.title).toContain('matched rule recommends exclusion');
    expect(excludeButton.textContent?.trim()).toBe('Exclude — suggested');

    component.post(transaction);
    expect(application.getTransaction(transaction.id)?.state).toBe('PENDING');
    expect(component.statusMessage).toContain('recommended for exclusion');

    component.selectedTransactionIds.add(transaction.id);
    component.bulkPost();
    expect(application.getTransaction(transaction.id)?.state).toBe('PENDING');
    expect(component.statusMessage).toContain('recommended for exclusion');
  });

  it('exposes P/L Summary and P/L Detail with exact drill-down', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = application.previewImport({ fileName: 'report-ui.csv', content: 'Date,Description,Amount\n2026-01-08,Report expense,-7.00', kind: 'CSV', destinationAccountId: account.id });
    application.commitImport(preview.previewToken);
    const transaction = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    application.categorize(transaction.id, category.id);
    application.post([transaction.id]);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    component.selectWorkspace('REPORTS');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.report-workspace')?.textContent).toContain('P/L Summary');
    expect(fixture.nativeElement.querySelector('.report-table')?.textContent).toContain('Operating Expenses');
    const expenseRow = [...fixture.nativeElement.querySelectorAll('.report-table tbody tr')].find((row: HTMLTableRowElement) => row.textContent?.includes('Operating Expenses')) as HTMLTableRowElement;
    expect(expenseRow).toBeTruthy();
    (expenseRow.querySelector('.report-amount') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.reportView).toBe('DETAIL');
    expect(component.filteredReportDetailRows).toHaveSize(1);
    expect(component.filteredReportDetailRows.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).toBe(700n);
    expect(fixture.nativeElement.querySelector('.detail-table')?.textContent).toContain('Report expense');
    expect(fixture.nativeElement.querySelector('.detail-table')?.textContent).toContain('Operating Expenses');

    component.selectReportView('SUMMARY');
    fixture.detectChanges();
    const netProfitRow = [...fixture.nativeElement.querySelectorAll('.report-table tbody tr')].find((row: HTMLTableRowElement) => row.textContent?.includes('Net Profit')) as HTMLTableRowElement;
    const netProfitAmounts = netProfitRow.querySelectorAll<HTMLButtonElement>('.report-amount');
    netProfitAmounts[netProfitAmounts.length - 1].click();
    fixture.detectChanges();
    expect(component.filteredReportDetailRows.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).toBe(-700n);
    expect(fixture.nativeElement.querySelector('.detail-table')?.textContent).toContain('-$7.00');
  });

  it('renders nested chart-account subtotals with bold total amounts and exact group drill-down', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const chart = application.importChartAccounts([
      'Account name,Account type',
      'Amazon Income,Income',
      'Amazon Income:Online Sales,Income',
      'Amazon Income:Online Sales:Amazon Returned Product Sales,Income',
      'Operating Expenses,Expenses',
      'Other Income,Other income',
      'Other Expense,Other expense',
      'Federal Income Tax,Expenses',
      'State and Local Income Tax,Expenses',
    ].join('\n'));
    const chartByName = Object.fromEntries(chart.map(item => [item.name, item]));
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const committed = application.commitImport(application.previewImport({
      fileName: 'hierarchical-report-ui.csv',
      kind: 'CSV',
      destinationAccountId: account.id,
      content: 'Date,Description,Amount\n2026-01-05,Amazon sales,100.00\n2026-01-06,Returned sales,25.00',
    }).previewToken);
    const transactions = application.listTransactions({ sourceBatchId: committed.batch.id, pageSize: 100 }).items;
    transactions.forEach(transaction => application.categorize(transaction.id, transaction.description === 'Amazon sales' ? chartByName['Amazon Income:Online Sales'].id : chartByName['Amazon Income:Online Sales:Amazon Returned Product Sales'].id));
    application.post(transactions.map(transaction => transaction.id));

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectWorkspace('REPORTS');
    fixture.componentInstance.reportGrouping = 'MONTH';
    fixture.componentInstance.loadReports();
    fixture.detectChanges();
    const groupRows = [...fixture.nativeElement.querySelectorAll('.report-group-row')] as HTMLTableRowElement[];
    const amazonSalesGroup = groupRows.find(row => row.textContent?.includes('Online Sales'))!;
    expect(amazonSalesGroup).toBeTruthy();
    expect(amazonSalesGroup.textContent).toContain('$100.00');
    const groupLabel = amazonSalesGroup.querySelector('.report-cell-label') as HTMLElement;
    const groupAmount = amazonSalesGroup.querySelector('.report-amount') as HTMLElement;
    expect(getComputedStyle(groupLabel).fontSize).toBe('14px');
    expect(getComputedStyle(groupLabel).fontWeight).toBe('800');
    expect(getComputedStyle(groupAmount).fontWeight).toBe('800');
    const accountRows = [...fixture.nativeElement.querySelectorAll('.report-account-row')] as HTMLTableRowElement[];
    const returnedSalesRow = accountRows.find(row => row.textContent?.includes('Amazon Returned Product Sales'))!;
    expect(getComputedStyle(returnedSalesRow.querySelector('.report-cell-label') as HTMLElement).fontWeight).toBe('500');
    expect(getComputedStyle(returnedSalesRow.querySelector('.report-amount') as HTMLElement).fontWeight).toBe('500');
    const subtotalRows = [...fixture.nativeElement.querySelectorAll('.report-subtotal-row')] as HTMLTableRowElement[];
    const amazonSalesTotal = subtotalRows.find(row => row.textContent?.includes('Total for Online Sales'))!;
    expect(amazonSalesTotal).toBeTruthy();
    expect(amazonSalesTotal.textContent).toContain('$125.00');
    expect(getComputedStyle(amazonSalesTotal.querySelector('.report-cell-label') as HTMLElement).fontWeight).toBe('900');
    expect(getComputedStyle(amazonSalesTotal.querySelector('.report-amount') as HTMLElement).fontWeight).toBe('900');

    (amazonSalesTotal.querySelector('.report-amount') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.reportSelectionLabel).toBe('Online Sales · 2026-01');
    expect(fixture.componentInstance.filteredReportDetailRows).toHaveSize(2);
    expect(fixture.componentInstance.filteredReportDetailRows.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).toBe(12500n);

    fixture.componentInstance.reportView = 'SUMMARY';
    fixture.componentInstance.reportGrouping = 'YEAR';
    fixture.componentInstance.loadReports();
    fixture.detectChanges();
    const annualHeaders = [...fixture.nativeElement.querySelectorAll('.report-table thead th')].map((header: HTMLTableCellElement) => header.textContent?.trim());
    expect(annualHeaders).toEqual(['Profit and loss', 'Total']);
    const annualAmountRow = [...fixture.nativeElement.querySelectorAll('.report-table tbody tr')].find((row: HTMLTableRowElement) => row.querySelector('.report-amount')) as HTMLTableRowElement;
    expect(annualAmountRow.querySelectorAll('td.amount')).toHaveSize(1);
  });

  it('applies report-only category exclusions without changing posted books', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = application.previewImport({ fileName: 'report-exclusion.csv', content: 'Date,Description,Amount\n2026-01-08,Excluded only in report,-7.00', kind: 'CSV', destinationAccountId: account.id });
    application.commitImport(preview.previewToken);
    const transaction = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    application.categorize(transaction.id, category.id);
    application.post([transaction.id]);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const before = component.profitLossReport.netProfitMinor;
    component.toggleReportCategory(category.id);

    expect(component.profitLossReport.netProfitMinor).toBe(before + 700n);
    expect(application.getTransaction(transaction.id)?.state).toBe('POSTED');
    expect(application.getTransaction(transaction.id)?.splits[0].chartAccountId).toBe(category.id);
  });

  it('renders and exports the selected Schedule C-ready report and keeps removed-tax drill-down available', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const stateTax = application.listChartAccounts().find(item => item.name === 'Taxes paid:Taxes Paid - State and Local' || item.name === 'State and Local Income Tax')!;
    const committed = application.commitImport(application.previewImport({
      fileName: 'schedule-c-ui.csv',
      content: 'Date,Description,Amount\n2026-04-14,State franchise tax,-800.00',
      kind: 'CSV',
      destinationAccountId: account.id,
    }).previewToken);
    const transaction = application.listTransactions({ sourceBatchId: committed.batch.id, states: ['PENDING'] }).items[0];
    application.categorize(transaction.id, stateTax.id);
    application.post([transaction.id]);
    const settings = application.getTaxYearSettings(2026);
    application.saveTaxYearSettings({ ...settings, includeStateLocalIncomeTax: false });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('REPORTS');
    fixture.detectChanges();

    expect(component.reportBasis).toBe('SCHEDULE_C');
    expect(component.report.removedStateLocalMinor).toBe(80000n);
    expect(component.report.netProfitMinor).toBe(component.profitLossReport.netProfitMinor + 80000n);
    expect(component.reportNetProfitMoney()).toBe('$0.00');
    expect(component.reportRemovedTaxMoney()).toBe('$800.00');
    expect(fixture.nativeElement.querySelector('.report-basis-switch .active-report-basis')?.textContent).toContain('Schedule C-ready');

    component.selectReportBasis('UNADJUSTED');
    expect(component.reportNetProfitMoney()).toBe('-$800.00');
    component.selectReportBasis('SCHEDULE_C');
    expect(component.reportDetailRows).toHaveSize(0);

    component.showRemovedTaxDetail();
    expect(component.reportDetailRows).toHaveSize(1);
    expect(component.reportDetailRows[0].description).toBe('State franchise tax');

    component.selectReportView('SUMMARY');
    const exportSpy = spyOn(application, 'exportReportCsv').and.callThrough();
    spyOn<any>(component, 'downloadFile');
    component.downloadReport('CSV');
    expect(exportSpy.calls.mostRecent().args[0].netProfitMinor).toBe(component.report.netProfitMinor);

    const printSpy = jasmine.createSpy('print');
    spyOn(window, 'open').and.returnValue({
      document: { write: jasmine.createSpy('write'), close: jasmine.createSpy('close') },
      focus: jasmine.createSpy('focus'),
      print: printSpy,
    } as unknown as Window);
    component.downloadReport('PRINT');
    expect(printSpy).not.toHaveBeenCalled();
    expect(component.statusMessage).toContain('⌘P');
  });

  it('opens the statement picker after an account is selected', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectAccount(account.id);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.transaction-file-input') as HTMLInputElement;
    const click = spyOn(input, 'click');

    fixture.componentInstance.openTransactionFilePicker();

    expect(click).toHaveBeenCalled();
  });

  it('opens the Pending transaction view after committing an accepted import', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const importFacade = TestBed.inject(ImportFacade);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    component.selectedTransactionState = 'POSTED';
    component.startDate = '2025-01-01';
    component.endDate = '2025-12-31';
    component.search = 'old filter';
    component.bulkCategoryId = 'old-category';
    component.importPreview = importFacade.inspect({
      fileName: 'accepted.csv',
      content: 'Date,Description,Amount\n2026-06-08,Accepted import row,-12.34',
      kind: 'CSV',
      destinationAccountId: account.id,
    });
    component.selectedFileName = 'accepted.csv';

    component.commitImport();
    fixture.detectChanges();

    expect(component.workspaceView).toBe('TRANSACTIONS');
    expect(component.selectedAccountId).toBe(account.id);
    expect(component.selectedTransactionState).toBe('PENDING');
    expect(component.startDate).toBe('');
    expect(component.endDate).toBe('');
    expect(component.search).toBe('');
    expect(component.bulkCategoryId).toBe('');
    expect(component.transactions.map(transaction => transaction.description)).toContain('Accepted import row');
    expect(fixture.nativeElement.querySelector('#transactions-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.pending-ledger')?.textContent).toContain('Accepted import row');
  });

  it('restores the selected account and transaction filters together after restart', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const bofa = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const chase = application.listAccounts().find(item => item.name === 'Reserve Checking')!;
    application.commitImport(application.previewImport({ fileName: 'restored-bofa.csv', content: 'Date,Description,Amount\n2026-01-08,Restored BofA row,-7.00', kind: 'CSV', destinationAccountId: bofa.id }).previewToken);
    application.commitImport(application.previewImport({ fileName: 'other-bank.csv', content: 'Date,Description,Amount\n2026-01-08,Other bank row,-8.00', kind: 'CSV', destinationAccountId: chase.id }).previewToken);

    const firstFixture = TestBed.createComponent(AppComponent);
    firstFixture.detectChanges();
    const first = firstFixture.componentInstance;
    first.selectAccount(bofa.id);
    first.startDate = '2026-01-01';
    first.endDate = '2026-01-31';
    first.search = 'Restored';
    first.transactionSortColumn = 'AMOUNT';
    first.transactionSortDirection = 'DESC';
    first.refresh();
    firstFixture.destroy();

    const restartedFixture = TestBed.createComponent(AppComponent);
    restartedFixture.detectChanges();
    const restarted = restartedFixture.componentInstance;
    const selectedCard = restartedFixture.nativeElement.querySelector('.account-card.selected') as HTMLButtonElement;

    expect(restarted.selectedAccountId).toBe(bofa.id);
    expect(restarted.startDate).toBe('2026-01-01');
    expect(restarted.endDate).toBe('2026-01-31');
    expect(restarted.search).toBe('Restored');
    expect(restarted.transactionSortColumn).toBe('AMOUNT');
    expect(restarted.transactionSortDirection).toBe('DESC');
    expect(selectedCard.textContent).toContain('Operating Checking');
    expect(selectedCard.getAttribute('aria-pressed')).toBe('true');
    expect(restarted.transactions.map(transaction => transaction.accountId)).toEqual([bofa.id]);
  });

  it('posts the displayed rule category without separate Accept or Apply actions', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const chart = application.importChartAccounts('Account name,Account type\nInsurance,Expenses');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      'Rule Name': 'Liberty Mutual',
      'Rule Conditions': JSON.stringify({ ruleConditions: [{ ruleType: 10, value: '-1' }, { ruleType: 1, value: 'Liberty Mutual' }], isAndRule: true }),
      'Rule Outputs': JSON.stringify({ ruleActions: [{ actionType: 0, value: 'Insurance' }] }),
    }]), 'Rules');
    application.importRulesWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'insurance.csv', content: 'Date,Description,Amount\n2026-01-06,Liberty Mutual DES:Small Comm,-77.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    fixture.detectChanges();
    const pending = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    const row = fixture.nativeElement.querySelector('.pending-ledger tbody tr') as HTMLTableRowElement;
    const table = fixture.nativeElement.querySelector('.pending-ledger') as HTMLTableElement;
    const tableScroll = fixture.nativeElement.querySelector('.table-scroll') as HTMLDivElement;
    expect(row.textContent).toContain('Liberty Mutual DES:Small Comm');
    expect(row.textContent).toContain('Insurance');
    expect(row.textContent).toContain('Rule "Liberty Mutual" matched at priority 1.');
    expect(row.querySelector('.category-editor select')).toBeNull();
    expect(row.querySelector('.category-picker-trigger')?.textContent).toContain('Insurance');
    const amount = row.querySelector('.amount') as HTMLTableCellElement;
    expect(getComputedStyle(amount).fontFamily).toContain('ui-monospace');
    expect(getComputedStyle(amount).fontWeight).toBe('700');
    expect(getComputedStyle(amount).fontVariantNumeric).toContain('tabular-nums');
    expect(getComputedStyle(table).tableLayout).toBe('fixed');
    expect(getComputedStyle(tableScroll).overflowX).not.toBe('auto');
    const confirm = spyOn(window, 'confirm');
    component.post(pending);
    expect(confirm).not.toHaveBeenCalled();
    const categorized = application.getTransaction(pending.id)!;
    expect(categorized.state).toBe('POSTED');
    expect(categorized.splits[0].chartAccountId).toBe(chart[0].id);
    expect(categorized.categorizationSource).toBe('RULE');
  });

  it('posts every selected categorized Pending transaction without confirmation', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.commitImport(application.previewImport({ fileName: 'batch-post.csv', content: 'Date,Description,Amount\n2026-01-06,First pending,-7.00\n2026-01-07,Second pending,-8.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const transactions = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items;
    transactions.forEach(transaction => {
      component.selectedTransactionIds.add(transaction.id);
      component.selectedCategoryIds[transaction.id] = category.id;
    });
    const confirm = spyOn(window, 'confirm');
    component.bulkPost();
    expect(confirm).not.toHaveBeenCalled();
    expect(application.listTransactions({ accountId: account.id, states: ['POSTED'] }).total).toBe(2);
  });

  it('filters Pending rows by the category selected in the header picker', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const chart = application.importChartAccounts('Account name,Account type\nOffice expenses,Expenses\nInsurance,Expenses');
    const office = chart.find(item => item.name === 'Office expenses')!;
    const insurance = chart.find(item => item.name === 'Insurance')!;
    application.commitImport(application.previewImport({ fileName: 'category-filter.csv', content: 'Date,Description,Amount\n2026-01-06,Office row,-7.00\n2026-01-07,Insurance row,-8.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const [officeRow, insuranceRow] = component.transactions;
    component.chooseCategory(officeRow.id, office.id);
    component.chooseCategory(insuranceRow.id, insurance.id);
    component.chooseCategory('bulk', office.id);

    expect(component.transactions.map(transaction => transaction.id)).toEqual([officeRow.id]);
  });

  it('posts only categorized selected Pending transactions and leaves the unresolved selection Pending', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.commitImport(application.previewImport({ fileName: 'partial-batch-post.csv', content: 'Date,Description,Amount\n2026-01-08,Ready,-7.00\n2026-01-09,Needs category,-8.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const [ready, unresolved] = application.listTransactions({ accountId: account.id, states: ['PENDING'], sort: 'DATE_ASC' }).items;
    component.selectedTransactionIds.add(ready.id);
    component.selectedTransactionIds.add(unresolved.id);
    component.selectedCategoryIds[ready.id] = category.id;
    component.selectedCategoryIds[unresolved.id] = '';
    const confirm = spyOn(window, 'confirm');
    component.bulkPost();
    expect(confirm).not.toHaveBeenCalled();
    expect(application.getTransaction(ready.id)?.state).toBe('POSTED');
    expect(application.getTransaction(unresolved.id)?.state).toBe('PENDING');
    expect(component.statusMessage).toContain('1 uncategorized transaction will remain Pending');
  });

  it('retains other pending category drafts after posting one transaction', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.commitImport(application.previewImport({ fileName: 'drafts.csv', content: 'Date,Description,Amount\n2026-01-08,First pending,-7.00\n2026-01-09,Second pending,-8.00\n2026-01-10,Third pending,-9.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const [first, second, third] = component.transactions;
    component.chooseCategory(first.id, category.id);
    component.chooseCategory(second.id, category.id);
    component.chooseCategory(third.id, category.id);

    component.post(first);

    expect(application.getTransaction(first.id)?.state).toBe('POSTED');
    expect(component.selectedCategoryIds[first.id]).toBeUndefined();
    expect(component.selectedCategoryIds[second.id]).toBe(category.id);
    expect(component.selectedCategoryIds[third.id]).toBe(category.id);
  });

  it('lets the user confirm a high-confidence bank/card transfer instead of posting it', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const bank = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const card = application.listAccounts().find(item => item.name === 'Business Card')!;
    application.commitImport(application.previewImport({ fileName: 'bofa.csv', content: 'Date,Description,Amount\n2026-01-08,AMERICAN EXPRESS ACH PMT,-35.00', kind: 'CSV', destinationAccountId: bank.id }).previewToken);
    application.commitImport(application.previewImport({ fileName: 'amex.qfx', content: '<STMTTRN><DTPOSTED>20260108</DTPOSTED><TRNAMT>35.00</TRNAMT><NAME>AUTOPAY PAYMENT THANK YOU</NAME><FITID>1</FITID></STMTTRN>', kind: 'QBO_OFX', destinationAccountId: card.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(card.id);
    const amexPayment = application.listTransactions({ accountId: card.id, states: ['PENDING'] }).items[0];
    expect(component.hasTransferSuggestion(amexPayment)).toBeTrue();
    expect(component.categorySelectionNote(amexPayment)).toContain('Transfer candidate: Operating Checking');
    spyOn(window, 'confirm').and.returnValue(true);
    component.matchTransfer(amexPayment);
    expect(application.getTransaction(amexPayment.id)?.state).toBe('MATCHED_TRANSFER');
  });

  it('shows a row-level explanation for rejected import-preview rows', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    component.importPreview = application.previewImport({ fileName: 'rejected.csv', content: 'Date,Description,Amount\ninvalid,Rejected row,-1.00', kind: 'CSV', destinationAccountId: account.id });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rejection-details')?.textContent).toContain('INVALID_DATE');
    expect(fixture.nativeElement.querySelector('.rejection-details')?.textContent).toContain('Invalid posting date: invalid');
  });

  it('filters the category picker by contains text and selects without posting', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const chart = application.importChartAccounts('Account name,Account type\nOffice expenses,Expenses\nOffice expenses:Software & apps,Expenses\nInsurance,Expenses');
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'picker.csv', content: 'Date,Description,Amount\n2026-01-08,Picker row,-7.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const transaction = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    component.openCategoryPicker(transaction.id);
    component.categorySearch = 'software';
    expect(component.filteredCategoryAccounts.map(category => category.id)).toEqual([chart.find(category => category.name === 'Office expenses:Software & apps')!.id]);
    component.handleCategoryPickerKeydown(new KeyboardEvent('keydown', { key: 'Enter' }), transaction.id);
    expect(component.selectedCategoryIds[transaction.id]).toBe(chart.find(category => category.name === 'Office expenses:Software & apps')!.id);
    fixture.detectChanges();
    const categoryPath = component.categoryPath(component.selectedCategoryIds[transaction.id]);
    const categoryTrigger = fixture.nativeElement.querySelector('.pending-ledger .category-picker-trigger') as HTMLButtonElement;
    const categorySummary = fixture.nativeElement.querySelector('.category-summary strong') as HTMLElement;
    expect(categoryTrigger.title).toBe(categoryPath);
    expect(categorySummary.title).toBe(categoryPath);
    expect(categorySummary.classList.contains('category-tooltip-target')).toBeTrue();
    expect(categorySummary.getAttribute('data-tooltip')).toBe(categoryPath);
    expect(application.getTransaction(transaction.id)?.state).toBe('PENDING');
  });

  it('keeps the all-accounts view read-only until one account is selected', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'all-accounts.csv', content: 'Date,Description,Amount\n2026-01-08,All account row,-7.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('.selection-actions button')] as HTMLButtonElement[];
    expect(fixture.componentInstance.selectedAccountId).toBe('');
    expect((fixture.nativeElement.querySelector('.transaction-file-input') as HTMLInputElement).disabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('[aria-label="Select all visible transactions"]') as HTMLInputElement).disabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('.pending-ledger tbody input[type="checkbox"]') as HTMLInputElement).disabled).toBeTrue();
    expect((fixture.nativeElement.querySelector('.pending-ledger .category-picker-trigger') as HTMLButtonElement).disabled).toBeTrue();
    expect(buttons.filter(button => ['Post selected', 'Categorize selected', 'Exclude selected'].includes(button.textContent?.trim() ?? '')).every(button => button.disabled)).toBeTrue();
    expect((fixture.nativeElement.querySelector('.bulk-category-picker .category-picker-trigger') as HTMLButtonElement).disabled).toBeFalse();
  });

  it('uses the standard toolbar style and Delete All label for excluded bulk deletion', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'excluded.csv', content: 'Date,Description,Amount\n2026-01-08,Excluded row,-7.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const transaction = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    application.exclude([transaction.id], 'Fixture exclusion');

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    component.selectedTransactionState = 'EXCLUDED';
    component.refresh();
    fixture.detectChanges();

    const deleteAll = [...fixture.nativeElement.querySelectorAll('.selection-actions button')].find((button: HTMLButtonElement) => button.textContent?.trim() === 'Delete All') as HTMLButtonElement;
    expect(deleteAll).toBeTruthy();
    expect(deleteAll.classList.contains('quiet-button')).toBeTrue();
    expect(deleteAll.classList.contains('danger')).toBeFalse();
  });

  it('keeps Clear enabled and resets transaction filters to the Pending account view', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'clear-filters.csv', content: 'Date,Description,Amount\n2026-01-08,Visible after clear,-7.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const pendingId = component.transactions[0].id;
    component.startDate = '2025-01-01';
    component.endDate = '2025-12-31';
    component.selectedTransactionState = 'EXCLUDED';
    component.search = 'does not match';
    component.bulkCategoryId = application.listChartAccounts()[0].id;
    component.selectedTransactionIds.add(pendingId);
    component.refresh();
    fixture.detectChanges();

    const clear = [...fixture.nativeElement.querySelectorAll('.selection-actions button')]
      .find((button: HTMLButtonElement) => button.textContent?.trim() === 'Clear') as HTMLButtonElement;
    expect(clear.disabled).toBeFalse();
    clear.click();
    fixture.detectChanges();

    expect(component.startDate).toBe('');
    expect(component.endDate).toBe('');
    expect(component.transactionMonth).toBe('');
    expect(component.selectedTransactionState).toBe('PENDING');
    expect(component.search).toBe('');
    expect(component.bulkCategoryId).toBe('');
    expect(component.selectedTransactionIds.size).toBe(0);
    expect(component.transactions.map(transaction => transaction.id)).toContain(pendingId);
  });

  it('sets both transaction dates to the first and last day of a selected month', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const monthInput = fixture.nativeElement.querySelector('.transaction-month-filter') as HTMLInputElement;

    monthInput.value = '2028-02';
    monthInput.dispatchEvent(new Event('input'));
    monthInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.transactionMonth).toBe('2028-02');
    expect(component.startDate).toBe('2028-02-01');
    expect(component.endDate).toBe('2028-02-29');
  });

  it('can clear an unposted category choice from the picker', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'clear-category.csv', content: 'Date,Description,Amount\n2026-01-08,Clear category,-7.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const transaction = component.transactions[0];
    const category = component.chartAccounts[0];
    component.chooseCategory(transaction.id, category.id);
    component.openCategoryPicker(transaction.id);

    component.clearCategory(transaction.id);

    expect(component.selectedCategoryIds[transaction.id]).toBe('');
    expect(application.getTransaction(transaction.id)?.splits).toEqual([]);
    expect(application.getTransaction(transaction.id)?.categorizationSource).toBe('CLEARED');
    expect(component.activeCategoryPicker).toBe('');
  });

  it('keeps a cleared rule suggestion empty across account changes and component restart', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const bofa = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const chase = application.listAccounts().find(item => item.name === 'Reserve Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.importRules([{ id: 'clearable-ui-rule', name: 'Clearable UI rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Suggested UI charge' }], chartAccountId: category.id }]);
    application.commitImport(application.previewImport({ fileName: 'clear-rule-ui.csv', content: 'Date,Description,Amount\n2026-01-08,Suggested UI charge,-7.00', kind: 'CSV', destinationAccountId: bofa.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(bofa.id);
    const transaction = component.transactions[0];
    expect(component.selectedCategoryIds[transaction.id]).toBe(category.id);

    component.clearCategory(transaction.id);
    component.selectAccount(chase.id);
    component.selectAccount(bofa.id);
    expect(component.selectedCategoryIds[transaction.id]).toBe('');
    fixture.destroy();

    const restarted = TestBed.createComponent(AppComponent);
    restarted.detectChanges();
    expect(restarted.componentInstance.selectedAccountId).toBe(bofa.id);
    expect(restarted.componentInstance.selectedCategoryIds[transaction.id]).toBe('');
    expect(application.getTransaction(transaction.id)?.categorizationSource).toBe('CLEARED');
  });

  it('persists a manually assigned Pending category when switching to another account and back', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const bofa = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    const chase = application.listAccounts().find(item => item.name === 'Reserve Checking')!;
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    application.commitImport(application.previewImport({ fileName: 'manual-category-bofa.csv', content: 'Date,Description,Amount\n2026-01-08,Persistent manual category,-7.00', kind: 'CSV', destinationAccountId: bofa.id }).previewToken);
    application.commitImport(application.previewImport({ fileName: 'other-account.csv', content: 'Date,Description,Amount\n2026-01-09,Other account,-8.00', kind: 'CSV', destinationAccountId: chase.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(bofa.id);
    const transaction = component.transactions.find(item => item.description === 'Persistent manual category')!;

    component.chooseCategory(transaction.id, category.id);
    component.selectAccount(chase.id);
    component.selectAccount(bofa.id);

    expect(application.getTransaction(transaction.id)?.state).toBe('PENDING');
    expect(application.getTransaction(transaction.id)?.splits[0].chartAccountId).toBe(category.id);
    expect(component.selectedCategoryIds[transaction.id]).toBe(category.id);
  });

  it('opens a viewport-level picker and focuses its search field', (done) => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'picker-position.csv', content: 'Date,Description,Amount\n2026-01-01,First,-1.00\n2026-01-02,Second,-2.00\n2026-01-03,Third,-3.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.componentInstance.selectAccount(account.id);
    fixture.detectChanges();
    const row = fixture.componentInstance.transactions[2];
    fixture.componentInstance.openCategoryPicker(row.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.category-picker-popover')).toBeTruthy();
    expect(getComputedStyle(fixture.nativeElement.querySelector('.category-picker-results')).maxHeight).toBe('266px');
    setTimeout(() => {
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[aria-label="Find category"]'));
      done();
    });
  });

  it('records a changed rule suggestion as a manual category when posting', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const chart = application.importChartAccounts('Account name,Account type\nInsurance,Expenses\nOffice expenses,Expenses');
    const insurance = chart.find(account => account.name === 'Insurance')!;
    const office = chart.find(account => account.name === 'Office expenses')!;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      'Rule Name': 'Liberty Mutual',
      'Rule Conditions': JSON.stringify({ ruleConditions: [{ ruleType: 10, value: '-1' }, { ruleType: 1, value: 'Liberty Mutual' }], isAndRule: true }),
      'Rule Outputs': JSON.stringify({ ruleActions: [{ actionType: 0, value: 'Insurance' }] }),
    }]), 'Rules');
    application.importRulesWorkbook(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({ fileName: 'override.csv', content: 'Date,Description,Amount\n2026-01-07,Liberty Mutual override,-50.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const transaction = application.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    expect(component.suggestionFor(transaction.id).chartAccountId).toBe(insurance.id);
    component.selectedCategoryIds[transaction.id] = office.id;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pending-ledger tbody tr')?.textContent).toContain('Changed from suggested category: Insurance.');
    component.post(transaction);

    const posted = application.getTransaction(transaction.id)!;
    expect(posted.state).toBe('POSTED');
    expect(posted.splits[0].chartAccountId).toBe(office.id);
    expect(posted.categorizationSource).toBe('MANUAL');
    expect(posted.ruleId).toBeUndefined();
  });

  it('sorts Pending rows by date ascending, toggles the date heading, and selects or clears every visible row', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({
      fileName: 'sorting.csv',
      content: [
        'Date,Description,Amount',
        '2026-01-20,Later transaction,-20.00',
        '2026-01-05,Earlier transaction,-5.00',
        '2026-01-15,Middle transaction,-15.00',
      ].join('\n'),
      kind: 'CSV',
      destinationAccountId: account.id,
    }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    expect(component.transactions.map(transaction => transaction.postingDate)).toEqual([
      '2026-01-05',
      '2026-01-15',
      '2026-01-20',
    ]);

    const dateHeader = fixture.nativeElement.querySelector('[data-sort-column="DATE_ACCOUNT"]') as HTMLTableCellElement;
    expect(dateHeader.getAttribute('aria-sort')).toBe('ascending');
    (dateHeader.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(dateHeader.getAttribute('aria-sort')).toBe('descending');
    expect(component.transactions.map(transaction => transaction.postingDate)).toEqual([
      '2026-01-20',
      '2026-01-15',
      '2026-01-05',
    ]);
    (dateHeader.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.transactions.map(transaction => transaction.postingDate)).toEqual([
      '2026-01-05',
      '2026-01-15',
      '2026-01-20',
    ]);

    const selectAll = fixture.nativeElement.querySelector('[aria-label="Select all visible transactions"]') as HTMLInputElement;
    selectAll.click();
    fixture.detectChanges();
    expect(component.selectedTransactionIds.size).toBe(3);
    expect(selectAll.checked).toBeTrue();

    const firstRowCheckbox = fixture.nativeElement.querySelector('.pending-ledger tbody input[type="checkbox"]') as HTMLInputElement;
    firstRowCheckbox.click();
    fixture.detectChanges();
    expect(selectAll.indeterminate).toBeTrue();

    selectAll.click();
    fixture.detectChanges();
    expect(component.selectedTransactionIds.size).toBe(3);
    selectAll.click();
    fixture.detectChanges();
    expect(component.selectedTransactionIds.size).toBe(0);
  });

  it('sorts source, categorization, and amount headings ascending and then descending', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const categories = application.importChartAccounts('Account name,Account type\nAlpha category,Expenses\nMiddle category,Expenses\nZulu category,Expenses');
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({
      fileName: 'column-sorting.csv',
      content: [
        'Date,Description,Amount',
        '2026-01-20,Alpha source,-10.00',
        '2026-01-05,Zebra source,-30.00',
        '2026-01-15,Middle source,-20.00',
      ].join('\n'),
      kind: 'CSV',
      destinationAccountId: account.id,
    }).previewToken);

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    const byDescription = new Map(component.transactions.map(transaction => [transaction.description, transaction]));
    component.selectedCategoryIds[byDescription.get('Alpha source')!.id] = categories.find(category => category.name === 'Zulu category')!.id;
    component.selectedCategoryIds[byDescription.get('Middle source')!.id] = categories.find(category => category.name === 'Middle category')!.id;
    component.selectedCategoryIds[byDescription.get('Zebra source')!.id] = categories.find(category => category.name === 'Alpha category')!.id;
    fixture.detectChanges();

    const clickSort = (column: string) => {
      const heading = fixture.nativeElement.querySelector(`[data-sort-column="${column}"]`) as HTMLTableCellElement;
      (heading.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      return heading;
    };

    let heading = clickSort('SOURCE');
    expect(heading.getAttribute('aria-sort')).toBe('ascending');
    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Alpha source', 'Middle source', 'Zebra source']);
    heading = clickSort('SOURCE');
    expect(heading.getAttribute('aria-sort')).toBe('descending');
    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Zebra source', 'Middle source', 'Alpha source']);

    heading = clickSort('CATEGORY');
    expect(heading.getAttribute('aria-sort')).toBe('ascending');
    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Zebra source', 'Middle source', 'Alpha source']);
    heading = clickSort('CATEGORY');
    expect(heading.getAttribute('aria-sort')).toBe('descending');
    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Alpha source', 'Middle source', 'Zebra source']);

    heading = clickSort('AMOUNT');
    expect(heading.getAttribute('aria-sort')).toBe('ascending');
    expect(component.transactions.map(transaction => transaction.amount.minorUnits)).toEqual([-3000n, -2000n, -1000n]);
    heading = clickSort('AMOUNT');
    expect(heading.getAttribute('aria-sort')).toBe('descending');
    expect(component.transactions.map(transaction => transaction.amount.minorUnits)).toEqual([-1000n, -2000n, -3000n]);
  });

  it('filters by date and state, identifies the selected account owner, and undoes Posted or Excluded rows', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const chartAccount = application.importChartAccounts('Account name,Account type\nOffice expenses,Expenses')[0];
    const account = application.listAccounts().find(item => item.name === 'Operating Checking')!;
    application.commitImport(application.previewImport({
      fileName: 'register-states.csv',
      content: [
        'Date,Description,Amount',
        '2026-01-05,Keep pending,-5.00',
        '2026-01-15,Post then undo,-15.00',
        '2026-01-20,Exclude then undo,-20.00',
      ].join('\n'),
      kind: 'CSV',
      destinationAccountId: account.id,
    }).previewToken);
    const imported = application.listTransactions({ accountId: account.id, sort: 'DATE_ASC' }).items;
    const posted = imported.find(transaction => transaction.description === 'Post then undo')!;
    const excluded = imported.find(transaction => transaction.description === 'Exclude then undo')!;
    application.categorize(posted.id, chartAccount.id, 'Fixture category');
    application.post([posted.id]);
    application.exclude([excluded.id], 'Fixture exclusion');

    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    component.selectAccount(account.id);
    component.selectedTransactionState = 'POSTED';
    component.startDate = '2026-01-10';
    component.endDate = '2026-01-16';
    component.refresh();
    fixture.detectChanges();

    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Post then undo']);
    expect(fixture.nativeElement.querySelector('.register-title')?.textContent).toContain('Operating');
    expect(fixture.nativeElement.querySelector('.register-title')?.textContent).toContain('Operating Checking');
    expect(fixture.nativeElement.querySelector('.pending-ledger tbody tr')?.textContent).toContain('Posted');
    (fixture.nativeElement.querySelector('[aria-label="Undo Post then undo to Pending"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(application.getTransaction(posted.id)?.state).toBe('PENDING');

    component.selectedTransactionState = 'EXCLUDED';
    component.startDate = '2026-01-20';
    component.endDate = '2026-01-20';
    component.refresh();
    fixture.detectChanges();
    expect(component.transactions.map(transaction => transaction.description)).toEqual(['Exclude then undo']);
    expect(fixture.nativeElement.querySelector('.pending-ledger tbody tr')?.textContent).toContain('Fixture exclusion');
    (fixture.nativeElement.querySelector('[aria-label="Undo Exclude then undo to Pending"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(application.getTransaction(excluded.id)?.state).toBe('PENDING');
  });
});
