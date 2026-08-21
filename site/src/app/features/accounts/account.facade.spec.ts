import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from '../../core/application-interface/accounting.application';
import { DefaultAccountingApplication } from '../../core/application-services/default-accounting.application';
import { BackupBundleService } from '../../core/backup-services/backup-bundle.service';
import { ImportPipelineService } from '../../core/import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../../core/repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../../core/repository-gateways/in-memory-accounting.repository';
import { AccountFacade } from './account.facade';

describe('AccountFacade', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [
    InMemoryAccountingRepository,
    { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
    ImportPipelineService,
    BackupBundleService,
    { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
    AccountFacade,
  ] }));

  it('keeps financial-account create, edit, archive, and restore behind the application interface', () => {
    const facade = TestBed.inject(AccountFacade);
    facade.load();
    const created = facade.create({ type: 'BANK', detailType: 'Savings', name: 'Reserve savings', institutionOrEntity: 'BofA', lastFour: '9090', description: 'Cash reserve', openingBalanceMinor: 50000n, openingBalanceDate: '2026-01-01', locked: false })!;
    const updated = facade.update(created.id, { type: 'BANK', detailType: 'Money Market', name: 'Operating reserve', institutionOrEntity: 'BofA', lastFour: '9090', description: 'Updated reserve', openingBalanceMinor: 52500n, openingBalanceDate: '2026-01-02', locked: false })!;
    expect(updated).toEqual(jasmine.objectContaining({ id: created.id, name: 'Operating reserve', detailType: 'Money Market', description: 'Updated reserve' }));
    facade.archive(created.id, true);
    expect(facade.accounts().find(account => account.id === created.id)?.archived).toBeTrue();
    facade.archive(created.id, false);
    expect(facade.accounts().find(account => account.id === created.id)?.archived).toBeFalse();
    expect(facade.error()).toBeUndefined();
  });

  it('surfaces validation failures and retains the account list', () => {
    const facade = TestBed.inject(AccountFacade);
    facade.load();
    const before = facade.accounts();
    expect(facade.create({ type: 'BANK', detailType: 'Credit Card', name: 'Invalid detail', institutionOrEntity: 'Test', openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01' })).toBeUndefined();
    expect(facade.error()).toContain('not valid for Bank');
    expect(facade.accounts()).toEqual(before);
  });
});
