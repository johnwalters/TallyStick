import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../application-interface/accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import {
  CashFlowContractError,
} from '../domain-model/cash-flow.types';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { DefaultAccountingApplication } from './default-accounting.application';
import { ACCOUNT_TYPE_CATALOG } from '../domain-model/account-taxonomy';
import { money } from '../domain-model/accounting.types';

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

  it('implements classification and cash-balance report operations while keeping later detail/output operations deferred', async () => {
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

    const deferredOperations: Array<() => unknown> = [
      () => application.getCashFlowDetail({ reportId: report.reportId, databaseRevision: revision, detailKey: 'detail-1' as never }),
    ];
    for (const operation of deferredOperations) {
      expect(() => operation()).toThrowError(CashFlowContractError);
      try { operation(); } catch (error) {
        expect((error as CashFlowContractError).code).toBe('CASH_FLOW_NOT_IMPLEMENTED');
        expect((error as CashFlowContractError).failure.retryable).toBeFalse();
      }
    }
    await expectDeferred(() => application.exportCashFlow({ reportId: 'report-1' as never, databaseRevision: revision, format: 'CSV' }));
    await expectDeferred(() => application.openCashFlowPrintPreview({ reportId: 'report-1' as never, databaseRevision: revision }));
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
    expect(review.databaseRevision).toBeDefined();
    expect(performance.now() - startedAt).toBeLessThan(500);
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
