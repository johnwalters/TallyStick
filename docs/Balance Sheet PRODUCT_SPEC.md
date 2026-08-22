# TallyStick Balance Sheet Product Specification

*Implementation specification · Version 1.0 · Implemented August 21, 2026*

Authority: [Balance Sheet PRD](Balance%20Sheet%20PRD.md) Draft 0.2  
Companion architecture: [Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md)  
Application-wide specification: [Local Accounting Application Product Specification](PRODUCT_SPEC.md)  
Implementation tracker: [Balance Sheet Task Tracker](Balance%20Sheet%20TASKS.md)
Execution catalog: [Balance Sheet Implementation Slices](Balance%20Sheet%20IMPLEMENTATION%20SLICES.md)

## 1. Purpose and status

This document translates the approved Balance Sheet PRD into implementation-ready contracts, calculations, persistence changes, user-interface behavior, migrations, exports, and verification criteria.

It specifies three connected product changes:

1. a local, as-of-date Balance Sheet;
2. reusable Company Settings for application and report identity; and
3. a generic account taxonomy shared by financial accounts and Chart of Accounts entries.

Implementation and release evidence are recorded in the linked Task Tracker. This document remains the controlling calculation and output contract for future changes.

When this document and the application-wide specification conflict on this feature, this document controls. The PRD controls product intent and acceptance.

## 2. Design constraints

- Preserve the Angular application, in-process application-service boundary, Electron filesystem boundary, and local SQLite persistence model.
- Do not introduce an HTTP API, server process, cloud dependency, or stored report-total table.
- Calculate money exclusively in signed integer minor units.
- Treat business dates as calendar dates without time-zone conversion.
- Use opaque stable identifiers; never identify an account by its display name.
- Keep the source-account sign convention: money in is positive and money out is negative.
- Read company identity, currency, fiscal year, accounting basis, and tax year through one reusable company-settings service.
- Do not encode a company name, institution, marketplace, financial-account ID, chart-account ID, or category name in report logic.
- Use one immutable Balance Sheet result object for the screen, drill-down keys, CSV, XLSX, print preview, and PDF.
- Report generation, drill-down, export, and print are read-only operations.

## 3. System decomposition

### 3.1 Application service

Extend the existing `AccountingApplication` boundary with typed Company Settings, account-classification, Balance Sheet, drill-down, and export operations. Angular components depend only on this interface.

| Operation | Required behavior |
| --- | --- |
| `getCompanyProfile` | Return the reusable masked company profile. |
| `updateCompanyProfile` | Validate, persist, audit, and return Company Settings. |
| `getAccountTypeCatalog` | Return the complete grouped Account Type and Detail Type catalog. |
| `previewAccountPlacement` | Validate a proposed account classification and return its reporting behavior/path without writing. |
| `getBalanceSheet` | Return one immutable report result for a normalized query and database revision. |
| `getBalanceSheetDetail` | Return exactly reconciling contributions for a report/detail key. |
| `exportBalanceSheet` | Export CSV or XLSX from the supplied report identity/result, without recalculation. |
| `openBalanceSheetPrintPreview` | Open a preview backed by the supplied report result; do not invoke printing automatically. |

The application service rejects a detail or export request when its report identity no longer matches the active database revision. The UI regenerates the report instead of mixing data from different revisions.

### 3.2 Domain/report service

A `BalanceSheetReportService` owns:

- as-of balance calculation;
- natural-sign transformation;
- account placement and hierarchy;
- derived Opening Balance Equity, Retained Earnings, and Current Earnings;
- synthetic subtotals and accounting-equation totals;
- warning generation; and
- drill-down contribution construction.

It consumes repository records and the existing unadjusted P/L report service. It does not read the DOM or filesystem.

### 3.3 Persistence

SQLite remains authoritative for company settings, account classification, transactions, splits, transfers, and audit history. Proposed schema version 6 adds metadata only; it does not rewrite ledger amounts, transaction states, posting splits, transfer matches, rule references, or stable IDs.

### 3.4 Presentation and native boundary

Angular renders the report and settings editors. Electron owns save dialogs, XLSX/CSV file writes, the print-preview window, PDF/system print integration, and the Command-P menu item. The same report DTO crosses all output paths.

