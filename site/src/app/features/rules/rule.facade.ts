import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import { TransactionRule } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class RuleFacade {
  readonly rules = signal<TransactionRule[]>([]);
  readonly testResults = signal<Array<{ transactionId: string; matched: boolean; rationale: string }>>([]);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  load(): void { this.run(() => this.rules.set(this.application.listRules())); }
  save(rule: TransactionRule): TransactionRule | undefined {
    let saved: TransactionRule | undefined;
    this.run(() => { saved = this.application.saveRule(rule); this.rules.set(this.application.listRules()); });
    return saved;
  }
  enable(id: string, enabled: boolean): void { this.run(() => { this.application.setRuleEnabled(id, enabled); this.rules.set(this.application.listRules()); }); }
  duplicate(id: string): TransactionRule | undefined {
    let duplicate: TransactionRule | undefined;
    this.run(() => { duplicate = this.application.duplicateRule(id); this.rules.set(this.application.listRules()); });
    return duplicate;
  }
  delete(id: string): void { this.run(() => { this.application.deleteRule(id); this.rules.set(this.application.listRules()); }); }
  reorder(id: string, priority: number): void { this.run(() => { this.application.reorderRule(id, priority); this.rules.set(this.application.listRules()); }); }
  importWorkbook(content: string | ArrayBuffer): void { this.run(() => this.rules.set(this.application.importRulesWorkbook(content))); }
  test(rule: TransactionRule, transactionIds?: string[]): void { this.run(() => this.testResults.set(this.application.testRule(rule, transactionIds))); }
  draftFromTransaction(transactionId: string, chartAccountId?: string): TransactionRule | undefined {
    let draft: TransactionRule | undefined;
    this.run(() => { draft = this.application.createRuleDraftFromTransaction(transactionId, chartAccountId); });
    return draft;
  }

  private run(work: () => void): void {
    this.error.set(undefined);
    try { work(); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Rule operation failed.'); }
  }
}
