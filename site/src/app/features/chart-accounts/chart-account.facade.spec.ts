import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from '../../core/application-interface/accounting.application';
import { DefaultAccountingApplication } from '../../core/application-services/default-accounting.application';
import { BackupBundleService } from '../../core/backup-services/backup-bundle.service';
import { ImportPipelineService } from '../../core/import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../../core/repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../../core/repository-gateways/in-memory-accounting.repository';
import { ChartAccountFacade } from './chart-account.facade';

describe('ChartAccountFacade', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      InMemoryAccountingRepository,
      { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
      ImportPipelineService,
      BackupBundleService,
      { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ChartAccountFacade,
    ] });
  });

  it('keeps list, create, edit, archive, import, and export behind the application boundary', () => {
    const facade = TestBed.inject(ChartAccountFacade);
    facade.load();
    const created = facade.create({ name: 'Facade expense', accountType: 'EXPENSE', detailType: 'Other business expenses', description: 'Facade test', displayOrder: 700, locked: false })!;
    const updated = facade.update(created.id, { name: 'Updated facade expense', accountType: 'EXPENSE', detailType: 'Office expenses', description: 'Updated', displayOrder: 701, locked: false })!;
    expect(updated.id).toBe(created.id);
    expect(facade.archive(created.id, true)?.archived).toBeTrue();
    expect(facade.export().byteLength).toBeGreaterThan(0);
    expect(facade.import(facade.export())?.some(account => account.id === created.id)).toBeTrue();
    expect(facade.error()).toBeUndefined();
  });

  it('surfaces validation errors without replacing the current list', () => {
    const facade = TestBed.inject(ChartAccountFacade);
    facade.load();
    const before = facade.accounts();
    expect(facade.create({ name: '', accountType: 'EXPENSE', detailType: 'Office expenses', displayOrder: 1, locked: false })).toBeUndefined();
    expect(facade.error()).toContain('required');
    expect(facade.accounts()).toEqual(before);
  });
});