## 4. Shared terminology and enums

### 4.1 Reporting group

```ts
type ReportingGroup = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

type BalanceSheetSection = 'ASSETS' | 'LIABILITIES' | 'EQUITY' | 'RECONCILIATION';
```

### 4.2 Account type

```ts
type AccountingAccountType =
  | 'BANK'
  | 'ACCOUNTS_RECEIVABLE'
  | 'OTHER_CURRENT_ASSET'
  | 'FIXED_ASSET'
  | 'OTHER_ASSET'
  | 'CREDIT_CARD'
  | 'ACCOUNTS_PAYABLE'
  | 'OTHER_CURRENT_LIABILITY'
  | 'LONG_TERM_LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'OTHER_INCOME'
  | 'COGS'
  | 'EXPENSE'
  | 'OTHER_EXPENSE';
```

Account-type to reporting-group mapping is a product constant and must be exhaustive. An unknown value is an error, not a default classification.

### 4.3 Account role and import capability

```ts
type AccountRole = 'FINANCIAL_SOURCE' | 'CHART';

interface ImportCapability {
  enabled: boolean;
  supportedSourceKinds: readonly ImportSourceKind[];
}
```

`AccountRole` describes storage/ledger use. `AccountingAccountType` describes accounting presentation. This new name avoids collision with the current legacy financial-account `AccountType = BANK | CREDIT_CARD | ENTITY`. Import capability is independent of both.

- Bank and Credit Card financial-source accounts default to import enabled.
- Other Current Asset financial-source accounts may enable import for marketplace or clearing activity.
- All other account types default to import disabled.
- Enabling an unsupported combination returns a typed validation failure.

### 4.4 Classification status

```ts
type ClassificationStatus = 'CONFIRMED' | 'REVIEW_REQUIRED';
```

An account marked `REVIEW_REQUIRED` stays visible and produces a warning. It is never omitted or silently reclassified.

## 5. Company Settings contract

### 5.1 Domain model

```ts
interface CompanyProfile {
  companyId: string;
  legalName: string;
  displayName: string;
  doingBusinessAs?: string;
  entityType?: string;
  address?: {
    line1?: string;
    line2?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    countryCode?: string;
  };
  phone?: string;
  email?: string;
  website?: string;
  maskedTaxIdentifier?: string;
  currencyCode: string;
  fiscalYearStartMonth: number;
  accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  activeTaxYear: number;
  createdAt: string;
  modifiedAt: string;
}

interface UpdateCompanyProfileCommand {
  expectedModifiedAt: string;
  legalName: string;
  displayName?: string;
  doingBusinessAs?: string;
  entityType?: string;
  address?: CompanyAddressInput;
  phone?: string;
  email?: string;
  website?: string;
  taxIdentifier?: string | null;
  currencyCode: string;
  fiscalYearStartMonth: number;
  accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  activeTaxYear: number;
}

interface ReportCompanyIdentity {
  companyId: string;
  legalName: string;
  displayName: string;
  doingBusinessAs?: string;
  addressLines: readonly string[];
  contactLines: readonly string[];
}
```

The read contract returns only a masked tax identifier. A separate explicit reveal operation may return the full local value to the company editor; it must never enter general application state, logs, analytics, standard exports, or report DTOs.

### 5.2 Service operations

| Operation | Required behavior |
| --- | --- |
| `getCompanyProfile()` | Return the single configured company profile. |
| `updateCompanyProfile(command)` | Validate, write transactionally, audit the change, and return the updated masked profile. |
| `revealCompanyTaxIdentifier()` | Require an explicit edit/reveal action and return only to the focused settings editor. |

### 5.3 Validation

- `legalName` is required after trimming.
- `displayName` defaults to `legalName` when blank.
- Currency is a supported three-letter ISO code; release 1 reports one base currency only.
- Fiscal-year start month is 1 through 12.
- Active tax year is a four-digit supported year.
- Email, website, country code, and tax identifier receive format validation when populated.
- Optional blank fields persist as null, not placeholder strings.
- Optimistic concurrency rejects a stale `expectedModifiedAt`.

### 5.4 Product-wide use

