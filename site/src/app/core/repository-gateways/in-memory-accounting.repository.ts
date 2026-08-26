import { Injectable } from '@angular/core';
import { AuditEvent, FinancialAccount, newId, nowUtc } from '../domain-model/accounting.types';
import { CompanyProfile, databaseRevision, DatabaseRevision } from '../domain-model/balance-sheet.types';
import { CashFlowClassification, getDefaultCashFlowClassification, validateCashFlowClassification } from '../domain-model/cash-flow-classification';
import { validateAccountUse } from '../domain-model/account-taxonomy';
import {
  AccountingRepository,
  BalanceSheetRepositorySnapshot,
  CashFlowClassificationRecord,
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
  cashFlowClassifications = new Map<string, CashFlowClassificationRecord>();
  private persistedFinancialAccountIds = new Set<string>();
  private persistedChartAccountIds = new Set<string>();
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
      cashFlowClassifications: [...this.cashFlowClassifications.values()],
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
      cashFlowClassifications: payload.cashFlowClassifications,
    });
  }

  readCashFlowSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot {
    return this.readBalanceSheetSnapshot(asOfDate);
  }

  getDatabaseRevision(): DatabaseRevision {
    const payload = {
      company: this.company,
      profile: this.profile,
      accounts: [...this.accounts.values()],
      chartAccounts: [...this.chartAccounts.values()],
      transactions: [...this.transactions.values()],
      transfers: [...this.transfers.values()],
      cashFlowClassifications: [...this.cashFlowClassifications.values()],
      audit: this.audit,
    };
    return databaseRevision(this.revision(payload));
  }

  getCashFlowClassification(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): CashFlowClassificationRecord | undefined {
    const value = this.cashFlowClassifications.get(`${accountRole}:${accountId}`);
    return value ? structuredClone(value) : undefined;
  }

  saveCashFlowClassifications(updates: readonly CashFlowClassificationRecord[], expectedRevision?: DatabaseRevision): DatabaseRevision {
    if (expectedRevision !== undefined && expectedRevision !== this.getDatabaseRevision()) throw new Error('Cash Flow classification update is stale; reload the current database revision.');
    this.transaction(() => updates.forEach(update => {
      const account = update.accountRole === 'FINANCIAL_SOURCE' ? this.accounts.get(update.accountId) : this.chartAccounts.get(update.accountId);
      if (!account) throw new Error(`Cash Flow account not found: ${update.accountRole}/${update.accountId}.`);
      const normalizedAccountType = String(account.accountType).trim();
      const normalizedDetailType = String(account.detailType).trim();
      const accountUse = validateAccountUse({ accountType: normalizedAccountType, requestedRole: update.accountRole });
      if (!accountUse.ok) throw new Error(`Invalid Cash Flow account structure for ${update.accountId}: ${accountUse.error.code}.`);
      const validation = validateCashFlowClassification({
        accountRole: update.accountRole,
        accountType: normalizedAccountType,
        detailType: normalizedDetailType,
        classification: update,
      });
      if (!validation.ok) throw new Error(`Invalid Cash Flow classification for ${update.accountId}: ${validation.error.code}.`);
      const modifiedAtUtc = update.modifiedAtUtc ?? nowUtc();
      if (new Date(modifiedAtUtc).toISOString() !== modifiedAtUtc) throw new Error(`Invalid Cash Flow classification timestamp for ${update.accountId}.`);
      const key = `${update.accountRole}:${update.accountId}`;
      const before = this.cashFlowClassifications.get(key);
      const normalized: CashFlowClassificationRecord = {
        ...validation.value.classification,
        modifiedAtUtc,
        accountRole: update.accountRole,
        accountId: update.accountId,
        accountType: normalizedAccountType,
        detailType: normalizedDetailType,
      };
      this.cashFlowClassifications.set(key, normalized);
      this.audit.push({
        id: newId(), timestampUtc: modifiedAtUtc, operation: 'SAVE_CASH_FLOW_CLASSIFICATION',
        entityType: update.accountRole === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
        entityId: update.accountId, before: before ? structuredClone(before) : undefined,
        after: structuredClone(normalized), reason: normalized.rationale,
      });
    }));
    return this.getDatabaseRevision();
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
      cashFlowClassifications: structuredClone(this.cashFlowClassifications),
      persistedFinancialAccountIds: structuredClone(this.persistedFinancialAccountIds),
      persistedChartAccountIds: structuredClone(this.persistedChartAccountIds),
    };
    try {
      const result = work();
      this.prepareCashFlowClassifications();
      this.persistedFinancialAccountIds = new Set(this.accounts.keys());
      this.persistedChartAccountIds = new Set(this.chartAccounts.keys());
      return result;
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
      this.cashFlowClassifications = snapshot.cashFlowClassifications;
      this.persistedFinancialAccountIds = snapshot.persistedFinancialAccountIds;
      this.persistedChartAccountIds = snapshot.persistedChartAccountIds;
      throw error;
    }
  }

  private prepareCashFlowClassifications(): void {
    const next = new Map<string, CashFlowClassificationRecord>();
    for (const account of this.accounts.values()) next.set(`FINANCIAL_SOURCE:${account.id}`, this.classificationFor('FINANCIAL_SOURCE', account.id, account.accountType, account.detailType, this.persistedFinancialAccountIds.has(account.id)));
    for (const account of this.chartAccounts.values()) next.set(`CHART:${account.id}`, this.classificationFor('CHART', account.id, account.accountType, account.detailType, this.persistedChartAccountIds.has(account.id)));
    this.cashFlowClassifications = next;
  }

  private classificationFor(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string, accountType: string, detailType: string, persisted: boolean): CashFlowClassificationRecord {
    const normalizedAccountType = accountType.trim();
    const normalizedDetailType = detailType.trim();
    const accountUse = validateAccountUse({ accountType: normalizedAccountType, requestedRole: accountRole });
    if (!accountUse.ok) throw new Error(`Existing account ${accountId} has an incompatible Cash Flow role/type: ${accountUse.error.code}.`);
    const key = `${accountRole}:${accountId}`;
    const existing = this.cashFlowClassifications.get(key);
    if (existing && existing.accountType === normalizedAccountType && existing.detailType === normalizedDetailType) {
      const validation = validateCashFlowClassification({ accountRole, accountType: normalizedAccountType, detailType: normalizedDetailType, classification: existing });
      if (validation.ok) {
        if (existing.modifiedAtUtc !== undefined && new Date(existing.modifiedAtUtc).toISOString() !== existing.modifiedAtUtc) {
          throw new Error(`Existing Cash Flow classification for ${accountId} has an invalid timestamp. Reclassify it explicitly before saving the account.`);
        }
        return { ...existing, ...validation.value.classification, accountType: normalizedAccountType, detailType: normalizedDetailType };
      }
      throw new Error(`Existing Cash Flow classification for ${accountId} is invalid: ${validation.error.code}. Reclassify it explicitly before saving the account.`);
    }
    if (persisted) throw new Error(`Existing Cash Flow classification for ${accountId} no longer matches its account structure. Reclassify it explicitly before saving the account.`);
    const seeded = getDefaultCashFlowClassification({ accountRole, accountType: normalizedAccountType, detailType: normalizedDetailType });
    if (!seeded.ok) throw new Error(`Unable to seed Cash Flow classification for ${accountId}: ${seeded.error.code}.`);
    return { ...seeded.value, accountRole, accountId, accountType: normalizedAccountType, detailType: normalizedDetailType };
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
