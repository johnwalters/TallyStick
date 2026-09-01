import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import { Transaction, TransactionQuery } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class TransactionFacade {
  readonly items = signal<Transaction[]>([]);
  readonly total = signal(0);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly detail = signal<ReturnType<AccountingApplication['getTransactionDetail']> | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  load(query: TransactionQuery): void {
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const result = this.application.listTransactions(query);
      this.items.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to load transactions.');
    } finally {
      this.busy.set(false);
    }
  }

  post(ids: string[]): void { this.runMutation(() => this.application.post(ids)); }
  postWithCategory(id: string, chartAccountId: string): void { this.runMutation(() => [this.application.postWithCategory(id, chartAccountId)]); }
  postWithCategories(items: Array<{ id: string; chartAccountId: string }>): void { this.runMutation(() => this.application.postWithCategories(items)); }
  acceptSuggestion(id: string): void { this.runMutation(() => [this.application.acceptSuggestion(id)]); }
  categorize(ids: string[], chartAccountId: string, rationale?: string): void { this.runMutation(() => this.application.categorizeMany(ids, chartAccountId, rationale)); }
  clearCategorization(id: string, rationale?: string): void { this.runMutation(() => [this.application.clearCategorization(id, rationale)]); }
  exclude(ids: string[], reason: string): void { this.runMutation(() => this.application.exclude(ids, reason)); }
  deleteExcluded(ids: string[]): void { this.runMutation(() => { this.application.deleteExcluded(ids); return []; }); }
  confirmTransfer(leftId: string, rightId: string, rationale?: string): void { this.runMutation(() => { this.application.confirmTransfer(leftId, rightId, rationale); return []; }); }
  undo(ids: string[]): void { this.runMutation(() => this.application.undo(ids)); }
  correctAmount(id: string, amountMinor: bigint, rationale: string, expectedModifiedAtUtc?: string): void { this.runMutation(() => [this.application.correctAmount(id, amountMinor, rationale, expectedModifiedAtUtc)]); }
  loadDetail(id: string): void { try { this.error.set(undefined); this.detail.set(this.application.getTransactionDetail(id)); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Unable to load transaction detail.'); } }

  private runMutation(work: () => Transaction[]): void {
    this.busy.set(true);
    this.error.set(undefined);
    try { work(); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Transaction operation failed.'); }
    finally { this.busy.set(false); }
  }
}
