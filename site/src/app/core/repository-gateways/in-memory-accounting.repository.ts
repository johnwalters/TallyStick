import { Injectable } from '@angular/core';
import { AuditEvent, FinancialAccount, newId } from '../domain-model/accounting.types';
import { CompanyProfile, databaseRevision } from '../domain-model/balance-sheet.types';
import {
  AccountingRepository,
  BalanceSheetRepositorySnapshot,
  PersistedCompanyProfile,
  TaxIdentifierPersistence,
} from './accounting.repository';

@Injectable()
export class InMemoryAccountingRepository implements AccountingRepository {
  company = {
    id: newId(),
    name: 'Example Outfitters LLC',
    currency: 'USD' as const,
    fiscalYearStartMonth: 1,
    accountingBasis: 'CASH' as const,
    activeTaxYear: new Date().getFullYear(),
  };
  accounts = new Map();
  chartAccounts = new Map();
  transactions = new Map();
  batches = new Map();
  rules = new Map();
  transfers = new Map();
  taxSettings = new Map();
  audit: AuditEvent[] = [];
  private profile?: CompanyProfile;
  private taxIdentifier?: string;

  getCompanyProfile(): CompanyProfile | undefined {
    return this.profile ? structuredClone(this.profile) : undefined;
  }

  saveCompanyProfile(profile: CompanyProfile, taxIdentifier: TaxIdentifierPersistence): void {
    this.profile = structuredClone(profile);
    if (taxIdentifier.mode === 'SET') this.taxIdentifier = taxIdentifier.value;
    if (taxIdentifier.mode === 'CLEAR') this.taxIdentifier = undefined;
  }

  revealCompanyTaxIdentifier(): string | undefined {
    return this.taxIdentifier;
  }

  exportCompanyProfile(): PersistedCompanyProfile | undefined {
    if (!this.profile) return undefined;
    const { maskedTaxIdentifier: _masked, ...profile } = this.profile;
    return structuredClone({ ...profile, taxIdentifier: this.taxIdentifier });
  }

  readBalanceSheetSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot {
    const payload = {
      company: this.company,
      profile: this.profile,
      accounts: [...this.accounts.values()] as FinancialAccount[],
      chartAccounts: [...this.chartAccounts.values()],
      transactions: [...this.transactions.values()],
      transfers: [...this.transfers.values()],
      audit: this.audit,
    };
    return structuredClone({
      asOfDate,
      databaseRevision: databaseRevision(this.revision(payload)),
      company: this.company,
      companyProfile: this.profile,
      accounts: payload.accounts,
      chartAccounts: payload.chartAccounts,
      transactions: payload.transactions,
      transfers: payload.transfers,
    });
  }

  transaction<T>(work: () => T): T {
    const snapshot = {
      company: structuredClone(this.company),
      profile: structuredClone(this.profile),
      taxIdentifier: this.taxIdentifier,
      accounts: structuredClone(this.accounts),
      chartAccounts: structuredClone(this.chartAccounts),
      transactions: structuredClone(this.transactions),
      batches: structuredClone(this.batches),
      rules: structuredClone(this.rules),
      transfers: structuredClone(this.transfers),
      taxSettings: structuredClone(this.taxSettings),
      audit: structuredClone(this.audit),
    };
    try {
      return work();
    } catch (error) {
      this.company = snapshot.company;
      this.profile = snapshot.profile;
      this.taxIdentifier = snapshot.taxIdentifier;
      this.accounts = snapshot.accounts;
      this.chartAccounts = snapshot.chartAccounts;
      this.transactions = snapshot.transactions;
      this.batches = snapshot.batches;
      this.rules = snapshot.rules;
      this.transfers = snapshot.transfers;
      this.taxSettings = snapshot.taxSettings;
      this.audit = snapshot.audit;
      throw error;
    }
  }

  private revision(value: unknown): string {
    const serialized = JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return `${item}n`;
      if (item instanceof Map) return [...item.entries()];
      return item;
    });
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `memory:${(hash >>> 0).toString(16)}`;
  }
}
