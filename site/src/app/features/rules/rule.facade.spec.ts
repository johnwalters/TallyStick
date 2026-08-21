import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from '../../core/application-interface/accounting.application';
import { DefaultAccountingApplication } from '../../core/application-services/default-accounting.application';
import { BackupBundleService } from '../../core/backup-services/backup-bundle.service';
import { ImportPipelineService } from '../../core/import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../../core/repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../../core/repository-gateways/in-memory-accounting.repository';
import { RuleFacade } from './rule.facade';

describe('RuleFacade', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        InMemoryAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
        RuleFacade,
      ],
    });
  });

  it('keeps list, editor mutations, transaction drafts, and unsaved test results behind the application interface', () => {
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const facade = TestBed.inject(RuleFacade);
    const account = application.listAccounts()[0];
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const batch = application.commitImport(application.previewImport({
      fileName: 'facade-rule.csv', content: 'Date,Description,Amount\n2026-01-10,FACADE RULE,-5.00', kind: 'CSV', destinationAccountId: account.id,
    }).previewToken).batch;
    const transaction = application.listTransactions({ sourceBatchId: batch.id }).items[0];
    const draft = facade.draftFromTransaction(transaction.id, category.id)!;

    facade.test(draft, [transaction.id]);
    expect(facade.testResults()[0].matched).toBeTrue();
    const saved = facade.save({ ...draft, name: 'Facade rule', priority: 1 })!;
    const copy = facade.duplicate(saved.id)!;
    expect(copy.enabled).toBeFalse();
    facade.enable(copy.id, true);
    expect(facade.rules().find(rule => rule.id === copy.id)?.enabled).toBeTrue();
    facade.delete(saved.id);
    expect(facade.rules().some(rule => rule.id === saved.id)).toBeFalse();
    expect(facade.error()).toBeUndefined();
  });
});
