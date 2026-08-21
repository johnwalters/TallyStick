import { DesktopDatabaseLifecycleGateway } from './database-lifecycle.gateway';

describe('DesktopDatabaseLifecycleGateway', () => {
  afterEach(() => delete (globalThis as { localAccounting?: unknown }).localAccounting);

  it('reports browser mode without exposing filesystem concerns', async () => {
    const gateway = new DesktopDatabaseLifecycleGateway();
    await expectAsync(gateway.getLocations()).toBeResolvedTo({ currentDatabasePath: '', desktopAvailable: false });
    await expectAsync(gateway.backupNow()).toBeRejectedWithError(/desktop application/);
  });

  it('maps the desktop bridge to stable application DTOs', async () => {
    const backupNow = jasmine.createSpy('backupNow').and.resolveTo({ operation: 'BACKUP', path: '/backups/one.sqlite', completedAtUtc: '2026-08-11T17:04:05.000Z', restartRequired: false });
    (globalThis as { localAccounting?: unknown }).localAccounting = {
      databaseLifecycle: {
        getLocations: async () => ({ currentDatabasePath: '/books/tallystick.sqlite', backupDirectory: '/backups' }),
        chooseBackupDirectory: async () => ({ currentDatabasePath: '/books/tallystick.sqlite', backupDirectory: '/chosen' }),
        backupNow,
        relocateCurrentDatabase: async () => undefined,
        restoreDatabaseBackup: async () => undefined,
      },
    };
    const gateway = new DesktopDatabaseLifecycleGateway();

    expect(await gateway.getLocations()).toEqual({ currentDatabasePath: '/books/tallystick.sqlite', backupDirectory: '/backups', desktopAvailable: true });
    expect((await gateway.chooseBackupDirectory())?.backupDirectory).toBe('/chosen');
    expect((await gateway.backupNow()).path).toBe('/backups/one.sqlite');
    expect(backupNow).toHaveBeenCalled();
  });
});
