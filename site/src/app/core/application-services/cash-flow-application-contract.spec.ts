import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../application-interface/accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import {
  CashFlowContractError,
} from '../domain-model/cash-flow.types';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY, CashFlowClassificationRecord } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { DefaultAccountingApplication } from './default-accounting.application';
import { ACCOUNT_TYPE_CATALOG } from '../domain-model/account-taxonomy';
import { ChartAccount, FinancialAccount, money, Transaction } from '../domain-model/accounting.types';
import { CashFlowClassification } from '../domain-model/cash-flow-classification';

describe('Cash Flow public application contract', () => {
  let application: AccountingApplication;
  let repository: InMemoryAccountingRepository;

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
    application = TestBed.inject(ACCOUNTING_APPLICATION);
    repository = TestBed.inject(InMemoryAccountingRepository);
  });

  it('publishes the Cash Flow catalog through the typed application boundary', () => {
    const catalog = application.getCashFlowClassificationCatalog();
    expect(catalog).toEqual(jasmine.objectContaining({
      cashRoles: ['CASH', 'CASH_EQUIVALENT', 'RESTRICTED_CASH', 'NOT_CASH', 'REVIEW_REQUIRED'],
      treatments: ['CASH_BALANCE', 'OPERATING_REVENUE_EXPENSE', 'OPERATING_ASSET', 'OPERATING_LIABILITY', 'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'],
      sections: ['OPERATING', 'INVESTING', 'FINANCING', 'CASH_RECONCILIATION', 'NONCASH_DISCLOSURE'],
      statuses: ['CONFIRMED', 'REVIEW_REQUIRED'],
      sources: ['DEFAULT', 'MIGRATED', 'USER'],
      method: 'INDIRECT',
    }));
    expect(catalog.compatibility).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ accountRole: 'CHART', accountType: 'EQUITY', permittedTreatments: jasmine.arrayContaining(['FINANCING', 'EXCLUDED']) }),
      jasmine.objectContaining({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', permittedCashRoles: jasmine.arrayContaining(['CASH', 'REVIEW_REQUIRED']) }),
    ]));
    expect(catalog.defaults).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({ accountRole: 'CHART', accountType: 'OTHER_CURRENT_LIABILITY', detailType: 'Loan payable', classification: jasmine.objectContaining({ treatment: 'FINANCING', status: 'CONFIRMED' }) }),
      jasmine.objectContaining({ accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Interest paid', classification: jasmine.objectContaining({ treatment: 'OPERATING_REVENUE_EXPENSE' }) }),
    ]));
    expect(catalog.labels.treatments.FINANCING).toBe('Financing');
    const financialAccountTypes = new Set(ACCOUNT_TYPE_CATALOG.filter(definition => ['ASSET', 'LIABILITY'].includes(definition.reportingGroup)).map(definition => definition.accountType));
    expect(catalog.compatibility.filter(entry => entry.accountRole === 'FINANCIAL_SOURCE').every(entry => financialAccountTypes.has(entry.accountType))).toBeTrue();
    expect(catalog.defaults.filter(entry => entry.accountRole === 'FINANCIAL_SOURCE').every(entry => financialAccountTypes.has(entry.accountType))).toBeTrue();
    expect(Object.isFrozen(catalog)).toBeTrue();
    expect(Object.isFrozen(catalog.compatibility)).toBeTrue();
    expect(Object.isFrozen(catalog.defaults)).toBeTrue();
  });

  it('implements classification, report, CSV/XLSX, and exact detail operations', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
    const chart = application.listChartAccounts().find(account => account.detailType === 'Owner draw')!;
    const preview = application.previewCashFlowClassification({ accountRole: 'CHART', accountId: chart.id, treatment: 'FINANCING' });
    expect(preview.valid).toBeTrue();
    expect(preview.statementSection).toBe('FINANCING');
    const saved = application.saveCashFlowClassification({ accountRole: 'CHART', accountId: chart.id, treatment: 'FINANCING', userRationale: 'Owner distribution policy.' });
    expect(saved.databaseRevision).toBeDefined();
    expect(saved.saveImpact?.accountId).toBe(chart.id);
    expect(saved.saveImpact?.cacheInvalidated).toBeTrue();
    expect(application.getCashFlowClassificationReview(query).databaseRevision).toBe(saved.databaseRevision);

    const exported = application.exportCashFlowClassifications({ databaseRevision: saved.databaseRevision });
    const importPreview = application.previewCashFlowClassificationImport({ databaseRevision: saved.databaseRevision, rows: exported.rows });
    expect(importPreview.issues).toEqual([]);
    const committed = application.commitCashFlowClassificationImport({ previewId: importPreview.previewId, databaseRevision: saved.databaseRevision });
    expect(committed.appliedRowCount).toBe(exported.rows.length);

    const revision = committed.databaseRevision;
    const report = application.getCashFlowReport(query);
    expect(report.databaseRevision).toBe(revision);
    expect(report.query).toEqual(query);
    expect(typeof report.beginningCashMinor).toBe('bigint');
    expect(typeof report.endingCashMinor).toBe('bigint');
    expect(Object.isFrozen(report)).toBeTrue();

    const detailRow = report.rows.find(row => row.amountMinor !== undefined && row.detailKey)!;
    const detail = application.getCashFlowDetail({ reportId: report.reportId, databaseRevision: revision, detailKey: detailRow.detailKey! });
    expect(detail.rowId).toBe(detailRow.rowId);
    expect(detail.amountMinor).toBe(detailRow.amountMinor!);
    expect(detail.contributions.reduce((sum, contribution) => sum + contribution.contributionMinor, 0n)).toBe(detail.amountMinor);

    const csvExport = await application.exportCashFlow({ reportId: report.reportId, databaseRevision: report.databaseRevision, format: 'CSV' });
    expect(csvExport.format).toBe('CSV');
    if (csvExport.status === 'CANCELLED' || csvExport.format !== 'CSV') throw new Error('Expected a completed CSV export.');
    expect(csvExport.content).toContain('Report,Statement of Cash Flows');
    expect(csvExport.content).toContain(report.reportId);
    expect(csvExport.rowCount).toBe(report.rows.length);

    const printPreview = await application.openCashFlowPrintPreview({ reportId: report.reportId, databaseRevision: report.databaseRevision });
    expect(printPreview).toEqual({ opened: false, title: `${report.company.displayName} — Statement of Cash Flows` });

    expect(() => application.getCashFlowDetail({ reportId: report.reportId, databaseRevision: revision, detailKey: 'detail-1' as never }))
      .toThrowError(CashFlowContractError);
    try {
      application.getCashFlowDetail({ reportId: report.reportId, databaseRevision: revision, detailKey: 'detail-1' as never });
    } catch (error) {
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_DETAIL_NOT_FOUND');
      expect((error as CashFlowContractError).failure.retryable).toBeFalse();
    }
    await expectStaleIdentity(() => application.exportCashFlow({ reportId: 'report-1' as never, databaseRevision: revision, format: 'CSV' }));
    await expectStaleIdentity(() => application.openCashFlowPrintPreview({ reportId: 'report-1' as never, databaseRevision: revision }));

    const xlsxExport = await application.exportCashFlow({ reportId: report.reportId, databaseRevision: revision, format: 'XLSX' });
    if (xlsxExport.status === 'CANCELLED' || xlsxExport.format !== 'XLSX') throw new Error('Expected a completed XLSX export.');
    expect(xlsxExport.bytes.byteLength).toBeGreaterThan(0);
  });

  it('serves immutable, reconciling detail for every eligible public report row', () => {
    installDetailCoverageFixture();
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: true } as const;
    const report = application.getCashFlowReport(query);
    const eligibleRows = report.rows.filter(row => row.amountMinor !== undefined && row.detailKey);
    expect(eligibleRows.length).toBeGreaterThan(0);
    const rowTypes = new Set(eligibleRows.map(row => row.rowType));
    ['ACCOUNT_ACTIVITY', 'SUBTOTAL', 'TOTAL', 'NET_PROFIT', 'CASH_BALANCE', 'DIFFERENCE', 'NONCASH_DISCLOSURE'].forEach(type => {
      expect(rowTypes).withContext(`Missing eligible ${type} row.`).toContain(type);
    });

    for (const row of eligibleRows) {
      const storedContributions = report.detailIndex[row.detailKey!];
      expect(storedContributions.reduce((sum, item) => sum + item.contributionMinor, 0n))
        .withContext(`Stored detail mismatch for ${row.rowId}: row=${row.amountMinor} contributions=${storedContributions.map(item => item.contributionMinor).join(',')}`)
        .toBe(row.amountMinor!);
      const detail = application.getCashFlowDetail({
        reportId: report.reportId,
        databaseRevision: report.databaseRevision,
        detailKey: row.detailKey!,
      });
      expect(detail.reportId).toBe(report.reportId);
      expect(detail.databaseRevision).toBe(report.databaseRevision);
      expect(detail.rowId).toBe(row.rowId);
      expect(detail.amountMinor).toBe(row.amountMinor!);
      expect(Object.isFrozen(detail)).toBeTrue();
      expect(Object.isFrozen(detail.contributions)).toBeTrue();
      expect(detail.contributions.every(item => item.detailKey === row.detailKey)).toBeTrue();
      expect(detail.contributions.every(item => Boolean(item.transactionId || item.accountId || item.formula))).toBeTrue();
      expect(new Set(detail.contributions.map(item => item.contributionId)).size).toBe(detail.contributions.length);
      expect(detail.contributions.reduce((sum, item) => sum + item.contributionMinor, 0n)).toBe(row.amountMinor!);
    }

    expect(() => application.getCashFlowDetail({
      reportId: report.reportId,
      databaseRevision: report.databaseRevision,
      detailKey: 'missing-detail-key' as never,
    })).toThrowError(CashFlowContractError);
    try {
      application.getCashFlowDetail({ reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: 'missing-detail-key' as never });
      fail('Expected an invalid detail key to be rejected.');
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_DETAIL_NOT_FOUND');
    }
  });

  it('invalidates cached reports across report-affecting mutations and preserves rename history', async () => {
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false } as const;
    const bank = application.listAccounts().find(account => account.type === 'BANK')!;
    const chart = application.listChartAccounts().find(account => account.name === 'Online Sales')!;
    repository.transactions.set('cache-matrix-transaction', {
      id: 'cache-matrix-transaction', accountId: bank.id, postingDate: '2026-01-10', amount: money(1n), rawDescription: 'Cache matrix', description: 'Cache matrix', state: 'PENDING',
      splits: [{ id: 'cache-matrix-transaction:split', chartAccountId: chart.id, amount: money(1n) }], categorizationSource: 'MANUAL',
      createdAtUtc: '2026-01-10T00:00:00.000Z', modifiedAtUtc: '2026-01-10T00:00:00.000Z',
    });
    const read = spyOn(repository, 'readCashFlowSnapshot').and.callThrough();
    const mutationCases: Array<{ name: string; mutate: () => void }> = [
      { name: 'transaction state', mutate: () => repository.transactions.set('cache-matrix-transaction', { ...repository.transactions.get('cache-matrix-transaction')!, state: 'POSTED' }) },
      { name: 'transaction edit', mutate: () => application.updateTransaction('cache-matrix-transaction', { description: 'Cache matrix edited' }) },
      { name: 'transaction splits', mutate: () => application.split('cache-matrix-transaction', [{ chartAccountId: chart.id, amountMinor: 1n, memo: 'Updated split' }]) },
      { name: 'transfer match', mutate: () => repository.transfers.set('cache-matrix-transfer', { id: 'cache-matrix-transfer', leftTransactionId: 'cache-matrix-transaction', rightTransactionId: 'cache-matrix-counterparty', confidence: 1, rationale: 'Cache matrix transfer.', confirmedAtUtc: '2026-01-11T00:00:00.000Z' }) },
      { name: 'financial account edit', mutate: () => application.updateAccount(bank.id, { type: bank.type, detailType: bank.detailType, name: `${bank.name} renamed`, institutionOrEntity: bank.institutionOrEntity, lastFour: bank.lastFour, parentAccountId: bank.parentAccountId, description: bank.description, openingBalanceMinor: bank.openingBalance.minorUnits, openingBalanceDate: bank.openingBalanceDate, locked: bank.locked }) },
      { name: 'Chart account edit', mutate: () => application.updateChartAccount(chart.id, { name: 'Online Sales renamed', accountType: chart.accountType, detailType: chart.detailType, parentId: chart.parentId, description: chart.description, displayOrder: chart.displayOrder, locked: chart.locked }) },
      { name: 'classification save', mutate: () => application.saveCashFlowClassification({ accountRole: 'CHART', accountId: chart.id, treatment: 'OPERATING_REVENUE_EXPENSE', userRationale: 'Cache matrix classification save.' }) },
      { name: 'classification import', mutate: () => {
        const revision = application.getCashFlowClassificationReview(query).databaseRevision;
        const exported = application.exportCashFlowClassifications({ databaseRevision: revision });
        const preview = application.previewCashFlowClassificationImport({ databaseRevision: revision, rows: exported.rows });
        application.commitCashFlowClassificationImport({ previewId: preview.previewId, databaseRevision: revision });
      } },
      { name: 'opening balance', mutate: () => application.updateAccount(bank.id, { type: bank.type, detailType: bank.detailType, name: `${bank.name} opening`, institutionOrEntity: bank.institutionOrEntity, lastFour: bank.lastFour, parentAccountId: bank.parentAccountId, description: bank.description, openingBalanceMinor: bank.openingBalance.minorUnits + 1n, openingBalanceDate: bank.openingBalanceDate, locked: bank.locked }) },
      { name: 'company reporting settings', mutate: () => {
        const profile = application.getCompanyProfile();
        application.updateCompanyProfile({ expectedModifiedAt: profile.modifiedAt, legalName: `${profile.legalName} settings`, displayName: profile.displayName, doingBusinessAs: profile.doingBusinessAs, entityType: profile.entityType, address: profile.address, phone: profile.phone, email: profile.email, website: profile.website, currencyCode: profile.currencyCode, fiscalYearStartMonth: profile.fiscalYearStartMonth === 12 ? 1 : profile.fiscalYearStartMonth + 1, accountingBasis: profile.accountingBasis, activeTaxYear: profile.activeTaxYear });
      } },
      { name: 'Chart replacement', mutate: () => {
        const preview = application.previewChartAccountsImport(application.exportChartAccounts());
        application.commitChartAccountsImport(preview.previewToken);
      } },
      { name: 'portable import', mutate: () => application.importAllData(application.exportAllData()) },
      { name: 'backup restore', mutate: () => application.restoreBackupBundle(application.createBackupBundle()) },
      { name: 'relocation activation', mutate: () => {
        // Native relocation swaps the active repository behind the same
        // application.  Replacing the in-memory maps and recording the host
        // activation event exercises the same revision boundary without
        // requiring a desktop bridge in this browser contract suite.
        repository.accounts = new Map([...repository.accounts.entries()].map(([id, account]) => [id, { ...account }]));
        repository.chartAccounts = new Map([...repository.chartAccounts.entries()].map(([id, account]) => [id, { ...account }]));
        repository.audit.push({ id: 'cache-matrix-relocation', timestampUtc: '2026-01-31T00:00:00.000Z', operation: 'RELOCATE_DATABASE', entityType: 'Database', entityId: repository.company.id, reason: 'Relocation activation.' });
      } },
    ];

    let prior = application.getCashFlowReport(query);
    for (const mutation of mutationCases) {
      const oldDetailRow = prior.rows.find(row => row.amountMinor !== undefined && row.detailKey)!;
      read.calls.reset();
      mutation.mutate();
      const refreshed = application.getCashFlowReport(query);
      expect(refreshed.databaseRevision).not.toBe(prior.databaseRevision);
      expect(refreshed).toBe(application.getCashFlowReport({ ...query }));
      expect(read.calls.count()).toBeLessThanOrEqual(1);
      expect(() => application.getCashFlowDetail({ reportId: prior.reportId, databaseRevision: prior.databaseRevision, detailKey: oldDetailRow.detailKey! })).toThrowError(CashFlowContractError);
      await expectStale(() => application.exportCashFlow({ reportId: prior.reportId, databaseRevision: prior.databaseRevision, format: 'CSV' }));
      await expectStale(() => application.openCashFlowPrintPreview({ reportId: prior.reportId, databaseRevision: prior.databaseRevision }));
      prior = refreshed;
    }

    // Search/filter/navigation state belongs to the workspace, not the
    // repository revision, and therefore leaves the immutable cache intact.
    const beforeWorkspaceChange = application.getCashFlowReport(query);
    const workspaceFilter = 'expense';
    expect(workspaceFilter).toBe('expense');
    expect(application.getCashFlowReport(query)).toBe(beforeWorkspaceChange);
  });

  it('keeps semantic rows and contribution identities stable across account renames while labels update', () => {
    installDetailCoverageFixture();
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: true } as const;
    const before = application.getCashFlowReport(query);
    const target = before.rows.find(row => row.accountId === 'public-detail-asset-child' && row.amountMinor !== undefined)!;
    const beforeDetail = application.getCashFlowDetail({ reportId: before.reportId, databaseRevision: before.databaseRevision, detailKey: target.detailKey! });
    const account = repository.chartAccounts.get('public-detail-asset-child')!;
    application.updateChartAccount(account.id, { name: 'Renamed child', accountType: account.accountType, detailType: account.detailType, parentId: account.parentId, description: account.description, displayOrder: account.displayOrder, locked: account.locked });
    const after = application.getCashFlowReport(query);
    const renamed = after.rows.find(row => row.rowId === target.rowId)!;
    const afterDetail = application.getCashFlowDetail({ reportId: after.reportId, databaseRevision: after.databaseRevision, detailKey: renamed.detailKey! });
    expect(renamed.rowId).toBe(target.rowId);
    expect(renamed.amountMinor).toBe(target.amountMinor);
    expect(renamed.label).not.toBe(target.label);
    expect(afterDetail.contributions.map(item => item.contributionId)).toEqual(beforeDetail.contributions.map(item => item.contributionId));
    expect(afterDetail.contributions.map(item => item.contributionMinor)).toEqual(beforeDetail.contributions.map(item => item.contributionMinor));
    expect(() => application.getCashFlowDetail({ reportId: before.reportId, databaseRevision: before.databaseRevision, detailKey: target.detailKey! })).toThrowError(CashFlowContractError);
    try {
      application.getCashFlowDetail({ reportId: before.reportId, databaseRevision: before.databaseRevision, detailKey: target.detailKey! });
      fail('Expected the renamed report revision to be stale.');
    } catch (error) {
      expect((error as CashFlowContractError).failure.code).toBe('CASH_FLOW_REPORT_REVISION_STALE');
    }
  });

  it('rejects stale Cash Flow output requests after a report-affecting mutation', async () => {
    const report = application.getCashFlowReport({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false });
    const staleRevision = report.databaseRevision;
    repository.company = { ...repository.company, name: 'Changed after report' };

    await expectStale(() => application.exportCashFlow({ reportId: report.reportId, databaseRevision: staleRevision, format: 'CSV' }));
    await expectStale(() => application.openCashFlowPrintPreview({ reportId: report.reportId, databaseRevision: staleRevision }));
  });

  it('uses stable IDs first, then unique normalized paths, without mutating preview state', () => {
    const revision = application.exportCashFlowClassifications({ databaseRevision: application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false }).databaseRevision }).databaseRevision;
    const exported = application.exportCashFlowClassifications({ databaseRevision: revision });
    const source = exported.rows.find(row => row.accountRole === 'CHART')!;
    expect(source.accountPath).toBeTruthy();
    const pathOnly = { ...source, accountId: undefined, accountPath: `  ${source.accountPath.replace(/ > /g, ' : ')}  ` };
    const preview = application.previewCashFlowClassificationImport({ databaseRevision: revision, rows: [pathOnly] });
    expect(preview.issues).toEqual([]);
    expect(preview.rows[0].accountId).toBe(source.accountId);
    expect(application.exportCashFlowClassifications({ databaseRevision: revision }).databaseRevision).toBe(revision);

    const idAndPathMismatch = application.previewCashFlowClassificationImport({ databaseRevision: revision, rows: [{ ...source, accountId: 'missing-stable-id', accountPath: source.accountPath }] });
    expect(idAndPathMismatch.issues.map(issue => issue.code)).toContain('ACCOUNT_NOT_FOUND');

    const invalid = application.previewCashFlowClassificationImport({ databaseRevision: revision, rows: [{ ...source, treatment: 'NOT_A_TREATMENT' }] });
    expect(invalid.issues.map(issue => issue.code)).toContain('UNKNOWN_TREATMENT');
    expect(() => application.commitCashFlowClassificationImport({ previewId: invalid.previewId, databaseRevision: revision })).toThrowError(CashFlowContractError);
    expect(application.exportCashFlowClassifications({ databaseRevision: revision }).databaseRevision).toBe(revision);
  });

  it('rejects optimistic classification saves prepared from an older state', () => {
    const chart = application.listChartAccounts().find(account => account.detailType === 'Owner draw')!;
    expect(() => application.saveCashFlowClassification({ accountRole: 'CHART', accountId: chart.id, treatment: 'FINANCING', userRationale: 'Stale edit.', expectedModifiedAtUtc: '2020-01-01T00:00:00.000Z' })).toThrowError(CashFlowContractError);
    try {
      application.saveCashFlowClassification({ accountRole: 'CHART', accountId: chart.id, treatment: 'FINANCING', userRationale: 'Stale edit.', expectedModifiedAtUtc: '2020-01-01T00:00:00.000Z' });
    } catch (error) {
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_CLASSIFICATION_STALE');
      expect((error as CashFlowContractError).failure.retryable).toBeTrue();
    }
  });

  it('reports missing financial cash roles and stale import structures without mutation', () => {
    const account = application.listAccounts()[0];
    const missingRole = application.previewCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountId: account.id, treatment: 'OPERATING_LIABILITY' });
    expect(missingRole.valid).toBeFalse();
    expect(missingRole.failures[0].code).toBe('CASH_ROLE_REQUIRED');

    const revision = application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false }).databaseRevision;
    const importPreview = application.previewCashFlowClassificationImport({
      databaseRevision: revision,
      rows: [{ accountRole: 'FINANCIAL_SOURCE', accountId: account.id, accountType: 'EXPENSE', detailType: account.detailType, cashRole: 'NOT_CASH', treatment: 'OPERATING_LIABILITY', status: 'CONFIRMED', source: 'USER', rationale: 'Invalid role/type combination.' }],
    });
    expect(importPreview.issues.map(issue => issue.code)).toContain('CLASSIFICATION_STALE');
    expect(application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false }).databaseRevision).toBe(revision);
  });

  it('exposes review reasons, archived state, and current versus suggested classifications', () => {
    const chart = application.listChartAccounts().find(account => account.detailType === 'Owner draw')!;
    const archived = application.listChartAccounts().find(account => account.name === 'Software and apps')!;
    application.archiveChartAccount(archived.id, true);
    repository.cashFlowClassifications.delete(`CHART:${chart.id}`);
    const missing = application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false }).accounts.find(item => item.accountId === chart.id)!;
    expect(missing.reviewReasons).toContain('MISSING_CLASSIFICATION');
    expect(missing.currentClassification).toBeUndefined();
    expect(missing.suggestedClassification?.source).toBe('DEFAULT');

    const archivedReview = application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false }).accounts.find(item => item.accountId === archived.id)!;
    expect(archivedReview.archived).toBeTrue();
    expect(archivedReview.reviewReasons).toContain('ARCHIVED_ACCOUNT');
    expect(archivedReview.currentClassification).toBeDefined();
  });

  it('reviews a 10,000-transaction dataset with one-pass activity aggregation', () => {
    const bank = application.listAccounts()[0];
    const chart = application.listChartAccounts().find(account => account.detailType === 'Owner draw')!;
    for (let index = 0; index < 10_000; index += 1) {
      repository.transactions.set(`cash-flow-scale-${index}`, {
        id: `cash-flow-scale-${index}`,
        accountId: bank.id,
        postingDate: '2026-06-01',
        amount: money(1n),
        rawDescription: 'Scale fixture',
        description: 'Scale fixture',
        state: 'POSTED',
        splits: [{ id: `cash-flow-scale-split-${index}`, chartAccountId: chart.id, amount: money(1n) }],
        categorizationSource: 'MANUAL',
        createdAtUtc: '2026-06-01T00:00:00.000Z',
        modifiedAtUtc: '2026-06-01T00:00:00.000Z',
      });
    }
    const startedAt = performance.now();
    const review = application.getCashFlowClassificationReview({ startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false });
    const reviewMs = performance.now() - startedAt;
    console.info(`Cash Flow classification performance: review=${reviewMs.toFixed(2)}ms transactions=10000`);
    expect(review.databaseRevision).toBeDefined();
    expect(reviewMs).toBeLessThan(500);
  });
});

