import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION } from '../application-interface/accounting.application';
import { DefaultAccountingApplication } from '../application-services/default-accounting.application';
import { BackupBundleService } from '../backup-services/backup-bundle.service';
import { ImportPipelineService } from '../import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from './accounting.repository';
import { SqliteAccountingRepository } from './sqlite-accounting.repository';
import { SqliteDatabaseGateway } from '../sqlite-gateway/sqlite-database.gateway';
import { money } from '../domain-model/accounting.types';

describe('SqliteAccountingRepository', () => {
  it('persists domain state and reloads it from exported SQLite bytes', async () => {
    const database = new SqliteDatabaseGateway();
    const repository = new SqliteAccountingRepository(database);
    await repository.initialize();

    repository.transaction(() => {
      repository.accounts.set('bank-1', {
        id: 'bank-1', type: 'BANK', name: 'Checking', institutionOrEntity: 'BofA',
        detailType: 'Checking', description: 'Primary operating account', lastFour: '0001', openingBalance: money(10000n), openingBalanceDate: '2026-01-01', archived: false, locked: true,
      });
      repository.chartAccounts.set('expense-1', {
        id: 'expense-1', name: 'Office Expense', type: 'EXPENSE', accountType: 'EXPENSE', detailType: 'Office expenses', displayOrder: 1, archived: false, locked: false,
      });
      repository.transactions.set('transaction-1', {
        id: 'transaction-1', accountId: 'bank-1', postingDate: '2026-01-15',
        amount: money(-1250n), rawDescription: 'Office Depot', description: 'Office Depot',
        state: 'POSTED', splits: [{ id: 'split-1', chartAccountId: 'expense-1', amount: money(-1250n) }],
        categorizationSource: 'MANUAL', createdAtUtc: '2026-01-15T12:00:00.000Z', modifiedAtUtc: '2026-01-15T12:00:00.000Z',
      });
    });

    const bytes = database.exportBytes();
    const reopenedDatabase = new SqliteDatabaseGateway();
    const reopenedRepository = new SqliteAccountingRepository(reopenedDatabase);
    await reopenedRepository.initialize(bytes);

    expect(reopenedRepository.accounts.get('bank-1')?.openingBalance.minorUnits).toBe(10000n);
    expect(reopenedRepository.accounts.get('bank-1')).toEqual(jasmine.objectContaining({ detailType: 'Checking', description: 'Primary operating account', lastFour: '0001', locked: true }));
    expect(reopenedRepository.transactions.get('transaction-1')?.splits[0].amount.minorUnits).toBe(-1250n);
    expect(reopenedDatabase.execute('SELECT version FROM schema_version')[0]['version']).toBe(5);
  });

  it('rolls back in-memory and SQLite state when a transaction fails', async () => {
    const database = new SqliteDatabaseGateway();
    const repository = new SqliteAccountingRepository(database);
    await repository.initialize();
    const initialBytes = database.exportBytes();

    expect(() => repository.transaction(() => {
      repository.accounts.set('will-rollback', {
        id: 'will-rollback', type: 'BANK', name: 'Temporary', institutionOrEntity: 'Test',
        detailType: 'Checking', openingBalance: money(0n), openingBalanceDate: '2026-01-01', archived: false, locked: false,
      });
      throw new Error('injected failure');
    })).toThrowError('injected failure');

    expect(repository.accounts.has('will-rollback')).toBeFalse();
    expect(database.exportBytes()).toEqual(initialBytes);
    expect(database.execute('SELECT COUNT(*) AS count FROM financial_account')[0]['count']).toBe(0);
  });

  it('persists the application import, categorization, posting, and report path', async () => {
    await TestBed.configureTestingModule({
      providers: [
        SqliteDatabaseGateway,
        SqliteAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: SqliteAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ],
    }).compileComponents();

    const database = TestBed.inject(SqliteDatabaseGateway);
    const repository = TestBed.inject(SqliteAccountingRepository);
    await repository.initialize();
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const account = application.listAccounts()[0];
    const expense = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const preview = application.previewImport({
      fileName: 'persistence.csv',
      content: 'Date,Description,Amount\n2026-02-01,Packaging Supplies,-25.00',
      kind: 'CSV',
      destinationAccountId: account.id,
    });
    application.commitImport(preview.previewToken);
    const pending = application.listTransactions({ states: ['PENDING'] }).items[0];
    application.categorize(pending.id, expense.id);
    application.clearCategorization(pending.id);
    const pendingDatabase = new SqliteDatabaseGateway();
    const pendingRepository = new SqliteAccountingRepository(pendingDatabase);
    await pendingRepository.initialize(database.exportBytes());
    expect(pendingRepository.transactions.get(pending.id)?.state).toBe('PENDING');
    expect(pendingRepository.transactions.get(pending.id)?.splits).toEqual([]);
    expect(pendingRepository.transactions.get(pending.id)?.categorizationSource).toBe('CLEARED');
    application.categorize(pending.id, expense.id);
    application.post([pending.id]);
    const report = application.getProfitLoss('2026-01-01', '2026-12-31', 'YEAR');
    expect(report.netProfitMinor).toBe(-2500n);

    const reopenedDatabase = new SqliteDatabaseGateway();
    const reopenedRepository = new SqliteAccountingRepository(reopenedDatabase);
    await reopenedRepository.initialize(database.exportBytes());
    expect(reopenedRepository.transactions.size).toBe(1);
    expect([...reopenedRepository.transactions.values()][0].state).toBe('POSTED');
    expect(reopenedRepository.audit.some(event => event.operation === 'POST_TRANSACTION')).toBeTrue();
    const backup = JSON.parse(application.createBackupBundle()) as { databaseBase64?: string; databaseHash?: string };
    expect(backup.databaseBase64).toBeTruthy();
    expect(backup.databaseHash).toBeTruthy();
  });

  it('persists audited rule editor mutations and deletion in SQLite', async () => {
    await TestBed.configureTestingModule({
      providers: [
        SqliteDatabaseGateway,
        SqliteAccountingRepository,
        { provide: ACCOUNTING_REPOSITORY, useExisting: SqliteAccountingRepository },
        ImportPipelineService,
        BackupBundleService,
        { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
      ],
    }).compileComponents();
    const database = TestBed.inject(SqliteDatabaseGateway);
    const repository = TestBed.inject(SqliteAccountingRepository);
    await repository.initialize();
    const application = TestBed.inject(ACCOUNTING_APPLICATION);
    const category = application.listChartAccounts().find(item => item.name === 'Operating Expenses')!;
    const saved = application.saveRule({
      id: '', name: 'SQLite editor rule', enabled: true, priority: 1,
      conditions: [{ field: 'DESCRIPTION', operator: 'CONTAINS', value: 'SQLITE RULE' }],
      chartAccountId: category.id, matchMode: 'ALL',
    });
    application.setRuleEnabled(saved.id, false);

    const reopenedDatabase = new SqliteDatabaseGateway();
    const reopenedRepository = new SqliteAccountingRepository(reopenedDatabase);
    await reopenedRepository.initialize(database.exportBytes());
    expect(reopenedRepository.rules.get(saved.id)).toEqual(jasmine.objectContaining({ name: 'SQLite editor rule', enabled: false }));

    application.deleteRule(saved.id);
    const afterDeleteDatabase = new SqliteDatabaseGateway();
    const afterDeleteRepository = new SqliteAccountingRepository(afterDeleteDatabase);
    await afterDeleteRepository.initialize(database.exportBytes());
    expect(afterDeleteRepository.rules.has(saved.id)).toBeFalse();
    expect(afterDeleteRepository.audit.some(event => event.operation === 'DELETE_RULE' && event.entityId === saved.id)).toBeTrue();
  });
});
