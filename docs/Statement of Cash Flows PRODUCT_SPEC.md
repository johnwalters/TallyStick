# TallyStick Statement of Cash Flows Product Specification

*Implementation specification · Draft 0.1 · Proposed August 25, 2026*

Authority: [Statement of Cash Flows PRD](Statement%20of%20Cash%20Flows%20PRD.md) Draft 0.1  
Current product baseline: [TallyStick Product Specification](PRODUCT_SPEC.md)  
Related completed feature: [Balance Sheet Product Specification](Balance%20Sheet%20PRODUCT_SPEC.md)

## 1. Purpose and status

This document translates the proposed Statement of Cash Flows PRD into implementation contracts, persistence changes, calculations, user-interface behavior, outputs, and verification gates.

**Status: Proposed; not implemented.** Nothing in this document marks application code, schema migration, fixtures, tests, or release work complete.

The first release provides:

1. an indirect-method Statement of Cash Flows for one inclusive date range;
2. explicit cash/cash-equivalent designation for financial accounts;
3. cash-flow treatment for financial and Chart accounts;
4. Operating, Investing, and Financing calculations;
5. supplemental identifiable noncash disclosures;
6. exact drill-down and cash reconciliation; and
7. screen, CSV, XLSX, and print/PDF parity.

## 2. Design constraints

- Preserve the Angular/application-service/domain/repository/native-host boundaries.
- Do not introduce an HTTP API, server, cloud dependency, or telemetry requirement.
- Do not store editable Statement of Cash Flows totals.
- Use one repository snapshot and one database revision for P/L, opening Balance Sheet, ending Balance Sheet, report rows, detail, and exports.
- Use signed integer minor units (`bigint`) for all money calculations.
- Do not classify by company, institution, marketplace, financial-account, Chart-account, payee, or vendor name.
- Keep Cash Flow classification independent from Account Type, P/L/Balance Sheet placement, import capability, and transaction state.
- Do not mutate transactions or account balances during report generation.
- Do not include Pending or Excluded activity.
- Do not automatically confirm transfer candidates.
- Do not include noncash Investing or Financing activity in cash totals.
- Do not present a report with material unclassified activity or nonzero Difference as Complete.
- Use one immutable `CashFlowReport` for screen, drill-down keys, CSV, XLSX, print preview, and PDF.
- Reject detail or export requests whose report/database revision is stale.
- Standard outputs omit the full company tax identifier and sensitive filesystem paths.
- The first release has no per-transaction Cash Flow override. A mixed transaction uses posting splits assigned to separately classified accounts.

## 3. System decomposition

### 3.1 Application service

Extend `AccountingApplication` with:

| Operation | Responsibility |
| --- | --- |
| `getCashFlowClassificationCatalog` | Return permitted cash roles, treatments, compatibility, labels, and default rationale. |
| `previewCashFlowClassification` | Validate proposed account classification and return statement behavior without writing. |
| `saveCashFlowClassification` | Persist a validated stable-ID classification atomically and audit it. |
| `getCashFlowClassificationReview` | Return participating accounts, status, period activity, and blocking issues for a query. |
| `getCashFlowReport` | Return one immutable report for a normalized query and database revision. |
| `getCashFlowDetail` | Return contributions that reconcile exactly to a row in that report revision. |
| `exportCashFlow` | Export CSV or XLSX from the supplied immutable report without recalculation. |
| `openCashFlowPrintPreview` | Open a print/PDF-ready preview from the supplied immutable report without automatically printing. |

The Angular workspace and facade depend only on this boundary.

### 3.2 Domain/report service

Add a `CashFlowReportService` that owns:

- query validation and normalization;
- a single immutable repository snapshot;
- opening and ending cash balances;
- unadjusted P/L Net Profit for the report period;
- noncash P/L reversals;
- operating asset/liability changes;
- investing and financing cash-side activity;
- transfer classification;
- identifiable noncash disclosures;
- hierarchy, totals, status, warnings, and Difference;
- stable row/detail identity; and
- report caching by database revision plus normalized query.

Refactor reusable Balance Sheet calculations into pure snapshot functions when needed. The Cash Flow service must not call public P/L and Balance Sheet APIs in a way that permits different database revisions between components.

### 3.3 Persistence

The repository owns:

- classification fields and audit events;
- one Cash Flow snapshot containing company/profile, financial accounts, Chart accounts, transactions, posting splits, confirmed transfers, and database revision;
- additive indexes required for period/account/transfer reads; and
- transactional migration and rollback.

No Cash Flow report row or total table is added.

### 3.4 Presentation and native boundary

Angular owns navigation, filters, classification editors, statement rendering, warning/detail panels, and export actions. Pure output services build CSV, XLSX, and print models. Electron owns save dialogs, safe writes, preview windows, Command-P, and cleanup.

## 4. Shared terminology and enums

### 4.1 Cash role

```ts
export const CASH_FLOW_CASH_ROLES = [
  'CASH',
  'CASH_EQUIVALENT',
  'RESTRICTED_CASH',
  'NOT_CASH',
  'REVIEW_REQUIRED',
] as const;

export type CashFlowCashRole = typeof CASH_FLOW_CASH_ROLES[number];
```

Only `CASH` and `CASH_EQUIVALENT` participate in standard Beginning and Ending Cash totals. `RESTRICTED_CASH` is separately disclosed. `REVIEW_REQUIRED` cannot be silently treated as cash or noncash.

### 4.2 Cash-flow section

