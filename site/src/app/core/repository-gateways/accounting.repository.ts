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
import { CashFlowClassification } from '../domain-model/cash-flow-classification';

export interface CashFlowClassificationRecord extends CashFlowClassification {
  readonly accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  readonly accountId: string;
  readonly accountType: string;
  readonly detailType: string;
}

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
  readonly cashFlowClassifications: readonly CashFlowClassificationRecord[];
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
  cashFlowClassifications: Map<string, CashFlowClassificationRecord>;
  getCompanyProfile(): CompanyProfile | undefined;
  saveCompanyProfile(profile: CompanyProfile, taxIdentifier: TaxIdentifierPersistence): void;
  revealCompanyTaxIdentifier(): string | undefined;
  exportCompanyProfile(): PersistedCompanyProfile | undefined;
  readBalanceSheetSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot;
  readCashFlowSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot;
  getCashFlowClassification(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): CashFlowClassificationRecord | undefined;
  saveCashFlowClassifications(updates: readonly CashFlowClassificationRecord[], expectedRevision?: DatabaseRevision): DatabaseRevision;
  getDatabaseRevision(): DatabaseRevision;
  transaction<T>(work: () => T): T;
  exportDatabaseBytes?(): Uint8Array;
}

export const ACCOUNTING_REPOSITORY = new InjectionToken<AccountingRepository>('AccountingRepository');
