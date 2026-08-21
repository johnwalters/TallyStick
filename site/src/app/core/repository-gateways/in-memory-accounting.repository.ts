import { Injectable } from '@angular/core';
import { newId } from '../domain-model/accounting.types';
import { AccountingRepository } from './accounting.repository';

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
  audit = [];

  transaction<T>(work: () => T): T {
    const snapshot = {
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
}
