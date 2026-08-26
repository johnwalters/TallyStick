import { BackupBundleService } from './backup-bundle.service';

describe('BackupBundleService', () => {
  it('creates and verifies a versioned integrity bundle', () => {
    const service = new BackupBundleService();
    const bundle = service.create('{"version":1,"schemaVersion":1,"company":{"id":"company-1"},"accounts":[],"transactions":[],"audit":[]}', 1, { companyId: 'company-1' });
    expect(service.verify(bundle).valid).toBeTrue();
    const tampered = bundle.replace('company-1', 'company-2');
    expect(service.verify(tampered).valid).toBeFalse();
  });
});