The application header uses `displayName`. Reports and standard exports use `displayName`, with `legalName` included in metadata when different. Print/PDF may include configured address and contact fields. The tax identifier is excluded from standard reports and exports.

## 6. Account taxonomy and editor contract

### 6.1 Type catalog

One catalog service returns grouped account types, compatible detail types, natural balance, statement placement, valid parent types, default import capability, and whether an opening balance is applicable.

The required detail-type catalog is the catalog in PRD Section 5.3. At minimum, Bank exposes Cash on hand, Checking, Money Market, Rents Held in Trust, Savings, and Trust account; Credit Card exposes Credit Card.

Those values are the standard selectable minimum, not permission to destroy imported metadata. An existing nonblank detail type outside the standard catalog is retained as an imported/custom detail type, shown explicitly in the editor, and mapped by its Account Type reporting group. It is not offered for a new account unless added to the catalog. A value that cannot be mapped safely is marked `REVIEW_REQUIRED` rather than rewritten or dropped.

```ts
interface AccountTypeDefinition {
  accountType: AccountingAccountType;
  reportingGroup: ReportingGroup;
  label: string;
  detailTypes: readonly DetailTypeDefinition[];
  naturalBalance: 'DEBIT' | 'CREDIT';
  balanceSheetSection?: BalanceSheetSection;
  openingBalanceAllowed: boolean;
  importCapabilityDefault: boolean;
}
```

### 6.2 Unified editor, existing stores

The UI presents one account editor and one taxonomy, but release 1 preserves the two existing persistence roles:

- financial-source accounts remain in `financial_account`; and
- categorization/counteraccounts remain in `chart_account`.

For a new account, the user-facing **Account use** choice determines the role:

- **Track transactions directly** creates a financial-source account and is available only for Asset or Liability types supported by the source-account ledger.
- **Category only** creates a Chart account and is available for all reporting groups.

When launched from an existing financial-source or Chart account, the role is fixed and the editor does not imply that changing Account Type moves a record between stores. A role conversion is outside release 1 and returns a clear validation message. Names never determine role. A financial-source account cannot be selected as a posting split, and a Chart account cannot receive imported source transactions.

Equity, Income, and Expense reporting groups are Chart accounts. Financial-source accounts must use an Asset or Liability type. Attempts to save an Equity, Income, or Expense financial-source account return `ACCOUNT_ROLE_TYPE_MISMATCH`.

### 6.3 Financial-source account additions

```ts
interface FinancialAccountClassification {
  accountType: Extract<AccountingAccountType,
    | 'BANK'
    | 'ACCOUNTS_RECEIVABLE'
    | 'OTHER_CURRENT_ASSET'
    | 'FIXED_ASSET'
    | 'OTHER_ASSET'
    | 'CREDIT_CARD'
    | 'ACCOUNTS_PAYABLE'
    | 'OTHER_CURRENT_LIABILITY'
    | 'LONG_TERM_LIABILITY'>;
  detailType: string;
  classificationStatus: ClassificationStatus;
  importCapability: ImportCapability;
  openingBalanceSource: 'DERIVED_EQUITY' | 'LEDGER_ACTIVITY';
}
```

`DERIVED_EQUITY` means the stored opening balance contributes to both the account and derived Opening Balance Equity. `LEDGER_ACTIVITY` requires the stored opening balance to be zero; dated Posted ledger activity supplies the position and counteraccount. This mutual exclusion prevents double counting.

### 6.4 Chart account additions

The existing Chart account `accountType`, `detailType`, parent, display order, lock, and archive fields use the same catalog. Balance Sheet Asset, Liability, and Equity chart accounts become reportable. Income/Expense Chart behavior remains unchanged and flows through earnings.

### 6.5 Parent and type changes

- A parent must exist, be active when newly selected, use the same reporting group, and not create a cycle.
- Account type and detail type must be compatible.
- Type changes preview affected report placement and validate transactions, splits, rules, tax settings, parent/children, import mappings, and transfer eligibility.
- A change that would invalidate any reference is rejected with the exact reference list.
- A stable account ID never changes during edit, archive, restore, or migration.
- Nonzero archived accounts remain reportable.

### 6.6 Placement preview