```ts
export const CASH_FLOW_SECTIONS = [
  'OPERATING',
  'INVESTING',
  'FINANCING',
  'CASH_RECONCILIATION',
  'NONCASH_DISCLOSURE',
] as const;

export type CashFlowSection = typeof CASH_FLOW_SECTIONS[number];
```

### 4.3 Cash-flow treatment

```ts
export const CASH_FLOW_TREATMENTS = [
  'CASH_BALANCE',
  'OPERATING_REVENUE_EXPENSE',
  'OPERATING_ASSET',
  'OPERATING_LIABILITY',
  'NONCASH_PNL_ADJUSTMENT',
  'INVESTING',
  'FINANCING',
  'NONCASH_DISCLOSURE',
  'EXCLUDED',
  'REVIEW_REQUIRED',
] as const;

export type CashFlowTreatment = typeof CASH_FLOW_TREATMENTS[number];
```

Treatment controls Cash Flow calculation only. It never changes a P/L or Balance Sheet reporting group.

### 4.4 Classification status and source

```ts
export type CashFlowClassificationStatus = 'CONFIRMED' | 'REVIEW_REQUIRED';
export type CashFlowClassificationSource = 'DEFAULT' | 'MIGRATED' | 'USER';

export interface CashFlowClassification {
  cashRole?: CashFlowCashRole; // Financial accounts only
  treatment: CashFlowTreatment;
  status: CashFlowClassificationStatus;
  source: CashFlowClassificationSource;
  rationale: string;
  modifiedAtUtc?: string;
}
```

`cashRole` is required for financial accounts and prohibited for Chart accounts. A financial account with `CASH` or `CASH_EQUIVALENT` must use `CASH_BALANCE`. A `REVIEW_REQUIRED` role or treatment requires Review-required status.

### 4.5 Report status

```ts
export type CashFlowReportStatus = 'COMPLETE' | 'REVIEW_REQUIRED';
export type CashFlowMethod = 'INDIRECT';
```

The first release exposes no method selector.

## 5. Classification catalog and defaults

### 5.1 Compatibility rules

| Account structure | Permitted treatment |
| --- | --- |
| Financial account with Cash/Cash-equivalent role | `CASH_BALANCE` only |
| Financial restricted-cash account | `CASH_BALANCE` or `REVIEW_REQUIRED` |
| Bank account marked Not cash | Investing, Financing, Excluded, or Review required when structurally valid |
| Current Asset | Operating asset, Investing, Excluded, or Review required |
| Fixed/Other long-term Asset | Investing, Noncash disclosure, Excluded, or Review required |
| Credit Card/A/P/current operating liability | Operating liability, Financing, Excluded, or Review required |
| Long-term liability | Financing, Noncash disclosure, Excluded, or Review required |
| Equity | Financing, Noncash disclosure, Excluded, or Review required |
| Income/Expense/COGS | Operating revenue/expense, Noncash P/L adjustment, Investing, Financing, Excluded, or Review required |

Invalid combinations fail validation; they do not fall back to Operating.

### 5.2 Structural default matrix

Defaults use current `accountType`, `detailType`, account role, and existing classification metadata. Names are never evidence.

| Structure | Cash role | Treatment | Initial status |
| --- | --- | --- | --- |
| Financial Bank / Cash on hand | Cash | Cash balance | Confirmed |
| Financial Bank / Checking | Cash | Cash balance | Confirmed |
| Financial Bank / Savings | Cash equivalent | Cash balance | Confirmed, user-reviewable |
| Financial Bank / Money Market | Review required | Review required | Review required |
| Financial Bank / Rents Held in Trust or Trust account | Restricted cash | Cash balance | Confirmed with disclosure |
| Financial Credit Card | Not cash | Operating liability | Confirmed |
| Financial Other Current Asset / standard Marketplace clearing or Clearing account detail | Not cash | Operating asset | Confirmed |
| Chart A/R, Inventory, Prepaid expense | — | Operating asset | Confirmed |
| Chart other current asset without a specific safe mapping | — | Review required | Review required |
| Chart Fixed Asset | — | Investing | Confirmed |
| Chart Other Asset | — | Investing | Confirmed, user-reviewable |
| Chart Credit Card or A/P | — | Operating liability | Confirmed |
| Chart Payroll, Sales Tax, or other operating current liability | — | Operating liability | Confirmed |
| Chart Loan payable or Long Term Liability | — | Financing | Confirmed |
| Chart Equity / Owner equity or Owner draw | — | Financing | Confirmed |
| Chart Equity / Retained earnings | — | Excluded | Confirmed |
| Chart Income, Other Income, COGS, Expense | — | Operating revenue/expense | Confirmed |
| Chart Other Expense / Depreciation | — | Noncash P/L adjustment | Confirmed |
| Structurally ambiguous/custom detail | — | Review required | Review required |

Interest, income taxes, dividends/distributions, restricted cash, and unusual activities remain user-reviewable policy classifications. A base-chart seed may provide defaults through specific standard Detail Types, never display names.

### 5.3 Account edits and historical behavior

- Save by stable account ID and role.
- Validate against the complete resulting account set.
- Audit before/after classification and user rationale.
- Invalidate Cash Flow reports after save.
- A classification change affects regenerated historical reports. The UI discloses that first-release classifications are not effective-dated.
- Classification save never edits transactions, rules, Account Type, parent, P/L placement, Balance Sheet placement, or import capability.

## 6. Application contracts

