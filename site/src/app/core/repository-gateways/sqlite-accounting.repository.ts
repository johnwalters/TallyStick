import { Injectable } from '@angular/core';
import { SqliteDatabaseGateway } from '../sqlite-gateway/sqlite-database.gateway';
import {
  AuditEvent,
  ChartAccount,
  Company,
  FinancialAccount,
  ImportBatch,
  money,
  PostingSplit,
  TaxYearSettings,
  Transaction,
  TransactionRule,
  TransferMatch,
  nowUtc,
} from '../domain-model/accounting.types';
import { CompanyProfile, databaseRevision, DatabaseRevision } from '../domain-model/balance-sheet.types';
import {
  CashFlowClassification,
  getDefaultCashFlowClassification,
  validateCashFlowClassification,
} from '../domain-model/cash-flow-classification';
import { validateAccountUse } from '../domain-model/account-taxonomy';
import {
  AccountingRepository,
  BalanceSheetRepositorySnapshot,
  CashFlowClassificationRecord,
  PersistedCompanyProfile,
  TaxIdentifierPersistence,
} from './accounting.repository';

// sql.js returns dynamically shaped rows; the column names are constrained by
// the schema and mapped immediately into typed domain objects below.
type SqlRow = any;

interface RepositorySnapshot {
  company: Company;
  companyProfile?: CompanyProfile;
  taxIdentifier?: string;
  accounts: Map<string, FinancialAccount>;
  chartAccounts: Map<string, ChartAccount>;
  transactions: Map<string, Transaction>;
  batches: Map<string, ImportBatch>;
  rules: Map<string, TransactionRule>;
  transfers: Map<string, TransferMatch>;
  taxSettings: Map<number, TaxYearSettings>;
  audit: AuditEvent[];
  cashFlowClassifications: Map<string, CashFlowClassificationRecord>;
  persistedFinancialAccountIds: Set<string>;
  persistedChartAccountIds: Set<string>;
}

/**
 * SQLite-backed implementation of the stable application repository contract.
 *
 * The first persistence slice deliberately keeps the application-facing Map
 * collections. Each command transaction snapshots the domain state, executes
 * the existing application behavior, and atomically replaces the normalized
 * SQLite rows. This lets the application move to real persistence without
 * leaking SQL or SQLite types into the Application Service Interface.
 */
@Injectable()
export class SqliteAccountingRepository implements AccountingRepository {
  company: Company = {
    id: 'company-demo-outfitters',
    name: 'Example Outfitters LLC',
    currency: 'USD',
    fiscalYearStartMonth: 1,
    accountingBasis: 'CASH',
    activeTaxYear: new Date().getFullYear(),
  };
  accounts = new Map<string, FinancialAccount>();
  chartAccounts = new Map<string, ChartAccount>();
  transactions = new Map<string, Transaction>();
  batches = new Map<string, ImportBatch>();
  rules = new Map<string, TransactionRule>();
  transfers = new Map<string, TransferMatch>();
  taxSettings = new Map<number, TaxYearSettings>();
  audit: AuditEvent[] = [];
  cashFlowClassifications = new Map<string, CashFlowClassificationRecord>();
  private persistedFinancialAccountIds = new Set<string>();
  private persistedChartAccountIds = new Set<string>();

  private initialized = false;
  private companyProfile?: CompanyProfile;
  private taxIdentifier?: string;

  constructor(private readonly database: SqliteDatabaseGateway) {}

  async initialize(bytes?: Uint8Array): Promise<void> {
    if (this.initialized) return;
    await this.database.open(bytes);
    const integrity = this.database.integrityCheck();
    const foreignKeys = this.database.foreignKeyCheck();
    if (!integrity.valid || !foreignKeys.valid) throw new Error(`SQLite integrity check failed: ${integrity.message}; foreign-key violations: ${foreignKeys.violations.length}.`);
    this.loadState();
    this.initialized = true;
  }

  transaction<T>(work: () => T): T {
    this.requireInitialized();
    const snapshot = this.snapshot();
    let result!: T;
    try {
      this.database.transaction(() => {
        result = work();
        this.writeState();
      });
      return result;
    } catch (error) {
      // Re-read the authoritative SQLite state. This covers both a normal
      // rolled-back command and a post-commit host-file flush failure without
      // leaving the in-memory maps out of sync with SQLite.
      try { this.loadState(); } catch { this.restore(snapshot); }
      throw error;
    }
  }

  exportDatabaseBytes(): Uint8Array {
    this.requireInitialized();
    return this.database.exportBytes();
  }

  getCompanyProfile(): CompanyProfile | undefined {
    return this.companyProfile ? structuredClone(this.companyProfile) : undefined;
  }

