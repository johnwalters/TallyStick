import { InjectionToken } from '@angular/core';
import {
  AuditEvent,
  ChartAccount,
  Company,
  FinancialAccount,
  ImportBatch,
  TaxYearSettings,
  Transaction,
  TransactionRule,
  TransferMatch,
} from '../domain-model/accounting.types';

export interface AccountingRepository {
  company: Company;
  accounts: Map<string, FinancialAccount>;
  chartAccounts: Map<string, ChartAccount>;
  transactions: Map<string, Transaction>;
  batches: Map<string, ImportBatch>;
  rules: Map<string, TransactionRule>;
  transfers: Map<string, TransferMatch>;
  taxSettings: Map<number, TaxYearSettings>;
  audit: AuditEvent[];
  transaction<T>(work: () => T): T;
  exportDatabaseBytes?(): Uint8Array;
}

export const ACCOUNTING_REPOSITORY = new InjectionToken<AccountingRepository>('AccountingRepository');
