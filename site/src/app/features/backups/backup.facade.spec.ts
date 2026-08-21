import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication, DatabaseLocations } from '../../core/application-interface/accounting.application';
import { BackupFacade } from './backup.facade';

describe('BackupFacade database lifecycle', () => {
  let application: jasmine.SpyObj<AccountingApplication>;
  let facade: BackupFacade;
  const locations: DatabaseLocations = {
    currentDatabasePath: '/books/tallystick.sqlite', backupDirectory: '/backups', desktopAvailable: true,
  };

  beforeEach(() => {
    application = jasmine.createSpyObj<AccountingApplication>('AccountingApplication', [
      'getDatabaseLocations', 'chooseBackupDirectory', 'backupDatabaseNow', 'relocateCurrentDatabase', 'restoreDatabaseBackup',
    ]);
    TestBed.configureTestingModule({ providers: [BackupFacade, { provide: ACCOUNTING_APPLICATION, useValue: application }] });
    facade = TestBed.inject(BackupFacade);
  });

  it('loads locations and refreshes latest verified metadata after backup', async () => {
    application.getDatabaseLocations.and.resolveTo(locations);
    application.backupDatabaseNow.and.resolveTo({
      operation: 'BACKUP', path: '/backups/tallystick-2026-08-11-170405.sqlite', completedAtUtc: '2026-08-11T17:04:05.000Z', restartRequired: false,
    });
    application.getDatabaseLocations.and.resolveTo({
      ...locations, latestVerifiedBackupPath: '/backups/tallystick-2026-08-11-170405.sqlite', latestVerifiedBackupAtUtc: '2026-08-11T17:04:05.000Z',
    });

    const result = await facade.backupNow();

    expect(result?.operation).toBe('BACKUP');
    expect(facade.locations().latestVerifiedBackupPath).toContain('tallystick-2026-08-11-170405.sqlite');
    expect(facade.lastOperation()).toEqual(result);
    expect(facade.busy()).toBeFalse();
    expect(facade.error()).toBeUndefined();
  });

  it('surfaces a desktop operation failure without changing the last successful operation', async () => {
    application.backupDatabaseNow.and.rejectWith(new Error('SQLite integrity check failed.'));

    const result = await facade.backupNow();

    expect(result).toBeUndefined();
    expect(facade.error()).toBe('SQLite integrity check failed.');
    expect(facade.lastOperation()).toBeUndefined();
    expect(facade.busy()).toBeFalse();
  });
});