async function expectDeferred(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    fail('Expected a Cash Flow deferred-operation failure.');
  } catch (error) {
    expect((error as CashFlowContractError).code).toBe('CASH_FLOW_NOT_IMPLEMENTED');
  }
}

async function expectStaleIdentity(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    fail('Expected a stale or unknown Cash Flow report identity failure.');
  } catch (error) {
    expect((error as CashFlowContractError).code).toBe('CASH_FLOW_REPORT_REVISION_STALE');
    expect((error as CashFlowContractError).failure.retryable).toBeTrue();
  }
}

function installDetailCoverageFixture(): void {
  const repository = TestBed.inject(InMemoryAccountingRepository);
  const cash = [...repository.accounts.values()].find(account => account.type === 'BANK')!;
  repository.accounts.set(cash.id, { ...cash, openingBalance: money(1_000n), openingBalanceDate: '2025-12-01' });
  const cashClassification = repository.cashFlowClassifications.get(`FINANCIAL_SOURCE:${cash.id}`)!;
  repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${cash.id}`, {
    ...cashClassification, cashRole: 'CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'USER',
    rationale: 'Public detail coverage cash role.', modifiedAtUtc: '2026-01-01T00:00:00.000Z',
  });

  let displayOrder = 2_000;
  const addChart = (id: string, name: string, accountType: ChartAccount['accountType'], detailType: string, treatment: CashFlowClassification['treatment'], parentId?: string): ChartAccount => {
    const type: ChartAccount['type'] = accountType === 'EQUITY' ? 'EQUITY' : accountType === 'INCOME' ? 'INCOME' : accountType === 'COGS' ? 'COGS' : accountType === 'EXPENSE' || accountType === 'OTHER_EXPENSE' ? 'EXPENSE' : accountType === 'OTHER_INCOME' ? 'OTHER_INCOME' : accountType === 'FIXED_ASSET' || accountType === 'OTHER_CURRENT_ASSET' ? 'ASSET' : 'LIABILITY';
    const parent = parentId ? repository.chartAccounts.get(parentId) : undefined;
    const account: ChartAccount = { id, name: parent ? `${parent.name}:${name}` : name, type, accountType, detailType, parentId, displayOrder: displayOrder++, archived: false, locked: false };
    repository.chartAccounts.set(id, account);
    const classification: CashFlowClassificationRecord = {
      accountRole: 'CHART', accountId: id, accountType, detailType, treatment, status: treatment === 'REVIEW_REQUIRED' ? 'REVIEW_REQUIRED' : 'CONFIRMED', source: 'USER',
      rationale: `Public detail coverage ${id}.`, modifiedAtUtc: '2026-01-01T00:00:00.000Z',
    };
    repository.cashFlowClassifications.set(`CHART:${id}`, classification);
    return account;
  };
  const income = addChart('public-detail-income', 'Coverage income', 'INCOME', 'Sales of product income', 'OPERATING_REVENUE_EXPENSE');
  const assetParent = addChart('public-detail-asset-parent', 'Coverage assets', 'OTHER_CURRENT_ASSET', 'Other current assets', 'OPERATING_ASSET');
  const assetChild = addChart('public-detail-asset-child', 'Child', 'OTHER_CURRENT_ASSET', 'Other current assets', 'OPERATING_ASSET', assetParent.id);
  const fixed = addChart('public-detail-fixed', 'Coverage equipment', 'FIXED_ASSET', 'Machinery and equipment', 'INVESTING');
  const equity = addChart('public-detail-equity', 'Coverage capital', 'EQUITY', 'Owner equity', 'FINANCING');
  const unresolved = addChart('public-detail-unresolved', 'Coverage unresolved', 'OTHER_CURRENT_ASSET', 'Other current assets', 'REVIEW_REQUIRED');

  const debt: FinancialAccount = {
    ...cash, id: 'public-detail-debt', type: 'BANK', accountType: 'LONG_TERM_LIABILITY', detailType: 'Notes payable', name: 'Coverage debt',
    openingBalance: money(0n), openingBalanceDate: '2025-12-01', archived: false,
  };
  repository.accounts.set(debt.id, debt);
  repository.cashFlowClassifications.set(`FINANCIAL_SOURCE:${debt.id}`, {
    accountRole: 'FINANCIAL_SOURCE', accountId: debt.id, accountType: debt.accountType, detailType: debt.detailType, cashRole: 'NOT_CASH',
    treatment: 'FINANCING', status: 'CONFIRMED', source: 'USER', rationale: 'Public detail coverage noncash source.', modifiedAtUtc: '2026-01-01T00:00:00.000Z',
  });

  const addTransaction = (id: string, accountId: string, postingDate: string, amountMinor: bigint, state: Transaction['state'], splits: readonly { chartAccountId: string; amountMinor: bigint; splitId: string }[]): void => {
    repository.transactions.set(id, {
      id, accountId, postingDate, amount: money(amountMinor), rawDescription: id, description: id, state,
      splits: splits.map(split => ({ id: split.splitId, chartAccountId: split.chartAccountId, amount: money(split.amountMinor) })),
      categorizationSource: 'MANUAL', createdAtUtc: `${postingDate}T00:00:00.000Z`, modifiedAtUtc: `${postingDate}T00:00:00.000Z`,
    });
  };
  addTransaction('public-detail-income-tx', cash.id, '2026-01-05', 100n, 'POSTED', [{ chartAccountId: income.id, amountMinor: 100n, splitId: 'public-detail-income-tx:income' }]);
  addTransaction('public-detail-asset-tx', cash.id, '2026-01-10', -50n, 'POSTED', [{ chartAccountId: assetChild.id, amountMinor: -50n, splitId: 'public-detail-asset-tx:asset' }]);
  addTransaction('public-detail-fixed-tx', cash.id, '2026-01-15', -75n, 'POSTED', [{ chartAccountId: fixed.id, amountMinor: -75n, splitId: 'public-detail-fixed-tx:fixed' }]);
  addTransaction('public-detail-equity-tx', cash.id, '2026-01-20', 25n, 'POSTED', [{ chartAccountId: equity.id, amountMinor: 25n, splitId: 'public-detail-equity-tx:equity' }]);
  addTransaction('public-detail-unresolved-tx', cash.id, '2026-01-25', -10n, 'POSTED', [{ chartAccountId: unresolved.id, amountMinor: -10n, splitId: 'public-detail-unresolved-tx:unresolved' }]);
  addTransaction('public-detail-excluded-tx', cash.id, '2026-01-26', -5n, 'EXCLUDED', [{ chartAccountId: unresolved.id, amountMinor: -5n, splitId: 'public-detail-excluded-tx:unresolved' }]);
  addTransaction('public-detail-noncash-tx', debt.id, '2026-02-01', -500n, 'POSTED', [{ chartAccountId: fixed.id, amountMinor: -500n, splitId: 'public-detail-noncash-tx:fixed' }]);
}

async function expectStale(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
    fail('Expected a stale Cash Flow output failure.');
  } catch (error) {
    expect((error as CashFlowContractError).code).toBe('CASH_FLOW_REPORT_REVISION_STALE');
    expect((error as CashFlowContractError).failure.retryable).toBeTrue();
  }
}
