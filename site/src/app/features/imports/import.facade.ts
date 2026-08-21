import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication, ImportSourceInput } from '../../core/application-interface/accounting.application';
import { ImportPreview } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class ImportFacade {
  readonly preview = signal<ImportPreview | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  inspect(source: ImportSourceInput): ImportPreview | undefined {
    try {
      this.error.set(undefined);
      const result = this.application.previewImport(source);
      this.preview.set(result);
      return result;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to inspect import.');
      return undefined;
    }
  }

  commit(): ImportPreview | undefined {
    const current = this.preview();
    if (!current) return undefined;
    try {
      const result = this.application.commitImport(current.previewToken);
      this.preview.set(undefined);
      return result;
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to commit import.');
      return undefined;
    }
  }
}
