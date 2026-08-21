import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import { ChartAccount, RuleImportPreview, TransactionRule } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class SetupFacade {
  readonly chartAccounts = signal<ChartAccount[]>([]);
  readonly rules = signal<TransactionRule[]>([]);
  readonly ruleImportPreview = signal<RuleImportPreview | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  load(): void {
    this.run(() => {
      this.chartAccounts.set(this.application.listChartAccounts());
      this.rules.set(this.application.listRules());
    });
  }

  importChart(content: string | ArrayBuffer): void {
    this.run(() => this.chartAccounts.set(this.application.importChartAccounts(content)));
  }

  importRules(content: string | ArrayBuffer): void {
    this.run(() => this.rules.set(this.application.importRulesWorkbook(content)));
  }

  previewRulesImport(content: string | ArrayBuffer): void {
    this.run(() => this.ruleImportPreview.set(this.application.previewRulesImport(content)));
  }

  commitRulesImport(): void {
    const preview = this.ruleImportPreview();
    if (!preview) { this.error.set('Choose a rule exchange file first.'); return; }
    this.run(() => { this.rules.set(this.application.commitRulesImport(preview.previewToken)); this.ruleImportPreview.set(undefined); });
  }

  exportRules(format: 'XLSX' | 'CSV'): ArrayBuffer | string { return this.application.exportRules(format); }

  private run(work: () => void): void {
    this.error.set(undefined);
    try { work(); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Books setup failed.'); }
  }
}