```ts
interface AccountPlacementPreview {
  reportingGroup: ReportingGroup;
  section?: BalanceSheetSection;
  fullPath: string;
  asOfDate: string;
  currentBalanceMinor?: bigint;
  behavior: 'BALANCE_SHEET_LINE' | 'CURRENT_EARNINGS';
  warnings: readonly AccountPlacementWarning[];
}
```

Asset, Liability, and Equity accounts preview their Balance Sheet path and current as-of balance. Income, COGS, Expense, Other Income, and Other Expense preview `CURRENT_EARNINGS` and explicitly state that they do not appear as individual Balance Sheet lines.

## 7. Proposed schema version 6

### 7.1 Company profile

Add one row per `company`:

```sql
CREATE TABLE company_profile (
  company_id TEXT PRIMARY KEY REFERENCES company(id),
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  doing_business_as TEXT,
  entity_type TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  locality TEXT,
  region TEXT,
  postal_code TEXT,
  country_code TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  tax_identifier TEXT,
  created_at TEXT NOT NULL,
  modified_at TEXT NOT NULL
);
```

Existing currency, fiscal-year start, accounting basis, and active tax year remain authoritative on `company` and are exposed through the combined Company Settings service.

### 7.2 Financial-account classification

Add to `financial_account`:

- `account_type TEXT NOT NULL`;
- `classification_status TEXT NOT NULL DEFAULT 'CONFIRMED'`;
- `import_enabled INTEGER NOT NULL DEFAULT 0`;
- `supported_source_kinds_json TEXT NOT NULL DEFAULT '[]'`;
- `opening_balance_source TEXT NOT NULL DEFAULT 'DERIVED_EQUITY'`.

Retain the legacy `type` column during schema 6 compatibility. New domain and report code reads `account_type`; legacy `type` is migration provenance only and must not drive new report placement.

### 7.3 Migration transaction

Migration runs in one SQLite transaction and records one correlated audit event set.

1. Create `company_profile` and seed legal/display name from `company.name`.
2. Preserve existing currency, fiscal year, accounting basis, and active tax year.
3. Map `BANK` to account type Bank, retain compatible Bank detail type, and enable import.
4. Map `CREDIT_CARD` to Credit Card, normalize detail type to Credit Card, and enable import.
5. Map legacy `ENTITY` with existing marketplace/clearing detail metadata to Other Current Asset and enable import.
6. Map ambiguous legacy `ENTITY` to Other Current Asset / Clearing account, set `REVIEW_REQUIRED`, retain import capability, and emit a migration warning.
7. Preserve IDs, names, parent IDs, opening balances/dates, transactions, transfers, rules, mappings, archive/lock state, and audit history.
8. Validate foreign keys, cycles, compatible detail types, required company fields, and record counts before committing.
9. Update the one shared current-schema constant only after the migration succeeds.

Migration must not classify by a customer-specific account name. Existing detail metadata and structural role are the only permitted automatic evidence.

## 8. Balance Sheet query and result contract

### 8.1 Query

```ts
interface BalanceSheetQuery {
  asOfDate: string;
  includeZeroBalanceAccounts: boolean;
}
```

The application validates the business date before repository work. Default `asOfDate` is the last day of the fiscal period identified by the active tax year. `activeTaxYear` denotes the calendar year in which that fiscal period ends; for example, a July-start fiscal year with active tax year 2026 ends June 30, 2026. Report filters persist independently from Transaction and P/L filters.

### 8.2 Report result

```ts
interface BalanceSheetReport {
  reportId: string;
  databaseRevision: string;
  generatedAt: string;
  query: BalanceSheetQuery;
  company: ReportCompanyIdentity;
  currencyCode: string;
  accountingBasis: 'CASH' | 'ACCRUAL' | 'MODIFIED_CASH';
  fiscalPeriod: { startDate: string; endDate: string };
  rows: readonly BalanceSheetRow[];
  totalAssetsMinor: bigint;
  totalLiabilitiesMinor: bigint;
  totalEquityMinor: bigint;
  totalLiabilitiesAndEquityMinor: bigint;
  differenceMinor: bigint;
  warnings: readonly BalanceSheetWarning[];
  detailIndex: Readonly<Record<string, readonly BalanceSheetContribution[]>>;
}

type BalanceSheetRowType =
  | 'SECTION_HEADER'
  | 'GROUP_HEADER'
  | 'ACCOUNT'
  | 'SUBTOTAL'
  | 'DERIVED_EQUITY'
  | 'TOTAL'
  | 'DIFFERENCE';

interface BalanceSheetRow {
  rowId: string;
  rowType: BalanceSheetRowType;
  section: BalanceSheetSection;
  accountType?: AccountingAccountType;
  accountRole?: AccountRole;
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
  unclassified: boolean;
}
```

