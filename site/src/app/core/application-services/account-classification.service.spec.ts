import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../application-interface/accounting.application';
import { ACCOUNT_TYPE_CATALOG, AccountingAccountType, ImportCapability, SaveGenericAccountCommand } from '../domain-model/account-taxonomy';
import { money, newId, nowUtc } from '../domain-model/accounting.types';
import { BalanceSheetContractError } from '../domain-model/balance-sheet.types';
import { ACCOUNTING_REPOSITORY } from '../repository-gateways/accounting.repository';
import { InMemoryAccountingRepository } from '../repository-gateways/in-memory-accounting.repository';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { DefaultAccountingApplication } from './default-accounting.application';

describe('AccountClassificationService through AccountingApplication', () => {
  let application: AccountingApplication;
  let repository: InMemoryAccountingRepository;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      InMemoryAccountingRepository,
      { provide: ACCOUNTING_REPOSITORY, useExisting: InMemoryAccountingRepository },
      ImportPipelineService,
      BackupBundleService,
      { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
    ] });
    application = TestBed.inject(ACCOUNTING_APPLICATION);
    repository = TestBed.inject(InMemoryAccountingRepository);
  });

  it('returns the exhaustive grouped catalog and creates every standard type in its supported role', () => {
    const catalog = application.getAccountTypeCatalog();
    expect(catalog.flatMap(group => group.accountTypes).map(type => type.accountType)).toEqual(ACCOUNT_TYPE_CATALOG.map(type => type.accountType));

    for (const definition of ACCOUNT_TYPE_CATALOG) {
      const detailType = definition.detailTypes[0].value;
      const chart = application.saveGenericAccount(chartCommand(definition.accountType, detailType, `Chart ${definition.accountType}`));
      expect(chart).toEqual(jasmine.objectContaining({ role: 'CHART', created: true }));
      expect(repository.chartAccounts.get(chart.accountId)).toEqual(jasmine.objectContaining({ accountType: definition.accountType, detailType }));
    }

    for (const definition of ACCOUNT_TYPE_CATALOG.filter(type => ['ASSET', 'LIABILITY'].includes(type.reportingGroup))) {
      const detailType = definition.accountType === 'OTHER_CURRENT_ASSET' ? 'Marketplace clearing' : definition.detailTypes[0].value;
      const financial = application.saveGenericAccount(financialCommand(definition.accountType, detailType, `Source ${definition.accountType}`));
      expect(repository.accounts.get(financial.accountId)).toEqual(jasmine.objectContaining({ accountType: definition.accountType, detailType }));
    }

    expectContractFailure(() => application.saveGenericAccount(financialCommand('EQUITY', 'Owner equity', 'Invalid source')), 'ACCOUNT_CLASSIFICATION_INVALID');
  });

  it('accepts every compatible reporting-group parent path and rejects an incompatible path', () => {
    for (const group of application.getAccountTypeCatalog()) {
      const parentDefinition = group.accountTypes[0];
      const parent = application.saveGenericAccount(chartCommand(parentDefinition.accountType, parentDefinition.detailTypes[0].value, `${group.label} parent`));
      for (const definition of group.accountTypes) {
        const child = application.saveGenericAccount({
          ...chartCommand(definition.accountType, definition.detailTypes[0].value, `${definition.accountType} child`),
          parentId: parent.accountId,
        });
        expect(repository.chartAccounts.get(child.accountId)?.parentId).toBe(parent.accountId);
      }
    }
    const assetParent = [...repository.chartAccounts.values()].find(account => account.name === 'Asset parent')!;
    const invalid = application.validateGenericAccount({ ...chartCommand('EXPENSE', 'Advertising', 'Wrong parent'), parentId: assetParent.id });
    expect(invalid.valid).toBeFalse();
    expect(invalid.blockingReferences).toEqual([jasmine.objectContaining({ kind: 'PARENT', referenceId: assetParent.id })]);
  });

  it('keeps import capability independent from classification and enforces supported combinations', () => {
    const noImportBank = application.saveGenericAccount({ ...financialCommand('BANK', 'Checking', 'Manual cash'), importCapability: disabledImport() });
    expect(repository.accounts.get(noImportBank.accountId)).toEqual(jasmine.objectContaining({ accountType: 'BANK', importEnabled: false, supportedSourceKinds: [] }));

    const marketplace = application.saveGenericAccount({
      ...financialCommand('OTHER_CURRENT_ASSET', 'Marketplace clearing', 'Marketplace clearing source'),
      importCapability: { enabled: true, supportedSourceKinds: ['CSV', 'AMAZON'] },
    });
    expect(repository.accounts.get(marketplace.accountId)?.supportedSourceKinds).toEqual(['CSV', 'AMAZON']);
    expectContractFailure(() => application.saveGenericAccount({
      ...financialCommand('BANK', 'Checking', 'Unsupported Amazon bank'),
      importCapability: { enabled: true, supportedSourceKinds: ['AMAZON'] },
    }), 'ACCOUNT_CLASSIFICATION_INVALID');
    expectContractFailure(() => application.saveGenericAccount({
      ...chartCommand('BANK', 'Checking', 'Chart cannot import'),
      importCapability: { enabled: true, supportedSourceKinds: ['CSV'] },
    }), 'ACCOUNT_CLASSIFICATION_INVALID');
  });

  it('preserves stable IDs, existing roles, and imported custom detail types', () => {
    const created = application.saveGenericAccount(chartCommand('EXPENSE', 'Advertising', 'Campaign costs'));
    const updated = application.saveGenericAccount({
      ...chartCommand('EXPENSE', 'Imported campaign subtype', 'Campaign costs updated'),
      accountId: created.accountId,
      currentRole: 'CHART',
    });
    expect(updated.accountId).toBe(created.accountId);
    expect(updated.created).toBeFalse();
    expect(repository.chartAccounts.get(created.accountId)).toEqual(jasmine.objectContaining({ id: created.accountId, detailType: 'Imported campaign subtype' }));
    expectContractFailure(() => application.saveGenericAccount({
      ...financialCommand('BANK', 'Checking', 'Unsupported conversion'),
      accountId: created.accountId,
      currentRole: 'CHART',
    }), 'ACCOUNT_CLASSIFICATION_INVALID');
  });

  it('previews every Balance Sheet placement and Current Earnings behavior with as-of balances', () => {
    for (const definition of ACCOUNT_TYPE_CATALOG) {
      const preview = application.previewAccountPlacement({ accountType: definition.accountType, accountName: definition.label, asOfDate: '2026-12-31' });
      expect(preview.reportingGroup).toBe(definition.reportingGroup);
      expect(preview.behavior).toBe(definition.placementBehavior);
      expect(preview.section).toBe(definition.balanceSheetSection);
      expect(preview.fullPath).toContain(definition.label);
      expect(preview.currentBalanceMinor).toBeUndefined();
    }

    const source = application.saveGenericAccount({ ...financialCommand('BANK', 'Checking', 'Preview checking'), openingBalanceMinor: 10_000n });
    const preview = application.previewAccountPlacement({ accountType: 'BANK', accountRole: 'FINANCIAL_SOURCE', accountId: source.accountId, accountName: 'Preview checking', asOfDate: '2026-12-31' });
    expect(preview).toEqual(jasmine.objectContaining({ behavior: 'BALANCE_SHEET_LINE', currentBalanceMinor: 10_000n, fullPath: 'Assets > Bank > Preview checking' }));
    const earnings = application.previewAccountPlacement({ accountType: 'INCOME', accountName: 'Online sales', asOfDate: '2026-12-31' });
    expect(earnings).toEqual(jasmine.objectContaining({ behavior: 'CURRENT_EARNINGS', fullPath: 'Current Earnings > Income > Online sales' }));
  });

  it('returns every incompatible parent, child, tax, and lock reference before rejecting a change', () => {
    const parent = application.saveGenericAccount(chartCommand('EXPENSE', 'Advertising', 'Expense parent'));
    const target = application.saveGenericAccount({ ...chartCommand('EXPENSE', 'Advertising', 'Referenced expense'), parentId: parent.accountId, locked: true });
    const child = application.saveGenericAccount({ ...chartCommand('EXPENSE', 'Advertising', 'Expense child'), parentId: target.accountId });
    repository.taxSettings.set(2026, { taxYear: 2026, federalIncomeTaxAccountIds: [target.accountId], stateLocalIncomeTaxAccountIds: [], includeFederalIncomeTax: false, includeStateLocalIncomeTax: true });

    const validation = application.validateGenericAccount({
      ...chartCommand('BANK', 'Checking', 'Referenced expense'), accountId: target.accountId, currentRole: 'CHART', parentId: parent.accountId, locked: true,
    });
    expect(validation.valid).toBeFalse();
    expect(validation.blockingReferences.map(reference => reference.kind).sort()).toEqual(['CHILD', 'LOCK_STATE', 'PARENT', 'TAX_SETTING']);
    expect(validation.blockingReferences.map(reference => reference.referenceId)).toContain(child.accountId);
    expectContractFailure(() => application.saveGenericAccount({
      ...chartCommand('BANK', 'Checking', 'Referenced expense'), accountId: target.accountId, currentRole: 'CHART', parentId: parent.accountId, locked: true,
    }), 'ACCOUNT_REFERENCE_CONFLICT', 4);
  });

  it('requires complete reference confirmation and enforces opening-balance mutual exclusion', () => {
    const source = application.saveGenericAccount(financialCommand('BANK', 'Checking', 'Referenced source'));
    const transactionId = newId();
    repository.transactions.set(transactionId, {
      id: transactionId, accountId: source.accountId, postingDate: '2026-01-15', amount: money(2_500n), rawDescription: 'Transfer activity', description: 'Transfer activity',
      state: 'MATCHED_TRANSFER', splits: [], sourceBatchId: 'batch-1', categorizationSource: 'TRANSFER', transferMatchId: 'transfer-1', createdAtUtc: nowUtc(), modifiedAtUtc: nowUtc(),
    });
    repository.batches.set('batch-1', { id: 'batch-1', destinationAccountId: source.accountId, sourceKind: 'CSV', sourceName: 'checking.csv', sourceHash: 'hash', mappingVersion: '1', acceptedCount: 1, rejectedCount: 0, skippedCount: 0, warningCount: 0, totalAcceptedAmount: money(2_500n) });
    repository.rules.set('rule-1', { id: 'rule-1', name: 'Source rule', enabled: true, priority: 1, conditions: [{ field: 'ACCOUNT', operator: 'EQUALS', value: source.accountId }], matchMode: 'ALL' });
    repository.transfers.set('transfer-1', { id: 'transfer-1', leftTransactionId: transactionId, rightTransactionId: 'other-transaction', confidence: 1, rationale: 'Fixture', confirmedAtUtc: nowUtc() });
    const command = {
      ...financialCommand('OTHER_CURRENT_ASSET', 'Marketplace clearing', 'Referenced source'),
      accountId: source.accountId, currentRole: 'FINANCIAL_SOURCE' as const,
      importCapability: { enabled: true, supportedSourceKinds: ['CSV', 'AMAZON'] } as ImportCapability,
    };
    const validation = application.validateGenericAccount(command);
    expect(validation.valid).toBeTrue();
    expect(validation.confirmationReferences.map(reference => reference.kind).sort()).toEqual(['IMPORT_MAPPING', 'REPORT_EFFECT', 'RULE', 'TRANSACTION', 'TRANSFER']);
    expectContractFailure(() => application.saveGenericAccount(command), 'ACCOUNT_REFERENCE_CONFLICT', 5);
    const saved = application.saveGenericAccount({ ...command, confirmedReferenceIds: validation.confirmationReferences.map(reference => reference.referenceId) });
    expect(saved.accountId).toBe(source.accountId);
    expect(repository.accounts.get(source.accountId)?.accountType).toBe('OTHER_CURRENT_ASSET');

    expectContractFailure(() => application.saveGenericAccount({
      ...financialCommand('BANK', 'Checking', 'Conflicting opening'), openingBalanceSource: 'LEDGER_ACTIVITY', openingBalanceMinor: 1n,
    }), 'ACCOUNT_CLASSIFICATION_INVALID');
    const ledgerOpening = application.saveGenericAccount({
      ...financialCommand('BANK', 'Checking', 'Ledger opening'), openingBalanceSource: 'LEDGER_ACTIVITY', openingBalanceMinor: 0n,
    });
    expect(repository.accounts.get(ledgerOpening.accountId)?.openingBalanceSource).toBe('LEDGER_ACTIVITY');
  });
});