  saveCompanyProfile(profile: CompanyProfile, taxIdentifier: TaxIdentifierPersistence): void {
    this.companyProfile = structuredClone(profile);
    if (taxIdentifier.mode === 'SET') this.taxIdentifier = taxIdentifier.value;
    if (taxIdentifier.mode === 'CLEAR') this.taxIdentifier = undefined;
  }

  revealCompanyTaxIdentifier(): string | undefined {
    return this.taxIdentifier;
  }

  exportCompanyProfile(): PersistedCompanyProfile | undefined {
    if (!this.companyProfile) return undefined;
    const { maskedTaxIdentifier: _masked, ...profile } = this.companyProfile;
    return structuredClone({ ...profile, taxIdentifier: this.taxIdentifier });
  }

  readBalanceSheetSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot {
    this.requireInitialized();
    return structuredClone({
      asOfDate,
      databaseRevision: this.getDatabaseRevision(),
      company: this.company,
      companyProfile: this.companyProfile,
      accounts: [...this.accounts.values()],
      chartAccounts: [...this.chartAccounts.values()],
      transactions: [...this.transactions.values()],
      transfers: [...this.transfers.values()],
      cashFlowClassifications: [...this.cashFlowClassifications.values()],
    });
  }

  readCashFlowSnapshot(asOfDate: string): BalanceSheetRepositorySnapshot {
    return this.readBalanceSheetSnapshot(asOfDate);
  }

  getDatabaseRevision(): DatabaseRevision {
    this.requireInitialized();
    const bytes = this.database.exportBytes();
    return databaseRevision(`sqlite:${this.database.schemaVersion()}:${this.hashBytes(bytes)}`);
  }

  getCashFlowClassification(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): CashFlowClassificationRecord | undefined {
    const value = this.cashFlowClassifications.get(this.classificationKey(accountRole, accountId));
    return value ? structuredClone(value) : undefined;
  }

  saveCashFlowClassifications(updates: readonly CashFlowClassificationRecord[], expectedRevision?: DatabaseRevision): DatabaseRevision {
    this.requireInitialized();
    if (expectedRevision !== undefined && expectedRevision !== this.getDatabaseRevision()) {
      throw new Error('Cash Flow classification update is stale; reload the current database revision.');
    }
    this.transaction(() => {
      for (const update of updates) {
        const structure = update.accountRole === 'FINANCIAL_SOURCE'
          ? this.accounts.get(update.accountId)
          : this.chartAccounts.get(update.accountId);
        if (!structure) throw new Error(`Cash Flow account not found: ${update.accountRole}/${update.accountId}.`);
        const normalizedAccountType = String(structure.accountType).trim();
        const normalizedDetailType = String(structure.detailType).trim();
        const accountUse = validateAccountUse({ accountType: normalizedAccountType, requestedRole: update.accountRole });
        if (!accountUse.ok) throw new Error(`Invalid Cash Flow account structure for ${update.accountId}: ${accountUse.error.code}.`);
        const validation = validateCashFlowClassification({
          accountRole: update.accountRole,
          accountType: normalizedAccountType,
          detailType: normalizedDetailType,
          classification: update,
        });
        if (!validation.ok) throw new Error(`Invalid Cash Flow classification for ${update.accountId}: ${validation.error.code}.`);
        const before = this.cashFlowClassifications.get(this.classificationKey(update.accountRole, update.accountId));
        const modifiedAtUtc = update.modifiedAtUtc ?? nowUtc();
        if (new Date(modifiedAtUtc).toISOString() !== modifiedAtUtc) throw new Error(`Invalid Cash Flow classification timestamp for ${update.accountId}.`);
        const normalized: CashFlowClassificationRecord = {
          ...validation.value.classification,
          modifiedAtUtc,
          accountRole: update.accountRole,
          accountId: update.accountId,
          accountType: normalizedAccountType,
          detailType: normalizedDetailType,
        };
        this.cashFlowClassifications.set(this.classificationKey(update.accountRole, update.accountId), normalized);
        this.audit.push({
          id: `cash-flow-classification:${update.accountRole}:${update.accountId}:${Date.now()}-${this.audit.length}`,
          timestampUtc: normalized.modifiedAtUtc ?? new Date().toISOString(),
          operation: 'SAVE_CASH_FLOW_CLASSIFICATION',
          entityType: update.accountRole === 'FINANCIAL_SOURCE' ? 'FinancialAccountCashFlowClassification' : 'ChartAccountCashFlowClassification',
          entityId: update.accountId,
          before: before ? structuredClone(before) : undefined,
          after: structuredClone(normalized),
          reason: normalized.rationale,
        });
      }
    });
    return this.getDatabaseRevision();
  }

