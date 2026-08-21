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
import {
  CompanyProfile,
  DatabaseRevision,
} from '../domain-model/balance-sheet.types';

export interface PersistedCompanyProfile extends Omit<CompanyProfile, 'maskedTaxIdentifier'> {
  readonly taxIdentifier?: string;
}

export type TaxIdentifierPersistence =
  | { readonly mode: 'PRESERVE' }
  | { readonly mode: 'SET'; readonly value: string }
  | { readonly mode: 'CLEAR' };

export interface BalanceSheetRepositorySnapshot {
  readonly asOfDate: string;
  readonly databaseRevision: DatabaseRevision;
  readonly company: Company;
  readonly companyProfile?: CompanyProfile;
  readonly accounts: readonly FinancialAccount[];
  readonly chartAccounts: readonly ChartAccount[];
  readonly transactions: readonly Transaction[];
  readonly transfers: readonly TransferMatch[];
}

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
  getCompanyProfile(): CompanyProfile | undefined;
  saveCompanyProfile(profile: CompanyProfile, taxIdentifier: TaxIdentifierPersistence): void;
  revealCompanyTaxIdentifier(): string | undefined;
  exportCompanyProfile(): PersistedCompanyProfile | undefined;
  readBalanceSheetSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot;
  transaction<T>(work: () => T): T;
  exportDatabaseBytes?(): Uint8Array;
}

export const ACCOUNTING_REPOSITORY = new InjectionToken<AccountingRepository>('AccountingRepository');
