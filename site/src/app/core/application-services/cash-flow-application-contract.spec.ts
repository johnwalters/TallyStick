import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../application-interface/accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import {
  CashFlowContractError,
  databaseRevision,
} from '../domain-model/cash-flow.types';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { DefaultAccountingApplication } from './default-accounting.application';
import { ACCOUNT_TYPE_CATALOG } from '../domain-model/account-taxonomy';

describe('Cash Flow public application contract', () => {
  let application: AccountingApplication;

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

  it('exposes every Cash Flow operation through the typed boundary with a dedicated deferred-operation failure', async () => {
    const revision = databaseRevision('revision-1');
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false };
    const rawImport = {
      accountPath: 'Assets > Bank > Checking', accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      cashRole: 'MYSTERY_CASH_ROLE', treatment: 'MYSTERY_TREATMENT', status: 'MYSTERY_STATUS', source: 'MYSTERY_SOURCE', rationale: '',
    };
    const syncOperations: Array<() => unknown> = [
      () => application.previewCashFlowClassification({ accountRole: 'CHART', accountId: 'chart-1', treatment: 'FINANCING' }),
      () => application.saveCashFlowClassification({ accountRole: 'CHART', accountId: 'chart-1', treatment: 'FINANCING', userRationale: 'Review.' }),
      () => application.getCashFlowClassificationReview(query),
      () => application.getCashFlowReport(query),
      () => application.getCashFlowDetail({ reportId: 'report-1' as never, databaseRevision: revision, detailKey: 'detail-1' as never }),
      () => application.previewCashFlowClassificationImport({ databaseRevision: revision, rows: [rawImport] }),
      () => application.commitCashFlowClassificationImport({ previewId: 'preview-1', databaseRevision: revision }),
      () => application.exportCashFlowClassifications({ databaseRevision: revision }),
    ];
    for (const operation of syncOperations) {
      expect(() => operation()).toThrowError(CashFlowContractError);
      try {
        operation();
      } catch (error) {
        expect((error as CashFlowContractError).code).toBe('CASH_FLOW_NOT_IMPLEMENTED');
        expect((error as CashFlowContractError).failure.retryable).toBeFalse();
      }
    }

    await expectDeferred(() => application.exportCashFlow({ reportId: 'report-1' as never, databaseRevision: revision, format: 'CSV' }));
    await expectDeferred(() => application.openCashFlowPrintPreview({ reportId: 'report-1' as never, databaseRevision: revision }));
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