`detailIndex` may be lazily generated behind `detailKey` for performance, but the returned detail must be calculated from the same immutable query snapshot and report rules.

### 8.3 Stable row identity

Account rows use role plus stable account ID. Synthetic rows use fixed semantic keys plus the query date, never display labels. Labels may change without invalidating drill-down identity.

## 9. Calculation rules

### 9.1 Included states and dates

- Include Posted transactions dated on or before `asOfDate`.
- Include both sides of confirmed Matched Transfers dated on or before `asOfDate` in their financial-source accounts.
- Exclude Pending and Excluded transactions.
- Exclude all activity after `asOfDate`.
- Include a stored opening balance only when its opening date is on or before `asOfDate` and `openingBalanceSource` is `DERIVED_EQUITY`.
- Archived status does not remove historical balances.

### 9.2 Source-account balance

For each financial-source account:

```text
internal source balance
  = applicable stored opening balance
  + sum(Posted transaction signed amounts through as-of date)
  + sum(Matched Transfer signed amounts through as-of date)
```

Natural presentation:

- Asset amount = internal source balance.
- Liability amount = `-1 × internal source balance`.
- Equity financial-source amount = internal source balance.

An overdrawn Asset or credit-balance anomaly may therefore display negative. The report preserves the amount and emits an applicable warning; it never clamps to zero.

### 9.3 Chart-account balance

Use active posting splits belonging to included Posted transactions.

| Reporting group | Balance Sheet contribution |
| --- | --- |
| Asset | `-1 × stored split amount` |
| Liability | `stored split amount` |
| Equity | `stored split amount` |
| Income / Other Income | included through earnings only |
| COGS / Expense / Other Expense | included through earnings only |

Matched Transfers have no posting splits and do not affect Chart accounts or earnings.

### 9.4 Fiscal period

The fiscal-year start containing `asOfDate` is derived from `fiscalYearStartMonth`:

- if the as-of month is on or after the start month, start in the as-of year;
- otherwise, start in the preceding year.

Current Earnings equals the existing **unadjusted** P/L Net Profit from that start date through `asOfDate`. Schedule C exclusions and report-only P/L category exclusions do not apply.

Derived Retained Earnings equals unadjusted P/L Net Profit for all recognized Posted activity before the current fiscal-year start. Direct Equity account postings remain separate Equity account lines. TallyStick does not create a closing entry.

### 9.5 Opening Balance Equity

For accounts with applicable `DERIVED_EQUITY` opening balances:

```text
Opening Balance Equity
  = sum(Asset opening balances in natural presentation)
  - sum(Liability opening balances in natural presentation)
```

It is a derived Equity row, not a transaction or Chart account. Its detail consists only of the contributing opening-balance records.

An account using `LEDGER_ACTIVITY` must have a zero stored opening balance and contributes no derived Opening Balance Equity. This validation makes a stored opening position and a ledger-entered opening position mutually exclusive.

### 9.6 Hierarchy and subtotals

- Group order follows the PRD: Assets, Liabilities, Equity.
- Account-type order follows the catalog; account order within a type follows Chart display order, then normalized label, then stable ID.
- Direct postings to a parent appear in that parent's direct Account row.
- Descendants appear once at their own depth.
- `Total for <parent>` equals the parent's direct amount plus all visible/hidden descendant amounts.
- Hiding zero leaves does not change any subtotal.
- Structural parents remain when necessary to explain a visible descendant.
- A cycle or missing parent produces a warning and places the affected nonzero amount under Unclassified accounts.

### 9.7 Totals and equation

