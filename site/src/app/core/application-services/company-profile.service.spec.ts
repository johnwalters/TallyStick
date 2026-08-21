import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../application-interface/accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import { BalanceSheetContractError, UpdateCompanyProfileCommand } from '../domain-model/balance-sheet.types';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { SqliteAccountingRepository } from '../repository-gateways/sqlite-accounting.repository';
import { SqliteDatabaseGateway } from '../sqlite-gateway/sqlite-database.gateway';
import { DefaultAccountingApplication } from './default-accounting.application';

describe('CompanyProfileService through AccountingApplication', () => {
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
    repository = TestBed.inject(InMemoryAccountingRepository);
    application = TestBed.inject(ACCOUNTING_APPLICATION);
  });

  it('normalizes, masks, audits, and persists a valid update without changing ledger records', () => {
    const current = application.getCompanyProfile();
    const ledgerBefore = ledgerState(application.exportAllData());

    const updated = application.updateCompanyProfile({
      ...baseCommand(current.modifiedAt),
      legalName: '  Northstar Workshop LLC  ',
      displayName: '   ',
      doingBusinessAs: '   ',
      entityType: '  LLC ',
      address: { line1: ' 12 Example Way ', line2: ' ', locality: ' Sample City ', region: ' ca ', postalCode: ' 90000 ', countryCode: ' us ' },
      phone: ' 555-0100 ',
      email: ' books@example.test ',
      website: ' https://example.test/books ',
      taxIdentifier: '12-3456789',
    });

    expect(updated).toEqual(jasmine.objectContaining({
      legalName: 'Northstar Workshop LLC', displayName: 'Northstar Workshop LLC', entityType: 'LLC',
      phone: '555-0100', email: 'books@example.test', website: 'https://example.test/books', maskedTaxIdentifier: '•••• 6789',
    }));
    expect(updated.doingBusinessAs).toBeUndefined();
    expect(updated.address).toEqual({ line1: '12 Example Way', line2: undefined, locality: 'Sample City', region: 'ca', postalCode: '90000', countryCode: 'US' });
    expect(application.revealCompanyTaxIdentifier()).toEqual({ companyId: updated.companyId, taxIdentifier: '12-3456789' });
    expect(ledgerState(application.exportAllData())).toEqual(ledgerBefore);
    expect(repository.company).toEqual(jasmine.objectContaining({ name: 'Northstar Workshop LLC', currency: 'USD', fiscalYearStartMonth: 7, accountingBasis: 'ACCRUAL', activeTaxYear: 2027 }));
    const audit = repository.audit.filter(event => event.operation === 'UPDATE_COMPANY_PROFILE');
    expect(audit).toHaveSize(1);
    expect(JSON.stringify(audit)).not.toContain('12-3456789');
    expect(JSON.stringify(audit[0].after)).toContain('•••• 6789');
    expect(repository.exportCompanyProfile()?.taxIdentifier).toBe('12-3456789');
  });

  it('preserves an omitted tax identifier and clears it only when explicitly requested', () => {
    let profile = application.getCompanyProfile();
    profile = application.updateCompanyProfile({ ...baseCommand(profile.modifiedAt), taxIdentifier: '98-7654321' });
    profile = application.updateCompanyProfile({ ...baseCommand(profile.modifiedAt), legalName: 'Renamed Company LLC' });
    expect(profile.maskedTaxIdentifier).toBe('•••• 4321');
    expect(application.revealCompanyTaxIdentifier().taxIdentifier).toBe('98-7654321');

    profile = application.updateCompanyProfile({ ...baseCommand(profile.modifiedAt), taxIdentifier: null });
    expect(profile.maskedTaxIdentifier).toBeUndefined();
    expect(application.revealCompanyTaxIdentifier().taxIdentifier).toBeUndefined();
  });

  it('rejects stale updates with a typed retryable failure', () => {
    const stale = application.getCompanyProfile();
    application.updateCompanyProfile(baseCommand(stale.modifiedAt));

    expectFailure(() => application.updateCompanyProfile(baseCommand(stale.modifiedAt)), 'COMPANY_PROFILE_STALE', 'expectedModifiedAt', true);
  });

  it('returns typed validation failures for every Company Settings validation rule', () => {
    const modifiedAt = application.getCompanyProfile().modifiedAt;
    const cases: Array<{ patch: Partial<UpdateCompanyProfileCommand>; field: string }> = [
      { patch: { legalName: ' ' }, field: 'legalName' },
      { patch: { currencyCode: 'US' }, field: 'currencyCode' },
      { patch: { fiscalYearStartMonth: 0 }, field: 'fiscalYearStartMonth' },
      { patch: { fiscalYearStartMonth: 13 }, field: 'fiscalYearStartMonth' },
      { patch: { activeTaxYear: 99 }, field: 'activeTaxYear' },
      { patch: { accountingBasis: 'OTHER' as UpdateCompanyProfileCommand['accountingBasis'] }, field: 'accountingBasis' },
      { patch: { email: 'not-an-email' }, field: 'email' },
      { patch: { website: 'ftp://example.test' }, field: 'website' },
      { patch: { address: { countryCode: 'USA' } }, field: 'address.countryCode' },
      { patch: { taxIdentifier: 'x' }, field: 'taxIdentifier' },
    ];

    for (const item of cases) {
      expectFailure(() => application.updateCompanyProfile({ ...baseCommand(modifiedAt), ...item.patch }), 'COMPANY_PROFILE_INVALID', item.field, false);
    }
    expect(repository.audit.filter(event => event.operation === 'UPDATE_COMPANY_PROFILE')).toEqual([]);
  });
});