  private loadState(): void {
    const company = this.database.execute('SELECT id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year FROM company LIMIT 1')[0] as SqlRow | undefined;
    if (company) {
      this.company = {
        id: String(company.id),
        name: String(company.name),
        currency: String(company.currency),
        fiscalYearStartMonth: Number(company.fiscal_year_start_month),
        accountingBasis: String(company.accounting_basis) as Company['accountingBasis'],
        activeTaxYear: Number(company.active_tax_year),
      };
    }

    const profile = this.database.execute('SELECT * FROM company_profile LIMIT 1')[0] as SqlRow | undefined;
    if (profile) {
      this.taxIdentifier = this.optionalString(profile.tax_identifier);
      const address = {
        line1: this.optionalString(profile.address_line_1),
        line2: this.optionalString(profile.address_line_2),
        locality: this.optionalString(profile.locality),
        region: this.optionalString(profile.region),
        postalCode: this.optionalString(profile.postal_code),
        countryCode: this.optionalString(profile.country_code),
      };
      this.companyProfile = {
        companyId: String(profile.company_id),
        legalName: String(profile.legal_name),
        displayName: String(profile.display_name),
        doingBusinessAs: this.optionalString(profile.doing_business_as),
        entityType: this.optionalString(profile.entity_type),
        address: Object.values(address).some(Boolean) ? address : undefined,
        phone: this.optionalString(profile.phone),
        email: this.optionalString(profile.email),
        website: this.optionalString(profile.website),
        maskedTaxIdentifier: this.maskTaxIdentifier(this.taxIdentifier),
        currencyCode: String(this.company.currency),
        fiscalYearStartMonth: this.company.fiscalYearStartMonth,
        accountingBasis: this.company.accountingBasis,
        activeTaxYear: this.company.activeTaxYear,
        createdAt: String(profile.created_at),
        modifiedAt: String(profile.modified_at),
      };
    } else {
      this.companyProfile = undefined;
      this.taxIdentifier = undefined;
    }

    this.accounts = new Map(this.database.execute('SELECT * FROM financial_account ORDER BY name').map(row => {
      const item = row as SqlRow;
      return [String(item.id), {
        id: String(item.id),
        type: String(item.type) as FinancialAccount['type'],
        accountType: String(item.account_type) as FinancialAccount['accountType'],
        classificationStatus: String(item.classification_status) as FinancialAccount['classificationStatus'],
        importEnabled: this.boolean(item.import_enabled),
        supportedSourceKinds: this.parseJson(item.supported_source_kinds_json, []),
        openingBalanceSource: String(item.opening_balance_source) as FinancialAccount['openingBalanceSource'],
        detailType: String(item.detail_type),
        name: String(item.name),
        institutionOrEntity: String(item.institution_or_entity),
        lastFour: item.last_four === null || item.last_four === undefined ? undefined : String(item.last_four),
        parentAccountId: item.parent_account_id === null || item.parent_account_id === undefined ? undefined : String(item.parent_account_id),
        description: item.description === null || item.description === undefined ? undefined : String(item.description),
        openingBalance: money(this.bigInt(item.opening_balance_minor), String(this.company.currency)),
        openingBalanceDate: String(item.opening_balance_date),
        archived: this.boolean(item.archived),
        locked: this.boolean(item.locked),
      } satisfies FinancialAccount];
    }));
    this.persistedFinancialAccountIds = new Set(this.accounts.keys());

    this.chartAccounts = new Map(this.database.execute('SELECT * FROM chart_account ORDER BY display_order, name').map(row => {
      const item = row as SqlRow;
      return [String(item.id), {
        id: String(item.id),
        name: String(item.name),
        parentId: item.parent_id === null || item.parent_id === undefined ? undefined : String(item.parent_id),
        type: String(item.type) as ChartAccount['type'],
        accountType: String(item.account_type) as ChartAccount['accountType'],
        detailType: String(item.detail_type),
        description: item.description === null || item.description === undefined ? undefined : String(item.description),
        displayOrder: Number(item.display_order),
        archived: this.boolean(item.archived),
        locked: this.boolean(item.locked),
      } satisfies ChartAccount];
    }));
    this.persistedChartAccountIds = new Set(this.chartAccounts.keys());

    this.cashFlowClassifications = new Map<string, CashFlowClassificationRecord>();
    if (this.tableExists('financial_account_cash_flow_classification')) {
      this.database.execute(`SELECT f.id AS account_id, f.account_type, f.detail_type,
        c.cash_flow_cash_role, c.cash_flow_treatment, c.cash_flow_status, c.cash_flow_source,
        c.cash_flow_rationale, c.cash_flow_modified_at_utc
        FROM financial_account f
        JOIN financial_account_cash_flow_classification c ON c.financial_account_id = f.id`).forEach(row => {
        this.setLoadedCashFlowClassification(row, 'FINANCIAL_SOURCE');
      });
      this.database.execute(`SELECT a.id AS account_id, a.account_type, a.detail_type,
        c.cash_flow_treatment, c.cash_flow_status, c.cash_flow_source,
        c.cash_flow_rationale, c.cash_flow_modified_at_utc
        FROM chart_account a
        JOIN chart_account_cash_flow_classification c ON c.chart_account_id = a.id`).forEach(row => {
        this.setLoadedCashFlowClassification(row, 'CHART');
      });
    }

    this.batches = new Map(this.database.execute('SELECT * FROM import_batch ORDER BY committed_at_utc, id').map(row => {
      const item = row as SqlRow;
      return [String(item.id), {
        id: String(item.id),
        destinationAccountId: String(item.destination_account_id),
        sourceKind: String(item.source_kind) as ImportBatch['sourceKind'],
        sourceName: String(item.source_name),
        sourceHash: String(item.source_hash),
        mappingVersion: String(item.mapping_version),
        acceptedCount: Number(item.accepted_count),
        rejectedCount: Number(item.rejected_count),
        skippedCount: Number(item.skipped_count),
        warningCount: Number(item.warning_count),
        totalAcceptedAmount: money(this.bigInt(item.total_accepted_minor), String(this.company.currency)),
        committedAtUtc: item.committed_at_utc === null ? undefined : String(item.committed_at_utc),
      } satisfies ImportBatch];
    }));

    const transactions = new Map<string, Transaction>();
    this.database.execute('SELECT * FROM transaction_record ORDER BY posting_date, id').forEach(row => {
      const item = row as SqlRow;
      transactions.set(String(item.id), {
        id: String(item.id),
        accountId: String(item.account_id),
        postingDate: String(item.posting_date),
        transactionDate: item.transaction_date === null ? undefined : String(item.transaction_date),
        amount: money(this.bigInt(item.amount_minor), String(item.currency)),
        rawDescription: String(item.raw_description),
        description: String(item.description),
        rawPayee: item.raw_payee === null ? undefined : String(item.raw_payee),
        payee: item.payee === null ? undefined : String(item.payee),
        memo: item.memo === null ? undefined : String(item.memo),
        reference: item.reference === null ? undefined : String(item.reference),
        state: String(item.state) as Transaction['state'],
        splits: [],
        sourceBatchId: item.source_batch_id === null ? undefined : String(item.source_batch_id),
        sourceRowNumber: item.source_row_number === null ? undefined : Number(item.source_row_number),
        categorizationSource: String(item.categorization_source || 'NONE') as Transaction['categorizationSource'],
        ruleId: item.rule_id === null ? undefined : String(item.rule_id),
        rationale: item.rationale === null ? undefined : String(item.rationale),
        exclusionReason: item.exclusion_reason === null ? undefined : String(item.exclusion_reason),
        transferMatchId: item.transfer_match_id === null ? undefined : String(item.transfer_match_id),
        createdAtUtc: String(item.created_at_utc),
        modifiedAtUtc: String(item.modified_at_utc),
        postedAtUtc: item.posted_at_utc === null ? undefined : String(item.posted_at_utc),
        excludedAtUtc: item.excluded_at_utc === null ? undefined : String(item.excluded_at_utc),
        undoneAtUtc: item.undone_at_utc === null ? undefined : String(item.undone_at_utc),
      });
    });
    this.database.execute('SELECT * FROM posting_split ORDER BY transaction_id, id').forEach(row => {
      const item = row as SqlRow;
      const transaction = transactions.get(String(item.transaction_id));
      if (!transaction) return;
      const split: PostingSplit = {
        id: String(item.id),
        chartAccountId: String(item.chart_account_id),
        amount: money(this.bigInt(item.amount_minor), transaction.amount.currency),
        memo: item.memo === null ? undefined : String(item.memo),
      };
      transaction.splits.push(split);
    });
    this.transactions = transactions;

    this.transfers = new Map(this.database.execute('SELECT * FROM transfer_match ORDER BY confirmed_at_utc, id').map(row => {
      const item = row as SqlRow;
      return [String(item.id), {
        id: String(item.id),
        leftTransactionId: String(item.left_transaction_id),
        rightTransactionId: String(item.right_transaction_id),
        confidence: Number(item.confidence),
        rationale: String(item.rationale),
        confirmedAtUtc: String(item.confirmed_at_utc),
      } satisfies TransferMatch];
    }));

    this.rules = new Map(this.database.execute('SELECT * FROM transaction_rule ORDER BY priority, id').map(row => {
      const item = row as SqlRow;
      const storedConditions = this.parseJson<unknown>(item.conditions_json, []);
      const conditionPayload = Array.isArray(storedConditions)
        ? { conditions: storedConditions, matchMode: 'ALL' as const }
        : storedConditions as { conditions?: unknown; matchMode?: 'ALL' | 'ANY' };
      return [String(item.id), {
        id: String(item.id),
        name: String(item.name),
        enabled: this.boolean(item.enabled),
        priority: Number(item.priority),
        conditions: (conditionPayload.conditions ?? []) as TransactionRule['conditions'],
        chartAccountId: item.chart_account_id === null ? undefined : String(item.chart_account_id),
        payee: item.payee === null ? undefined : String(item.payee),
        memo: item.memo === null ? undefined : String(item.memo),
        tags: this.parseJson<string[] | undefined>(item.tags_json, undefined),
        suggestExclude: this.boolean(item.suggest_exclude),
        matchMode: conditionPayload.matchMode ?? 'ALL',
      } satisfies TransactionRule];
    }));

    this.taxSettings = new Map(this.database.execute('SELECT * FROM tax_year_settings ORDER BY tax_year').map(row => {
      const item = row as SqlRow;
      return [Number(item.tax_year), {
        taxYear: Number(item.tax_year),
        federalIncomeTaxAccountIds: this.parseJson(item.federal_income_tax_account_ids_json, []),
        stateLocalIncomeTaxAccountIds: this.parseJson(item.state_local_income_tax_account_ids_json, []),
        includeFederalIncomeTax: this.boolean(item.include_federal_income_tax),
        includeStateLocalIncomeTax: this.boolean(item.include_state_local_income_tax),
        confirmedAtUtc: item.confirmed_at_utc === null ? undefined : String(item.confirmed_at_utc),
        accountantNote: item.accountant_note === null ? undefined : String(item.accountant_note),
      } satisfies TaxYearSettings];
    }));

    this.audit = this.database.execute('SELECT * FROM audit_event ORDER BY timestamp_utc, id').map(row => {
      const item = row as SqlRow;
      return {
        id: String(item.id),
        timestampUtc: String(item.timestamp_utc),
        operation: String(item.operation),
        entityType: String(item.entity_type),
        entityId: String(item.entity_id),
        before: this.parseJson(item.before_json, undefined),
        after: this.parseJson(item.after_json, undefined),
        reason: item.reason === null ? undefined : String(item.reason),
        correlationId: item.correlation_id === null ? undefined : String(item.correlation_id),
      } satisfies AuditEvent;
    });
  }