```text
Total Assets = sum natural Asset leaf/direct contributions exactly once
Total Liabilities = sum natural Liability leaf/direct contributions exactly once
Total Equity = direct Equity + derived Retained Earnings
             + Current Earnings + Opening Balance Equity
Total Liabilities and Equity = Total Liabilities + Total Equity
Difference = Total Assets - Total Liabilities - Total Equity
```

No tolerance is applied in minor units. A valid result has `differenceMinor === 0`.

## 10. Drill-down contract

```ts
type BalanceSheetContributionKind =
  | 'OPENING_BALANCE'
  | 'POSTED_TRANSACTION'
  | 'POSTING_SPLIT'
  | 'MATCHED_TRANSFER'
  | 'CURRENT_EARNINGS'
  | 'RETAINED_EARNINGS';

interface BalanceSheetContribution {
  contributionId: string;
  kind: BalanceSheetContributionKind;
  businessDate: string;
  financialAccountId?: string;
  financialAccountName?: string;
  chartAccountId?: string;
  chartAccountPath?: string;
  transactionId?: string;
  transferMatchId?: string;
  sourceBatchId?: string;
  description: string;
  payee?: string;
  memo?: string;
  storedAmountMinor?: bigint;
  contributionMinor: bigint;
  runningBalanceMinor?: bigint;
}
```

Required behavior:

- Financial-source detail starts with an applicable opening balance, then Posted and Matched activity in date/stable-ID order, with a running balance.
- Chart detail lists each contributing Posted split and source provenance.
- Current Earnings opens/reuses P/L Detail for the exact fiscal period and unadjusted basis.
- Derived Retained Earnings opens P/L Detail constrained before the fiscal-period start.
- Opening Balance Equity lists contributing stored opening balances.
- Subtotal detail is the stable union of its direct and descendant contributions; a contribution appears once.
- The integer sum of contribution amounts must equal the selected row amount before detail is returned.
- A mismatch returns `REPORT_DETAIL_RECONCILIATION_FAILED`; partial detail is not displayed as complete.

## 11. Warnings and error model

### 11.1 Warning codes

| Code | Trigger | Display behavior |
| --- | --- | --- |
| `UNCLASSIFIED_NONZERO_ACCOUNT` | Review-required/unmapped account has nonzero balance | Show under Unclassified accounts and link to editor. |
| `BALANCE_SHEET_OUT_OF_BALANCE` | Difference is nonzero | Prominent report-level warning and difference drill-down. |
| `OPENING_BALANCE_AFTER_AS_OF` | Opening date is after report date | Exclude opening amount and identify account/date. |
| `ARCHIVED_NONZERO_ACCOUNT` | Archived account has nonzero balance | Show row with Archived indicator. |
| `UNSUPPORTED_CURRENCY` | Non-base or mixed currency detected | Preserve source metadata; fail totals if conversion is required. |
| `ACCOUNT_HIERARCHY_INVALID` | Cycle or missing parent | Place nonzero amount under Unclassified and explain. |
| `ACCOUNT_CLASSIFICATION_INVALID` | Type/detail/role cannot map | Show account and block silent omission. |
| `OPENING_BALANCE_MODE_CONFLICT` | Ledger mode has nonzero stored opening | Fail report for affected amount and link to account editor. |

### 11.2 Errors

Extend the application error model with stable report/company/account codes. Raw SQL, native stack traces, full tax identifiers, and sensitive filesystem paths are not displayed. Report errors never mutate books or produce a success-labeled partial export.

## 12. User-interface specification

### 12.1 Navigation

Add a Balance Sheet item with an appropriate Bootstrap Icon to the existing left navigation. It is mutually exclusive with Transactions, Chart of Accounts, Rules, Profit & Loss, and Backups. Changing workspaces does not alter Transaction selections or report filters.

### 12.2 Workspace header

Show:

- configured company display/report name;
- `Balance Sheet` heading;
- as-of date and accounting basis;
- Total Assets, Total Liabilities, Total Equity, and Difference;
- as-of date picker;
- Today, Previous month end, Current month end, and Year end shortcuts;
- Show zero-balance accounts toggle;
- Edit company information;
- Summary CSV, Summary XLSX, and Print / PDF actions.

### 12.3 Statement table