describe('CompanyProfileService SQLite round trip', () => {
  it('survives close/reopen with masked normal reads, explicit reveal, and sanitized audit history', async () => {
    TestBed.configureTestingModule({
      providers: [
        SqliteDatabaseGateway,
        SqliteAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: SqliteAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ],
    });
    const database = TestBed.inject(SqliteDatabaseGateway);
    const repository = TestBed.inject(SqliteAccountingRepository);
    await repository.initialize();
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const current = application.getCompanyProfile();
    const transactionCount = repository.transactions.size;

    const updated = application.updateCompanyProfile({
      ...baseCommand(current.modifiedAt), legalName: 'Copper Lantern Studio LLC', displayName: 'Copper Lantern', taxIdentifier: '55-5555555',
    });
    const bytes = database.exportBytes();
    const reopenedDatabase = new SqliteDatabaseGateway();
    const reopened = new SqliteAccountingRepository(reopenedDatabase);
    await reopened.initialize(bytes);

    expect(reopened.getCompanyProfile()).toEqual(jasmine.objectContaining({ legalName: 'Copper Lantern Studio LLC', displayName: 'Copper Lantern', modifiedAt: updated.modifiedAt, maskedTaxIdentifier: '•••• 5555' }));
    expect(JSON.stringify(reopened.getCompanyProfile())).not.toContain('55-5555555');
    expect(reopened.revealCompanyTaxIdentifier()).toBe('55-5555555');
    expect(reopened.company).toEqual(jasmine.objectContaining({ name: 'Copper Lantern Studio LLC', fiscalYearStartMonth: 7, accountingBasis: 'ACCRUAL', activeTaxYear: 2027 }));
    expect(reopened.transactions.size).toBe(transactionCount);
    const audit = reopened.audit.filter(event => event.operation === 'UPDATE_COMPANY_PROFILE');
    expect(audit).toHaveSize(1);
    expect(JSON.stringify(audit)).not.toContain('55-5555555');
  });
});

function baseCommand(expectedModifiedAt: string): UpdateCompanyProfileCommand {
  return {
    expectedModifiedAt,
    legalName: 'Example Outfitters LLC',
    displayName: 'Example Outfitters',
    currencyCode: 'usd',
    fiscalYearStartMonth: 7,
    accountingBasis: 'ACCRUAL',
    activeTaxYear: 2027,
  };
}

function ledgerState(payload: string): unknown {
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  return {
    accounts: parsed['accounts'], chartAccounts: parsed['chartAccounts'], transactions: parsed['transactions'],
    batches: parsed['batches'], rules: parsed['rules'], transfers: parsed['transfers'], taxSettings: parsed['taxSettings'],
  };
}

function expectFailure(work: () => unknown, code: string, field: string, retryable: boolean): void {
  try {
    work();
    fail(`Expected ${code}.`);
  } catch (error) {
    expect(error instanceof BalanceSheetContractError).toBeTrue();
    const contractError = error as BalanceSheetContractError;
    expect(contractError.code).toBe(code as never);
    expect(contractError.failure.field).toBe(field);
    expect(contractError.failure.retryable).toBe(retryable);
  }
}