### 6.1 Classification operations

```ts
export interface CashFlowClassificationTarget {
  accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  accountId: string;
}

export interface PreviewCashFlowClassificationCommand
  extends CashFlowClassificationTarget {
  cashRole?: CashFlowCashRole;
  treatment: CashFlowTreatment;
}

export interface CashFlowClassificationPreview {
  valid: boolean;
  normalized?: CashFlowClassification;
  statementSection?: CashFlowSection;
  statementLabel: string;
  rationale: string;
  failures: readonly CashFlowClassificationFailure[];
}

export interface CashFlowClassificationFailure {
  code: 'ACCOUNT_NOT_FOUND'
    | 'CASH_ROLE_REQUIRED'
    | 'CASH_ROLE_NOT_ALLOWED'
    | 'TREATMENT_INCOMPATIBLE'
    | 'RATIONALE_REQUIRED'
    | 'CLASSIFICATION_STALE';
  message: string;
  accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  accountId: string;
}

export interface SaveCashFlowClassificationCommand
  extends PreviewCashFlowClassificationCommand {
  expectedModifiedAtUtc?: string;
  userRationale: string;
}

export interface CashFlowClassificationReview {
  query: CashFlowQuery;
  databaseRevision: string;
  accounts: readonly CashFlowClassificationReviewItem[];
  blockingCount: number;
  warningCount: number;
}

export interface CashFlowClassificationReviewItem {
  accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  accountId: string;
  accountPath: string;
  accountType: string;
  detailType: string;
  cashRole?: CashFlowCashRole;
  treatment: CashFlowTreatment;
  status: CashFlowClassificationStatus;
  source: CashFlowClassificationSource;
  rationale: string;
  openingAmountMinor: bigint;
  endingAmountMinor: bigint;
  periodActivityMinor: bigint;
  reportImpactMinor: bigint;
}
```

Preview is read-only. Save is atomic and fails on stale optimistic-concurrency data.

### 6.2 Report operations

```ts
getCashFlowReport(query: CashFlowQuery): CashFlowReport;
getCashFlowDetail(command: GetCashFlowDetailCommand): CashFlowDetail;
exportCashFlow(command: ExportCashFlowCommand): Promise<CashFlowExportResult>;
openCashFlowPrintPreview(
  command: OpenCashFlowPrintPreviewCommand,
): Promise<CashFlowPrintPreviewResult>;
```

```ts
export interface ExportCashFlowCommand {
  reportId: string;
  databaseRevision: string;
  format: 'CSV' | 'XLSX';
}

export interface CashFlowExportResult {
  format: 'CSV' | 'XLSX';
  path: string;
  completedAtUtc: string;
  rowCount: number;
}

export interface OpenCashFlowPrintPreviewCommand {
  reportId: string;
  databaseRevision: string;
}

export interface CashFlowPrintPreviewResult {
  opened: boolean;
  title: string;
}
```

Detail and output commands carry `reportId` and `databaseRevision`. The service rejects stale requests instead of recalculating behind the caller's back.

## 7. Proposed schema version 7

Schema 7 is the proposed next migration from the current schema 6. If another migration lands first, renumber this migration without changing its atomicity or compatibility requirements.

### 7.1 Financial-account additions

Add to the persisted financial-account classification record or equivalent table:

| Column | Requirement |
| --- | --- |
| `cash_flow_cash_role` | Required checked enum |
| `cash_flow_treatment` | Required checked enum |
| `cash_flow_status` | Required `CONFIRMED` or `REVIEW_REQUIRED` |
| `cash_flow_source` | Required `DEFAULT`, `MIGRATED`, or `USER` |
| `cash_flow_rationale` | Required nonempty text |
| `cash_flow_modified_at_utc` | Optional ISO timestamp |

### 7.2 Chart-account additions

Add to the Chart-account record or one-to-one classification table:

| Column | Requirement |
| --- | --- |
| `cash_flow_treatment` | Required checked enum; no cash role |
| `cash_flow_status` | Required `CONFIRMED` or `REVIEW_REQUIRED` |
| `cash_flow_source` | Required `DEFAULT`, `MIGRATED`, or `USER` |
| `cash_flow_rationale` | Required nonempty text |
| `cash_flow_modified_at_utc` | Optional ISO timestamp |

### 7.3 Migration transaction

Within one foreign-key-enabled transaction:

1. Verify the source schema and take the existing host-level safety backup.
2. Add classification storage and constraints.
3. Map every account using the structural default matrix.
4. Mark custom or ambiguous combinations Review required.
5. Preserve all stable IDs, relationships, history, rules, transfers, imports, balances, and audit records.
6. Add audit/migration evidence without storing customer-specific rationale.
7. Update the shared schema version only after all rows validate.
8. Run `PRAGMA foreign_key_check` and required semantic checks.
9. Roll back the entire migration on any failure.

No migration condition may compare a company, institution, marketplace, account, vendor, or payee name.

### 7.4 Import, export, backup, and restore

- Chart of Accounts CSV/XLSX adds Cash Flow Treatment, Cash Flow Status, and optional rationale columns.
- Unknown enum values and incompatible combinations are row-level blocking errors.
- Existing valid workbooks without the new columns receive previewed structural defaults; commit discloses Review-required rows.
- Financial-account portable export includes cash role and treatment.
- Backup bundles, raw database backup, portable data export, restore validation, desktop-host validation, and smoke fixtures accept schema 7 through the shared schema constant.
- Restore never silently downgrades or strips classifications.

