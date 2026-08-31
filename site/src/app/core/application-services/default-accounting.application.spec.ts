import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from '../application-interface/accounting.application';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID, DEFAULT_INTEREST_PAID_ACCOUNT_ID, DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID, DEFAULT_OWNER_DRAW_ACCOUNT_ID, DEFAULT_SOFTWARE_APPS_ACCOUNT_ID, DefaultAccountingApplication } from './default-accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import * as XLSX from 'xlsx';
import { AlternateUiHarness } from '../../features/alternate/alternate-ui.harness';
import { BOFA_SUMMARY_PREAMBLE_CSV } from '../import-services/test-fixtures/bofa-summary-preamble.fixture';
import { CURRENT_SQLITE_SCHEMA_VERSION } from '../../../shared/schema-version';

describe('DefaultAccountingApplication', () => {
  let app: DefaultAccountingApplication;

  const exportedChartWithout = (accountId: string): ArrayBuffer => {
    const source = XLSX.read(app.exportChartAccounts(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean>>(source.Sheets[source.SheetNames[0]], { defval: '' })
      .filter(row => row['Account ID'] !== accountId);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Chart of Accounts');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InMemoryAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ],
    });
    app = TestBed.inject(ACCOUNTING_APPLICATION) as DefaultAccountingApplication;
  });

  it("seeds one standard Owner's Draw equity account and restores it for an existing company", () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    expect(app.listChartAccounts().filter(item => item.id === DEFAULT_OWNER_DRAW_ACCOUNT_ID)).toEqual([
      jasmine.objectContaining({ name: "Owner's Draw", type: 'EQUITY', accountType: 'EQUITY', detailType: 'Owner draw', archived: false }),
    ]);

    repository.chartAccounts.delete(DEFAULT_OWNER_DRAW_ACCOUNT_ID);
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());

    expect([...repository.chartAccounts.values()].filter(item => item.accountType === 'EQUITY' && item.detailType === 'Owner draw')).toHaveSize(1);
    expect(repository.audit.filter(event => event.operation === 'CREATE_DEFAULT_CHART_ACCOUNT')).toHaveSize(1);
  });

  it('seeds one standard Advertising and Marketing expense account and restores it for an existing company', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    expect(app.listChartAccounts().filter(item => item.id === DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID)).toEqual([
      jasmine.objectContaining({ name: 'Advertising and Marketing', type: 'EXPENSE', accountType: 'EXPENSE', detailType: 'Advertising', archived: false }),
    ]);

    repository.chartAccounts.delete(DEFAULT_ADVERTISING_MARKETING_ACCOUNT_ID);
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());

    expect([...repository.chartAccounts.values()].filter(item => item.accountType === 'EXPENSE' && item.detailType === 'Advertising' && item.name === 'Advertising and Marketing')).toHaveSize(1);
    expect(repository.audit.filter(event => event.operation === 'CREATE_DEFAULT_CHART_ACCOUNT')).toHaveSize(1);
  });

  it('seeds one standard Interest Paid expense account and restores it for an existing company', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    expect(app.listChartAccounts().filter(item => item.id === DEFAULT_INTEREST_PAID_ACCOUNT_ID)).toEqual([
      jasmine.objectContaining({ name: 'Interest Paid', type: 'EXPENSE', accountType: 'EXPENSE', detailType: 'Interest paid', parentId: undefined, archived: false }),
    ]);

    repository.chartAccounts.delete(DEFAULT_INTEREST_PAID_ACCOUNT_ID);
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());

    expect([...repository.chartAccounts.values()].filter(item => item.accountType === 'EXPENSE' && item.detailType === 'Interest paid' && item.name === 'Interest Paid')).toHaveSize(1);
    expect(repository.audit.filter(event => event.operation === 'CREATE_DEFAULT_CHART_ACCOUNT')).toHaveSize(1);
  });

  it('does not rewrite or duplicate an existing same-named user account during startup seeding', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    repository.transaction(() => {
      repository.chartAccounts.delete(DEFAULT_INTEREST_PAID_ACCOUNT_ID);
      repository.chartAccounts.set('user-interest-paid', {
        id: 'user-interest-paid', name: 'Interest Paid', type: 'EXPENSE', accountType: 'EXPENSE',
        detailType: 'Advertising', description: 'User-defined category with the same display name.', displayOrder: 999, archived: false, locked: false,
      });
    });

    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());

    expect(repository.chartAccounts.get('user-interest-paid')).toEqual(jasmine.objectContaining({
      detailType: 'Advertising', description: 'User-defined category with the same display name.',
    }));
    expect(repository.chartAccounts.has(DEFAULT_INTEREST_PAID_ACCOUNT_ID)).toBeFalse();
  });

  it('seeds and restores the Operating Expenses, Office Expenses, and Software and apps hierarchy', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const operatingExpenses = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const officeExpenses = app.listChartAccounts().find(item => item.id === DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID)!;
    const softwareApps = app.listChartAccounts().find(item => item.id === DEFAULT_SOFTWARE_APPS_ACCOUNT_ID)!;
    expect(officeExpenses).toEqual(jasmine.objectContaining({ name: 'Office Expenses', accountType: 'EXPENSE', detailType: 'Office expenses', parentId: operatingExpenses.id, archived: false }));
    expect(softwareApps).toEqual(jasmine.objectContaining({ name: 'Software and apps', accountType: 'EXPENSE', detailType: 'Office expenses', parentId: officeExpenses.id, archived: false }));

    repository.chartAccounts.delete(DEFAULT_SOFTWARE_APPS_ACCOUNT_ID);
    repository.chartAccounts.delete(DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID);
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());
    TestBed.runInInjectionContext(() => new DefaultAccountingApplication());

    const restoredOffice = repository.chartAccounts.get(DEFAULT_OFFICE_EXPENSES_ACCOUNT_ID)!;
    const restoredSoftware = repository.chartAccounts.get(DEFAULT_SOFTWARE_APPS_ACCOUNT_ID)!;
    expect(restoredOffice.parentId).toBe(operatingExpenses.id);
    expect(restoredSoftware.parentId).toBe(restoredOffice.id);
    expect([...repository.chartAccounts.values()].filter(item => item.name === 'Office Expenses')).toHaveSize(1);
    expect([...repository.chartAccounts.values()].filter(item => item.name === 'Software and apps')).toHaveSize(1);
    expect(repository.audit.filter(event => event.operation === 'CREATE_DEFAULT_CHART_ACCOUNT')).toHaveSize(2);
  });

  it("posts Owner's Draw to Equity without changing Profit & Loss", () => {
    const checking = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const ownerDraw = app.listChartAccounts().find(item => item.id === DEFAULT_OWNER_DRAW_ACCOUNT_ID)!;
    const committed = app.commitImport(app.previewImport({
      fileName: 'owner-draw.csv', content: 'Date,Description,Amount\n2026-01-05,Owner withdrawal,-3000.00', kind: 'CSV', destinationAccountId: checking.id,
    }).previewToken);
    const transaction = app.listTransactions({ sourceBatchId: committed.batch.id }).items[0];
    app.categorize(transaction.id, ownerDraw.id);
    app.post([transaction.id]);

    expect(app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR').netProfitMinor).toBe(0n);
    const balanceSheet = app.getBalanceSheet({ asOfDate: '2026-12-31', includeZeroBalanceAccounts: false });
    expect(balanceSheet.rows.find(row => row.accountId === ownerDraw.id)).toEqual(jasmine.objectContaining({ section: 'EQUITY', amountMinor: -300_000n }));
    expect(balanceSheet.differenceMinor).toBe(0n);
  });

  it('imports, categorizes, posts, and reports an exact amount', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = app.previewImport({ fileName: 'sample.csv', content: 'Date,Description,Amount\n2026-02-01,Shipping Supplies,-25.00', kind: 'CSV', destinationAccountId: account.id });
    const committed = app.commitImport(preview.previewToken);
    const transactionId = committed.rows.find(row => row.status === 'ACCEPTED')!.transaction!.sourceRowNumber!;
    const transaction = app.listTransactions({ accountId: account.id }).items.find(item => item.sourceRowNumber === transactionId)!;
    const categorized = app.categorize(transaction.id, expense.id);
    expect(categorized.state).toBe('PENDING');
    expect(categorized.splits[0].chartAccountId).toBe(expense.id);
    const cleared = app.clearCategorization(transaction.id);
    expect(cleared.splits).toEqual([]);
    expect(cleared.categorizationSource).toBe('CLEARED');
    app.categorize(transaction.id, expense.id);
    app.post([transaction.id]);
    const report = app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR');
    expect(report.netProfitMinor).toBe(-2500n);
    expect(report.reconciliationDifferenceMinor).toBe(0n);
  });

  it('persists a cleared rule suggestion until the user selects a category again', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'clearable-rule', name: 'Clearable rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Suggested charge' }], chartAccountId: expense.id }]);
    const committed = app.commitImport(app.previewImport({ fileName: 'clear-rule.csv', content: 'Date,Description,Amount\n2026-02-01,Suggested charge,-25.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const transaction = app.listTransactions({ sourceBatchId: committed.batch.id }).items[0];
    expect(app.suggestTransaction(transaction.id).source).toBe('RULE');

    const cleared = app.clearCategorization(transaction.id);

    expect(cleared.categorizationSource).toBe('CLEARED');
    expect(cleared.splits).toEqual([]);
    expect(app.suggestTransaction(transaction.id).source).toBe('NONE');
    expect(app.suggestTransaction(transaction.id).chartAccountId).toBeUndefined();
    expect(app.getTransactionDetail(transaction.id).audit.at(-1)?.operation).toBe('CLEAR_TRANSACTION_CATEGORIZATION');
  });

  it('searches transaction amounts using signed, currency, decimal, and grouped formats', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const committed = app.commitImport(app.previewImport({
      fileName: 'amount-search.csv',
      kind: 'CSV',
      destinationAccountId: account.id,
      content: 'Date,Description,Amount\n2026-02-01,Positive deposit,40.00\n2026-02-02,Negative fee,-13.00\n2026-02-03,Large purchase,-1234.56',
    }).previewToken);
    const descriptions = (search: string) => app.listTransactions({ sourceBatchId: committed.batch.id, search }).items.map(transaction => transaction.description);

    expect(descriptions('$40.00')).toEqual(['Positive deposit']);
    expect(descriptions('+40.00')).toEqual(['Positive deposit']);
    expect(descriptions('-13.00')).toEqual(['Negative fee']);
    expect(descriptions('-$13.00')).toEqual(['Negative fee']);
    expect(descriptions('1,234.56')).toEqual(['Large purchase']);
    expect(descriptions('-$1,234.56')).toEqual(['Large purchase']);
  });

  it('commits valid rows when another row in the import batch has a zero amount', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const preview = app.previewImport({
      fileName: 'mixed-zero.csv',
      content: 'Date,Description,Amount\n2026-02-01,Rejected zero,0.00\n2026-02-02,Accepted expense,-25.00',
      kind: 'CSV',
      destinationAccountId: account.id,
    });
    expect(preview.batch.acceptedCount).toBe(1);
    expect(preview.batch.rejectedCount).toBe(1);
    expect(preview.rows.find(row => row.code === 'ZERO_AMOUNT')?.status).toBe('REJECTED');

    const committed = app.commitImport(preview.previewToken);
    const imported = app.listTransactions({ sourceBatchId: committed.batch.id }).items;
    expect(imported).toHaveSize(1);
    expect(imported[0].description).toBe('Accepted expense');
  });

  it('commits only transaction-table rows from a BofA-style CSV with summary data above the header', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const preview = app.previewImport({
      fileName: 'bofa-summary-preamble.csv',
      content: BOFA_SUMMARY_PREAMBLE_CSV,
      kind: 'CSV',
      destinationAccountId: account.id,
    });

    expect(preview.batch.acceptedCount).toBe(2);
    expect(preview.batch.rejectedCount).toBe(1);
    const committed = app.commitImport(preview.previewToken);
    const imported = app.listTransactions({ sourceBatchId: committed.batch.id, sort: 'DATE_ASC' }).items;
    expect(imported.map(transaction => transaction.description)).toEqual(['Office Supplies', 'Customer Deposit']);
    expect(imported.map(transaction => transaction.sourceRowNumber)).toEqual([9, 10]);
  });

  it('assigns the reviewed Amazon labels to their exact categories before broader Amazon rules', () => {
    const chart = app.importChartAccounts([
      'Account name,Account type',
      'Cost of goods sold,Cost of goods sold',
      'Cost of goods sold:Storage,Cost of goods sold',
      'Cost of goods sold:Storage:Amazon FBA Storage,Cost of goods sold',
      'Amazon AWD Storage,Cost of goods sold',
      'Amazon Income,Income',
      'Amazon Income:Amazon Shipping Credits,Income',
      'Amazon Selling Expenses,Expenses',
      'Amazon Selling Expenses:Amazon Selling Fees,Expenses',
      'Goodwill,Assets',
      'Advertising & marketing,Expenses',
      'Advertising & marketing:Amazon Advertising,Expenses',
    ].join('\n'));
    const categoryId = (name: string) => chart.find(category => category.name === name)!.id;
    app.importRules([
      { id: 'amazon-upstream-processing', name: 'AmazonUpstreamProcessingFee', enabled: true, priority: 1, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'AmazonUpstreamProcessingFee' }], chartAccountId: categoryId('Cost of goods sold:Storage:Amazon FBA Storage'), matchMode: 'ALL' },
      { id: 'amazon-upstream-storage', name: 'AmazonUpstreamStorageTransportationFee', enabled: true, priority: 2, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'AmazonUpstreamStorageTransportationFee' }], chartAccountId: categoryId('Cost of goods sold:Storage:Amazon FBA Storage'), matchMode: 'ALL' },
      { id: 'amazon-fba-long-term-storage', name: 'FBALongTermStorageFee', enabled: true, priority: 3, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'FBALongTermStorageFee' }], chartAccountId: categoryId('Cost of goods sold:Storage:Amazon FBA Storage'), matchMode: 'ALL' },
      { id: 'amazon-upstream-storage-promo', name: 'AmazonUpstreamStorageTransportationFeePromo', enabled: true, priority: 4, conditions: [{ field: 'DESCRIPTION', operator: 'EQUALS', value: 'AmazonUpstreamStorageTransportationFeePromo' }], chartAccountId: categoryId('Amazon AWD Storage'), matchMode: 'ALL' },
      { id: 'marketplace-liquidation', name: 'MarketplaceLiquidation', enabled: true, priority: 5, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: app.listAccounts().find(account => account.name === 'Marketplace')!.id }, { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'MarketplaceLiquidation' }], chartAccountId: categoryId('Amazon Selling Expenses:Amazon Selling Fees'), matchMode: 'ALL' },
      { id: 'amazon-goodwill', name: 'Goodwill', enabled: true, priority: 6, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'Goodwill' }], chartAccountId: categoryId('Goodwill'), matchMode: 'ALL' },
      { id: 'amazon-shipping-in', name: 'ShippingCharge', enabled: true, priority: 7, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'IN' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'ShippingCharge' }], chartAccountId: categoryId('Amazon Income:Amazon Shipping Credits'), matchMode: 'ALL' },
      { id: 'amazon-shipping-out', name: 'ShippingCharge out', enabled: true, priority: 8, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'EQUALS', value: 'ShippingCharge' }], chartAccountId: categoryId('Amazon Income:Amazon Shipping Credits'), matchMode: 'ALL' },
      { id: 'broad-amazon-advertising', name: 'PP Concerto 1', enabled: true, priority: 9, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Amazon' }], chartAccountId: categoryId('Advertising & marketing:Amazon Advertising'), matchMode: 'ALL' },
    ]);
    const amazon = app.listAccounts().find(account => account.name === 'Marketplace')!;
    const preview = app.previewImport({
      fileName: 'reviewed-amazon-labels.csv',
      content: [
        'Date,Description,Amount',
        '2026-01-31,AmazonUpstreamProcessingFee,-92.80',
        '2026-01-31,AmazonUpstreamStorageTransportationFee,-126.83',
        '2026-01-31,FBALongTermStorageFee,-0.35',
        '2026-01-31,AmazonUpstreamStorageTransportationFeePromo,1.02',
        '2026-01-31,AmazonUpstreamStorageTransportationFeePromo,-1.36',
        '2026-01-31,MarketplaceLiquidationReferralFee,-3.25',
        '2026-01-31,MarketplaceLiquidationProcessingFee,-14.50',
        '2026-01-31,Goodwill,-2.30',
        '2026-01-31,ShippingCharge,181.56',
        '2026-01-31,ShippingCharge,-2.25',
      ].join('\n'),
      kind: 'AMAZON',
      destinationAccountId: amazon.id,
    });
    const committed = app.commitImport(preview.previewToken);
    const transactions = app.listTransactions({ sourceBatchId: committed.batch.id }).items;
    const expected = new Map([
      ['AmazonUpstreamProcessingFee:OUT', 'Cost of goods sold:Storage:Amazon FBA Storage'],
      ['AmazonUpstreamStorageTransportationFee:OUT', 'Cost of goods sold:Storage:Amazon FBA Storage'],
      ['FBALongTermStorageFee:OUT', 'Cost of goods sold:Storage:Amazon FBA Storage'],
      ['AmazonUpstreamStorageTransportationFeePromo:IN', 'Amazon AWD Storage'],
      ['AmazonUpstreamStorageTransportationFeePromo:OUT', 'Amazon AWD Storage'],
      ['MarketplaceLiquidationReferralFee:OUT', 'Amazon Selling Expenses:Amazon Selling Fees'],
      ['MarketplaceLiquidationProcessingFee:OUT', 'Amazon Selling Expenses:Amazon Selling Fees'],
      ['Goodwill:OUT', 'Goodwill'],
      ['ShippingCharge:IN', 'Amazon Income:Amazon Shipping Credits'],
      ['ShippingCharge:OUT', 'Amazon Income:Amazon Shipping Credits'],
    ]);
    for (const transaction of transactions) {
      const direction = transaction.amount.minorUnits < 0n ? 'OUT' : 'IN';
      const suggestion = app.suggestTransaction(transaction.id);
      expect(suggestion.source).toBe('RULE');
      expect(chart.find(category => category.id === suggestion.chartAccountId)?.name).toBe(expected.get(`${transaction.description}:${direction}`));
    }
    const bank = app.listAccounts().find(account => account.name === 'Operating Checking')!;
    const nonAmazonBatch = app.commitImport(app.previewImport({ fileName: 'non-marketplace-liquidation.csv', content: 'Date,Description,Amount\n2026-01-31,MarketplaceLiquidationProcessingFee,-14.50', kind: 'CSV', destinationAccountId: bank.id }).previewToken).batch;
    const nonAmazonTransaction = app.listTransactions({ sourceBatchId: nonAmazonBatch.id }).items[0];
    expect(app.suggestTransaction(nonAmazonTransaction.id).ruleId).not.toBe('marketplace-liquidation');
  });

  it('allows a later actionable storage rule to win over an incomplete imported rule', () => {
    const chart = app.importChartAccounts('Account name,Account type\nCost of goods sold,Cost of goods sold\nCost of goods sold:Storage,Cost of goods sold');
    const storage = chart.find(category => category.name === 'Cost of goods sold:Storage')!;
    app.importRules([
      { id: 'categoryless-storage', name: 'Incomplete storage rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'EXAMPLE STOR' }], matchMode: 'ALL' },
      { id: 'example-storage', name: 'Example Storage', enabled: true, priority: 2, conditions: [{ field: 'DIRECTION', operator: 'EQUALS', value: 'OUT' }, { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'EXAMPLE STORAGE SAMPLE CITY' }], chartAccountId: storage.id, matchMode: 'ALL' },
    ]);
    const amex = app.listAccounts().find(account => account.name === 'Business Card')!;
    const committed = app.commitImport(app.previewImport({
      fileName: 'business-card-storage.qfx',
      content: '<STMTTRN><DTPOSTED>20260308</DTPOSTED><TRNAMT>-240.00</TRNAMT><NAME>EXAMPLE STORAGE SAMPLE CITY CA</NAME><FITID>storage-1</FITID></STMTTRN>',
      kind: 'QBO_OFX',
      destinationAccountId: amex.id,
    }).previewToken);
    const transaction = app.listTransactions({ sourceBatchId: committed.batch.id }).items[0];
    const suggestion = app.suggestTransaction(transaction.id);

    expect(suggestion.source).toBe('RULE');
    expect(suggestion.ruleId).toBe('example-storage');
    expect(suggestion.chartAccountId).toBe(storage.id);
  });

  it('scopes a two-condition software rule to the selected card account', () => {
    const chart = app.importChartAccounts('Account name,Account type\nOffice expenses,Expenses\nOffice expenses:Software & apps,Expenses');
    const software = chart.find(category => category.name === 'Office expenses:Software & apps')!;
    const amex = app.listAccounts().find(account => account.name === 'Business Card')!;
    const bofa = app.listAccounts().find(account => account.name === 'Operating Checking')!;
    app.importRules([{
      id: 'card-cloud-software',
      name: 'Cloud software service',
      enabled: true,
      priority: 1,
      conditions: [
        { field: 'ACCOUNT', operator: 'EQUALS', value: amex.id },
        { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'CLOUD SOFTWARE' },
        { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'INVOICEPORTAL' },
      ],
      chartAccountId: software.id,
      matchMode: 'ALL',
    }]);
    const amexBatch = app.commitImport(app.previewImport({
      fileName: 'business-card-software.qfx',
      content: '<STMTTRN><DTPOSTED>20260109</DTPOSTED><TRNAMT>-50.00</TRNAMT><NAME>CLOUD SOFTWARE INVOICEPORTAL</NAME><FITID>software-1</FITID></STMTTRN><STMTTRN><DTPOSTED>20260307</DTPOSTED><TRNAMT>-130.00</TRNAMT><NAME>CLOUD SOFTWARE SERVICE INVOICEPORTAL</NAME><FITID>software-2</FITID></STMTTRN>',
      kind: 'QBO_OFX',
      destinationAccountId: amex.id,
    }).previewToken);
    const bofaBatch = app.commitImport(app.previewImport({
      fileName: 'checking-software.csv',
      content: 'Date,Description,Amount\n2026-01-09,CLOUD SOFTWARE INVOICEPORTAL,-50.00',
      kind: 'CSV',
      destinationAccountId: bofa.id,
    }).previewToken);

    for (const transaction of app.listTransactions({ sourceBatchId: amexBatch.batch.id }).items) {
      const suggestion = app.suggestTransaction(transaction.id);
      expect(suggestion.source).toBe('RULE');
      expect(suggestion.chartAccountId).toBe(software.id);
    }
    const nonAmex = app.listTransactions({ sourceBatchId: bofaBatch.batch.id }).items[0];
    expect(app.suggestTransaction(nonAmex.id).source).toBe('NONE');
  });

  it('creates, edits, subaccounts, locks, and archives financial accounts while retaining stable history', () => {
    const account = app.createAccount({ type: 'ENTITY', detailType: 'Clearing account', name: 'Marketplace Clearing', institutionOrEntity: 'Example Marketplace', lastFour: '1234', description: 'Marketplace settlement clearing', openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01' });
    expect(app.listAccounts().find(item => item.id === account.id)?.archived).toBeFalse();
    const child = app.createAccount({ type: 'ENTITY', detailType: 'Marketplace', name: 'Marketplace Reserve', institutionOrEntity: 'Example Marketplace', parentAccountId: account.id, openingBalanceMinor: 1250n, openingBalanceDate: '2026-01-01' });
    const updated = app.updateAccount(child.id, { type: 'ENTITY', detailType: 'Marketplace', name: 'Marketplace Reserve', institutionOrEntity: 'Example Marketplace', lastFour: '4321', parentAccountId: account.id, description: 'Held reserve', openingBalanceMinor: 1500n, openingBalanceDate: '2026-01-02', locked: true });
    expect(updated).toEqual(jasmine.objectContaining({ id: child.id, name: 'Marketplace Reserve', detailType: 'Marketplace', parentAccountId: account.id, description: 'Held reserve', locked: true }));
    expect(app.getAccount(child.id)?.calculatedBalance?.minorUnits).toBe(1500n);
    expect(() => app.archiveAccount(child.id, true)).toThrowError(/Locked account/i);
    expect(() => app.updateAccount(account.id, { type: 'BANK', detailType: 'Checking', name: account.name, institutionOrEntity: 'BofA', openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01' })).toThrowError(/same account type/i);
    expect(() => app.updateAccount(account.id, { type: 'ENTITY', detailType: 'Clearing account', name: account.name, institutionOrEntity: 'Example Marketplace', parentAccountId: child.id, openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01' })).toThrowError(/cycle/i);
    app.updateAccount(child.id, { type: 'ENTITY', detailType: 'Marketplace', name: 'Marketplace Reserve', institutionOrEntity: 'Example Marketplace', parentAccountId: account.id, openingBalanceMinor: 1500n, openingBalanceDate: '2026-01-02', locked: false });
    app.archiveAccount(child.id, true);
    expect(app.getAccount(child.id)?.archived).toBeTrue();
    expect(() => app.previewImport({ fileName: 'blocked.csv', content: 'Date,Description,Amount\n2026-01-01,Blocked,-1', kind: 'CSV', destinationAccountId: account.id })).not.toThrow();
    app.archiveAccount(account.id, true);
    expect(app.listAccounts().find(item => item.id === account.id)?.archived).toBeTrue();
    expect(() => app.previewImport({ fileName: 'blocked.csv', content: 'Date,Description,Amount\n2026-01-01,Blocked,-1', kind: 'CSV', destinationAccountId: account.id })).toThrowError(/archived/i);
    app.archiveAccount(account.id, false);
    expect(app.listAccounts().find(item => item.id === account.id)?.archived).toBeFalse();
    expect(app.listAccounts().find(item => item.id === account.id)?.lastFour).toBe('1234');
    const exported = JSON.parse(app.exportAllData()) as { audit: Array<{ operation: string; entityId: string }> };
    expect(exported.audit.some(event => event.operation === 'UPDATE_ACCOUNT' && event.entityId === child.id)).toBeTrue();
  });

  it('rejects stale edits without changing the transaction', () => {
    const account = app.listAccounts()[0];
    const preview = app.previewImport({ fileName: 'stale.csv', content: 'Date,Description,Amount\n2026-06-01,Stale test,-1.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transaction = app.listTransactions({ accountId: account.id }).items[0];
    expect(() => app.updateTransaction(transaction.id, { expectedModifiedAtUtc: 'old', description: 'Must not save' })).toThrowError(/changed/i);
    expect(app.getTransaction(transaction.id)?.description).toBe('Stale test');
  });

  it('bulk-categorizes atomically and records posted amount corrections', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const first = app.commitImport(app.previewImport({ fileName: 'bulk-1.csv', content: 'Date,Description,Amount\n2026-06-02,Bulk one,-1.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    app.commitImport(app.previewImport({ fileName: 'bulk-2.csv', content: 'Date,Description,Amount\n2026-06-03,Bulk two,-2.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const transactions = app.listTransactions({ accountId: account.id }).items;
    expect(app.categorizeMany(transactions.map(item => item.id), expense.id)).toHaveSize(2);
    app.post(transactions.map(item => item.id));
    const corrected = app.correctAmount(transactions[0].id, -150n, 'Vendor receipt correction');
    expect(corrected.amount.minorUnits).toBe(-150n);
    expect(corrected.splits[0].amount.minorUnits).toBe(-150n);
    expect(app.getExceptions('2026-01-01', '2026-12-31').some(item => item.kind === 'EDITED_AFTER_POSTING')).toBeTrue();
    expect(first.batch.acceptedCount).toBe(1);
  });

  it('rejects unbalanced splits without posting', () => {
    const account = app.listAccounts()[0];
    const preview = app.previewImport({ fileName: 'sample.csv', content: 'Date,Description,Amount\n2026-02-01,One line,-25.00', kind: 'CSV', destinationAccountId: account.id });
    const committed = app.commitImport(preview.previewToken);
    const id = app.listTransactions({ accountId: account.id }).items[0].id;
    const chart = app.listChartAccounts()[0];
    expect(() => app.split(id, [{ chartAccountId: chart.id, amountMinor: -2400n }])).toThrowError(/Split total/);
    expect(app.getTransaction(id)?.splits.length).toBe(0);
    expect(() => app.post([id])).toThrowError(/requires at least one split/);
    expect(committed.batch.acceptedCount).toBe(1);
  });

  it('rejects an invalid bulk selection without changing valid selected items', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = app.previewImport({ fileName: 'bulk-invalid.csv', content: 'Date,Description,Amount\n2026-02-10,Bulk guard,-1.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transaction = app.listTransactions({ accountId: account.id }).items[0];
    expect(() => app.categorizeMany([transaction.id, 'missing-id'], expense.id)).toThrowError(/not found/i);
    expect(app.getTransaction(transaction.id)?.splits).toHaveSize(0);
  });

  it('permanently deletes only excluded transactions and their transaction audit history', () => {
    const account = app.listAccounts()[0];
    const preview = app.previewImport({ fileName: 'delete-excluded.csv', content: 'Date,Description,Amount\n2026-02-10,Delete me,-1.00\n2026-02-11,Keep me,-2.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const [remove, retain] = app.listTransactions({ accountId: account.id, sort: 'DATE_ASC' }).items;
    app.exclude([remove.id], 'Fixture deletion');
    app.deleteExcluded([remove.id]);
    expect(app.getTransaction(remove.id)).toBeUndefined();
    expect(app.getTransaction(retain.id)).toBeTruthy();
    expect(JSON.parse(app.exportAllData()).audit.filter((event: { entityType: string; entityId: string }) => event.entityType === 'Transaction' && event.entityId === remove.id)).toHaveSize(0);
    expect(() => app.deleteExcluded([retain.id])).toThrowError(/Only Excluded/);
    expect(app.getTransaction(retain.id)).toBeTruthy();
  });

  it('retires Amazon Duplicate Summary Payments so matching transactions need an explicit category before posting', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'duplicate-summary', name: 'Amazon Duplicate Summary Payments', enabled: true, priority: 5, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Amazon Payments Summary' }], chartAccountId: expense.id }]);
    expect(app.listRules()).toHaveSize(0);
    const preview = app.previewImport({ fileName: 'amazon-summary.csv', content: 'Date,Description,Amount\n2026-02-10,Amazon Payments Summary,-1.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transaction = app.listTransactions({ accountId: account.id }).items[0];
    expect(app.suggestTransaction(transaction.id).source).toBe('NONE');
    expect(() => app.post([transaction.id])).toThrowError(/requires at least one split/i);
    app.postWithCategory(transaction.id, expense.id);
    expect(app.getTransaction(transaction.id)?.state).toBe('POSTED');
  });

  it('posts a categorized Pending selection atomically', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = app.previewImport({ fileName: 'batch-post.csv', content: 'Date,Description,Amount\n2026-02-10,First,-1.00\n2026-02-11,Second,-2.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transactions = app.listTransactions({ accountId: account.id, sort: 'DATE_ASC' }).items;
    app.postWithCategories(transactions.map(transaction => ({ id: transaction.id, chartAccountId: expense.id })));
    expect(app.listTransactions({ accountId: account.id, states: ['POSTED'] }).total).toBe(2);
  });

  it('matches a bank/card movement without changing profit', () => {
    const bank = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const card = app.listAccounts().find(item => item.name === 'Business Card')!;
    const first = app.commitImport(app.previewImport({ fileName: 'bank.csv', content: 'Date,Description,Amount\n2026-03-01,Amex Payment,-100.00', kind: 'CSV', destinationAccountId: bank.id }).previewToken);
    app.commitImport(app.previewImport({ fileName: 'card.csv', content: 'Date,Description,Amount\n2026-03-01,Payment Received,100.00', kind: 'CSV', destinationAccountId: card.id }).previewToken);
    const left = app.listTransactions({ accountId: bank.id }).items.find(item => item.sourceBatchId === first.batch.id)!;
    const right = app.listTransactions({ accountId: card.id }).items[0];
    const match = app.confirmTransfer(left.id, right.id);
    expect(match.id).toBeTruthy();
    expect(app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR').netProfitMinor).toBe(0n);
    app.unmatchTransfer(match.id);
    expect(app.getTransaction(left.id)?.state).toBe('PENDING');
  });

  it('round-trips rules through the documented exchange format and rejects an invalid replacement without changing rules', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'exchange-rule', name: 'Exchange rule', enabled: true, priority: 1, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: account.id }, { field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Vendor' }], chartAccountId: expense.id }]);
    const exported = app.exportRules('XLSX') as ArrayBuffer;
    const workbook = XLSX.read(exported, { type: 'array' });
    const exportedRow = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })[0];
    expect(JSON.parse(exportedRow['Conditions JSON'])).toContain(jasmine.objectContaining({
      field: 'ACCOUNT', value: account.name,
    }));
    expect(exportedRow['Conditions JSON']).not.toContain(account.id);

    const preview = app.previewRulesImport(exported);
    expect(preview.valid).toBeTrue();
    expect(preview.updatedCount).toBe(1);
    expect(preview.issues.filter(issue => issue.code === 'RULE_ACCOUNT_REMAPPED_BY_NAME')).toHaveSize(0);
    app.commitRulesImport(preview.previewToken);
    expect(app.listRules()).toEqual(jasmine.objectContaining([jasmine.objectContaining({ id: 'exchange-rule', chartAccountId: expense.id })]));
    expect(app.listRules()[0].conditions.find(condition => condition.field === 'ACCOUNT')?.value).toBe(account.id);

    const CSV = app.exportRules('CSV') as string;
    expect(CSV).toContain('Chart Account ID,Chart Account Name');
    expect(CSV).toContain(`${expense.id},Operating Expenses`);

    const invalid = app.previewRulesImport('Rule ID,Rule Name,Enabled,Priority,Match Mode,Conditions JSON,Chart Account ID,Tags JSON,Suggest Exclude\nbad,Bad,TRUE,1,ALL,[],[],[],FALSE');
    expect(invalid.valid).toBeFalse();
    expect(() => app.commitRulesImport(invalid.previewToken)).toThrowError(/Correct every rule-import error/);
    expect(app.listRules()).toEqual(jasmine.objectContaining([jasmine.objectContaining({ id: 'exchange-rule' })]));
  });

  it('remaps an imported ACCOUNT condition to the unique active financial account with the exported identity', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const original = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'portable-account-rule', name: 'Portable account rule', enabled: true, priority: 1, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: original.id }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;

    repository.accounts.delete(original.id);
    repository.accounts.set('replacement-operating-checking', { ...original, id: 'replacement-operating-checking' });
    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeTrue();
    expect(preview.issues.filter(issue => issue.code === 'RULE_ACCOUNT_REMAPPED_BY_NAME')).toHaveSize(0);
    expect(preview.rules[0].conditions[0].value).toBe('replacement-operating-checking');
    app.commitRulesImport(preview.previewToken);
    expect(app.listRules()[0].conditions[0].value).toBe('replacement-operating-checking');
  });

  it('blocks a rule import when an ACCOUNT condition cannot be resolved', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const original = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'missing-account-rule', name: 'Missing account rule', enabled: true, priority: 1, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: original.id }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;
    repository.accounts.delete(original.id);

    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeFalse();
    expect(preview.issues).toContain(jasmine.objectContaining({
      severity: 'ERROR', code: 'RULE_ACCOUNT_NOT_FOUND', rowNumber: 2,
      message: jasmine.stringContaining('bank/card/source account, not a Chart of Accounts category'),
    }));
    expect(preview.issues.find(issue => issue.code === 'RULE_ACCOUNT_NOT_FOUND')?.message).toContain('Rule “Missing account rule”');
    expect(preview.issues.find(issue => issue.code === 'RULE_ACCOUNT_NOT_FOUND')?.message).toContain('The file says the source account is “Operating Checking”');
    expect(() => app.commitRulesImport(preview.previewToken)).toThrowError(/Correct every rule-import error/);
  });

  it('blocks a rule import when exported ACCOUNT identity matches multiple active accounts', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const original = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'ambiguous-account-rule', name: 'Ambiguous account rule', enabled: true, priority: 1, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: original.id }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;
    repository.accounts.delete(original.id);
    repository.accounts.set('replacement-checking-one', { ...original, id: 'replacement-checking-one' });
    repository.accounts.set('replacement-checking-two', { ...original, id: 'replacement-checking-two' });

    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeFalse();
    expect(preview.issues).toContain(jasmine.objectContaining({ severity: 'ERROR', code: 'RULE_ACCOUNT_AMBIGUOUS', rowNumber: 2 }));
  });

  it('remaps an imported rule category to the unique active chart account with the exported name', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'portable-category-rule', name: 'Portable category rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Vendor' }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;

    repository.chartAccounts.delete(expense.id);
    repository.chartAccounts.set('replacement-operating-expenses', { ...expense, id: 'replacement-operating-expenses' });
    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeTrue();
    expect(preview.issues).toContain(jasmine.objectContaining({ severity: 'WARNING', code: 'RULE_CHART_ACCOUNT_REMAPPED_BY_NAME', rowNumber: 2 }));
    expect(preview.rules[0].chartAccountId).toBe('replacement-operating-expenses');
    app.commitRulesImport(preview.previewToken);
    expect(app.listRules()[0].chartAccountId).toBe('replacement-operating-expenses');
  });

  it('blocks a rule import when its exported category name cannot be resolved', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'missing-category-rule', name: 'Missing category rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Vendor' }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;
    repository.chartAccounts.delete(expense.id);

    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeFalse();
    expect(preview.issues).toContain(jasmine.objectContaining({ severity: 'ERROR', code: 'RULE_CHART_ACCOUNT_NOT_FOUND', rowNumber: 2 }));
  });

  it('blocks a rule import when its exported category name is ambiguous', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    app.importRules([{ id: 'ambiguous-category-rule', name: 'Ambiguous category rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'Vendor' }], chartAccountId: expense.id }]);
    const exported = app.exportRules('CSV') as string;
    repository.chartAccounts.delete(expense.id);
    repository.chartAccounts.set('replacement-operating-expenses-one', { ...expense, id: 'replacement-operating-expenses-one' });
    repository.chartAccounts.set('replacement-operating-expenses-two', { ...expense, id: 'replacement-operating-expenses-two' });

    const preview = app.previewRulesImport(exported);

    expect(preview.valid).toBeFalse();
    expect(preview.issues).toContain(jasmine.objectContaining({ severity: 'ERROR', code: 'RULE_CHART_ACCOUNT_AMBIGUOUS', rowNumber: 2 }));
  });

  it('unmatches the counterpart when a matched transfer is excluded, so a reimport can match it again', () => {
    const bank = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const card = app.listAccounts().find(item => item.name === 'Business Card')!;
    const first = app.commitImport(app.previewImport({ fileName: 'bank-payment.csv', content: 'Date,Description,Amount\n2026-03-01,AMERICAN EXPRESS ACH PMT,-100.00', kind: 'CSV', destinationAccountId: bank.id }).previewToken);
    app.commitImport(app.previewImport({ fileName: 'card-payment.qfx', content: 'Date,Description,Amount\n2026-03-01,AUTOPAY PAYMENT THANK YOU,100.00', kind: 'CSV', destinationAccountId: card.id }).previewToken);
    const left = app.listTransactions({ accountId: bank.id }).items.find(item => item.sourceBatchId === first.batch.id)!;
    const right = app.listTransactions({ accountId: card.id }).items[0];
    app.confirmTransfer(left.id, right.id);

    app.exclude([right.id], 'Replacing this imported payment');
    app.deleteExcluded([right.id]);

    expect(app.getTransaction(left.id)?.state).toBe('PENDING');
    expect(app.getTransaction(left.id)?.transferMatchId).toBeUndefined();
    const replacementBatch = app.commitImport(app.previewImport({ fileName: 'card-payment-reimport.qfx', content: 'Date,Description,Amount\n2026-03-01,AUTOPAY PAYMENT THANK YOU,100.00', kind: 'CSV', destinationAccountId: card.id }).previewToken).batch;
    const replacement = app.listTransactions({ accountId: card.id, states: ['PENDING'] }).items.find(item => item.sourceBatchId === replacementBatch.id)!;
    expect(app.suggestTransaction(replacement.id)).toEqual(jasmine.objectContaining({ source: 'TRANSFER', transferCandidateId: left.id }));
  });

  it('returns deterministic prior-match suggestions and creates disabled learned rules', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const firstPreview = app.previewImport({ fileName: 'prior-1.csv', content: 'Date,Description,Amount\n2026-01-10,Recurring Vendor,-12.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(firstPreview.previewToken);
    const first = app.listTransactions({ accountId: account.id }).items[0];
    app.categorize(first.id, expense.id);
    app.post([first.id]);
    const secondPreview = app.previewImport({ fileName: 'prior-2.csv', content: 'Date,Description,Amount\n2026-02-10,Recurring Vendor,-12.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(secondPreview.previewToken);
    const second = app.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    expect(app.suggestTransaction(second.id)).toEqual(jasmine.objectContaining({
      source: 'PRIOR_MATCH',
      rationale: 'A prior confirmed transaction used the same description and direction.',
    }));
    const learned = app.createRuleFromTransaction(second.id, expense.id);
    expect(learned.enabled).toBeFalse();
    expect(learned.conditions).toHaveSize(2);
    const duplicate = app.duplicateRule(learned.id);
    expect(duplicate.enabled).toBeFalse();
    app.setRuleEnabled(duplicate.id, true);
    expect(app.listRules().find(rule => rule.id === duplicate.id)?.enabled).toBeTrue();
    app.reorderRule(duplicate.id, 1);
    expect(app.listRules()[0].id).toBe(duplicate.id);
  });

  it('builds populated unsaved rule drafts and audits create, edit, copy, enable, and delete', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const batch = app.commitImport(app.previewImport({
      fileName: 'rule-editor.csv',
      content: 'Date,Description,Payee,Amount\n2026-03-12,ACME SOFTWARE MONTHLY,Acme Software,-49.00',
      kind: 'CSV',
      destinationAccountId: account.id,
    }).previewToken).batch;
    const transaction = app.listTransactions({ sourceBatchId: batch.id, states: ['PENDING'] }).items[0];

    const draft = app.createRuleDraftFromTransaction(transaction.id, expense.id);

    expect(draft.id).toBe('');
    expect(draft.enabled).toBeTrue();
    expect(draft.chartAccountId).toBe(expense.id);
    expect(draft.conditions).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ field: 'ACCOUNT', value: account.id }),
      jasmine.objectContaining({ field: 'DIRECTION', value: 'OUT' }),
      jasmine.objectContaining({ field: 'PAYEE', value: 'Acme Software' }),
    ]));
    expect(app.listRules().some(rule => rule.name === draft.name)).toBeFalse();
    expect(app.testRule(draft, [transaction.id])[0].matched).toBeTrue();

    const saved = app.saveRule({ ...draft, name: 'Acme monthly software', priority: 1 });
    expect(app.suggestTransaction(transaction.id)).toEqual(jasmine.objectContaining({ source: 'RULE', ruleId: saved.id, chartAccountId: expense.id }));
    const edited = app.saveRule({ ...saved, name: 'Acme software', memo: 'Monthly subscription', priority: 2 });
    expect(edited.name).toBe('Acme software');
    expect(app.listRules().find(rule => rule.id === saved.id)?.memo).toBe('Monthly subscription');

    const copy = app.duplicateRule(saved.id);
    expect(copy.id).not.toBe(saved.id);
    expect(copy.enabled).toBeFalse();
    app.setRuleEnabled(copy.id, true);
    expect(app.listRules().find(rule => rule.id === copy.id)?.enabled).toBeTrue();

    app.deleteRule(saved.id);
    expect(app.listRules().some(rule => rule.id === saved.id)).toBeFalse();
    expect(app.listRules().map(rule => rule.priority).sort((a, b) => a - b)).toEqual(app.listRules().map((_, index) => index + 1));
    const audit = JSON.parse(app.exportAllData()).audit as Array<{ operation: string; entityId: string }>;
    expect(audit).toEqual(jasmine.arrayContaining([jasmine.objectContaining({ operation: 'DELETE_RULE', entityId: saved.id })]));
  });

  it('round-trips the portable data export and restores records', () => {
    const account = app.listAccounts()[0];
    const preview = app.previewImport({ fileName: 'backup-source.csv', content: 'Date,Description,Amount\n2026-04-01,Backup fixture,-7.25', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const payload = app.exportAllData();
    expect(payload).toContain('backup-source.csv');
    const portable = JSON.parse(payload) as { companyProfile?: { legalName?: string }; accounts: Array<{ accountType?: string; classificationStatus?: string }> };
    expect(portable.companyProfile?.legalName).toBe('Example Outfitters LLC');
    expect(portable.accounts.every(item => Boolean(item.accountType) && Boolean(item.classificationStatus))).toBeTrue();
    app.importAllData(payload);
    expect(app.listTransactions({ accountId: account.id }).total).toBe(1);
  });

  it('rejects malformed current-schema classification imports before mutating repository state', () => {
    const snapshot = () => { const value = JSON.parse(app.exportAllData()) as any; delete value.exportedAtUtc; return JSON.stringify(value); };
    const baseline = snapshot();
    const payload = JSON.parse(app.exportAllData()) as any;
    const classifications = payload.cashFlowClassifications as any[];
    expect(classifications.length).toBe(payload.accounts.length + payload.chartAccounts.length);

    const malformed: Array<[string, (copy: any) => void]> = [
      ['missing classifications', copy => { copy.cashFlowClassifications = classifications.slice(0, -1); }],
      ['duplicate classification', copy => { copy.cashFlowClassifications = [...classifications, structuredClone(classifications[0])]; }],
      ['orphan classification', copy => { copy.cashFlowClassifications = [...classifications, { ...classifications[0], accountId: 'missing-account' }]; }],
      ['incompatible financial structure', copy => { copy.accounts[0].accountType = 'EXPENSE'; copy.accounts[0].detailType = 'Advertising'; }],
      ['stale account type', copy => { copy.cashFlowClassifications[0].accountType = 'EXPENSE'; }],
      ['invalid timestamp', copy => { copy.cashFlowClassifications[0].modifiedAtUtc = 'not-a-date'; }],
      ['invalid treatment', copy => { copy.cashFlowClassifications[0].treatment = 'NOT_A_TREATMENT'; }],
    ];
    malformed.forEach(([label, mutate]) => {
      const copy = structuredClone(payload);
      mutate(copy);
      expect(() => app.importAllData(JSON.stringify(copy))).withContext(label).toThrow();
      expect(snapshot()).withContext(`${label} changed state`).toBe(baseline);
    });
  });

  it('rejects future portable schemas and mismatched bundled schemas without mutation', () => {
    const snapshot = () => { const value = JSON.parse(app.exportAllData()) as any; delete value.exportedAtUtc; return JSON.stringify(value); };
    const baseline = snapshot();
    const payload = JSON.parse(app.exportAllData()) as any;
    payload.schemaVersion = CURRENT_SQLITE_SCHEMA_VERSION + 1;
    expect(() => app.importAllData(JSON.stringify(payload))).toThrowError(/Unsupported portable schema version/);
    expect(snapshot()).toBe(baseline);

    const bundles = TestBed.inject(BackupBundleService);
    const mismatched = bundles.create(JSON.stringify({ ...JSON.parse(baseline), schemaVersion: CURRENT_SQLITE_SCHEMA_VERSION - 1 }), CURRENT_SQLITE_SCHEMA_VERSION, { companyId: app.getCompany().id });
    expect(app.verifyBackupBundle(mismatched)).toEqual(jasmine.objectContaining({ valid: false }));
    expect(() => app.restoreBackupBundle(mismatched)).toThrowError(/schema versions do not match/);
    expect(snapshot()).toBe(baseline);

    const futureBundle = bundles.create(baseline, CURRENT_SQLITE_SCHEMA_VERSION + 1, { companyId: app.getCompany().id });
    expect(app.verifyBackupBundle(futureBundle)).toEqual(jasmine.objectContaining({ valid: false }));
    expect(() => app.restoreBackupBundle(futureBundle)).toThrow();
    expect(snapshot()).toBe(baseline);
  });

  it('preserves user and migrated Cash Flow classifications and audit history across ordinary writes', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    const chart = app.listChartAccounts().find(item => item.name === 'Advertising and Marketing')!;
    const userReview = app.saveCashFlowClassification({
      accountRole: 'CHART', accountId: chart.id, treatment: 'EXCLUDED', userRationale: 'Keep this advertising activity outside the statement.',
    });
    const userBefore = repository.getCashFlowClassification('CHART', chart.id)!;
    const migratedChart = app.listChartAccounts().find(item => item.name === 'Other Expense')!;
    const migratedBefore = repository.getCashFlowClassification('CHART', migratedChart.id)!;
    repository.saveCashFlowClassifications([{ ...migratedBefore, source: 'MIGRATED', rationale: 'Migrated from the prior schema.', modifiedAtUtc: '2026-01-02T00:00:00.000Z' }]);
    const auditBefore = repository.audit.length;

    app.saveTaxYearSettings(app.getTaxYearSettings(2026));

    expect(repository.getCashFlowClassification('CHART', chart.id)).toEqual(userBefore);
    expect(repository.getCashFlowClassification('CHART', migratedChart.id)).toEqual(jasmine.objectContaining({ source: 'MIGRATED', rationale: 'Migrated from the prior schema.', modifiedAtUtc: '2026-01-02T00:00:00.000Z' }));
    expect(repository.audit.length).toBeGreaterThan(auditBefore);
    expect(userReview.saveImpact?.classification).toEqual(userBefore);
  });

  it('commits a Chart replacement with explicit Cash Flow classifications in one transaction', () => {
    const repository = TestBed.inject(InMemoryAccountingRepository);
    repository.rules.clear();
    const imported = app.importChartAccounts([
      'Account ID,Account Name,Account Type,Detail Type,Cash Flow Treatment,Cash Flow Status,Cash Flow Source,Cash Flow Rationale',
      'explicit-chart,Explicit expense,Expenses,Other business expenses,OPERATING_REVENUE_EXPENSE,CONFIRMED,USER,Explicit classification for the imported chart account.',
    ].join('\n'));
    expect(imported).toEqual([jasmine.objectContaining({ id: 'explicit-chart', name: 'Explicit expense' })]);
    expect(repository.getCashFlowClassification('CHART', 'explicit-chart')).toEqual(jasmine.objectContaining({
      treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'USER',
      rationale: 'Explicit classification for the imported chart account.',
    }));
    expect(repository.audit.some(event => event.operation === 'IMPORT_CHART')).toBeTrue();
    expect(repository.audit.some(event => event.operation === 'SAVE_CASH_FLOW_CLASSIFICATION' && event.entityId === 'explicit-chart')).toBeTrue();
  });

  it('keeps tax treatment report-only with federal excluded by default', () => {
    const account = app.listAccounts()[0];
    const federal = app.listChartAccounts().find(item => item.name === 'Federal Income Tax')!;
    const state = app.listChartAccounts().find(item => item.name === 'State and Local Income Tax')!;
    const federalPreview = app.previewImport({ fileName: 'federal.csv', content: 'Date,Description,Amount\n2026-05-01,Federal Tax,-100.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(federalPreview.previewToken);
    const statePreview = app.previewImport({ fileName: 'state.csv', content: 'Date,Description,Amount\n2026-05-02,State Tax,-50.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(statePreview.previewToken);
    const transactions = app.listTransactions({ accountId: account.id }).items;
    app.categorize(transactions.find(item => item.description === 'Federal Tax')!.id, federal.id);
    app.categorize(transactions.find(item => item.description === 'State Tax')!.id, state.id);
    app.post(transactions.map(item => item.id));
    const report = app.getScheduleCReadyReport('2026-01-01', '2026-12-31', 'YEAR');
    expect(report.includeFederalIncomeTax).toBeFalse();
    expect(report.includeStateLocalIncomeTax).toBeTrue();
    expect(report.removedFederalMinor).toBe(10000n);
    expect(report.removedTotalMinor).toBe(10000n);
    expect(app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR').netProfitMinor).toBe(-15000n);

    const settings = app.getTaxYearSettings(2026);
    app.saveTaxYearSettings({ ...settings, includeFederalIncomeTax: false, includeStateLocalIncomeTax: false });
    const bothExcluded = app.getScheduleCReadyReport('2026-01-01', '2026-12-31', 'YEAR');
    expect(bothExcluded.removedFederalMinor).toBe(10000n);
    expect(bothExcluded.removedStateLocalMinor).toBe(5000n);
    expect(bothExcluded.removedTotalMinor).toBe(15000n);
    expect(bothExcluded.netProfitMinor).toBe(0n);
  });

  it('verifies backup bundles and emits report exports', () => {
    const bundle = app.createBackupBundle();
    expect(JSON.parse(bundle).schemaVersion).toBe(CURRENT_SQLITE_SCHEMA_VERSION);
    expect(app.verifyBackupBundle(bundle).valid).toBeTrue();
    expect(app.validateBackupBundle(bundle).valid).toBeTrue();
    expect(app.validateBackupBundle(bundle).recordCounts?.['accounts']).toBe(5);
    expect(app.verifyBackupBundle(bundle.replace('dataHash', 'tamperedHash')).valid).toBeFalse();
    const report = app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR');
    const summaryCsv = app.exportReportCsv(report);
    expect(summaryCsv).toContain('Section,Category,Period,Amount USD');
    expect(summaryCsv).toContain('Net Profit');
    expect(summaryCsv).not.toContain(',"2026",');
    const summaryXlsx = app.exportReportXlsx(report);
    expect(summaryXlsx.byteLength).toBeGreaterThan(0);
    const summaryWorkbook = XLSX.read(summaryXlsx, { type: 'array' });
    const summaryMatrix = XLSX.utils.sheet_to_json<Array<string | number>>(summaryWorkbook.Sheets['P&L Summary'], { header: 1 });
    expect(summaryMatrix[0]).toEqual(['Profit and Loss', 'Total']);
    const printHtml = app.exportReportPrintHtml(report);
    expect(printHtml).toContain('<table>');
    expect(printHtml).not.toContain('<th>2026</th>');
    expect(app.exportReportDetailCsv('2026-01-01', '2026-12-31')).toContain('Transaction ID');
    expect(app.exportReportDetailXlsx('2026-01-01', '2026-12-31').byteLength).toBeGreaterThan(0);
  });

  it('reconciles report detail and produces an accountant package manifest', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = app.previewImport({ fileName: 'detail.csv', content: 'Date,Description,Amount\n2026-07-01,Detail line,-10.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transaction = app.listTransactions({ accountId: account.id }).items[0];
    app.categorize(transaction.id, expense.id);
    app.post([transaction.id]);
    const detail = app.getReportDetail('2026-01-01', '2026-12-31');
    expect(detail.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(1000n);
    expect(app.getReconciliation(account.id, '2026-01-01', '2026-12-31', -1000n).differenceMinor).toBe(0n);
    const packageText = app.exportAccountantPackage('2026-01-01', '2026-12-31');
    expect(packageText).toContain('unadjustedProfitLoss');
    expect(packageText).toContain('scheduleCReady');
    expect(packageText).toContain('exceptions');
  });

  it('reconciles every P/L section and synthetic total to selection-aware detail and matching exports', () => {
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const categories = Object.fromEntries(app.listChartAccounts().map(item => [item.name, item]));
    const source = [
      'Date,Description,Amount',
      '2026-01-03,January income,100.00',
      '2026-01-04,January COGS,-30.00',
      '2026-01-05,January operating expense,-20.00',
      '2026-01-06,January other income,5.00',
      '2026-01-07,January other expense,-3.00',
      '2026-02-03,February income,50.00',
      '2026-02-04,February COGS,-10.00',
      '2026-02-05,February operating expense,-5.00',
    ].join('\n');
    const committed = app.commitImport(app.previewImport({ fileName: 'complete-profit-loss.csv', content: source, kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const categoryByDescription: Record<string, string> = {
      'January income': categories['Online Sales'].id,
      'January COGS': categories['Cost of Goods Sold'].id,
      'January operating expense': categories['Operating Expenses'].id,
      'January other income': categories['Other Income'].id,
      'January other expense': categories['Other Expense'].id,
      'February income': categories['Online Sales'].id,
      'February COGS': categories['Cost of Goods Sold'].id,
      'February operating expense': categories['Operating Expenses'].id,
    };
    const transactions = app.listTransactions({ sourceBatchId: committed.batch.id, pageSize: 100 }).items;
    transactions.forEach(transaction => app.categorize(transaction.id, categoryByDescription[transaction.description]));
    app.post(transactions.map(transaction => transaction.id));

    const report = app.getProfitLoss('2026-01-01', '2026-02-28', 'MONTH');
    const expectedSelections: Array<{ sectionKey: 'INCOME' | 'COGS' | 'GROSS_PROFIT' | 'EXPENSES' | 'OTHER_INCOME' | 'OTHER_EXPENSE' | 'NET_PROFIT'; period: string; expected: bigint }> = [
      { sectionKey: 'INCOME', period: '2026-01', expected: 10000n },
      { sectionKey: 'COGS', period: '2026-01', expected: 3000n },
      { sectionKey: 'GROSS_PROFIT', period: '2026-01', expected: 7000n },
      { sectionKey: 'EXPENSES', period: '2026-01', expected: 2000n },
      { sectionKey: 'OTHER_INCOME', period: '2026-01', expected: 500n },
      { sectionKey: 'OTHER_EXPENSE', period: '2026-01', expected: 300n },
      { sectionKey: 'NET_PROFIT', period: '2026-01', expected: 5200n },
      { sectionKey: 'NET_PROFIT', period: '2026-02', expected: 3500n },
    ];
    expectedSelections.forEach(selection => {
      const detail = app.getProfitLossDrilldown({ startDate: report.startDate, endDate: report.endDate, grouping: report.grouping, ...selection });
      expect(detail.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).withContext(`${selection.sectionKey} ${selection.period}`).toBe(selection.expected);
    });
    const cogsDetail = app.getProfitLossDrilldown({ startDate: report.startDate, endDate: report.endDate, grouping: report.grouping, period: '2026-01', chartAccountId: categories['Cost of Goods Sold'].id });
    expect(cogsDetail.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).toBe(3000n);
    expect(cogsDetail[0].amountMinor).toBe(3000n);
    const allDetail = app.getProfitLossDrilldown({ startDate: report.startDate, endDate: report.endDate, grouping: report.grouping });
    expect(allDetail.reduce((sum, row) => sum + row.reportContributionMinor, 0n)).toBe(report.netProfitMinor);
    expect(report.netProfitMinor).toBe(8700n);
    const filteredDetail = app.getProfitLossDrilldown({ startDate: report.startDate, endDate: report.endDate, grouping: report.grouping, sectionKey: 'NET_PROFIT', accountId: account.id, search: 'January COGS' });
    expect(filteredDetail).toHaveSize(1);
    expect(filteredDetail[0].reportContributionMinor).toBe(-3000n);

    const januaryNetQuery = { startDate: report.startDate, endDate: report.endDate, grouping: report.grouping, period: '2026-01', sectionKey: 'NET_PROFIT' as const };
    const detailCsv = app.exportProfitLossDrilldownCsv(januaryNetQuery);
    expect(detailCsv).toContain('P/L Contribution USD');
    expect(detailCsv).toContain('January COGS');
    expect(detailCsv).not.toContain('February income');
    expect(detailCsv).toContain('"-30.00"');
    const detailWorkbook = XLSX.read(app.exportProfitLossDrilldownXlsx(januaryNetQuery), { type: 'array' });
    const exportedDetail = XLSX.utils.sheet_to_json<Record<string, string | number>>(detailWorkbook.Sheets['P&L Detail']);
    expect(exportedDetail).toHaveSize(5);
    expect(exportedDetail.reduce((sum, row) => sum + Number(row['profitLossContributionUsd']), 0)).toBe(52);

    const disclosure = { taxYear: 2026, includeFederalIncomeTax: false, includeStateLocalIncomeTax: true, removedTaxMinor: 1200n, configuredTaxAccounts: ['Federal Income Tax', 'State and Local Income Tax'] };
    const summaryCsv = app.exportReportCsv(report, disclosure);
    expect(summaryCsv).toContain('"Income","Total for Income","2026-01","100.00"');
    expect(summaryCsv).toContain('"Gross Profit","","2026-01","70.00"');
    expect(summaryCsv).toContain('"Net Profit","","TOTAL","87.00"');
    expect(summaryCsv).toContain('"Federal income-tax expense","Excluded"');
    const summaryWorkbook = XLSX.read(app.exportReportXlsx(report, disclosure), { type: 'array' });
    const summaryRows = XLSX.utils.sheet_to_json<Array<string | number>>(summaryWorkbook.Sheets['P&L Summary'], { header: 1 });
    expect(summaryRows.find(row => row[0] === 'Gross Profit')).toEqual(['Gross Profit', 70, 40, 110]);
    expect(summaryRows.find(row => row[0] === 'Net Profit')).toEqual(['Net Profit', 52, 35, 87]);
    const printHtml = app.exportReportPrintHtml(report, disclosure);
    expect(printHtml).toContain('2026-01');
    expect(printHtml).toContain('$87.00');
    expect(printHtml).toContain('Schedule C disclosure');
    expect(printHtml).not.toContain('Tax treatment reviewed');
    expect(printHtml).not.toContain('Accountant note');
  });

  it('builds nested chart-account subtotals and exports boldable total rows', () => {
    const chart = app.importChartAccounts([
      'Account name,Account type',
      'Amazon Income,Income',
      'Amazon Income:Online Sales,Income',
      'Amazon Income:Online Sales:Amazon Returned Product Sales,Income',
      'Cost of goods sold,Cost of goods sold',
      'Cost of goods sold:Storage,Cost of goods sold',
      'Cost of goods sold:Storage:Amazon FBA Storage,Cost of goods sold',
      'Operating Expenses,Expenses',
      'Other Income,Other income',
      'Other Expense,Other expense',
      'Federal Income Tax,Expenses',
      'State and Local Income Tax,Expenses',
    ].join('\n'));
    const chartByName = Object.fromEntries(chart.map(item => [item.name, item]));
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    const committed = app.commitImport(app.previewImport({
      fileName: 'hierarchical-profit-loss.csv',
      kind: 'CSV',
      destinationAccountId: account.id,
      content: [
        'Date,Description,Amount',
        '2026-03-01,Direct Amazon sales,100.00',
        '2026-03-02,Returned product sales,25.00',
        '2026-03-03,FBA storage,-30.00',
      ].join('\n'),
    }).previewToken);
    const categories: Record<string, string> = {
      'Direct Amazon sales': chartByName['Amazon Income:Online Sales'].id,
      'Returned product sales': chartByName['Amazon Income:Online Sales:Amazon Returned Product Sales'].id,
      'FBA storage': chartByName['Cost of goods sold:Storage:Amazon FBA Storage'].id,
    };
    const transactions = app.listTransactions({ sourceBatchId: committed.batch.id, pageSize: 100 }).items;
    transactions.forEach(transaction => app.categorize(transaction.id, categories[transaction.description]));
    app.post(transactions.map(transaction => transaction.id));

    const report = app.getProfitLoss('2026-03-01', '2026-03-31', 'MONTH');
    const income = report.sections.find(section => section.key === 'INCOME')!;
    const amazonIncome = income.children[0];
    const amazonSales = amazonIncome.children[0];
    expect(amazonIncome.label).toBe('Amazon Income');
    expect(amazonIncome.totalMinor).toBe(12500n);
    expect(amazonSales.label).toBe('Online Sales');
    expect(amazonSales.directTotalMinor).toBe(10000n);
    expect(amazonSales.children[0].label).toBe('Amazon Returned Product Sales');
    expect(amazonSales.children[0].totalMinor).toBe(2500n);
    const storage = report.sections.find(section => section.key === 'COGS')!.children[0].children[0];
    expect(storage.label).toBe('Storage');
    expect(storage.totalMinor).toBe(3000n);

    const csv = app.exportReportCsv(report);
    expect(csv).toContain('"Income","Amazon Income:Online Sales","2026-03","100.00"');
    expect(csv).toContain('"Income","Total for Amazon Income:Online Sales","2026-03","125.00"');
    expect(csv).toContain('"COGS","Total for Cost of goods sold:Storage","2026-03","30.00"');
    expect(csv).toContain('"Gross Profit","","2026-03","95.00"');
    const printHtml = app.exportReportPrintHtml(report);
    expect(printHtml).toContain('Total for Online Sales');
    expect(printHtml).toContain('class="subtotal"');
    expect(printHtml).toContain('font-weight:800');
  });

  it('keeps report-only category exclusions out of summary and detail exports', () => {
    const account = app.listAccounts()[0];
    const expense = app.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = app.previewImport({ fileName: 'excluded-report.csv', content: 'Date,Description,Amount\n2026-08-01,Report-only exclusion,-10.00', kind: 'CSV', destinationAccountId: account.id });
    app.commitImport(preview.previewToken);
    const transaction = app.listTransactions({ accountId: account.id }).items[0];
    app.categorize(transaction.id, expense.id);
    app.post([transaction.id]);
    const full = app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR');
    const excluded = app.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR', [expense.id]);
    expect(excluded.netProfitMinor).toBe(full.netProfitMinor + 1000n);
    expect(app.getReportDetail('2026-01-01', '2026-12-31', undefined, [expense.id])).toHaveSize(0);
    expect(app.exportReportDetailCsv('2026-01-01', '2026-12-31', undefined, [expense.id])).not.toContain('Report-only exclusion');
    expect(app.getTransaction(transaction.id)?.state).toBe('POSTED');
  });

  it('imports a fictional chart shape and bank-feed rule format without losing hierarchy', () => {
    const chartWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(chartWorkbook, XLSX.utils.json_to_sheet([
      { 'Account name': 'General business expenses', 'Account type': 'Expenses' },
      { 'Account name': 'General business expenses:Bank fees & service charges', 'Account type': 'Expenses' },
      { 'Account name': 'Operating Checking 0001', 'Account type': 'Bank' },
    ]), 'Chart');
    const chart = app.importChartAccounts(XLSX.write(chartWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    const parent = chart.find(item => item.name === 'General business expenses')!;
    const child = chart.find(item => item.name.includes('Bank fees'))!;
    expect(chart).toHaveSize(3);
    expect(parent.type).toBe('EXPENSE');
    expect(child.parentId).toBe(parent.id);
    expect(chart.find(item => item.name === 'Operating Checking 0001')?.type).toBe('ASSET');

    const rulesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(rulesWorkbook, XLSX.utils.json_to_sheet([{
      'Rule Name': 'Bank fee rule',
      'Rule Conditions': JSON.stringify({ ruleConditions: [{ ruleType: 10, value: '-1' }, { ruleType: 1, value: 'Bank fee' }], isAndRule: true }),
      'Rule Outputs': JSON.stringify({ ruleActions: [{ actionType: 0, value: 'General business expenses:Bank fees & service charges' }] }),
    }]), 'Rules');
    const rules = app.importRulesWorkbook(XLSX.write(rulesWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    expect(rules).toHaveSize(1);
    expect(rules[0].chartAccountId).toBe(child.id);
    expect(rules[0].conditions.map(condition => condition.field)).toEqual(['DIRECTION', 'DESCRIPTION']);
  });

  it('creates and edits stable chart accounts with compatible subaccounts and audited lock/archive behavior', () => {
    const parent = app.createChartAccount({
      name: 'Storage', accountType: 'COGS', detailType: 'Other costs of goods sold', description: 'Storage costs', displayOrder: 500, locked: false,
    });
    const child = app.createChartAccount({
      name: 'Amazon FBA Storage', accountType: 'COGS', detailType: 'Other costs of goods sold', parentId: parent.id, description: 'FBA monthly storage', displayOrder: 501, locked: true,
    });
    expect(child.name).toBe('Storage:Amazon FBA Storage');
    expect(() => app.archiveChartAccount(child.id, true)).toThrowError(/Unlock this account/);

    const renamed = app.updateChartAccount(parent.id, { name: 'Warehouse Storage', accountType: 'COGS', detailType: 'Other costs of goods sold', description: 'All storage', displayOrder: 500, locked: false });
    const renamedChild = app.listChartAccounts().find(account => account.id === child.id)!;
    expect(renamed.id).toBe(parent.id);
    expect(renamedChild.name).toBe('Warehouse Storage:Amazon FBA Storage');
    app.updateChartAccount(child.id, { name: 'Amazon FBA Storage', accountType: 'COGS', detailType: 'Other costs of goods sold', parentId: parent.id, description: 'FBA monthly storage', displayOrder: 501, locked: false });
    expect(app.archiveChartAccount(child.id, true).archived).toBeTrue();
  });

  it('round-trips every enhanced chart field and rejects an incompatible parent without changing the chart', () => {
    const parent = app.createChartAccount({ name: 'Office', accountType: 'EXPENSE', detailType: 'Office expenses', description: 'Office costs', displayOrder: 600, locked: false });
    const child = app.createChartAccount({ name: 'Software', accountType: 'EXPENSE', detailType: 'Other business expenses', parentId: parent.id, description: 'Subscriptions', displayOrder: 601, locked: true });
    const workbook = app.exportChartAccounts();
    const imported = app.importChartAccounts(workbook);
    expect(imported.find(account => account.id === child.id)).toEqual(child);
    const beforeInvalidImport = app.listChartAccounts();

    expect(() => app.importChartAccounts([
      'Account ID,Account Name,Parent ID,Account Type,Reporting Classification,Detail Type,Display Order,Archived,Locked',
      'income-parent,Income,,Income,INCOME,Sales of product income,1,FALSE,FALSE',
      'expense-child,Income:Office,income-parent,Expenses,EXPENSE,Office expenses,2,FALSE,FALSE',
    ].join('\n'))).toThrowError(/same account type/);
    expect(app.listChartAccounts()).toEqual(beforeInvalidImport);
  });

  it('previews and explicitly commits Chart workbooks with Cash Flow classifications without mutating during preview', () => {
    const before = app.listChartAccounts();
    const workbook = app.exportChartAccounts();
    const preview = app.previewChartAccountsImport(workbook);
    expect(preview.issues).toEqual([]);
    expect(preview.rows).toHaveSize(before.length);
    expect(preview.cashFlowClassifications.length).toBeGreaterThan(0);
    const interest = before.find(account => account.name === 'Interest Paid')!;
    expect(preview.cashFlowClassifications.find(item => item.accountId === interest.id)?.classification?.treatment).toBe('OPERATING_REVENUE_EXPENSE');
    expect(app.listChartAccounts()).toEqual(before);

    const committed = app.commitChartAccountsImport(preview.previewToken);
    expect(committed.map(account => ({ ...account, parentId: account.parentId ?? '' }))).toEqual(before.map(account => ({ ...account, parentId: account.parentId ?? '' })));
    const roundTrip = XLSX.read(app.exportChartAccounts(), { type: 'array' });
    const roundTripRows = XLSX.utils.sheet_to_json<Record<string, string>>(roundTrip.Sheets[roundTrip.SheetNames[0]], { defval: '' });
    expect(roundTripRows.find(row => row['Account ID'] === interest.id)?.['Cash Flow Treatment']).toBe('OPERATING_REVENUE_EXPENSE');
  });

  it('rejects stale Chart classification values in preview instead of silently replacing them', () => {
    const before = app.listChartAccounts();
    const workbook = XLSX.read(app.exportChartAccounts(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean>>(sheet, { defval: '' });
    const target = rows.find(row => row['Account Name'] === 'Operating Expenses')!;
    target['Detail Type'] = 'Custom detail';
    target['Cash Flow Cash Role'] = '';
    target['Cash Flow Treatment'] = '';
    target['Cash Flow Status'] = '';
    target['Cash Flow Source'] = '';
    target['Cash Flow Rationale'] = '';
    const replacement = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(replacement, XLSX.utils.json_to_sheet(rows), 'Chart of Accounts');
    const preview = app.previewChartAccountsImport(XLSX.write(replacement, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    expect(preview.issues.map(issue => issue.code)).toContain('CASH_FLOW_CLASSIFICATION_STALE');
    expect(() => app.commitChartAccountsImport(preview.previewToken)).toThrowError(/Cash Flow classification/);
    expect(app.listChartAccounts()).toEqual(before);
  });

  it('rejects a chart replacement that would orphan a posted transaction split', () => {
    const protectedAccount = app.createChartAccount({ name: 'Posted reference', accountType: 'EXPENSE', detailType: 'Other business expenses', displayOrder: 800, locked: false });
    const financialAccount = app.listAccounts().find(account => account.name === 'Operating Checking')!;
    const committed = app.commitImport(app.previewImport({ fileName: 'posted-reference.csv', content: 'Date,Description,Amount\n2026-06-01,Protected posting,-4.00', kind: 'CSV', destinationAccountId: financialAccount.id }).previewToken);
    const transaction = app.listTransactions({ sourceBatchId: committed.batch.id }).items[0];
    app.postWithCategory(transaction.id, protectedAccount.id);

    expect(() => app.importChartAccounts(exportedChartWithout(protectedAccount.id))).toThrowError(/Existing posted transaction/);
    expect(app.listChartAccounts().some(account => account.id === protectedAccount.id)).toBeTrue();
  });

  it('rejects a chart replacement that would orphan an enabled rule', () => {
    const protectedAccount = app.createChartAccount({ name: 'Rule reference', accountType: 'EXPENSE', detailType: 'Other business expenses', displayOrder: 801, locked: false });
    app.importRules([{ id: 'protected-chart-rule', name: 'Protected chart rule', enabled: true, priority: 1, conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'protected' }], chartAccountId: protectedAccount.id }]);

    expect(() => app.importChartAccounts(exportedChartWithout(protectedAccount.id))).toThrowError(/rule/);
    expect(app.listChartAccounts().some(account => account.id === protectedAccount.id)).toBeTrue();
  });

  it('rejects a chart replacement that would orphan a configured tax account', () => {
    const protectedAccount = app.createChartAccount({ name: 'Custom federal tax', accountType: 'EXPENSE', detailType: 'Taxes paid', displayOrder: 802, locked: false });
    const settings = app.getTaxYearSettings(2026);
    app.saveTaxYearSettings({ ...settings, federalIncomeTaxAccountIds: [protectedAccount.id] });

    expect(() => app.importChartAccounts(exportedChartWithout(protectedAccount.id))).toThrowError(/Federal income-tax setting/);
    expect(app.listChartAccounts().some(account => account.id === protectedAccount.id)).toBeTrue();
  });

  it('loads BOM-prefixed chart CSV and accepts a Quicken rule category without posting', () => {
    const chart = app.importChartAccounts('\uFEFFAccount name,Account type,Detail type\nGeneral business expenses,Expenses,Other Business Expenses\nGeneral business expenses:Bank fees & service charges,Expenses,Bank Charges');
    const bankFees = chart.find(item => item.name.endsWith('Bank fees & service charges'))!;
    expect(chart).toHaveSize(2);

    const rulesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(rulesWorkbook, XLSX.utils.json_to_sheet([{
      'Rule Name': 'Wire fee',
      'Rule Conditions': JSON.stringify({ ruleConditions: [{ ruleType: 10, value: '-1' }, { ruleType: 1, value: 'Wire Transfer Fee' }], isAndRule: true }),
      'Rule Outputs': JSON.stringify({ ruleActions: [
        { actionType: 0, value: 'General business expenses:Bank fees & service charges' },
        { actionType: 5, value: 'Bank of America' },
        { actionType: 11, value: ['account-scope-id'] },
      ] }),
    }]), 'Rules');
    const rules = app.importRulesWorkbook(XLSX.write(rulesWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    expect(rules[0].suggestExclude).toBeFalse();
    expect(rules[0].payee).toBe('Bank of America');

    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    app.commitImport(app.previewImport({ fileName: 'wire.csv', content: 'Date,Description,Amount\n2026-01-20,Wire Transfer Fee,-45.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const pending = app.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    const suggestion = app.suggestTransaction(pending.id);
    expect(suggestion.source).toBe('RULE');
    expect(suggestion.chartAccountId).toBe(bankFees.id);
    const categorized = app.acceptSuggestion(pending.id);
    expect(categorized.state).toBe('PENDING');
    expect(categorized.splits[0].chartAccountId).toBe(bankFees.id);
    expect(categorized.categorizationSource).toBe('RULE');
    expect(categorized.payee).toBe('Bank of America');
  });

  it('matches imported payee and memo conditions against raw bank descriptions when dedicated fields are absent', () => {
    const chart = app.importChartAccounts('Account name,Account type\nAmazon Income,Income');
    const rulesWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(rulesWorkbook, XLSX.utils.json_to_sheet([{
      'Rule Name': 'Amazon payment',
      'Rule Conditions': JSON.stringify({ ruleConditions: [{ ruleType: 10, value: '1' }, { ruleType: 6, value: 'DES:PAYMENTS' }], isAndRule: true }),
      'Rule Outputs': JSON.stringify({ ruleActions: [{ actionType: 0, value: 'Amazon Income' }] }),
    }]), 'Rules');
    app.importRulesWorkbook(XLSX.write(rulesWorkbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
    const account = app.listAccounts().find(item => item.name === 'Operating Checking')!;
    app.commitImport(app.previewImport({ fileName: 'amazon-bank.csv', content: 'Date,Description,Amount\n2026-01-22,AMAZON.CJFZPUB0W DES:PAYMENTS ID:123,2976.00', kind: 'CSV', destinationAccountId: account.id }).previewToken);
    const pending = app.listTransactions({ accountId: account.id, states: ['PENDING'] }).items[0];
    expect(app.suggestTransaction(pending.id).chartAccountId).toBe(chart[0].id);
  });

  it('supports a replacement UI harness through the stable application interface', () => {
    const harness = new AlternateUiHarness(app);
    const snapshot = harness.runReviewSnapshot('2026-01-01', '2026-12-31');
    expect(snapshot.accountCount).toBe(5);
    expect(snapshot.pendingCount).toBe(0);
    expect(snapshot.netProfitMinor).toBe(0n);
  });
});
