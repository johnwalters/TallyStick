import { APP_INITIALIZER, ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';

import { routes } from './app.routes';
import { ACCOUNTING_APPLICATION } from './core/application-interface/accounting.application';
import { DefaultAccountingApplication } from './core/application-services/default-accounting.application';
import { ImportPipelineService } from './core/import-services/import-pipeline.service';
import { ACCOUNTING_REPOSITORY } from './core/repository-gateways/accounting.repository';
import { SqliteAccountingRepository } from './core/repository-gateways/sqlite-accounting.repository';
import { SqliteDatabaseGateway } from './core/sqlite-gateway/sqlite-database.gateway';
import { BackupBundleService } from './core/backup-services/backup-bundle.service';

function initializeAccountingRepository(repository: SqliteAccountingRepository): () => Promise<void> {
  return () => repository.initialize();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withHashLocation()),
    SqliteDatabaseGateway,
    SqliteAccountingRepository,
    { provide: ACCOUNTING_REPOSITORY, useExisting: SqliteAccountingRepository },
    { provide: APP_INITIALIZER, useFactory: initializeAccountingRepository, deps: [SqliteAccountingRepository], multi: true },
    ImportPipelineService,
    BackupBundleService,
    { provide: ACCOUNTING_APPLICATION, useClass: DefaultAccountingApplication },
  ]
};