## 8. Repository snapshot

```ts
export interface CashFlowRepositorySnapshot {
  databaseRevision: string;
  company: Company;
  companyProfile: CompanyProfile;
  accounts: readonly FinancialAccount[];
  chartAccounts: readonly ChartAccount[];
  transactions: readonly Transaction[];
  transfers: readonly TransferMatch[];
}
```

`readCashFlowSnapshot(endDate)` returns all data required to calculate opening values through the day before `startDate` and period activity through `endDate`. It returns immutable clones and does not expose a live mutable repository collection.

Required indexes cover transaction state/date/account, split transaction/chart account, transfer endpoint, financial-account classification, Chart-account classification, and hierarchy display order.

## 9. Query and report contracts

### 9.1 Query

```ts
export interface CashFlowQuery {
  startDate: string;
  endDate: string;
  includeZeroRows: boolean;
}
```

Normalization rules:

- Dates are required ISO business dates.
- `startDate <= endDate`.
- Default is the configured active fiscal year.
- The UI's preset is not part of report identity after dates are normalized.
- The beginning-balance date is the calendar day immediately before `startDate`.
- Query state persists independently from other workspaces.

### 9.2 Report result

```ts
export interface CashFlowReport {
  reportId: string;
  databaseRevision: string;
  generatedAt: string;
  query: CashFlowQuery;
  company: ReportCompanyIdentity;
  currencyCode: string;
  accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  method: 'INDIRECT';
  status: CashFlowReportStatus;
  rows: readonly CashFlowRow[];
  netOperatingMinor: bigint;
  netInvestingMinor: bigint;
  netFinancingMinor: bigint;
  netChangeInCashMinor: bigint;
  beginningCashMinor: bigint;
  calculatedEndingCashMinor: bigint;
  endingCashMinor: bigint;
  differenceMinor: bigint;
  restrictedCashBeginningMinor: bigint;
  restrictedCashEndingMinor: bigint;
  unclassifiedCashActivityMinor: bigint;
  warnings: readonly CashFlowWarning[];
  detailIndex: Readonly<Record<string, readonly CashFlowContribution[]>>;
}

export type CashFlowRowType =
  | 'SECTION_HEADER'
  | 'NET_PROFIT'
  | 'GROUP_HEADER'
  | 'ADJUSTMENT'
  | 'ACCOUNT_ACTIVITY'
  | 'SUBTOTAL'
  | 'TOTAL'
  | 'CASH_BALANCE'
  | 'DIFFERENCE'
  | 'NONCASH_DISCLOSURE';

export interface CashFlowRow {
  rowId: string;
  rowType: CashFlowRowType;
  section: CashFlowSection;
  treatment?: CashFlowTreatment;
  accountRole?: 'FINANCIAL_SOURCE' | 'CHART';
  accountId?: string;
  parentRowId?: string;
  label: string;
  fullPath?: string;
  depth: number;
  amountMinor?: bigint;
  detailKey?: string;
  bold: boolean;
  derived: boolean;
  archived: boolean;
  reviewRequired: boolean;
}
```

### 9.3 Stable identity and freezing

- Account rows use section plus account role plus stable account ID.
- Synthetic rows use fixed semantic identifiers such as `NET_PROFIT`, `NET_OPERATING`, and `ENDING_CASH`, plus normalized query identity where needed.
- Labels and account names never form the stable key.
- Freeze the report, rows, warnings, contributions, and query before returning them.
- A report ID hashes or deterministically combines database revision, normalized query, method, and calculation-contract version.

## 10. Calculation rules

### 10.1 Shared snapshot and inclusion

Use one `CashFlowRepositorySnapshot` for the complete calculation.

- Posted transactions participate according to date and treatment.
- Confirmed Matched Transfers participate through the transfer rules below.
- Pending and Excluded transactions never contribute.
- Report-only Schedule C exclusions never change Net Profit or Cash Flow.
- Archived accounts retain historical effects.
- Transactions after `endDate` do not participate.
- Mixed or non-base currency requiring conversion returns a typed unsupported-currency failure.

### 10.2 Opening and ending balances

Generate pure Balance Sheet projections from the same snapshot:

```text
Opening snapshot date = dayBefore(startDate)
Ending snapshot date = endDate
```

The projections use the implemented Balance Sheet rules for opening balances, Posted activity, confirmed transfers, natural signs, and account hierarchy. If either source Balance Sheet has a nonzero accounting-equation Difference, add a blocking warning and mark the Cash Flow report Review required.

Beginning and Ending Cash equal the sum of financial accounts whose role is `CASH` or `CASH_EQUIVALENT` at the applicable snapshot date. Restricted cash is calculated separately.

### 10.3 Net Profit

Call the shared pure unadjusted P/L calculation using the snapshot's transactions and Chart accounts for `startDate...endDate`.

```text
Net Profit row amount = unadjusted P/L Net Profit for exact period
```

If P/L section/detail reconciliation fails, fail report generation rather than substituting a cached or adjusted result.

### 10.4 Noncash P/L adjustments

For each Chart account classified `NONCASH_PNL_ADJUSTMENT`:

```text
Adjustment = -1 × period P/L contribution for that account
```

This reverses both negative expenses and positive gains consistently. Detail includes original P/L contributions and the sign transformation. The account remains in Net Profit; the adjustment does not edit the P/L.

### 10.5 Operating assets and liabilities

