import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication, CreateAccountCommand, SaveAccountCommand } from '../../core/application-interface/accounting.application';
import { FinancialAccount } from '../../core/domain-model/accounting.types';

@Injectable({ providedIn: 'root' })
export class AccountFacade {
  readonly accounts = signal<FinancialAccount[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  load(): void { this.run(() => this.accounts.set(this.application.listAccounts())); }

  create(command: CreateAccountCommand): FinancialAccount | undefined {
    let created: FinancialAccount | undefined;
    this.run(() => { created = this.application.createAccount(command); this.accounts.set(this.application.listAccounts()); });
    return created;
  }

  update(id: string, command: SaveAccountCommand): FinancialAccount | undefined {
    let updated: FinancialAccount | undefined;
    this.run(() => { updated = this.application.updateAccount(id, command); this.accounts.set(this.application.listAccounts()); });
    return updated;
  }

  archive(id: string, archived: boolean): void {
    this.run(() => { this.application.archiveAccount(id, archived); this.accounts.set(this.application.listAccounts()); });
  }

  private run(work: () => void): void {
    this.busy.set(true);
    this.error.set(undefined);
    try { work(); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Account operation failed.'); }
    finally { this.busy.set(false); }
  }
}