  private writeState(): void {
    this.prepareCashFlowClassifications();
    this.database.execute('DELETE FROM financial_account_cash_flow_classification');
    this.database.execute('DELETE FROM chart_account_cash_flow_classification');
    this.database.execute('DELETE FROM posting_split');
    this.database.execute('DELETE FROM transfer_match');
    this.database.execute('DELETE FROM transaction_record');
    this.database.execute('DELETE FROM import_batch');
    this.database.execute('DELETE FROM transaction_rule');
    this.database.execute('DELETE FROM tax_year_settings');
    this.database.execute('DELETE FROM audit_event');
    this.database.execute('DELETE FROM company_profile');
    this.database.execute('UPDATE chart_account SET parent_id = NULL');
    this.database.execute('DELETE FROM chart_account');
    this.database.execute('UPDATE financial_account SET parent_account_id = NULL');
    this.database.execute('DELETE FROM financial_account');
    this.database.execute('DELETE FROM company');

    this.database.execute('INSERT INTO company(id, name, currency, fiscal_year_start_month, accounting_basis, active_tax_year) VALUES (?, ?, ?, ?, ?, ?)', [
      this.company.id, this.company.name, this.company.currency, this.company.fiscalYearStartMonth, this.company.accountingBasis, this.company.activeTaxYear,
    ]);
    const profile = this.ensureCompanyProfile();
    this.database.execute(`INSERT INTO company_profile(
      company_id, legal_name, display_name, doing_business_as, entity_type,
      address_line_1, address_line_2, locality, region, postal_code, country_code,
      phone, email, website, tax_identifier, created_at, modified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      profile.companyId, profile.legalName, profile.displayName, profile.doingBusinessAs ?? null, profile.entityType ?? null,
      profile.address?.line1 ?? null, profile.address?.line2 ?? null, profile.address?.locality ?? null,
      profile.address?.region ?? null, profile.address?.postalCode ?? null, profile.address?.countryCode ?? null,
      profile.phone ?? null, profile.email ?? null, profile.website ?? null, this.taxIdentifier ?? null,
      profile.createdAt, profile.modifiedAt,
    ]);
    for (const account of this.parentFirst(this.accounts.values(), account => account.parentAccountId)) {
      this.database.execute(`INSERT INTO financial_account(
        id, type, account_type, classification_status, import_enabled, supported_source_kinds_json, opening_balance_source,
        detail_type, name, institution_or_entity, last_four, parent_account_id, description,
        opening_balance_minor, opening_balance_date, archived, locked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        account.id, account.type, account.accountType, account.classificationStatus, account.importEnabled ? 1 : 0,
        this.json(account.supportedSourceKinds), account.openingBalanceSource, account.detailType, account.name,
        account.institutionOrEntity, account.lastFour ?? null, account.parentAccountId ?? null, account.description ?? null,
        account.openingBalance.minorUnits, account.openingBalanceDate, account.archived ? 1 : 0, account.locked ? 1 : 0,
      ]);
    }
    for (const account of this.parentFirst(this.chartAccounts.values(), account => account.parentId)) {
      this.database.execute('INSERT INTO chart_account(id, name, parent_id, type, account_type, detail_type, description, display_order, archived, locked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        account.id, account.name, account.parentId ?? null, account.type, account.accountType, account.detailType, account.description ?? null, account.displayOrder, account.archived ? 1 : 0, account.locked ? 1 : 0,
      ]);
    }
    for (const account of this.accounts.values()) {
      const classification = this.cashFlowClassifications.get(this.classificationKey('FINANCIAL_SOURCE', account.id));
      if (!classification || classification.cashRole === undefined) throw new Error(`Missing Cash Flow classification for financial account ${account.id}.`);
      this.database.execute(`INSERT INTO financial_account_cash_flow_classification(
        financial_account_id, cash_flow_cash_role, cash_flow_treatment, cash_flow_status,
        cash_flow_source, cash_flow_rationale, cash_flow_modified_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [account.id, classification.cashRole, classification.treatment, classification.status, classification.source, classification.rationale, classification.modifiedAtUtc ?? null]);
    }
    for (const account of this.chartAccounts.values()) {
      const classification = this.cashFlowClassifications.get(this.classificationKey('CHART', account.id));
      if (!classification || classification.cashRole !== undefined) throw new Error(`Missing Cash Flow classification for Chart account ${account.id}.`);
      this.database.execute(`INSERT INTO chart_account_cash_flow_classification(
        chart_account_id, cash_flow_treatment, cash_flow_status,
        cash_flow_source, cash_flow_rationale, cash_flow_modified_at_utc)
        VALUES (?, ?, ?, ?, ?, ?)`, [account.id, classification.treatment, classification.status, classification.source, classification.rationale, classification.modifiedAtUtc ?? null]);
    }
    for (const batch of this.batches.values()) {
      this.database.execute('INSERT INTO import_batch(id, destination_account_id, source_kind, source_name, source_hash, mapping_version, accepted_count, rejected_count, skipped_count, warning_count, total_accepted_minor, committed_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        batch.id, batch.destinationAccountId, batch.sourceKind, batch.sourceName, batch.sourceHash, batch.mappingVersion, batch.acceptedCount, batch.rejectedCount, batch.skippedCount, batch.warningCount, batch.totalAcceptedAmount.minorUnits, batch.committedAtUtc ?? null,
      ]);
    }
    for (const transaction of this.transactions.values()) {
      this.database.execute('INSERT INTO transaction_record(id, account_id, posting_date, transaction_date, amount_minor, currency, raw_description, description, raw_payee, payee, memo, reference, state, source_batch_id, source_row_number, categorization_source, rule_id, rationale, exclusion_reason, transfer_match_id, created_at_utc, modified_at_utc, posted_at_utc, excluded_at_utc, undone_at_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        transaction.id, transaction.accountId, transaction.postingDate, transaction.transactionDate ?? null, transaction.amount.minorUnits, transaction.amount.currency, transaction.rawDescription, transaction.description, transaction.rawPayee ?? null, transaction.payee ?? null, transaction.memo ?? null, transaction.reference ?? null, transaction.state, transaction.sourceBatchId ?? null, transaction.sourceRowNumber ?? null, transaction.categorizationSource, transaction.ruleId ?? null, transaction.rationale ?? null, transaction.exclusionReason ?? null, transaction.transferMatchId ?? null, transaction.createdAtUtc, transaction.modifiedAtUtc, transaction.postedAtUtc ?? null, transaction.excludedAtUtc ?? null, transaction.undoneAtUtc ?? null,
      ]);
      for (const split of transaction.splits) {
        this.database.execute('INSERT INTO posting_split(id, transaction_id, chart_account_id, amount_minor, memo) VALUES (?, ?, ?, ?, ?)', [
          split.id, transaction.id, split.chartAccountId, split.amount.minorUnits, split.memo ?? null,
        ]);
      }
    }
    for (const transfer of this.transfers.values()) {
      this.database.execute('INSERT INTO transfer_match(id, left_transaction_id, right_transaction_id, confidence, rationale, confirmed_at_utc) VALUES (?, ?, ?, ?, ?, ?)', [
        transfer.id, transfer.leftTransactionId, transfer.rightTransactionId, transfer.confidence, transfer.rationale, transfer.confirmedAtUtc,
      ]);
    }
    for (const rule of this.rules.values()) {
      this.database.execute('INSERT INTO transaction_rule(id, name, enabled, priority, conditions_json, chart_account_id, payee, memo, tags_json, suggest_exclude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        rule.id, rule.name, rule.enabled ? 1 : 0, rule.priority, this.json({ conditions: rule.conditions, matchMode: rule.matchMode ?? 'ALL' }), rule.chartAccountId ?? null, rule.payee ?? null, rule.memo ?? null, this.json(rule.tags), rule.suggestExclude ? 1 : 0,
      ]);
    }
    for (const settings of this.taxSettings.values()) {
      this.database.execute('INSERT INTO tax_year_settings(tax_year, federal_income_tax_account_ids_json, state_local_income_tax_account_ids_json, include_federal_income_tax, include_state_local_income_tax, confirmed_at_utc, accountant_note) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        settings.taxYear, this.json(settings.federalIncomeTaxAccountIds), this.json(settings.stateLocalIncomeTaxAccountIds), settings.includeFederalIncomeTax ? 1 : 0, settings.includeStateLocalIncomeTax ? 1 : 0, settings.confirmedAtUtc ?? null, settings.accountantNote ?? null,
      ]);
    }
    for (const event of this.audit) {
      this.database.execute('INSERT INTO audit_event(id, timestamp_utc, operation, entity_type, entity_id, before_json, after_json, reason, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        event.id, event.timestampUtc, event.operation, event.entityType, event.entityId, this.json(event.before), this.json(event.after), event.reason ?? null, event.correlationId ?? null,
      ]);
    }
    this.persistedFinancialAccountIds = new Set(this.accounts.keys());
    this.persistedChartAccountIds = new Set(this.chartAccounts.keys());
  }

  private parentFirst<T extends { id: string }>(items: Iterable<T>, parentId: (item: T) => string | undefined): T[] {
    const remaining = new Map([...items].map(item => [item.id, item]));
    const ordered: T[] = [];
    while (remaining.size) {
      const ready = [...remaining.values()].filter(item => {
        const parent = parentId(item);
        return !parent || !remaining.has(parent);
      });
      if (!ready.length) throw new Error('Account hierarchy cannot be persisted because it contains a cycle.');
      ready.forEach(item => {
        ordered.push(item);
        remaining.delete(item.id);
      });
    }
    return ordered;
  }

  private snapshot(): RepositorySnapshot {
    return structuredClone({
      company: this.company,
      companyProfile: this.companyProfile,
      taxIdentifier: this.taxIdentifier,
      accounts: this.accounts,
      chartAccounts: this.chartAccounts,
      transactions: this.transactions,
      batches: this.batches,
      rules: this.rules,
      transfers: this.transfers,
      taxSettings: this.taxSettings,
      audit: this.audit,
      cashFlowClassifications: this.cashFlowClassifications,
      persistedFinancialAccountIds: this.persistedFinancialAccountIds,
      persistedChartAccountIds: this.persistedChartAccountIds,
    });
  }

  private restore(snapshot: RepositorySnapshot): void {
    this.company = snapshot.company;
    this.companyProfile = snapshot.companyProfile;
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
  }

  /**
   * Prepare only classifications for genuinely new accounts. Existing rows
   * are validated in place; a missing or structurally incompatible row is a
   * persistence error rather than an invitation to overwrite user/migration
   * provenance with a new default.
   */
  private prepareCashFlowClassifications(): void {
    const next = new Map<string, CashFlowClassificationRecord>();
    for (const account of this.accounts.values()) {
      next.set(this.classificationKey('FINANCIAL_SOURCE', account.id), this.classificationFor('FINANCIAL_SOURCE', account.id, account.accountType, account.detailType, this.persistedFinancialAccountIds.has(account.id)));
    }
    for (const account of this.chartAccounts.values()) {
      next.set(this.classificationKey('CHART', account.id), this.classificationFor('CHART', account.id, account.accountType, account.detailType, this.persistedChartAccountIds.has(account.id)));
    }
    this.cashFlowClassifications = next;
  }

  private classificationFor(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string, accountType: string, detailType: string, persisted: boolean): CashFlowClassificationRecord {
    const normalizedAccountType = accountType.trim();
    const normalizedDetailType = detailType.trim();
    const accountUse = validateAccountUse({ accountType: normalizedAccountType, requestedRole: accountRole });
    if (!accountUse.ok) throw new Error(`Existing account ${accountId} has an incompatible Cash Flow role/type: ${accountUse.error.code}.`);
    const existing = this.cashFlowClassifications.get(this.classificationKey(accountRole, accountId));
    if (existing && existing.accountType === normalizedAccountType && existing.detailType === normalizedDetailType) {
      const validated = validateCashFlowClassification({ accountRole, accountType: normalizedAccountType, detailType: normalizedDetailType, classification: existing });
      if (validated.ok) {
        if (existing.modifiedAtUtc !== undefined && new Date(existing.modifiedAtUtc).toISOString() !== existing.modifiedAtUtc) {
          throw new Error(`Existing Cash Flow classification for ${accountId} has an invalid timestamp. Reclassify it explicitly before saving the account.`);
        }
        return { ...existing, ...validated.value.classification, accountType: normalizedAccountType, detailType: normalizedDetailType };
      }
      throw new Error(`Existing Cash Flow classification for ${accountId} is invalid: ${validated.error.code}. Reclassify it explicitly before saving the account.`);
    }
    if (persisted) {
      throw new Error(`Existing Cash Flow classification for ${accountId} no longer matches its account structure. Reclassify it explicitly before saving the account.`);
    }
    const seeded = getDefaultCashFlowClassification({ accountRole, accountType: normalizedAccountType, detailType: normalizedDetailType });
    if (!seeded.ok) throw new Error(`Unable to seed Cash Flow classification for ${accountId}: ${seeded.error.code}.`);
    return { ...seeded.value, accountRole, accountId, accountType: normalizedAccountType, detailType: normalizedDetailType, modifiedAtUtc: nowUtc() };
  }

  private setLoadedCashFlowClassification(row: SqlRow, accountRole: 'FINANCIAL_SOURCE' | 'CHART'): void {
    const accountId = String(row['account_id']);
    const classification: CashFlowClassification = {
      ...(row['cash_flow_cash_role'] === null || row['cash_flow_cash_role'] === undefined ? {} : { cashRole: String(row['cash_flow_cash_role']) as CashFlowClassification['cashRole'] }),
      treatment: String(row['cash_flow_treatment']) as CashFlowClassification['treatment'],
      status: String(row['cash_flow_status']) as CashFlowClassification['status'],
      source: String(row['cash_flow_source']) as CashFlowClassification['source'],
      rationale: String(row['cash_flow_rationale']),
      ...(row['cash_flow_modified_at_utc'] === null || row['cash_flow_modified_at_utc'] === undefined ? {} : { modifiedAtUtc: String(row['cash_flow_modified_at_utc']) }),
    };
    this.cashFlowClassifications.set(this.classificationKey(accountRole, accountId), {
      ...classification,
      accountRole,
      accountId,
      accountType: String(row['account_type']),
      detailType: String(row['detail_type']),
    });
  }

  private classificationKey(accountRole: 'FINANCIAL_SOURCE' | 'CHART', accountId: string): string {
    return `${accountRole}:${accountId}`;
  }

  private tableExists(table: string): boolean {
    return this.database.execute('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1', ['table', table]).length > 0;
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new Error('SQLite accounting repository is not initialized.');
  }

  private boolean(value: unknown): boolean {
    return Number(value) === 1;
  }

  private optionalString(value: unknown): string | undefined {
    return value === null || value === undefined || String(value).trim() === '' ? undefined : String(value);
  }

  private maskTaxIdentifier(value?: string): string | undefined {
    if (!value) return undefined;
    const visible = value.replace(/\W/g, '').slice(-4);
    return visible ? `•••• ${visible}` : '••••';
  }

  private ensureCompanyProfile(): CompanyProfile {
    if (this.companyProfile) {
      this.companyProfile = {
        ...this.companyProfile,
        companyId: this.company.id,
        currencyCode: this.company.currency,
        fiscalYearStartMonth: this.company.fiscalYearStartMonth,
        accountingBasis: this.company.accountingBasis,
        activeTaxYear: this.company.activeTaxYear,
        maskedTaxIdentifier: this.maskTaxIdentifier(this.taxIdentifier),
      };
      return this.companyProfile;
    }
    const timestamp = new Date().toISOString();
    this.companyProfile = {
      companyId: this.company.id,
      legalName: this.company.name,
      displayName: this.company.name,
      currencyCode: this.company.currency,
      fiscalYearStartMonth: this.company.fiscalYearStartMonth,
      accountingBasis: this.company.accountingBasis,
      activeTaxYear: this.company.activeTaxYear,
      createdAt: timestamp,
      modifiedAt: timestamp,
    };
    return this.companyProfile;
  }

  private hashBytes(bytes: Uint8Array): string {
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  private bigInt(value: unknown): bigint {
    return BigInt(String(value));
  }

  private json(value: unknown): string | null {
    if (value === undefined) return null;
    return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item);
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try {
      return this.hydrate(JSON.parse(value)) as T;
    } catch {
      return fallback;
    }
  }

  private hydrate(value: unknown): unknown {
    if (typeof value === 'string' && /^-?\d+n$/.test(value)) return BigInt(value.slice(0, -1));
    if (Array.isArray(value)) return value.map(item => this.hydrate(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.hydrate(item)]));
    return value;
  }
}
