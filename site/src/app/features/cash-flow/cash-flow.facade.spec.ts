import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import {
  CashFlowClassificationCatalog,
  CashFlowClassificationExportResult,
  CashFlowClassificationImportCommitResult,
  CashFlowClassificationImportPreview,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowContractError,
  CashFlowDetail,
  CashFlowExportResult,
  CashFlowReport,
  CashFlowClassificationImportRow,
  databaseRevision,
} from '../../core/domain-model/cash-flow.types';
import { CompanyProfile } from '../../core/domain-model/balance-sheet.types';
import { CashFlowFacade } from './cash-flow.facade';

describe('CashFlowFacade', () => {
  let facade: CashFlowFacade;
  let application: jasmine.SpyObj<AccountingApplication>;
  const revision = databaseRevision('revision-1');
  const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
  const catalog = { method: 'INDIRECT' } as unknown as CashFlowClassificationCatalog;
  const preview = { valid: true, statementLabel: 'Financing', rationale: 'Review.', failures: [] } as CashFlowClassificationPreview;
  const review = { query, databaseRevision: revision, accounts: [], blockingCount: 0, warningCount: 0 } as CashFlowClassificationReview;
  const importPreview = { previewId: 'preview-1', databaseRevision: revision, rows: [], issues: [], validRowCount: 0, blockedRowCount: 0 } as CashFlowClassificationImportPreview;
  const importCommit = { databaseRevision: revision, appliedRowCount: 0, review } as CashFlowClassificationImportCommitResult;
  const report = { reportId: 'report-1', databaseRevision: revision, query } as unknown as CashFlowReport;
  const detail = { reportId: 'report-1', databaseRevision: revision, detailKey: 'detail-1' } as unknown as CashFlowDetail;
  const classificationExport = { databaseRevision: revision, rows: [] } as CashFlowClassificationExportResult;
  const exportResult: CashFlowExportResult = {
    format: 'CSV', status: 'SAVED', path: '/tmp/cash-flow.csv', suggestedFileName: 'cash-flow.csv',
    completedAtUtc: '2026-08-25T00:00:00.000Z', rowCount: 0, content: '\uFEFFReport,Statement of Cash Flows\r\n',
  };

  beforeEach(() => {
    application = jasmine.createSpyObj<AccountingApplication>('AccountingApplication', [
      'getCompanyProfile', 'getCashFlowClassificationCatalog', 'previewCashFlowClassification', 'saveCashFlowClassification',
      'getCashFlowClassificationReview', 'previewCashFlowClassificationImport', 'commitCashFlowClassificationImport',
      'exportCashFlowClassifications', 'getCashFlowReport', 'getCashFlowDetail', 'exportCashFlow', 'openCashFlowPrintPreview',
    ]);
    application.getCompanyProfile.and.returnValue(companyFixture());
    application.getCashFlowClassificationCatalog.and.returnValue(catalog);
    application.previewCashFlowClassification.and.returnValue(preview);
    application.saveCashFlowClassification.and.returnValue(review);
    application.getCashFlowClassificationReview.and.returnValue(review);
    application.previewCashFlowClassificationImport.and.returnValue(importPreview);
    application.commitCashFlowClassificationImport.and.returnValue(importCommit);
    application.exportCashFlowClassifications.and.returnValue(classificationExport);
    application.getCashFlowReport.and.returnValue(report);
    application.getCashFlowDetail.and.returnValue(detail);
    application.exportCashFlow.and.resolveTo(exportResult);
    application.openCashFlowPrintPreview.and.resolveTo({ opened: true, title: 'Northstar Workshop — Statement of Cash Flows' });
    TestBed.configureTestingModule({ providers: [CashFlowFacade, { provide: ACCOUNTING_APPLICATION, useValue: application }] });
    facade = TestBed.inject(CashFlowFacade);
  });

  it('routes classification, exchange, report, detail, export, and print state through the application boundary', async () => {
    const classificationCommand = { accountRole: 'CHART' as const, accountId: 'chart-1', treatment: 'FINANCING' as const };
    const saveCommand = { ...classificationCommand, userRationale: 'Owner contribution.' };
    const rawRow: CashFlowClassificationImportRow = { accountPath: 'Equity > Owner equity', treatment: 'FINANCING' };
    const importCommand = { databaseRevision: revision, rows: [rawRow] };
    const detailCommand = { reportId: 'report-1' as never, databaseRevision: revision, detailKey: 'detail-1' as never };

    facade.loadCompanyProfile();
    facade.loadCatalog();
    facade.previewClassification(classificationCommand);
    facade.saveClassification(saveCommand);
    facade.loadClassificationReview(query);
    facade.previewClassificationImport(importCommand);
    facade.commitClassificationImport({ previewId: 'preview-1', databaseRevision: revision });
    expect(facade.exportClassifications({ databaseRevision: revision })).toBe(classificationExport);
    facade.loadReport(query);
    facade.loadDetail(detailCommand);
    expect(await facade.export({ reportId: 'report-1' as never, databaseRevision: revision, format: 'CSV' })).toBe(exportResult);
    expect(await facade.openPrintPreview({ reportId: 'report-1' as never, databaseRevision: revision })).toEqual({ opened: true, title: 'Northstar Workshop — Statement of Cash Flows' });

    expect(facade.company()?.displayName).toBe('Northstar Workshop');
    expect(facade.catalog()?.method).toBe('INDIRECT');
    expect(facade.classificationPreview()).toBe(preview);
    expect(facade.classificationReview()).toBe(review);
    expect(facade.importPreview()).toBe(importPreview);
    expect(facade.importCommit()).toBe(importCommit);
    expect(facade.lastClassificationExport()).toBe(classificationExport);
    expect(facade.report()).toBe(report);
    expect(facade.detail()).toBe(detail);
    expect(facade.error()).toBeUndefined();
    expect(facade.failure()).toBeUndefined();
    expect(facade.busy()).toBeFalse();
    expect(application.previewCashFlowClassificationImport).toHaveBeenCalledWith(importCommand);
    expect(application.commitCashFlowClassificationImport).toHaveBeenCalledWith({ previewId: 'preview-1', databaseRevision: revision });
  });

  it('clears stale report/detail state and exposes a boundary error', () => {
    facade.loadReport(query);
    facade.loadDetail({ reportId: 'report-1' as never, databaseRevision: revision, detailKey: 'detail-1' as never });
    application.getCashFlowReport.and.throwError('The Cash Flow report revision is stale.');

    facade.loadReport(query);

    expect(facade.report()).toBeUndefined();
    expect(facade.detail()).toBeUndefined();
    expect(facade.error()).toBe('The Cash Flow report revision is stale.');
  });

  it('preserves typed export failures for the UI without retaining a stale report decision', async () => {
    const failure = new CashFlowContractError({ code: 'CASH_FLOW_EXPORT_FAILED', message: 'Choose another location.', retryable: true });
    application.exportCashFlow.and.rejectWith(failure);

    const result = await facade.export({ reportId: 'report-1' as never, databaseRevision: revision, format: 'CSV' });

    expect(result).toBeUndefined();
    expect(facade.error()).toBe('Choose another location.');
    expect(facade.failure()).toEqual(failure.failure);
    expect(facade.failure()?.code).toBe('CASH_FLOW_EXPORT_FAILED');
  });
});

function companyFixture(): CompanyProfile {
  return {
    companyId: 'company-1', legalName: 'Northstar Workshop LLC', displayName: 'Northstar Workshop', currencyCode: 'USD',
    fiscalYearStartMonth: 1, accountingBasis: 'CASH', activeTaxYear: 2026,
    createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-08-25T00:00:00.000Z',
  };
}
