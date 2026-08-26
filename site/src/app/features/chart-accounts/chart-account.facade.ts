import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication, SaveChartAccountCommand } from '../../core/application-interface/accounting.application';
import { ChartAccount, ChartAccountImportPreview } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class ChartAccountFacade {
  readonly accounts = signal<ChartAccount[]>([]);
  readonly importPreview = signal<ChartAccountImportPreview | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  load(): void { this.run(() => this.accounts.set(this.application.listChartAccounts())); }

  create(command: SaveChartAccountCommand): ChartAccount | undefined {
    return this.run(() => {
      const account = this.application.createChartAccount(command);
      this.accounts.set(this.application.listChartAccounts());
      return account;
    });
  }

  update(id: string, command: SaveChartAccountCommand): ChartAccount | undefined {
    return this.run(() => {
      const account = this.application.updateChartAccount(id, command);
      this.accounts.set(this.application.listChartAccounts());
      return account;
    });
  }

  archive(id: string, archived: boolean): ChartAccount | undefined {
    return this.run(() => {
      const account = this.application.archiveChartAccount(id, archived);
      this.accounts.set(this.application.listChartAccounts());
      return account;
    });
  }

  import(content: string | ArrayBuffer): ChartAccount[] | undefined {
    return this.run(() => {
      const accounts = this.application.importChartAccounts(content);
      this.accounts.set(accounts);
      return accounts;
    });
  }

  preview(content: string | ArrayBuffer): ChartAccountImportPreview | undefined {
    return this.run(() => {
      const preview = this.application.previewChartAccountsImport(content);
      this.importPreview.set(preview);
      return preview;
    });
  }

  commitImport(): ChartAccount[] | undefined {
    return this.run(() => {
      const preview = this.importPreview();
      if (!preview) throw new Error('Choose a Chart of Accounts workbook first.');
      const accounts = this.application.commitChartAccountsImport(preview.previewToken);
      this.importPreview.set(undefined);
      this.accounts.set(accounts);
      return accounts;
    });
  }

  export(): ArrayBuffer { return this.application.exportChartAccounts(); }

  private run<T>(work: () => T): T | undefined {
    this.error.set(undefined);
    try { return work(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Chart of Accounts operation failed.'); return undefined; }
  }
}
