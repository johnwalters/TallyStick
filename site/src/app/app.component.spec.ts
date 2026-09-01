import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from './core/application-interface/accounting.application';
import { DefaultAccountingApplication } from './core/application-services/default-accounting.application';
import { ImportPipelineService } from './core/import-services/import-pipeline.service';
import { InMemoryAccountingRepository } from './core/repository-gateways/in-memory-accounting.repository';
import { AppComponent } from './app.component';
import { BackupBundleService } from './core/backup-services/backup-bundle.service';
import { ACCOUNTING_REPOSITORY } from './core/repository-gateways/accounting.repository';
import { ImportFacade } from './features/imports/import.facade';
import * as XLSX from 'xlsx';
import { formatMoney, money, newId, nowUtc } from './core/domain-model/accounting.types';
import { cashFlowReportDisclaimer, CashFlowContractError, CashFlowExportResult, CashFlowWarning } from './core/domain-model/cash-flow.types';

const cashFlowDisplayMoney = (value: bigint): string => formatMoney(money(value));

async function settleDeferred(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
  await new Promise<void>(resolve => setTimeout(resolve, 500));
  fixture.detectChanges();
}

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem('accounting.transaction-view.v1');
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      deferBlockBehavior: DeferBlockBehavior.Playthrough,
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

  it('opens the exact posted transaction when Cash Flow reports a category correction', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const sourceAccountId = component.accounts[0].id;
    component.correctCashFlowTransactionCategory({
      transactionId: 'transaction-goodwill', transactionDate: '2026-01-31', transactionDescription: 'Goodwill',
      sourceAccountId, sourceAccountName: 'Amazon', chartAccountId: 'goodwill-chart',
      chartAccountName: 'Goodwill', chartTreatment: 'INVESTING',
    });

    expect(component.workspaceView).toBe('TRANSACTIONS');
    expect(component.selectedAccountId).toBe(sourceAccountId);
    expect(component.selectedTransactionState).toBe('POSTED');
    expect(component.startDate).toBe('2026-01-31');
    expect(component.endDate).toBe('2026-01-31');
    expect(component.search).toBe('Goodwill');
    expect(component.statusMessage).toContain('Goodwill');
  });

  it('creates the local bookkeeping shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.title).toBe('TallyStick');
    expect(fixture.nativeElement.querySelector('.topbar .eyebrow')?.textContent).toContain('TALLYSTICK');
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Example Outfitters LLC');
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

  it('opens the Cash Flow classification review, exposes structural reasons, and saves a validated stable-ID change', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const created = application.saveGenericAccount({
      requestedRole: 'CHART', accountType: 'EXPENSE', detailType: 'Other business expenses', name: 'Classification review expense',
      importCapability: { enabled: false, supportedSourceKinds: [] }, openingBalanceSource: 'DERIVED_EQUITY', openingBalanceMinor: 0n,
      openingBalanceDate: '2026-01-01', displayOrder: 900, locked: false,
    });
    const repository = TestBed.inject(InMemoryAccountingRepository);
    repository.chartAccounts.get(created.accountId)!.detailType = 'Custom UI detail';
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openClassificationReview();
    fixture.detectChanges();
    await settleDeferred(fixture);

    const panel = fixture.nativeElement.querySelector('.cash-flow-review-panel') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Review classifications');
    const reviewItem = component.classificationReview?.accounts.find(item => item.accountId === created.accountId)!;
    expect(reviewItem.reviewReasons).toContain('AMBIGUOUS_STRUCTURE');
    expect(panel.textContent).toContain('Custom or ambiguous structure');

    component.selectClassificationReviewItem(reviewItem);
    fixture.detectChanges();
    expect(panel.querySelector('.cash-flow-review-editor')?.textContent).toContain('Classification review expense');
    component.classificationEditor!.treatment = 'FINANCING';
    component.classificationEditor!.rationale = 'Owner-financed expense policy for this test account.';
    component.classificationEditorChanged();
    fixture.detectChanges();
    const save = Array.from(panel.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Save classification') as HTMLButtonElement;
    expect(save.disabled).toBeFalse();
    save.click();
    fixture.detectChanges();

    const revision = application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: true }).databaseRevision;
    const exported = application.exportCashFlowClassifications({ databaseRevision: revision });
    expect(exported.rows.find(row => row.accountId === created.accountId)?.treatment).toBe('FINANCING');
    expect(component.classificationSaveMessage).toContain('Classification review expense');
    expect(component.classificationReview?.accounts.find(item => item.accountId === created.accountId)?.currentClassification?.treatment).toBe('FINANCING');
    expect(component.classificationEditor?.expectedModifiedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('blocks an incompatible Cash Flow combination in the account editor before save', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const account = component.accounts.find(item => item.name === 'Operating Checking')!;
    component.editGenericFinancialAccount(account.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-classification-section')?.textContent).toContain('Cash Flow classification');
    component.classificationEditor!.cashRole = 'CASH';
    component.classificationEditor!.treatment = 'FINANCING';
    component.classificationEditorChanged();
    fixture.detectChanges();
    expect(component.classificationPreview?.valid).toBeFalse();
    const save = (Array.from(fixture.nativeElement.querySelectorAll('.cash-flow-classification-section button')) as HTMLButtonElement[]).find(button => button.textContent?.trim() === 'Save classification') as HTMLButtonElement;
    expect(save.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('.classification-preview.invalid')).toBeTruthy();
  });

  it('returns confirmed participating accounts in the complete review and keeps role namespaces distinct', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openClassificationReview();
    fixture.detectChanges();
    const review = component.classificationReview!;
    const checking = review.accounts.find(item => item.accountPath.endsWith('Operating Checking'))!;
    expect(checking.currentClassification).toBeTruthy();
    expect(checking.currentClassification?.modifiedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(checking.reviewReasons ?? []).not.toContain('MISSING_CLASSIFICATION');
    expect(component.filteredClassificationReviewItems.some(item => item.accountId === checking.accountId)).toBeFalse();
    component.classificationReviewFilter = 'ALL';
    expect(component.filteredClassificationReviewItems.some(item => item.accountId === checking.accountId)).toBeTrue();
    expect(component.classificationSelectionKey('FINANCIAL_SOURCE', checking.accountId)).not.toBe(component.classificationSelectionKey('CHART', checking.accountId));
  });

  it('rejects a stale classification save and preserves the externally updated value', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openClassificationReview();
    fixture.detectChanges();
    const item = component.classificationReview!.accounts.find(candidate => candidate.accountPath.endsWith('Operating Checking'))!;
    component.selectClassificationReviewItem(item);
    const expectedModifiedAtUtc = component.classificationEditor!.expectedModifiedAtUtc;
    expect(expectedModifiedAtUtc).toBeTruthy();
    application.saveCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountId: item.accountId, cashRole: 'CASH', treatment: 'CASH_BALANCE',
      userRationale: 'External update wins this concurrency test.', expectedModifiedAtUtc,
      query: component.classificationReview!.query,
    });
    component.classificationEditor!.rationale = 'Stale UI update must not overwrite the external change.';
    component.classificationEditorChanged();
    component.saveClassificationEditor();
    expect(component.classificationError).toContain('Reload and try again');
    const revision = application.getCashFlowClassificationReview(component.classificationReview!.query).databaseRevision;
    const row = application.exportCashFlowClassifications({ databaseRevision: revision }).rows.find(candidate => candidate.accountId === item.accountId)!;
    expect(row.rationale).toBe('External update wins this concurrency test.');
  });

  it('uses the selected classification period for preview and save impact', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.classificationReviewStartDate = '2026-01-01';
    component.classificationReviewEndDate = '2026-01-31';
    component.openClassificationReview();
    fixture.detectChanges();
    const item = component.classificationReview!.accounts.find(candidate => candidate.accountPath.endsWith('Operating Checking'))!;
    component.selectClassificationReviewItem(item);
    expect(component.classificationPreview?.query).toEqual(component.classificationReview!.query);
    expect(component.classificationPreview?.periodActivityMinor).toBe(component.classificationEditor!.periodActivityMinor);
    component.classificationEditor!.rationale = 'Selected-period impact test.';
    component.classificationEditorChanged();
    component.saveClassificationEditor();
    expect(component.classificationSaveImpact?.query).toEqual(component.classificationReview!.query);
  });

  it('focuses the review dialog, traps Tab, restores the opener, and closes on Escape', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.section-heading-actions .quiet-button') as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await settleDeferred(fixture);
    const panel = fixture.nativeElement.querySelector('.cash-flow-review-panel') as HTMLElement;
    expect(document.activeElement).toBe(panel);
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    const last = focusable[focusable.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    panel.dispatchEvent(tab);
    expect(document.activeElement).toBe(focusable[0]);
    const search = panel.querySelector('input') as HTMLInputElement;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(fixture.nativeElement.querySelector('.cash-flow-review-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps archived classification editors read-only', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const chart = [...repository.chartAccounts.values()].find(account => !account.archived)!;
    application.archiveChartAccount(chart.id, true);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openClassificationReview();
    fixture.detectChanges();
    await settleDeferred(fixture);
    const item = component.classificationReview!.accounts.find(candidate => candidate.accountRole === 'CHART' && candidate.accountId === chart.id)!;
    component.selectClassificationReviewItem(item);
    fixture.detectChanges();
    expect(item.archived).toBeTrue();
    expect(component.classificationEditor?.archived).toBeTrue();
    const controls = fixture.nativeElement.querySelectorAll('.cash-flow-review-editor select, .cash-flow-review-editor textarea') as NodeListOf<HTMLSelectElement | HTMLTextAreaElement>;
    expect(controls.length).toBeGreaterThan(0);
    expect((fixture.nativeElement.querySelector('.cash-flow-review-editor fieldset') as HTMLFieldSetElement).disabled).toBeTrue();
    expect(Array.from(controls).every(control => control.matches(':disabled'))).toBeTrue();
    expect(fixture.nativeElement.querySelector('.cash-flow-review-editor')?.textContent).toContain('read-only');
  });

  it('edits two neutral company identities, refreshes branding, and excludes tax data from standard identity', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    (fixture.nativeElement.querySelector('.company-settings-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.company-editor-panel')?.getAttribute('role')).toBe('dialog');
    expect(fixture.nativeElement.querySelector('.company-masked-tax')?.textContent).toContain('Not set');
    expect(fixture.nativeElement.querySelector('.company-editor-panel')?.textContent).not.toContain('12-3456789');

    component.companyDraft!.legalName = '';
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.company-editor-footer .primary-button') as HTMLButtonElement).disabled).toBeTrue();
    component.companyDraft!.legalName = 'Copper Lantern Studio LLC';
    component.companyDraft!.displayName = 'Copper Lantern Studio';
    component.companyDraft!.doingBusinessAs = 'Copper Lantern';
    component.companyDraft!.addressLine1 = '44 Example Way';
    component.companyDraft!.locality = 'Portland';
    component.companyDraft!.region = 'OR';
    component.companyDraft!.postalCode = '97205';
    component.companyDraft!.countryCode = 'US';
    component.companyDraft!.email = 'books@copper-lantern.example';
    component.revealCompanyTaxIdentifier();
    component.markCompanyTaxIdentifierDirty('12-3456789');
    component.saveCompanySettings();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.topbar h1')?.textContent).toContain('Copper Lantern Studio');
    expect(component.companyProfile.maskedTaxIdentifier).toContain('6789');
    expect(JSON.stringify(component.companyReportIdentity)).toContain('Copper Lantern Studio LLC');
    expect(JSON.stringify(component.companyReportIdentity)).not.toContain('6789');
    expect(JSON.stringify(component.companyReportIdentity)).not.toContain('tax');

    component.openCompanySettings();
    component.companyDraft!.legalName = 'Harbor Thread Works Inc.';
    component.companyDraft!.displayName = 'Harbor Thread Works';
    component.companyDraft!.doingBusinessAs = '';
    component.companyDraft!.addressLine1 = '';
    component.companyDraft!.locality = '';
    component.companyDraft!.region = '';
    component.companyDraft!.postalCode = '';
    component.companyDraft!.countryCode = '';
    component.companyDraft!.email = '';
    component.saveCompanySettings();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.topbar h1')?.textContent).toContain('Harbor Thread Works');
    expect(component.companyReportIdentity.addressLines).toEqual([]);
    expect(component.companyReportIdentity.contactLines).toEqual([]);
  });

  it('discards company edits on cancel or Escape and presents stale-update recovery', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const original = component.companyProfile;

    component.openCompanySettings();
    component.companyDraft!.displayName = 'Unsaved Identity';
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.company-editor-panel') as HTMLElement;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.companyDraft).toBeUndefined();
    expect(component.companyProfile.displayName).toBe(original.displayName);

    component.openCompanySettings();
    component.companyDraft!.displayName = 'Stale Draft';
    application.updateCompanyProfile({
      expectedModifiedAt: original.modifiedAt,
      legalName: original.legalName,
      displayName: 'Externally Updated Identity',
      currencyCode: original.currencyCode,
      fiscalYearStartMonth: original.fiscalYearStartMonth,
      accountingBasis: original.accountingBasis,
      activeTaxYear: original.activeTaxYear,
    });
    component.saveCompanySettings();
    fixture.detectChanges();
    expect(component.companyEditorError).toContain('Reload');
    expect(fixture.nativeElement.querySelector('.company-editor-error [type="button"]')?.textContent).toContain('Reload company information');
    component.reloadCompanySettings();
    expect(component.companyDraft?.displayName).toBe('Externally Updated Identity');
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

  it('creates a category through the grouped unified editor with live Current Earnings placement', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CHART');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.chart-heading .primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.generic-account-editor-panel') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.querySelectorAll('select[name="genericAccountType"] optgroup')).toHaveSize(5);
    expect(panel.textContent).toContain('Category only');
    expect(panel.textContent).toContain('Current Earnings');
    expect(panel.textContent).toContain('does not appear as an individual Balance Sheet line');

    component.genericAccountDraft!.name = 'Web services';
    component.genericAccountDraft!.detailType = 'Other business expenses';
    component.refreshGenericAccountReview();
    fixture.detectChanges();
    expect(component.genericAccountDraftValid).toBeTrue();
    (panel.querySelector('.generic-account-editor-footer .primary-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const created = component.filteredChartAccounts.find(account => account.name === 'Web services');
    expect(created).toEqual(jasmine.objectContaining({ accountType: 'EXPENSE', detailType: 'Other business expenses' }));
  });

  it('preserves an imported detail and stable ID, fixes role during edit, and cancels by keyboard', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const created = application.saveGenericAccount({
      requestedRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising', name: 'Imported category',
      importCapability: { enabled: false, supportedSourceKinds: [] }, openingBalanceSource: 'DERIVED_EQUITY',
      openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01', displayOrder: 100, locked: false,
    });
    application.saveGenericAccount({
      accountId: created.accountId, currentRole: 'CHART', requestedRole: 'CHART', accountType: 'EXPENSE', detailType: 'Legacy imported subtype', name: 'Imported category',
      importCapability: { enabled: false, supportedSourceKinds: [] }, openingBalanceSource: 'DERIVED_EQUITY',
      openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01', displayOrder: 100, locked: false,
    });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.editGenericChartAccount(created.accountId);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('.generic-account-editor-panel') as HTMLElement;
    expect(panel.textContent).toContain('Category only');
    expect(panel.textContent).toContain('role of an existing account cannot be changed');
    expect(panel.querySelector('.custom-detail-note')?.textContent).toContain('Imported/custom detail retained');
    expect(Array.from(panel.querySelectorAll('select[name="genericDetailType"] option')).map(option => option.textContent)).toContain('Legacy imported subtype — Imported/custom');

    component.genericAccountDraft!.name = 'Imported category updated';
    component.refreshGenericAccountReview();
    component.saveGenericAccount();
    expect(application.listChartAccounts().find(account => account.id === created.accountId)?.name).toBe('Imported category updated');
    expect(application.listChartAccounts().find(account => account.id === created.accountId)?.detailType).toBe('Legacy imported subtype');

    component.editGenericChartAccount(created.accountId);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.generic-account-editor-panel') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.genericAccountDraft).toBeUndefined();
  });

  it('renames the migrated marketplace source and deletes an unused source account', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const application = TestBed.inject(ACCOUNTING_APPLICATION);

    const marketplace = application.listAccounts().find(account => account.name === 'Marketplace')!;
    component.editGenericFinancialAccount(marketplace.id);
    expect(component.genericAccountDraftValid).toBeTrue();
    component.genericAccountDraft!.name = 'Amazon';
    component.refreshGenericAccountReview();
    component.saveGenericAccount();
    expect(application.getAccount(marketplace.id)).toEqual(jasmine.objectContaining({ name: 'Amazon', detailType: 'Marketplace' }));

    const reserve = application.listAccounts().find(account => account.name === 'Reserve Checking')!;
    component.editGenericFinancialAccount(reserve.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.generic-account-delete')?.textContent).toContain('Delete account');
    spyOn(window, 'confirm').and.returnValue(true);
    component.deleteGenericAccount();
    expect(application.getAccount(reserve.id)).toBeUndefined();
    expect(component.genericAccountDraft).toBeUndefined();
  });

  it('shows opening-mode errors and every blocking reference before save', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.openNewGenericAccount('FINANCIAL_SOURCE');
    component.genericAccountDraft!.name = 'Ledger opening conflict';
    component.genericAccountDraft!.openingBalanceSource = 'LEDGER_ACTIVITY';
    component.genericAccountDraft!.openingBalanceText = '1.00';
    component.refreshGenericAccountReview();
    fixture.detectChanges();
    expect(component.genericAccountError).toContain('zero stored opening balance');
    expect((fixture.nativeElement.querySelector('.generic-account-editor-footer .primary-button') as HTMLButtonElement).disabled).toBeTrue();
    component.closeGenericAccountEditor();

    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const target = application.saveGenericAccount({
      requestedRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising', name: 'Locked referenced category',
      importCapability: { enabled: false, supportedSourceKinds: [] }, openingBalanceSource: 'DERIVED_EQUITY', openingBalanceMinor: 0n,
      openingBalanceDate: '2026-01-01', displayOrder: 101, locked: true,
    });
    const child = application.saveGenericAccount({
      requestedRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising', name: 'Referenced child', parentId: target.accountId,
      importCapability: { enabled: false, supportedSourceKinds: [] }, openingBalanceSource: 'DERIVED_EQUITY', openingBalanceMinor: 0n,
      openingBalanceDate: '2026-01-01', displayOrder: 102, locked: false,
    });
    const sourceId = application.listAccounts()[0].id;
    const transactionId = newId();
    repository.transactions.set(transactionId, {
      id: transactionId, accountId: sourceId, postingDate: '2026-02-01', amount: money(-500n), rawDescription: 'Referenced posting', description: 'Referenced posting',
      state: 'POSTED', splits: [{ id: 'blocking-split', chartAccountId: target.accountId, amount: money(-500n) }], categorizationSource: 'MANUAL', createdAtUtc: nowUtc(), modifiedAtUtc: nowUtc(),
    });
    repository.rules.set('blocking-rule', { id: 'blocking-rule', name: 'Referenced category rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'posting' }], chartAccountId: target.accountId, matchMode: 'ALL' });
    repository.taxSettings.set(2026, { taxYear: 2026, federalIncomeTaxAccountIds: [target.accountId], stateLocalIncomeTaxAccountIds: [], includeFederalIncomeTax: false, includeStateLocalIncomeTax: true });
    component.refresh();
    component.editGenericChartAccount(target.accountId);
    spyOn(window, 'confirm').and.returnValue(true);
    component.genericAccountDraft!.accountType = 'BANK';
    component.genericAccountTypeChanged();
    fixture.detectChanges();

    const blocking = [...fixture.nativeElement.querySelectorAll('.account-reference-list.blocking li')] as HTMLElement[];
    expect(blocking.map(item => item.textContent)).toEqual(jasmine.arrayWithExactContents([
      jasmine.stringMatching(/LOCK_STATE.*Locked referenced category/),
      jasmine.stringMatching(new RegExp(`CHILD.*Referenced child.*${child.accountId}`)),
      jasmine.stringMatching(/TAX_SETTING.*2026/),
    ]));
    expect(fixture.nativeElement.querySelector('.account-reference-list.confirmation')?.textContent).toContain('Referenced posting');
    expect(fixture.nativeElement.querySelector('.account-reference-list.confirmation')?.textContent).toContain('Referenced category rule');
    expect((fixture.nativeElement.querySelector('.generic-account-editor-footer .primary-button') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('shows exactly one icon-led primary accounting workspace', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const tabs = [...fixture.nativeElement.querySelectorAll('.workspace-tab')] as HTMLButtonElement[];
    const transactionsTab = tabs.find(tab => tab.textContent?.trim() === 'Transactions')!;
    const chartTab = tabs.find(tab => tab.textContent?.trim() === 'Chart of Accounts')!;
    const rulesTab = tabs.find(tab => tab.textContent?.trim() === 'Rules')!;
    const reportsTab = tabs.find(tab => tab.textContent?.trim() === 'Profit & Loss')!;
    const cashFlowTab = tabs.find(tab => tab.textContent?.trim() === 'Cash Flow')!;
    const balanceSheetTab = tabs.find(tab => tab.textContent?.trim() === 'Balance Sheet')!;
    const dataTab = tabs.find(tab => tab.textContent?.trim() === 'Backups')!;
    expect(tabs).toHaveSize(7);
    expect(fixture.nativeElement.querySelector('.workspace-switcher select')).toBeNull();
    expect(fixture.nativeElement.querySelector('.app-sidebar')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.workspace-switcher')?.getAttribute('aria-orientation')).toBe('vertical');
    expect(transactionsTab.querySelector('.bi-list')).toBeTruthy();
    expect(chartTab.querySelector('.bi-bar-chart-steps')).toBeTruthy();
    expect(reportsTab.querySelector('.bi-file-ruled')).toBeTruthy();
    expect(cashFlowTab.querySelector('.bi-cash')).toBeTruthy();
    expect(dataTab.querySelector('.bi-database')).toBeTruthy();
    expect(transactionsTab.getAttribute('aria-selected')).toBe('true');
    expect(reportsTab.getAttribute('aria-selected')).toBe('false');
    expect(balanceSheetTab.getAttribute('aria-selected')).toBe('false');
    expect(cashFlowTab.getAttribute('aria-selected')).toBe('false');

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

    balanceSheetTab.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.workspaceView).toBe('BALANCE_SHEET');
    expect(fixture.nativeElement.querySelector('#balance-sheet-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.balance-sheet-totals')).toBeTruthy();
    expect(balanceSheetTab.getAttribute('aria-selected')).toBe('true');

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

    cashFlowTab.click();
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(fixture.componentInstance.workspaceView).toBe('CASH_FLOW');
    expect(fixture.nativeElement.querySelector('#cash-flow-workspace')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#reports-workspace')).toBeNull();
    expect(cashFlowTab.getAttribute('aria-selected')).toBe('true');

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

  it('renders the Cash Flow workspace with independent period controls and statement metadata', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const reportStart = component.reportStartDate;
    const reportEnd = component.reportEndDate;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);

    const workspace = fixture.nativeElement.querySelector('#cash-flow-workspace') as HTMLElement;
    expect(component.cashFlowReport).toBeTruthy();
    expect(workspace.querySelector('h2')?.textContent).toContain('Statement of Cash Flows');
    expect(workspace.querySelector('[aria-label="Statement of Cash Flows"]')).toBeTruthy();
    expect(workspace.textContent).toContain('Beginning Cash');
    expect(workspace.textContent).toContain('Net Change in Cash');
    expect(workspace.textContent).toContain('Ending Cash');
    expect(workspace.textContent).toContain('Difference');

    component.cashFlowStartDate = '2026-02-01';
    component.cashFlowEndDate = '2026-02-28';
    component.cashFlowPeriod = 'CUSTOM';
    component.loadCashFlowReport();
    fixture.detectChanges();
    expect(component.cashFlowReport?.query.startDate).toBe('2026-02-01');
    expect(component.cashFlowReport?.query.endDate).toBe('2026-02-28');
    expect(component.reportStartDate).toBe(reportStart);
    expect(component.reportEndDate).toBe(reportEnd);
    expect(component.cashFlowPeriod).toBe('CUSTOM');

    const period = workspace.querySelector('.cash-flow-controls select') as HTMLSelectElement;
    period.value = 'CURRENT_QUARTER';
    period.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(component.cashFlowReport?.query.startDate).toMatch(/^\d{4}-(01|04|07|10)-01$/);
    expect(component.cashFlowReport?.query.endDate).toMatch(/^\d{4}-(03|06|09|12)-\d{2}$/);
  });

  it('supports Cash Flow hierarchy expansion, accessible amount drilldown, and detail reconciliation', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    const workspace = fixture.nativeElement.querySelector('#cash-flow-workspace') as HTMLElement;
    const detailRow = report.rows.find(row => row.detailKey && row.amountMinor !== undefined)!;
    expect(detailRow).toBeTruthy();
    const amount = Array.from(workspace.querySelectorAll('.cash-flow-amount')).find(button => button.textContent?.trim() === cashFlowDisplayMoney(detailRow.amountMinor!)) as HTMLButtonElement;
    expect(amount).toBeTruthy();
    expect(amount.getAttribute('aria-label')).toContain(component.cashFlowStartDate);
    amount.click();
    fixture.detectChanges();
    expect(component.cashFlowDetail?.reportId).toBe(report.reportId);
    expect(component.cashFlowDetail?.databaseRevision).toEqual(report.databaseRevision);
    expect(workspace.querySelector('.cash-flow-detail')).toBeTruthy();
    expect(workspace.querySelector('.cash-flow-detail-sum')?.textContent).toContain(cashFlowDisplayMoney(component.cashFlowDetail!.contributions.reduce((sum, item) => sum + item.contributionMinor, 0n)));
    (workspace.querySelector('.cash-flow-detail') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.cashFlowDetail).toBeUndefined();

    const parent = report.rows.find(row => report.rows.some(candidate => candidate.parentRowId === row.rowId));
    if (parent) {
      expect(component.cashFlowExpanded.has(parent.rowId)).toBeTrue();
      component.toggleCashFlowRow(parent);
      expect(component.cashFlowExpanded.has(parent.rowId)).toBeFalse();
      expect(report.rows.filter(row => row.parentRowId === parent.rowId).every(row => !component.cashFlowExpanded.has(row.rowId))).toBeTrue();
      component.toggleCashFlowRow(parent);
    }
    expect(workspace.querySelector('.cash-flow-detail')).toBeNull();
  });

  it('surfaces invalid Cash Flow periods and report failures without rendering stale data', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    component.cashFlowStartDate = '2026-03-31';
    component.cashFlowEndDate = '2026-03-01';
    component.cashFlowPeriod = 'CUSTOM';
    component.loadCashFlowReport();
    fixture.detectChanges();
    expect(component.cashFlowReport).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.cash-flow-error')?.textContent).toContain('on or before');

    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    spyOn(application, 'getCashFlowReport').and.throwError('Cash Flow fixture failure');
    component.cashFlowStartDate = '2026-01-01';
    component.cashFlowEndDate = '2026-12-31';
    component.loadCashFlowReport();
    fixture.detectChanges();
    expect(component.cashFlowReport).toBeUndefined();
    expect(fixture.nativeElement.querySelector('.cash-flow-error')?.textContent).toContain('Cash Flow fixture failure');
  });

  it('marks an open Cash Flow report stale after classification save and recovers on refresh', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const originalReportId = component.cashFlowReport?.reportId;
    component.openClassificationReview();
    fixture.detectChanges();
    await settleDeferred(fixture);
    const item = component.classificationReview!.accounts.find(candidate => candidate.accountPath.endsWith('Operating Checking'))!;
    component.selectClassificationReviewItem(item);
    component.classificationEditor!.rationale = `${component.classificationEditor!.rationale} UI stale test`;
    component.classificationEditorChanged();
    component.saveClassificationEditor();
    component.closeClassificationReview();
    fixture.detectChanges();
    expect(component.cashFlowReport?.reportId).toBe(originalReportId);
    expect(component.cashFlowStale).toBeTrue();
    const workspace = fixture.nativeElement.querySelector('#cash-flow-workspace') as HTMLElement;
    expect(workspace.querySelector('.cash-flow-status')?.textContent).toContain('Stale');
    expect(workspace.querySelector('.cash-flow-stale')?.textContent).toContain('Refresh report');
    expect(workspace.querySelector('.cash-flow-totals')).toBeNull();
    expect(workspace.querySelector('.cash-flow-table')).toBeNull();
    expect(Array.from(workspace.querySelectorAll('.cash-flow-actions button')).filter(button => /Export|Print/.test(button.textContent ?? '')).every(button => (button as HTMLButtonElement).disabled)).toBeTrue();
    expect(Array.from(workspace.querySelectorAll('.cash-flow-amount')).every(button => (button as HTMLButtonElement).disabled)).toBeTrue();

    component.loadCashFlowReport();
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(component.cashFlowStale).toBeFalse();
    expect(fixture.nativeElement.querySelector('.cash-flow-stale')).toBeNull();
  });

  it('marks reports stale when detail, export, or print encounters a revision conflict', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    fixture.detectChanges();
    const row = component.cashFlowReport!.rows.find(candidate => candidate.detailKey && candidate.amountMinor !== undefined)!;
    const staleError = new CashFlowContractError({ code: 'CASH_FLOW_REPORT_REVISION_STALE', message: 'Report revision is stale; reload and try again.', retryable: true });
    spyOn(application, 'getCashFlowDetail').and.throwError(staleError);
    component.openCashFlowDetail(row, { currentTarget: document.createElement('button') } as unknown as Event);
    expect(component.cashFlowStale).toBeTrue();
    component.cashFlowStale = false;
    const exportSpy = spyOn(application, 'exportCashFlow').and.throwError(staleError);
    await component.exportCashFlow('CSV');
    expect(exportSpy).toHaveBeenCalled();
    expect(component.cashFlowStale).toBeTrue();
    component.cashFlowStale = false;
    const printSpy = spyOn(application, 'openCashFlowPrintPreview').and.throwError(staleError);
    await component.openCashFlowPrintPreview();
    expect(printSpy).toHaveBeenCalled();
    expect(component.cashFlowStale).toBeTrue();
  });

  it('routes the native Command-P request to the current Cash Flow report preview without printing', async () => {
    let requestPreview: (() => void) | undefined;
    (globalThis as { localAccounting?: unknown }).localAccounting = {
      reportPreview: { onPrintRequested: (listener: () => void) => { requestPreview = listener; return () => undefined; } },
    };
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const preview = spyOn(component, 'openCashFlowPrintPreview').and.resolveTo();
    requestPreview?.();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('keeps the current report usable when a CSV save fails without changing the revision', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    spyOn(application, 'exportCashFlow').and.rejectWith(new CashFlowContractError({
      code: 'CASH_FLOW_EXPORT_FAILED', message: 'Cash Flow export failed. Choose another location and try again.',
      reportId: report.reportId, databaseRevision: report.databaseRevision, retryable: true,
    }));

    await component.exportCashFlow('CSV');

    expect(component.cashFlowStale).toBeFalse();
    expect(component.cashFlowReport).toBe(report);
    expect(component.cashFlowFacade.failure()?.code).toBe('CASH_FLOW_EXPORT_FAILED');
    expect(component.cashFlowFacade.error()).toContain('Choose another location');
  });

  it('downloads immutable CSV content returned by the Cash Flow output boundary in browser mode', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    const result: CashFlowExportResult = {
      format: 'CSV', status: 'DOWNLOAD_READY', suggestedFileName: 'statement.csv',
      rowCount: report.rows.length, content: '\uFEFFReport,Statement of Cash Flows\r\n',
    };
    spyOn(application, 'exportCashFlow').and.resolveTo(result);
    const download = spyOn<any>(component, 'downloadFile');

    await component.exportCashFlow('CSV');

    if (result.format !== 'CSV') throw new Error('Expected a CSV result.');
    expect(download).toHaveBeenCalledOnceWith(result.content, result.suggestedFileName, 'text/csv;charset=utf-8');
    expect(component.cashFlowStale).toBeFalse();
  });

  it('downloads immutable XLSX bytes returned by the Cash Flow output boundary in browser mode', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    const result: CashFlowExportResult = {
      format: 'XLSX', status: 'DOWNLOAD_READY', suggestedFileName: 'statement.xlsx',
      rowCount: report.rows.length, bytes: new Uint8Array([1, 2, 3]),
    };
    spyOn(application, 'exportCashFlow').and.resolveTo(result);
    const download = spyOn<any>(component, 'downloadFile');

    await component.exportCashFlow('XLSX');

    expect(download).toHaveBeenCalledOnceWith(result.bytes, result.suggestedFileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(component.cashFlowStale).toBeFalse();
  });

  it('uses the same query-based disclaimer on screen and in CSV output', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    fixture.detectChanges();
    const report = component.cashFlowReport!;
    const screenDisclaimer = (fixture.nativeElement.querySelector('.cash-flow-disclaimer') as HTMLElement).textContent?.trim();
    expect(screenDisclaimer).toBe(cashFlowReportDisclaimer(report.query));
    const exported = await application.exportCashFlow({ reportId: report.reportId, databaseRevision: report.databaseRevision, format: 'CSV' });
    if (exported.status === 'CANCELLED' || exported.format !== 'CSV') throw new Error('Expected browser-ready CSV output.');
    const disclaimerRow = exported.content.split(/\r?\n/).find((line: string) => line.startsWith('Disclaimer,'));
    expect(disclaimerRow).toContain(cashFlowReportDisclaimer(report.query));
  });

  it('does not download a second copy when the desktop save dialog is cancelled', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    const result: CashFlowExportResult = {
      format: 'CSV', status: 'CANCELLED', rowCount: report.rows.length,
    };
    spyOn(application, 'exportCashFlow').and.resolveTo(result);
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save: async () => 'CANCELLED' } };
    const download = spyOn<any>(component, 'downloadFile');

    await component.exportCashFlow('CSV');

    expect(download).not.toHaveBeenCalled();
    expect(component.cashFlowStale).toBeFalse();
  });

  it('covers every Cash Flow period preset, custom dates, empty/no-cash, and responsive workspace states', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    fixture.detectChanges();
    for (const preset of ['CURRENT_MONTH', 'PREVIOUS_MONTH', 'CURRENT_QUARTER', 'YEAR_TO_DATE', 'FISCAL_YEAR', 'PREVIOUS_FISCAL_YEAR'] as const) {
      const period = fixture.nativeElement.querySelector('.cash-flow-controls select') as HTMLSelectElement;
      period.value = preset;
      period.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      await settleDeferred(fixture);
      expect(component.cashFlowReport?.query.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(component.cashFlowReport?.query.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    component.cashFlowStartDate = '2026-02-01';
    component.cashFlowEndDate = '2026-02-28';
    component.cashFlowPeriod = 'CUSTOM';
    component.loadCashFlowReport();
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(component.cashFlowPeriod).toBe('CUSTOM');
    const report = component.cashFlowReport!;
    component.cashFlowLoading = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-loading')?.textContent).toContain('Loading Statement of Cash Flows');
    component.cashFlowLoading = false;
    fixture.detectChanges();
    const informationalWarning = { warningId: 'warning-ui-restricted', code: 'RESTRICTED_CASH_PRESENT', message: 'Restricted cash is disclosed.', accountRole: 'FINANCIAL_SOURCE', accountId: component.accounts[0].id } as CashFlowWarning;
    component.cashFlowReport = { ...report, status: 'COMPLETE', warnings: [informationalWarning] };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-warnings h3')?.textContent).toContain('Warnings and disclosures');
    component.cashFlowReport = { ...component.cashFlowReport!, status: 'REVIEW_REQUIRED' };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-warnings h3')?.textContent).toContain('Review required');
    component.cashFlowReport = { ...report, rows: [], warnings: [{ ...informationalWarning, code: 'NO_CASH_ACCOUNTS_CONFIGURED', message: 'No cash accounts are configured.' }], status: 'REVIEW_REQUIRED' };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-empty')).toBeTruthy();
    component.cashFlowReport = undefined;
    component.cashFlowStale = false;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cash-flow-empty-state')).toBeTruthy();
    component.cashFlowReport = report;
    component.cashFlowShowZeros = true;
    component.loadCashFlowReport();
    fixture.detectChanges();
    await settleDeferred(fixture);
    window.dispatchEvent(new Event('resize'));
    expect(fixture.nativeElement.querySelector('.cash-flow-table-wrap')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.cash-flow-actions')).toBeTruthy();
  });

  it('navigates an actionable warning by composite role and account identity and renders audit detail fields', async () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.selectWorkspace('CASH_FLOW');
    fixture.detectChanges();
    await settleDeferred(fixture);
    const report = component.cashFlowReport!;
    const source = application.listAccounts().find(account => account.name === 'Operating Checking')!;
    const warning = { warningId: 'warning-ui-account', code: 'ARCHIVED_PARTICIPATING_ACCOUNT', message: 'Review this account.', accountRole: 'FINANCIAL_SOURCE', accountId: source.id } as CashFlowWarning;
    component.cashFlowReport = { ...report, warnings: [warning], status: 'REVIEW_REQUIRED' };
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.cash-flow-warning .quiet-button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await settleDeferred(fixture);
    expect(component.classificationSelectedAccountKey).toBe(`FINANCIAL_SOURCE:${source.id}`);
    expect(component.classificationEditor?.accountId).toBe(source.id);
    expect(component.classificationReviewFilter).toBe('ALL');
    expect(fixture.nativeElement.querySelector('.cash-flow-review-item.selected')?.textContent).toContain('Operating Checking');
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.cash-flow-review-panel'));

    const row = report.rows.find(candidate => candidate.detailKey)!;
    const detail = { reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: row.detailKey!, rowId: row.rowId, amountMinor: 0n, contributions: [{ contributionId: 'ui-opening', detailKey: row.detailKey!, contributionType: 'BALANCE_CHANGE' as const, contributionMinor: 0n, openingAmountMinor: 0n, endingAmountMinor: 0n, rawChangeMinor: 0n, formula: 'Opening - Ending', accountRole: row.accountRole, accountId: row.accountId, chartAccountPath: row.fullPath, transactionId: 'tx-ui', transferId: 'transfer-ui' }] };
    component.cashFlowDetailRow = row;
    component.cashFlowDetail = detail;
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.cash-flow-detail') as HTMLElement;
    expect(panel.textContent).toContain('Opening $0.00');
    expect(panel.textContent).toContain('Ending $0.00');
    expect(panel.textContent).toContain('Raw change $0.00');
    expect(panel.textContent).toContain('Opening - Ending');
    expect(panel.textContent).toContain('Report');
    expect(panel.textContent).toContain('revision');
    expect(panel.textContent).toContain('transfer-ui');
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
    const ruleTransactions = Array.from({ length: 11 }, (_, index) => `2026-02-${String(index + 1).padStart(2, '0')},UI RULE VENDOR ${index + 1},-${18 + index}.00`);
    const batch = application.commitImport(application.previewImport({
      fileName: 'rules-ui.csv', content: ['Date,Description,Amount', ...ruleTransactions].join('\n'), kind: 'CSV', destinationAccountId: account.id,
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
    expect(component.matchingRuleTestTransactions).toHaveSize(11);
    expect(fixture.nativeElement.querySelector('.rule-test-panel')?.textContent).toContain('11 transactions');
    expect(fixture.nativeElement.querySelectorAll('.rule-test-panel li')).toHaveSize(11);
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