Use presented natural-sign Balance Sheet amounts for each classified account:

```text
Operating asset adjustment = Opening amount - Ending amount
Operating liability adjustment = Ending amount - Opening amount
```

Requirements:

- Include direct parent activity exactly once.
- Preserve child hierarchy and deterministic display order.
- Do not include Cash, Cash equivalent, Restricted cash, Investing, Financing, Equity, Current Earnings, Retained Earnings, or Opening Balance Equity as working capital.
- Credit-card accounts default to Operating liability unless overridden.
- A classified financial account and Chart account are separate stable rows; do not merge by name.
- Row detail shows opening amount, ending amount, raw change, sign rule, and contributing Balance Sheet detail.

### 10.6 Net Operating cash flow

```text
Net Operating =
  Net Profit
  + Noncash P/L adjustments
  + Operating asset adjustments
  + Operating liability adjustments
```

Every child and subtotal reconciles in minor units.

### 10.7 Investing and Financing cash-side activity

Iterate period activity in included cash/cash-equivalent financial accounts.

For a Posted transaction:

1. Verify posting splits sum to the transaction's accounting amount under the existing posting invariant.
2. Resolve each split's Chart account treatment.
3. Sum the split amount into Investing or Financing when mapped accordingly.
4. Do not directly sum Operating splits; Operating is derived through Net Profit and adjustments.
5. Add Review-required or invalid split amounts to `unclassifiedCashActivityMinor` and Difference diagnostics rather than a statement section.
6. Excluded treatment is omitted with a disclosed policy warning when material.

The current sign convention is retained: cash inflows are positive and cash outflows are negative.

### 10.8 Confirmed transfers

For each confirmed transfer with one or both endpoints in the report period:

- Cash to Cash/Cash equivalent: zero report effect; include in diagnostic detail only when requested.
- Cash to Restricted cash: apply restricted-cash presentation and disclose the transfer.
- Cash to Operating asset/liability: do not direct count; opening-to-ending adjustment captures the effect.
- Cash to Investing or Financing noncash endpoint: use the cash endpoint amount in that section.
- Cash to Review-required endpoint: add to unclassified diagnostics and mark Review required.
- No cash endpoint: no cash-flow total; evaluate for identifiable noncash disclosure.
- Missing, stale, or malformed transfer endpoints: typed warning/error; never manufacture a match.

Transfer contributions use the transfer ID and both transaction IDs to prevent duplication.

### 10.9 Identifiable noncash disclosures

Detect supported noncash investing or financing activity when recorded transaction and split relationships identify a noncash source and an Investing or Financing counteraccount. Do not infer an undisclosed counterentry.

Disclosure rows:

- never change Operating, Investing, Financing, Net Change, or Ending Cash;
- identify the asset/liability/equity accounts and amount;
- include transaction/split provenance; and
- state that TallyStick discloses only identifiable recorded noncash activity.

### 10.10 Opening-balance treatment

- Apply account opening balances to opening/ending snapshots using existing opening-balance modes.
- A cash opening balance before `startDate` contributes to Beginning Cash.
- A cash opening balance within the period without supported ledger activity is not a section flow. It creates `OPENING_CASH_BALANCE_WITHIN_PERIOD`, unclassified diagnostics, and a reconciliation Difference.
- An opening balance after `endDate` has no report effect.
- A `LEDGER_ACTIVITY` account with a nonzero stored opening balance fails through the existing conflict contract.
- Opening Balance Equity is never a period cash flow.

### 10.11 Reconciliation and status

```text
Net Change = Net Operating + Net Investing + Net Financing
Calculated Ending Cash = Beginning Cash + Net Change
Difference = Calculated Ending Cash - Ending Cash
```

`status = COMPLETE` only when:

- Difference is zero;
- unclassified cash activity is zero;
- at least one Cash/Cash-equivalent account is configured;
- no nonzero Review-required cash account exists;
- opening and ending source Balance Sheets reconcile;
- classifications and hierarchy are valid; and
- no blocking warning/error applies.

Otherwise `status = REVIEW_REQUIRED`. Exports retain that status and warnings; no filename, heading, or completion message may describe it as a clean completed statement.

`unclassifiedCashActivityMinor` is the signed diagnostic amount identified from Review-required cash transactions, unresolved transfer endpoints, in-period cash opening balances, and unresolved balance changes. It is excluded from Operating, Investing, Financing, and Net Change so the Difference remains visible until the activity is classified or corrected.

### 10.12 Zero rows and hierarchy

- Calculate all rows before applying the zero-row display filter.
- Section totals, Net Change, Beginning Cash, Ending Cash, and Difference always display.
- Hiding zero rows never changes totals, detail, status, or output identity.
- Parents/subtotals include direct and child activity once.
- Invalid nonzero hierarchy remains visible under a review group with warning.

## 11. Detail contract