function chartCommand(accountType: AccountingAccountType, detailType: string, name: string): SaveGenericAccountCommand {
  return {
    requestedRole: 'CHART', accountType, detailType, name, importCapability: disabledImport(),
    openingBalanceSource: 'DERIVED_EQUITY', openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01', displayOrder: 100, locked: false,
  };
}

function financialCommand(accountType: AccountingAccountType, detailType: string, name: string): SaveGenericAccountCommand {
  const importCapability: ImportCapability = ['BANK', 'CREDIT_CARD'].includes(accountType)
    ? { enabled: true, supportedSourceKinds: ['CSV'] }
    : accountType === 'OTHER_CURRENT_ASSET' && ['Marketplace clearing', 'Clearing account'].includes(detailType)
      ? { enabled: true, supportedSourceKinds: ['CSV', 'AMAZON'] }
      : disabledImport();
  return {
    requestedRole: 'FINANCIAL_SOURCE', accountType, detailType, name, institutionOrEntity: 'Example institution',
    importCapability, openingBalanceSource: 'DERIVED_EQUITY', openingBalanceMinor: 0n, openingBalanceDate: '2026-01-01', locked: false,
  };
}

function disabledImport(): ImportCapability { return { enabled: false, supportedSourceKinds: [] }; }

function expectContractFailure(work: () => unknown, code: string, referenceCount?: number): void {
  try {
    work();
    fail(`Expected ${code}.`);
  } catch (error) {
    expect(error instanceof BalanceSheetContractError).toBeTrue();
    const contractError = error as BalanceSheetContractError;
    expect(contractError.code).toBe(code as never);
    if (referenceCount !== undefined) expect(contractError.failure.references).toHaveSize(referenceCount);
  }
}