- Follow the PRD section and type order.
- Use the existing P/L indentation, 14px-or-greater readable labels, tabular prominent-decimal amount font, and currency formatter.
- Apply bold to both label and amount for group/subtotal/total rows.
- Do not bold either label or amount for detail account rows.
- Show `$0.00` for displayed zero values and a leading minus sign for negatives.
- Every amount button exposes a descriptive accessible name and opens detail.
- Nonzero archived and unclassified rows display visible text indicators, not color alone.

### 12.4 Empty and failure states

An empty valid report still shows Assets, Liabilities, Equity, all totals at `$0.00`, and a `$0.00` difference. Validation or generation failure replaces the table with an actionable error and does not reuse a stale prior result.

### 12.5 Company editor

Open a focused side panel consistent with existing account/rule editors. Save remains disabled until required fields are valid. Tax identifier is masked by default. Cancel discards unsaved edits. Successful save refreshes application branding and report metadata without rewriting ledger records.

### 12.6 Account editor changes

- Group Account Type options under Asset, Liability, Equity, Income, and Expense.
- Filter Detail Type immediately after Account Type changes.
- Require confirmation before clearing an incompatible existing detail or parent.
- Keep import capability separate from Account Type controls.
- Show the placement preview before save.
- Show all blocking references before rejecting a type change.

## 13. Export and print contracts

### 13.1 Shared source

All formats consume `BalanceSheetReport`. No exporter recalculates balances or applies its own sign rules.

### 13.2 Summary CSV

Write UTF-8 CSV with a metadata preamble and columns:

- company legal name;
- company display name;
- as-of date;
- accounting basis;
- currency;
- row ID and row type;
- section and Account Type;
- account role and stable account ID;
- label, full path, and depth;
- amount in decimal currency text;
- derived, archived, and unclassified flags.

Include explicit final rows for Total Assets, Total Liabilities, Total Equity, Total Liabilities and Equity, and Difference.

### 13.3 Summary XLSX

Workbook sheets:

1. **Balance Sheet** — screen order, indentation, matching bold styles, currency number formats, metadata, warnings, and final totals.
2. **Balance Sheet Detail** — one contribution row per drill-down contribution plus row/detail keys needed to reproduce every amount.

The workbook must reopen successfully and numeric cells must contain numbers, not formatted strings.

### 13.4 Print/PDF

- Open a preview window without automatically opening the system print dialog.
- Preview title: `<configured company display name> — Balance Sheet`.
- Provide a File > Print menu command with Command-P.
- Repeat report headings on subsequent pages.
- Keep a subtotal with the immediately preceding group when practical.
- Include warnings and the exact Difference.
- Standard print/PDF omits the tax identifier.

## 14. Cache and refresh behavior

The application may memoize a report by database revision plus normalized query. Invalidate the result after:

- Post or undo;
- match or unmatch transfer;
- transaction date/amount/source-account change;
- posting split change;
- financial or Chart account create/edit/archive/restore;
- opening balance/date/source change;
- company fiscal-year, currency, or accounting-basis change; or
- restore/relocation activation.

Switching workspaces or changing unrelated Transaction search/filter state does not invalidate the report. A cached report is never persisted as an editable book total.

## 15. Performance and determinism

- Target report generation: under 500 ms for 10,000 transactions and the current chart size on the supported desktop baseline.
- Target drill-down open: under 300 ms for 2,000 contributions.
- Use repository aggregation/query indexes on transaction state/date/account, transfer state/date/account, split transaction/chart account, and chart parent/display order.
- Identical database revision and normalized query must return identical row order, amounts, warnings, and stable semantic row keys.
- Export progress may be shown for large workbooks; cancellation removes temporary output and never presents it as successful.

## 16. Security and privacy

- All settings and report data remain local.
- Company information is included only where the output contract specifies it.
- Full tax identifier is masked outside explicit reveal/edit and excluded from logs, error telemetry, standard reports, CSV, XLSX, print, and PDF.
- Database backups include the local company profile and therefore may contain the tax identifier; the Backups workspace must retain its existing local-data disclosure.
- Temporary export and print files use the existing host-owned safe-write/cleanup behavior.

## 17. Verification strategy