```ts
export type CashFlowContributionType =
  | 'PNL_SPLIT'
  | 'NONCASH_REVERSAL'
  | 'BALANCE_CHANGE'
  | 'CASH_TRANSACTION'
  | 'TRANSFER'
  | 'OPENING_BALANCE'
  | 'FORMULA'
  | 'NONCASH_DISCLOSURE'
  | 'UNCLASSIFIED';

export interface CashFlowContribution {
  contributionId: string;
  detailKey: string;
  contributionType: CashFlowContributionType;
  contributionMinor: bigint;
  businessDate?: string;
  accountRole?: 'FINANCIAL_SOURCE' | 'CHART';
  accountId?: string;
  accountName?: string;
  chartAccountId?: string;
  chartAccountPath?: string;
  transactionId?: string;
  splitId?: string;
  transferId?: string;
  sourceBatchId?: string;
  payee?: string;
  description?: string;
  memo?: string;
  openingAmountMinor?: bigint;
  endingAmountMinor?: bigint;
  formula?: string;
  childRowId?: string;
}

export interface GetCashFlowDetailCommand {
  reportId: string;
  databaseRevision: string;
  detailKey: string;
}

export interface CashFlowDetail extends GetCashFlowDetailCommand {
  rowId: string;
  amountMinor: bigint;
  contributions: readonly CashFlowContribution[];
}
```

For every amount row:

```text
sum(contribution.contributionMinor) = row.amountMinor
```

Formula totals reference child row IDs and amounts from the same immutable report. Difference detail identifies missing/unclassified cash effects and source reconciliation issues. A mismatch returns `CASH_FLOW_DETAIL_RECONCILIATION_FAILED`; partial detail is not displayed as complete.

## 12. Warnings and error model

### 12.1 Warning codes

| Code | Trigger | Effect |
| --- | --- | --- |
| `NO_CASH_ACCOUNTS_CONFIGURED` | No Cash/Cash-equivalent account | Setup state; Review required |
| `CASH_ROLE_REVIEW_REQUIRED` | Nonzero account has Review-required cash role | Identify account; Review required |
| `CASH_FLOW_CLASSIFICATION_REVIEW_REQUIRED` | Participating account treatment unresolved | Identify account/activity; Review required |
| `UNCLASSIFIED_CASH_ACTIVITY` | Cash-side amount cannot enter a valid section | Difference detail; Review required |
| `CASH_RECONCILIATION_DIFFERENCE` | Calculated Ending Cash differs from Balance Sheet Ending Cash | Prominent Difference; Review required |
| `SOURCE_BALANCE_SHEET_OUT_OF_BALANCE` | Opening or ending Balance Sheet Difference is nonzero | Link source date/difference; Review required |
| `OPENING_CASH_BALANCE_WITHIN_PERIOD` | Cash opening balance date is inside period | Diagnostic contribution; Review required |
| `OPENING_BALANCE_MODE_CONFLICT` | Ledger mode conflicts with stored opening | Fail affected report |
| `UNMATCHED_CASH_TRANSFER_CANDIDATE` | Likely transfer remains unconfirmed | Show candidate; never auto-match |
| `RESTRICTED_CASH_PRESENT` | Restricted cash has nonzero balance/activity | Supplemental disclosure |
| `NONCASH_ACTIVITY_IDENTIFIED` | Supported noncash Investing/Financing item found | Supplemental disclosure |
| `ARCHIVED_PARTICIPATING_ACCOUNT` | Archived account contributes | Retain row/detail and flag |
| `ACCOUNT_HIERARCHY_INVALID` | Missing parent/cycle affects rows | Review group; Review required if nonzero |
| `CASH_FLOW_CLASSIFICATION_INVALID` | Persisted combination violates catalog | Identify account; Review required or fail |
| `EXCLUDED_MATERIAL_CASH_ACTIVITY` | Excluded treatment has material cash-side activity | Disclose policy and amount; Review required by default |
| `UNSUPPORTED_CURRENCY` | Conversion would be required | Fail calculation |

Warnings have stable IDs derived from code, stable references, and query identity—not translated display text.

### 12.2 Typed failures

At minimum:

```ts
type CashFlowFailureCode =
  | 'INVALID_CASH_FLOW_DATE_RANGE'
  | 'CASH_FLOW_REPORT_GENERATION_FAILED'
  | 'CASH_FLOW_REPORT_REVISION_STALE'
  | 'CASH_FLOW_DETAIL_NOT_FOUND'
  | 'CASH_FLOW_DETAIL_RECONCILIATION_FAILED'
  | 'CASH_FLOW_CLASSIFICATION_INVALID'
  | 'CASH_FLOW_CLASSIFICATION_STALE'
  | 'CASH_FLOW_EXPORT_FAILED'
  | 'CASH_FLOW_EXPORT_CANCELLED'
  | 'CASH_FLOW_PRINT_PREVIEW_FAILED'
  | 'UNSUPPORTED_CURRENCY';
```

Raw SQL, stack traces, full tax identifiers, and sensitive paths are not displayed. Cancellation is not reported as failure.

## 13. User-interface specification

### 13.1 Navigation

Add a `Cash Flow` icon-led tab beside Profit & Loss and Balance Sheet. It is mutually exclusive with Transactions, Chart of Accounts, Rules, Profit & Loss, Balance Sheet, and Backups. Default application workspace remains Transactions.

### 13.2 Workspace header

Display:

- company display/report name;
- `Statement of Cash Flows`;
- start and end dates;
- accounting basis and `Indirect method`;
- report status;
- Beginning Cash, Net Change, Ending Cash, and Difference;
- preset/date controls and Show zero rows;
- Review classifications;
- Export CSV, Export XLSX, and Print / PDF.

Status uses text and icon, not color alone.

### 13.3 Statement table

- Follow PRD section order.
- Use existing report width, dividers, hierarchy indentation, 14px-or-greater labels, tabular amount treatment, and label/amount weight parity.
- Bold section totals, Net Change, Beginning Cash, Ending Cash, and Difference; do not bold ordinary detail rows.
- Show zero as `$0.00` and negatives with a leading minus sign.
- Every amount button has an accessible name including label, amount, and report period.
- Supplemental noncash disclosures appear after Cash Reconciliation and do not visually imply inclusion in Net Change.
- Review-required and archived indicators use visible text.

### 13.4 Detail panel

Open a focused side panel consistent with P/L and Balance Sheet detail. Show:

- selected row and formula;
- total and contribution sum;
- opening/ending values for working-capital rows;
- transaction/split/transfer provenance;
- stable account path and source account;
- classification rationale; and
- Export detail when supported.

### 13.5 Classification review

Open a dedicated panel or workspace region containing:

- cash/cash-equivalent accounts and balances;
- restricted/review-required cash accounts;
- participating financial and Chart accounts grouped by treatment;
- period activity and report impact;
- filters for Review required, Cash accounts, Operating, Investing, Financing, and Noncash;
- proposed placement preview; and
- validated Save/Cancel behavior.

Save is disabled until required values and rationale are valid. A proposed change preview uses the current report query and does not write.

### 13.6 Empty, loading, stale, and failure states

- Loading never displays stale totals as current.
- Valid empty data displays an all-zero statement.
- No cash setup displays an actionable classification setup state.
- Stale reports display Refresh and disable detail/export until regenerated.
- Failures replace affected content with an actionable message; they do not reuse a prior success result.

## 14. Output contracts

### 14.1 Shared source

All output formats consume the supplied frozen `CashFlowReport`. Exporters do not recalculate, reclassify, rename, regroup, or re-read the repository.

### 14.2 CSV

Write UTF-8 CSV with metadata and row columns:

- company legal/display name;
- report title, start/end dates, method, basis, and currency;
- report ID, database revision, generated time, and status;
- row ID/type, section, treatment, label/path, depth, and amount;
- account role, stable account ID, cash role, archived/review flags;
- warning code/message/reference fields; and
- explicit Net Operating, Net Investing, Net Financing, Net Change, Beginning Cash, Calculated Ending Cash, Ending Cash, Restricted Cash, Unclassified activity, and Difference rows.

Special characters, Unicode, commas, quotes, and newlines round-trip safely.

### 14.3 XLSX

Create and reopen-verify three sheets:

1. **Statement of Cash Flows** — metadata, statement order, indentation, matching bold styles, numeric currency cells, status, warnings, noncash disclosures, and reconciliation.
2. **Cash Flow Detail** — one contribution per row with row/detail identity and complete provenance.
3. **Cash Flow Classifications** — stable account ID/role, account path, account type/detail, cash role, treatment, status, source, and rationale.

The statement and detail amounts reconcile after reopening. Cancellation removes temporary output.

### 14.4 Print/PDF

- Build from the immutable report rows and warnings.
- Preview title is `<display name> — Statement of Cash Flows`.
- Do not automatically open the system print dialog.
- Provide File > Print and Command-P.
- Repeat company, title, period, method, and column headings on later pages.
- Keep group labels with at least the following row and keep totals with their sections when practical.
- Include status, Difference, and supplemental noncash disclosures.
- Exclude the full tax identifier and internal filesystem paths.

## 15. Cache and invalidation

Cache key:

```text
databaseRevision + normalizedQuery + method + calculationContractVersion
```

Invalidate after:

- Post, undo, exclude/delete of formerly included activity, or Posted edit;
- categorization or posting-split change;
- match or unmatch transfer;
- financial/Chart account create, edit, archive, restore, or delete;
- Cash Flow classification save or import;
- opening balance/date/source change;
- company currency, accounting basis, fiscal-year start, or active tax-year change;
- Chart import replacement;
- database restore, relocation activation, or portable-data import.

Do not invalidate for unrelated navigation, Transaction search/filter state, drawer state, or export-dialog cancellation.

## 16. Performance and determinism

- Target full report under 750 ms for 10,000 transactions and current chart size on the supported desktop baseline.
- Target cached report under 100 ms.
- Target detail under 300 ms for 2,000 contributions.
- Target classification review under 500 ms for current chart size and 10,000 transactions.
- Use repository aggregation and Maps keyed by stable IDs; do not perform nested full-transaction scans per row.
- Sort by fixed section order, account display order, normalized path, stable role, and stable ID.
- Identical snapshot/query/contract version yields identical amounts, row order, warnings, and IDs.
- Report/detail/export/preview operations are read-only and deterministic except generated timestamps and selected output path.

## 17. Security and privacy

- All classification and report data remains local.
- Standard outputs include only company fields required by the existing report identity contract.
- Full tax identifiers are excluded from report state, logs, errors, CSV, XLSX, print, and PDF.
- Backup and portable-data behavior retains existing local-data disclosures.
- Temporary files use host-owned safe-write, atomic move, and cleanup behavior.
- Tests and fixtures use neutral public identities and synthetic transactions.
- Error messages do not expose SQL, native stacks, or private paths.

## 18. Verification strategy

### 18.1 Baseline oracle

Before implementation, create a deterministic two-year fixture oracle with exact expected:

- unadjusted P/L Net Profit;
- opening and ending Balance Sheets;
- cash/cash-equivalent account composition;
- noncash adjustments;
- operating asset/liability adjustments;
- Investing and Financing rows;
- noncash disclosures;
- Beginning Cash, Net Change, Ending Cash, unclassified activity, and Difference; and
- row/detail contribution totals.

The oracle is independent from the production report implementation.