### 17.1 Unit tests

Test independently:

- fiscal-year start calculation, including non-calendar fiscal years and leap day;
- natural signs for every Asset, Liability, Equity, Income, COGS, Expense, Other Income, and Other Expense path;
- source-account and Chart-account balances;
- Current and prior-period earnings parity with P/L;
- Opening Balance Equity and opening-balance mode conflict;
- hierarchy order, direct-parent postings, subtotals, zero hiding, and cycle fallback;
- equation totals and exact minor-unit difference;
- drill-down sums and duplicate prevention;
- company validation/masking; and
- every Account Type/Detail Type compatibility rule.

### 17.2 Persistence and migration tests

- Migrate schema 5 to 6 in place and reopen.
- Verify company profile seeding and generic edit persistence.
- Verify all legacy BANK, CREDIT_CARD, and ENTITY mappings without name-based assumptions.
- Prove stable IDs and record counts are unchanged.
- Prove transactions, splits, transfers, rules, mappings, archive/lock state, and audit history remain linked.
- Roll back the entire migration on any invalid record or failed integrity check.
- Accept schema 6 in backup, restore, portable export, Electron host validation, and desktop smoke fixtures through the shared schema constant.

### 17.3 Application-service tests

- Query validation and defaults.
- Read-only report behavior.
- Cache invalidation after each listed mutation.
- Typed warning and error outcomes.
- Company optimistic concurrency and audit events.
- Account type-change reference validation and placement preview.

### 17.4 Component/browser tests

- Navigation and workspace exclusivity.
- As-of shortcuts, zero toggle, company editor, and account taxonomy.
- Hierarchy/amount font-weight parity and accessibility names.
- Every amount opens reconciling detail.
- Empty, warning, unclassified, archived, and out-of-balance states.
- CSV/XLSX triggers and print preview behavior.

### 17.5 Export tests

- Screen, CSV, XLSX, detail sheet, print model, and PDF model share exact row amounts and totals.
- XLSX reopens with numeric currency cells, two required sheets, hierarchy, and styles.
- CSV round-trips special characters and configured neutral company names.
- Print preview exposes Command-P without auto-printing.

### 17.6 Electron smoke

Run against an isolated temporary profile and database. Verify company editing, account taxonomy/preview, report navigation, at least one drill-down, CSV/XLSX output, print preview and Command-P, warnings, totals, and `$0.00` reconciliation without touching the live database.

## 18. Acceptance traceability

| PRD requirement | Specification sections |
| --- | --- |
| BS-001–BS-005 | 8, 9.1–9.3 |
| BS-006–BS-007 | 9.4–9.5 |
| BS-008–BS-010 | 9.6–9.7 |
| BS-011–BS-013 | 10, 11, 12.3–12.4 |
| BS-014–BS-016 | 12.3, 13 |
| BS-017–BS-020 | 2, 14 |
| BS-021–BS-023 | 5, 7.1, 12.5, 16 |
| BS-024–BS-028 | 4, 6, 7.2 |
| BS-029–BS-030 | 7.3, 17.2 |
| A1–A7 | 9.1–9.4, 17.1 |
| A8–A12 | 9.4–10, 17.1–17.4 |
| A13–A14 | 13–15, 17.5–17.6 |
| A15–A16 | 5, 7.1, 17.2–17.4 |
| A17–A19 | 6, 7.2–7.3, 17.2–17.4 |

## 19. Product-spec completion gate

The feature is not complete until:

1. BS-001 through BS-030 and A1 through A19 pass.
2. Every visible amount reconciles to its detail or disclosed derived formula.
3. Current Earnings exactly equals the unadjusted P/L for the same fiscal period.
4. Valid fixtures have a zero minor-unit Difference.
5. Screen, CSV, XLSX, print preview, and PDF agree exactly.
6. Company identity is configurable everywhere required, with no prior-customer identity in generic fixtures.
7. The full taxonomy, placement preview, stable-reference validation, and Entity migration pass persistence and UI tests.
8. Browser tests and isolated Electron smoke pass.
9. Backup/restore and shared schema validation accept the migrated database.
10. No report operation mutates book state.

No DTO, service method, table, navigation item, or static build alone satisfies this gate.