### 18.2 Unit tests

Test pure functions for:

- query normalization, day-before-start, fiscal-year presets, leap day, and invalid ranges;
- cash-role/treatment compatibility and every structural default;
- Net Profit parity with P/L;
- noncash sign reversal;
- operating asset/liability sign rules with increases, decreases, zero, and negative balances;
- Investing/Financing cash-side signs;
- cash-to-cash, cash-to-restricted, cash-to-operating, and cash-to-financing transfers;
- credit-card charge/payment timing;
- opening balances and conflict modes;
- noncash disclosure exclusion;
- zero filtering and hierarchy;
- status and every warning code;
- stable row/detail identity; and
- exact minor-unit reconciliation.

### 18.3 Persistence and migration tests

- Migrate schema 6 to proposed schema 7 in place and reopen.
- Verify every standard Account Type/Detail Type mapping.
- Prove ambiguous custom details become Review required.
- Prove no mapping query or code path uses account/company/institution/marketplace names.
- Preserve stable IDs, counts, parents, transactions, splits, rules, transfers, imports, balances, archive/lock state, company profile, and audit history.
- Roll back on invalid enum, failed constraint, or foreign-key/semantic check.
- Round-trip Chart import/export with new columns.
- Accept schema 7 through backup, restore, portable export/import, desktop-host validation, and shared schema tests.

### 18.4 Application-service tests

- Preview is non-mutating.
- Save validates, audits, and invalidates reports.
- Query returns one frozen report and revision.
- Detail/export rejects stale revision.
- Every displayed amount reconciles.
- Review-required report is not labeled Complete.
- Every listed mutation invalidates; unrelated UI state does not.
- Report operations do not change repository counts, values, revision, or audit history.

### 18.5 Component/browser tests

- Navigation and workspace exclusivity.
- Period presets, manual dates, independent filters, and zero toggle.
- Complete, Review-required, empty, no-cash, stale, loading, and failure states.
- Hierarchy, font-weight parity, amount formatting, and accessible names.
- Every amount opens matching detail.
- Classification preview, validation, save/cancel, and stale conflict.
- Export actions and print preview behavior.

### 18.6 Export tests

- Screen, CSV, XLSX, print model, and PDF model contain the same rows, amounts, status, warnings, and Difference.
- CSV round-trips special characters and neutral company identities.
- XLSX reopens with three required sheets and numeric cells.
- XLSX detail reproduces every statement row.
- Print preview supports Command-P without auto-printing.
- Cancellation and write failure leave no success-labeled partial output.

### 18.7 Performance fixture

Use an isolated deterministic fixture with at least:

- 10,000 transactions;
- 2,000 drill-down contributions on one row;
- multiple cash, credit-card, clearing, asset, liability, and equity accounts;
- confirmed and unmatched transfer cases; and
- nested Chart hierarchy.

Record full report, cached report, detail, and classification-review timings.

### 18.8 Electron smoke

Run against an isolated temporary profile/database. Verify:

- schema migration or fresh schema creation;
- Cash Flow navigation;
- classification review/edit;
- one complete report and one drill-down;
- CSV and reopened XLSX;
- print preview and Command-P;
- warnings/status/Difference; and
- backup/restore of classifications.

Do not access or modify the live user database.

## 19. Acceptance traceability

| PRD requirement | Specification sections |
| --- | --- |
| CF-001–CF-003 | 3, 8–10.3 |
| CF-004–CF-006 | 4–7 |
| CF-007–CF-008 | 10.1, 10.8 |
| CF-009–CF-011 | 10.4–10.6 |
| CF-012–CF-015 | 10.7–10.9 |
| CF-016–CF-019 | 10.2, 10.10–10.12 |
| CF-020–CF-022 | 6, 7.4, 11, 13.4–13.5 |
| CF-023–CF-024 | 9.1, 13.1–13.2 |
| CF-025–CF-028 | 14 |
| CF-029–CF-030 | 6.2, 15 |
| CF-031–CF-035 | 2, 16–18 |
| A1–A5 | 10.3–10.8, 18.1–18.2 |
| A6–A11 | 10.4, 10.7–10.9, 18.1–18.2 |
| A12–A14 | 10.8–10.11, 12 |
| A15–A17 | 9.1, 10.1–10.3, 13.6 |
| A18–A20 | 7, 14, 18.3–18.8 |

## 20. Product-spec completion gate

The first Statement of Cash Flows release is complete only when:

1. CF-001 through CF-035 and A1 through A20 pass.
2. Net Profit exactly equals the existing unadjusted P/L for the normalized period.
3. Opening and Ending Cash exactly equal included Balance Sheet financial accounts for their dates.
4. Every row amount reconciles to its detail or disclosed formula.
5. Complete fixtures have zero unclassified cash activity and a zero minor-unit Difference.
6. Noncash Investing/Financing activity is excluded from cash totals and disclosed when identifiable.
7. Screen, CSV, XLSX, print preview, and PDF agree exactly.
8. Schema migration, Chart import/export, backup/restore, and portable export/import preserve classifications and references.
9. Browser, performance, desktop-host, and isolated packaged Electron smoke tests pass.
10. No Cash Flow read, detail, export, print, or preview operation mutates book state.
11. Generic source, fixtures, tests, outputs, and documentation pass a privacy scan.
12. Documentation is updated to mark the feature complete only after all preceding gates have recorded evidence.

No DTO, service method, table, navigation item, static build, or partial report alone satisfies this gate.
