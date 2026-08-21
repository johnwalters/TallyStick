# Local Accounting Application Product Specification

*Implementation-ready product specification · Draft 0.1 · August 6, 2026*

## 1. Document purpose and authority

This specification defines the behavior, contracts, data model, validation, user workflows, and verification requirements for the local accounting application described by:

- [Quicken Replacement PRD](Quicken%20Replacement%20PRD.md) — authority for product purpose, user needs, and MVP scope.
- [Quicken Replacement Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md) — authority for system boundaries, Angular service design, SQLite, and testing architecture.
- [Accounting Application Implementation Plan](accounting_plan.md) — authority for implementation order, phase gates, and release sequence.

If this specification conflicts with the PRD on product behavior, the PRD wins. If it conflicts with the Technical Architecture on system structure, the Technical Architecture wins. Changes that alter either authority document must be reviewed there before this specification is updated.

## 2. Product definition

The product is a single-user, local desktop accounting application for a small online business. It supports the bookkeeping workflow needed to:

1. Import bank, credit-card, and marketplace summary transactions.
2. Normalize and review imported activity.
3. Suggest categories through deterministic rules and prior confirmed behavior.
4. Post, split, exclude, undo, and transfer-match transactions.
5. Produce a cash-basis profit and loss report with traceable detail.
6. Produce a Schedule C-ready variant whose tax-account adjustments are visible and report-only.
7. Export an accountant package and preserve the books through verified local backup.

The product is not a general-purpose accounting suite and does not replace third-party marketplace analytics services.

### 2.1 Primary user

The owner/bookkeeper is the only MVP user. Authentication, roles, approvals, concurrent editing, and multi-user collaboration are out of scope.

### 2.2 Primary success measures

| Measure | Required result |
| --- | --- |
| Imported source rows | 100% accepted or rejected with a reason |
| Rejected rows | 100% visible with a human-readable reason |
| P/L reconciliation | `$0.00` difference between displayed totals and drill-down detail |
| Zero-amount rows | 100% of exact-zero normalized rows rejected individually without aborting their batch |
| Transfer effect | `$0.00` effect on net profit after confirmation |
| Schedule C adjustment | Disclosed, drillable, tax-year-specific, and non-mutating |
| Recovery | At least one verified, restorable year-end backup |

## 3. Locked scope

### 3.1 MVP capabilities

- Local company and financial-account setup.
- Bank, Credit Card, and Entity account types.
- CSV, XLS/XLSX, and QBO/OFX transaction imports.
- Amazon summary import through the shared import workflow.
- Preview, reusable mappings, validation, row disposition, and atomic import commit.
- Pending, Posted, Excluded, and Matched Transfer transaction states.
- Deterministic rules, prior-confirmed-match suggestions, and manual categorization.
- Editing, exact splits, individual and bulk actions, exclusion reasons, and undo.
- Bank and credit-card transfer suggestions, confirmation, and unmatching.
- In-app Chart of Accounts list/editor plus CSV/XLSX round-trip import/export.
- P/L summary/detail, Schedule C-ready report, exceptions, reconciliation, and accountant export.
- Local backup, validation-first restore, portable export, integrity checks, and audit history.

### 3.2 Explicit non-goals

- Live bank or credit-card connections.
- PDF statement import or OCR in MVP.
- AI or external categorization services.
- Amazon order, SKU, inventory, forecasting, or profitability analytics.
- Amazon payout/clearing auto-matching.
- Duplicate-detection or automatic de-duplication behavior beyond manual review and exclusion.
- Invoices, bills, accounts payable, payroll, or sales-tax filing.
- Full double-entry financial statements beyond the behavior required for transfers, balances, and a defensible P/L.
- Automatic Schedule C mapping, recategorization, or tax filing.
- In-app chart-of-accounts maintenance beyond import/export and use of active entries.
- Multiple companies, multiple users, cloud sync, or collaboration.
- HTTP services, Web APIs, .NET, SQL Server, or database-provider portability.

## 4. Required system boundary

### 4.1 Angular throughout

The application UI and all non-UI application behavior are written in Angular and TypeScript. Angular dependency injection composes feature facades, application services, accounting services, import services, report services, repositories/gateways, and backup services.

Business behavior must not be moved into a separate framework-neutral backend or the desktop host.

### 4.2 Stable Application Service Interface

Every user-visible capability is exposed through typed Angular-injectable services collectively called the **Application Service Interface**. This is an in-process application contract, not a network protocol.

The interface must:

- Accept typed commands and queries with explicit values.
- Return immutable DTOs and typed outcomes.
- Return validation and application failures without leaking native exceptions.
- Remain independent of Angular components, forms, routes, browser events, and presentation state.
- Never expose SQL, SQLite connections, native bridge handles, repository objects, parser objects, or lazy database queries.
- Support both the production Angular UI and a replacement Angular UI without changes to application behavior.

### 4.3 Native boundary

A minimal TypeScript desktop host may perform only privileged SQLite-driver and filesystem operations through a narrow typed bridge.

The host must not:

- Categorize, normalize, post, split, match, report, or adjust transactions.
- Interpret accounting state.
- Expose arbitrary filesystem access, process execution, or module loading.
- expose raw SQLite handles to Angular UI or application services.

### 4.4 Persistence boundary

SQLite is the sole system of record. Angular application services depend on focused Angular repository and query gateway services. The native host executes parameterized SQLite operations but contains no application decisions.

## 5. Product terminology

| Term | Meaning |
| --- | --- |
| Company | The one local business data set managed by the application. |
| Financial account | A Bank, Credit Card, or Entity ledger into which transactions are imported. |
| GL account | A chart-of-accounts category used to classify posted amounts. |
| Source row | One row or logical transaction read from an import file before accounting treatment. |
| Import batch | One previewed and committed source file for one destination account. |
| Pending | Imported but not yet included in balances or reports. |
| Posted | Validated and classified activity included in account balance and P/L calculations. |
| Excluded | Activity deliberately omitted from balances and reports with a recorded reason. |
| Matched Transfer | Two linked, equal-and-opposite account transactions included in account balances but excluded from the P/L. |
| Suggestion | A proposed category, transfer, or field value that does not change the books until confirmed. |
| Raw value | Immutable value derived from the source file. |
| Accounting value | User-reviewable value used for posting and reporting. |
| Schedule C-ready report | The existing P/L hierarchy with report-only federal/state tax exclusions and disclosures; not a Schedule C mapping system. |

## 6. Application service surface

The exact TypeScript names may be refined before implementation, but the functional surface and separation below are required.

### 6.1 Account application service

| Operation | Required behavior |
| --- | --- |
| `listAccounts` | Return active or archived accounts with stable ID, type/detail type, institution/entity, identifier, hierarchy, opening balance, calculated balance, lock/status, and unresolved count. |
| `getAccount` | Return one financial account with calculated balance without exposing persistence entities. |
| `createAccount` | Create a Bank, Credit Card, or Entity account after type, detail, identity, hierarchy, and opening-balance validation. |
| `updateAccount` | Update editable metadata and opening balance while preserving the stable ID and writing audit history. |
| `archiveAccount` | Archive or restore an unlocked account, prevent new imports while archived, and retain history and reports. |
| `listChartAccounts` | Return the ordered chart with stable ID, full hierarchy metadata, account type, detail type, description, lock state, and active/archive status. |
| `createChartAccount` | Validate and create a root account or compatible subaccount, preserving the stable chart boundary and writing audit history. |
| `updateChartAccount` | Edit account metadata and hierarchy without changing the stable ID or orphaning transaction, rule, tax-setting, or report references. |
| `archiveChartAccount` | Archive or restore an account while retaining historical references; locked accounts cannot be archived. |
| `importChartOfAccounts` | Validate a CSV/XLS/XLSX chart completely before atomically applying it. |
| `exportChartOfAccounts` | Write the current chart, hierarchy, and all editable fields to round-trip XLSX. |

### 6.2 Import application service

| Operation | Required behavior |
| --- | --- |
| `inspectSource` | Detect supported format, describe columns/metadata, and return typed unsupported or malformed failures. For CSV, locate the first valid transaction header and ignore statement-summary/preamble rows above it. |
| `previewImport` | Apply mapping, normalization, and validation without changing company data. |
| `saveMapping` | Save a reusable mapping identified by institution/file shape and source type. |
| `listMappings` | Return compatible saved mappings for the selected source. |
| `commitImport` | Atomically create one import batch and all accepted Pending transactions from an unchanged preview. |
| `getImportBatch` | Return batch provenance, mapping, counts, errors, and resulting transaction identifiers. |

### 6.3 Transaction application service

| Operation | Required behavior |
| --- | --- |
| `listTransactions` | Filter, search, sort, and page transactions without returning database queries. |
| `getTransaction` | Return raw values, accounting values, splits, suggestions, source batch, match, and audit history. |
| `updateTransaction` | Edit permitted accounting values while preserving raw values and auditing before/after state. |
| `setSplits` | Replace splits only when they reconcile exactly to the transaction amount. |
| `categorizeTransactions` | Apply one GL category to a validated selection as an atomic bulk operation. |
| `postTransactions` | Validate and post one or more Pending transactions atomically. |
| `excludeTransactions` | Exclude one or more Pending transactions atomically with a non-empty reason. |
| `undoTransactions` | Return Posted or Excluded items to Pending and reverse their balance/report effect atomically. |
| `findTransferCandidates` | Return ranked eligible equal-and-opposite bank/card candidates and rationale. |
| `confirmTransfer` | Link two eligible Pending transactions as a Matched Transfer atomically. |
| `unmatchTransfer` | Remove the link and return both transactions to Pending atomically. |

### 6.4 Rule application service

| Operation | Required behavior |
| --- | --- |
| `listRules` / `getRule` | Return human-readable conditions, actions, priority, status, and usage information. |
| `exportRules` | Export every current rule on demand to the documented Excel/CSV rule-exchange format, including stable identifier, name, enabled status, priority, conditions, actions, outputs, and chart-category reference. |
| `previewRulesImport` | Parse an externally edited Excel/CSV rule-exchange file and return a non-mutating validation preview with row-level errors, collision warnings, and imported/updated/disabled counts. |
| `commitRulesImport` | After explicit confirmation, atomically replace the full rule set only from a fully valid preview and record the exchange in audit history. |
| `importRules` | Import rules from the public exchange format; invalid input must not partially apply. |
| `testRule` | Evaluate an unsaved rule against selected existing transactions without changing them. |
| `saveRule` | Create or update a valid rule and its explicit priority. |
| `duplicateRule` | Copy a rule as disabled until explicitly enabled. |
| `setRuleEnabled` | Enable or disable without deleting history. |
| `reorderRules` | Atomically assign an unambiguous evaluation order. |
| `explainRuleEvaluation` | Return matching conditions, collisions, winner, outputs, and rationale. |

Rule spreadsheet exchange is the supported ongoing maintenance workflow. Exported rules may be edited outside the application and imported as a complete replacement set. Before confirmation, the application validates required fields, unique stable identifiers and priorities, supported conditions/operators/actions, range/value formats, active chart-category references, and well-formed rule logic. It presents row-level errors and reviewable collision warnings. Any validation failure leaves the active rules unchanged.

### 6.5 Report application service

| Operation | Required behavior |
| --- | --- |
| `getProfitLoss` | Return hierarchical totals by date range and month/year grouping. |
| `getProfitLossDetail` | Return the exact posted splits contributing to a selected report cell. |
| `getScheduleCReadyReport` | Apply tax-year report settings without mutating transactions or the unadjusted P/L. |
| `getTaxAdjustmentDetail` | Return postings removed by the active federal/state settings. |
| `saveTaxYearSettings` | Save account sets and include/exclude choices for one tax year. |
| `getExceptionReport` | Return pending, uncategorized, unmatched, parse-warning, and edited-after-posting items. |
| `getReconciliationReport` | Return opening balance, recognized activity, calculated balance, optional statement balance, and difference. |
| `exportReport` | Export permitted report forms to CSV, XLSX, or print-ready PDF. |
| `exportAccountantPackage` | Export annual unadjusted P/L, adjusted report, settings, detail, exclusions, and notes. |

### 6.6 Backup application service

| Operation | Required behavior |
| --- | --- |
| `getDatabaseLocations` | Return the configured live SQLite path, backup folder, latest verified backup path/time, and whether the desktop filesystem bridge is available. |
| `chooseBackupDirectory` | Select and persist a local backup folder without exposing Electron or filesystem types to the UI. |
| `createDatabaseBackup` | Snapshot the host-owned current SQLite image to a timestamped plain `.sqlite` file and verify the written copy. |
| `relocateCurrentDatabase` | Choose a new live `.sqlite` path, create a verified safety backup, atomically copy current data, persist the setting, and restart. |
| `restoreDatabaseBackup` | Choose a `.sqlite` backup, validate it separately, create a verified safety backup, atomically activate a copy at the live path, and restart. The selected backup remains unchanged. |
| `createBackup` | Package portable company data and generate an integrity manifest for the existing archive/export contract. |
| `verifyBackup` | Validate database integrity, schema, manifest, attachments, and hashes without altering active data. |
| `validateRestore` | Validate a candidate in a separate location and return discrepancies. |
| `activateRestore` | Replace active data only from a successful validation result and explicit confirmation. |
| `exportAllData` | Export documented CSV/JSON representations of all portable records. |
| `getBackupStatus` | Return latest attempted and latest verified backup separately. |

## 7. Canonical data model

### 7.1 Representation rules

- Identifiers are application-generated opaque strings and are never derived from SQLite row numbers.
- Money is stored as a signed 64-bit integer count of minor currency units and exposed through a `Money` value object.
- Business dates are calendar dates without time-zone conversion.
- Audit timestamps are UTC instants.
- Source-account sign convention is money in = positive and money out = negative.
- Raw imported fields and source provenance are immutable.
- User-entered accounting fields are versioned through append-only audit events.
- Reports are calculated from ledger detail and are never stored as editable totals.

### 7.2 Company

Required fields:

- `companyId`
- legal/display name
- default currency
- fiscal-year start
- default accounting basis
- active tax year
- created and modified timestamps

MVP permits exactly one company database. Multi-company switching is not implemented.

### 7.3 Financial account

Required fields:

- `accountId`
- account type: `BANK`, `CREDIT_CARD`, or `ENTITY`
- type-specific detail type
- display name
- institution/entity name
- optional last-four identifier
- optional same-type parent account identifier
- optional description
- opening balance in minor units
- opening-balance date
- read-only calculated balance derived from the opening balance and imported activity
- lock state
- active/archived status
- created and modified timestamps

Account names must be non-empty and unique. Bank detail types are Cash on hand, Checking, Money Market, Rents Held in Trust, Savings, and Trust account; Credit Card uses Credit Card; Entity uses Marketplace, Clearing account, or Other transactions. A parent must be active, the same account type, and cannot create a self-reference or cycle. Last four, when supplied, is exactly four digits. Locked accounts cannot be archived. Archived accounts retain transactions and remain reportable but cannot receive new imports. Create, edit, archive, and restore preserve the stable account ID and are transactional and audited.

### 7.4 Chart account

Required fields:

- `chartAccountId`
- external/stable identifier when supplied
- full account name
- display name
- optional parent identifier
- account type: `INCOME`, `COGS`, `EXPENSE`, `OTHER_INCOME`, or `OTHER_EXPENSE`
- display order
- active/archived status

The hierarchy must be acyclic. Each parent must exist. Names/identifiers must be unique under the imported chart rules. A chart replacement cannot orphan a posting or rule reference.

### 7.5 Import mapping

Required fields:

- `mappingId`
- source kind and optional institution/file-shape key
- detected header-row and sheet selection when applicable; CSV header detection must scan past summary/preamble rows and retain the original file row offset
- date field and date format
- one signed amount field or separate debit/credit fields
- explicit sign transformation
- description, payee, memo, reference, and optional source-type mappings
- created, modified, and last-used timestamps

A mapping must resolve one unambiguous posting date and one unambiguous normalized amount.

### 7.6 Import batch and source row

An import batch records:

- `batchId`, destination account, source kind, parser version, mapping version, and source-file hash
- source display name and immutable source metadata
- preview token/version
- started, previewed, committed, and completed timestamps
- accepted, rejected, skipped, and warning counts
- total normalized amount of accepted rows
- final status and typed failure when applicable

Each source row records its source location, original field values, normalized candidate values, disposition (`ACCEPTED`, `REJECTED`, or `SKIPPED`), validation codes, and resulting transaction identifier when accepted.

The source hash is provenance only in MVP. It must not silently block a re-import or perform automatic duplicate detection.

### 7.7 Transaction

Required fields:

- `transactionId` and `accountId`
- posting date and optional transaction/settlement date
- signed source-account amount and currency
- raw and normalized description
- raw and normalized payee/from-to
- raw and editable memo/reference values
- optional tags, business note, and attachment references
- transaction state
- import batch and source-row reference
- categorization source, rule identifier, rationale, and confirmation state
- exclusion reason or transfer link when applicable
- created, modified, posted, excluded, and undone timestamps as applicable

### 7.8 Posting split

Each Posted transaction has one or more posting splits containing:

- `splitId`, `transactionId`, and `chartAccountId`
- signed source-account amount in minor units
- optional memo and tags
- display order

The exact integer sum of all active split amounts must equal the transaction amount. A one-category transaction is represented by one split. A transaction cannot be Posted without at least one valid split.

### 7.9 Transfer match

A transfer match contains:

- `transferMatchId`
- exactly two transaction identifiers from different eligible accounts
- equal-and-opposite amounts
- date difference and configured window
- confidence score and rationale
- confirmed timestamp and audit reference

Both transactions must be Pending when confirmed. Confirmation changes both states to Matched Transfer in one database transaction. Neither transaction has P/L splits while matched.

### 7.10 Rule and suggestion

A rule contains:

- `ruleId`, name, enabled status, integer priority, and optional source/migration identifier
- condition tree supporting AND, OR, and explicit exclusions
- conditions for account, money direction, description operator, payee, amount/range, and source type
- actions for GL account, payee, memo/description, transfer account, tags, or exclusion suggestion
- created, modified, and last-tested timestamps

A suggestion records or returns its source (`TRANSFER`, `RULE`, `PRIOR_MATCH`, or `NONE`), confidence/rationale, matched rule/conditions, proposed outputs, and confirmation status. A suggestion never changes the books by itself.

### 7.11 Tax-year report settings

Settings are keyed by tax year and contain:

- the GL account identifiers treated as federal income-tax expense
- the GL account identifiers treated as state/local income-tax expense
- `includeFederalIncomeTax`, default `false`
- `includeStateLocalIncomeTax`, default `true`

These settings classify accounts only for report adjustment. They do not rename, map, edit, exclude, or recategorize transactions.

### 7.12 Audit event

Every mutation creates an append-only event containing:

- `auditEventId`, UTC timestamp, operation type, entity type, and entity identifier
- actor label for the local user/system operation
- before and after representations or an explicit change set
- user reason when required
- correlation identifier for bulk, import, transfer, restore, or migration operations

Audit events cannot be edited or deleted through the application.

## 8. Transaction state model

### 8.1 State effects

| State | Account balance | P/L | Editable | Permitted next state |
| --- | --- | --- | --- | --- |
| Pending | No | No | Yes | Posted, Excluded, Matched Transfer |
| Posted | Yes | Yes | Yes, with audit and revalidation | Pending |
| Excluded | No | No | Exclusion note only | Pending |
| Matched Transfer | Yes | No | No; unmatch first | Pending for both sides |

### 8.2 Transition rules

- Posting requires valid dates, amount, active account, active chart references, and exactly balanced splits.
- Exclusion requires a non-empty reason and displays a reconciliation warning.
- Transfer confirmation requires two distinct Pending transactions from different eligible bank/card accounts with exact opposite amounts.
- Undo removes the former reporting or balance effect and returns the affected transaction to Pending while retaining history.
- Unmatching always affects both sides atomically.
- A direct transition from Posted to Excluded or Matched Transfer is not allowed; the user must first undo to Pending.
- Editing a Posted transaction revalidates it and atomically updates its report/balance contribution. Raw fields remain unchanged and the edit is audited.

## 9. Import specification

### 9.1 Workflow

1. User selects a source file and destination account.
2. Import service detects the adapter or returns `UNSUPPORTED_SOURCE`.
3. Adapter inspects the source without modifying it. A CSV preprocessor locates the first row containing recognized date and amount headers and removes only earlier rows from the parser input.
4. User selects or defines a mapping when required.
5. Adapter parses source rows; shared normalization produces transaction candidates.
6. Validation assigns every source row an accepted, rejected, or skipped disposition.
7. Preview displays mapped values, row errors/warnings, counts, and totals.
8. User explicitly commits the unchanged preview.
9. One SQLite transaction creates the batch, accepted Pending transactions, source-row provenance, and audit events.
10. Commit returns final counts and identifiers. A failure creates no partial batch or transactions.

### 9.2 Adapter contract

Every adapter must:

- Identify whether it can read the selected source.
- Inspect structure and return available sheets/columns/metadata.
- Parse without editing the source.
- Preserve source row location and original values.
- For CSV, preserve original file row numbers after removing any rows above the detected transaction header.
- Produce the shared parsed-row/candidate model.
- Keep categorization, posting, transfers, and reporting outside the adapter.
- Return row-level typed errors rather than silently discarding activity.
- Pass the shared importer contract tests plus source-specific fixture tests.

### 9.3 Common validation

Accepted transaction candidates require:

- A valid business date.
- A normalized signed integer amount.
- A non-empty description or source type sufficient to identify the activity.
- A valid, active destination account.
- Source batch and row provenance.

Ambiguous date formats, ambiguous sign mapping, missing amounts, invalid numerics, unsupported currency, and structurally malformed rows are rejected or block preview as appropriate; they are never silently coerced.

### 9.4 Preview stability

A preview is bound to the source hash, parser version, mapping version, destination account, and normalized result. Commit must reject a stale preview if any bound value changed and require a new preview.

### 9.5 Amazon-specific behavior

- The destination must be an Entity account representing Amazon.
- Preserve the original activity label, such as `Commission` or `FBAStorageFee`.
- Apply sign-sensitive deterministic rules where the same label can represent different activity.
- If the normalized amount is exactly zero minor units for any source type, mark the source row `REJECTED` with code `ZERO_AMOUNT` and a visible reason.
- Continue previewing and committing every other valid row in the same batch; every source row is either accepted or rejected with a visible reason.
- Amazon deposits imported into a bank account remain Pending for manual categorization or exclusion. No Amazon payout matching occurs in MVP.

## 10. Categorization and rule evaluation

### 10.1 Suggestion order

For each eligible Pending transaction, evaluate in this order:

1. Transfer candidate detection.
2. Enabled deterministic rules in explicit priority order.
3. Deterministic prior-confirmed-match lookup.
4. Unresolved manual review.

Only one winning category suggestion is presented. Collisions and losing rules remain available in the explanation.

### 10.2 Rule behavior

- Priority values are unique after save/reorder.
- All conditions and exclusions are evaluated against normalized and explicitly named fields.
- String operators are exact, contains, or starts-with using documented normalization.
- Amount comparisons use integer minor units.
- A rule may suggest exclusion but cannot automatically exclude or post.
- A rule may suggest a transfer account but cannot confirm a transfer.
- Testing or explaining a rule never changes a transaction.

### 10.3 Prior confirmed match

Prior-match suggestions are deterministic, local, and explainable. The match key must include the source account, money direction, and exact normalized merchant/payee or description key. The UI must identify the historical transaction used. A prior match never auto-posts.

## 11. Transaction review specification

### 11.1 Queue and filters

The ledger supports:

- Account selection.
- Pending, Posted, Excluded, and Matched Transfer views.
- Custom start/end dates.
- Amount range, source/import batch, category, payee, and match-status filters.
- Search across description, memo, payee, reference, and category.
- Stable sorting and paging. Clicking Date/account, Source transaction, Categorization, or Amount sorts that visible column ascending on first selection and toggles ascending/descending on subsequent clicks, with an accessible direction indicator.
- Configurable visible columns.
- Checkbox selection with selection count and clear-selection action.

Each row shows date, raw description, normalized payee, amount, account, selected/suggested GL account, suggestion source, state, and available actions.

### 11.1a Category picker

Selecting a category from a transaction row opens a searchable picker rather than a fixed native drop-down. The picker must:

- Begin with the current suggested or selected category when one exists.
- Filter active chart accounts by case-insensitive **contains** matching as the user types, including parent and child account names.
- Present only the matching subset in a pop-up list, with each result clearly showing its full chart path and account type.
- Support keyboard navigation, Enter to select, Escape to dismiss without changing the transaction, and pointer selection.
- Leave a Pending transaction uncategorized until the user explicitly selects a result; selection alone does not post it.

### 11.2 Editing

- Raw source fields remain visible and immutable.
- Editable values include date, payee/from-to, memo, reference, tags, business note, and GL classification/splits.
- Amount correction changes only the accounting amount, requires explicit confirmation, and creates a prominent audit event retaining the raw amount.
- A Posted edit must pass all posting validations and update its report effect in the same database transaction.

### 11.3 Bulk behavior

Bulk categorize, post, exclude, and undo operations are all-or-nothing. The service validates the full selection first. If any item fails, no selected item changes and the result identifies every failing item and reason.

### 11.4 Exclusion

Any Pending transaction may be excluded for any user-supplied reason. Suggested reason labels may include duplicate summary, personal, non-business, and source error, but the user may enter another reason. Exclusion displays a warning that calculated account balance may differ from a statement balance.

## 12. Transfer matching specification

### 12.1 Candidate eligibility

A candidate pair must:

- Consist of two distinct Pending transactions.
- Belong to different active Bank or Credit Card accounts.
- Have equal-and-opposite integer amounts.
- Fall within the configured inclusive date window.
- Not already belong to another confirmed match.

Payee, memo, and reference clues influence ranking but do not relax the exact amount requirement.

### 12.2 Confirmation and unmatch

- High-confidence candidates may be presented first but require user confirmation.
- Ambiguous candidates show alternatives and rationale.
- Confirmation creates one link and changes both states atomically.
- Matched amounts affect their source-account calculated balances and never create P/L contributions.
- Unmatch removes the link and returns both sides to Pending atomically.
- Entity/Amazon payout matching is not eligible in MVP.

## 13. Chart-of-accounts specification

### 13.0 Financial-account management

Financial accounts are the real Bank, Credit Card, and Entity ledgers shown in Account overview; they are distinct from P/L chart categories. The Transactions workspace provides an **Add account** action and a separate **Edit** action on every account card. Both open the same focused side editor. Edit is populated from the current account and shows calculated balance as read-only context.

The editor exposes name, account type, compatible detail type, institution/entity, optional four-digit identifier, optional active same-type parent, hierarchy path, description, opening balance/date, lock, and active/archive state. A type change resets detail type to a valid value and removes an incompatible parent. Save validates the complete proposed account set before committing. Existing account IDs never change, so transactions, transfers, rules, reports, and audit history remain connected.

The Account overview card displays type/detail type, account name, and calculated balance with strong selected-account highlighting. Archived accounts remain visible and editable but cannot be selected for imports. Locked accounts must be unlocked before archive. All operations stay behind the Angular Application Service Interface and persist in local SQLite.

### 13.1 Import

The chart is imported from CSV or XLS/XLSX and validated in full before apply. Validation includes:

- Required fields.
- Unique identifiers/names under the chosen workbook convention.
- Supported QuickBooks-style account type and compatible reporting classification.
- Detail type, description, lock state, active/archive state, and integer display order.
- Existing parent and acyclic hierarchy.
- Parent and child account-type compatibility.
- Valid display order.
- Protection of references from transactions, rules, and tax settings.

Any error prevents the entire chart replacement and is reported with sheet, row, field, code, and human-readable reason.

### 13.2 In-app list and editor

The Chart of Accounts is an exclusive top-level workspace alongside Transactions, Rules, Profit & Loss, and Data & Backups. Its list provides search, account-type and active-status filters, hierarchy indentation, stable sorting, and New/Edit/Archive-Restore actions. The editor supports account name, account type, detail type, description, display order, lock state, and an optional compatible parent account. It previews the resulting parent:child path before save.

Create and edit commands validate duplicate names, account/detail type support, parent existence/type, self-parenting, hierarchy cycles, and integer display order. Editing never changes the stable account ID. Locked accounts remain editable only after explicitly clearing the lock and cannot be archived while locked. Every mutation is transactional and audited.

### 13.3 Export and round-trip maintenance

Export writes stable ID, name, parent ID/path, account type, reporting classification, detail type, description, display order, archived state, and lock state. A valid exported workbook can be imported without semantic changes. Invalid files leave the active chart untouched and surface the failing row or account in a human-readable error.

## 14. Reporting specification

### 14.1 Report inclusion

Only active splits belonging to Posted transactions contribute to the P/L. Pending, Excluded, and Matched Transfer transactions never contribute. Report-only category and tax filters do not change transaction state.

### 14.2 Sign and formulas

Posting splits retain source-account signs and reconcile to the source transaction. Reports transform them using the chart account type:

- Income and Other Income contribution = signed split amount.
- COGS, Expense, and Other Expense display contribution = negative signed split amount.

The report calculates:

- `Gross Profit = Income - COGS`
- `Net Profit = Gross Profit - Expenses + Other Income - Other Expense`

Reversals/refunds naturally produce negative values within their report section. Calculations use integer minor units; formatting occurs only at the presentation/export boundary.

### 14.3 P/L query

Required inputs:

- Inclusive start and end business dates.
- Grouping: month or year.
- Optional included/excluded GL account identifiers.

Required output:

- Chart hierarchy, recursively nested account groups, and section totals.
- A subtotal after each account group, labeled `Total for <account>`, with subtotal and synthetic total amounts rendered in bold.
- One value per group plus total.
- For a single-year Year-grouped report, collapse the duplicate year/total presentation to one `Total` column in the UI and Summary exports.
- Render report labels at a readable statement size and apply the same font weight to a row's label and amount.
- Query criteria and generated timestamp.
- Stable cell/drill-down identifiers.
- Reconciliation status.

Clicking a report value returns exactly the contributing posting splits and their transaction, source account, date, payee, memo, GL account, amount, and import batch.

### 14.4 Schedule C-ready report

The Schedule C-ready report starts from the same P/L result and then applies the selected tax year's settings:

- Federal income-tax accounts are excluded by default.
- State/local income-tax accounts are included by default.
- The user may include or exclude either group, yielding four valid combinations.
- The report prominently displays the tax year, active settings, affected account names, and removed amount.
- The exported report repeats the same disclosures.
- Drill-down returns every posting removed by the adjustment.
- The adjustment does not modify the chart, splits, transaction state, unadjusted P/L, or any other tax year.

### 14.5 Other reports

- **P/L detail:** every included posting split and source linkage.
- **Exception report:** Pending, unresolved category, unmatched candidate, parsing warning, and edited-after-posting items.
- **Reconciliation:** opening balance + Posted signed activity + Matched Transfer signed activity = calculated balance; show optional statement balance and difference.
- **Accountant package:** annual unadjusted P/L, Schedule C-ready P/L, tax settings/disclosure, GL detail, transaction detail, exclusion log, exception report, and business notes.

### 14.6 Export formats

- Summary and detailed reports: CSV and XLSX.
- Presentation-ready reports: print-ready PDF.
- Accountant package: defined bundle containing the selected exports and a manifest.
- PDF is an output format only; PDF statement import remains outside MVP.

## 15. Backup, restore, and portable export

### 15.1 Backup contents

A normal operational backup is a plain SQLite file named `tallystick-YYYY-MM-DD-HHMMSS.sqlite`. It contains every record currently stored in the company database, including accounts, transactions, splits, rules, mappings represented in database state, tax settings, and audit history. It is intentionally readable by standard SQLite tools.

The application may also retain a distinct portable archive/export contract. An attachment-inclusive archive includes:

- SQLite company database.
- Managed attachments and hashes.
- Import mappings and source provenance stored outside the database, if any.
- Bundle metadata, schema version, application version, creation timestamp, and integrity manifest.

### 15.2 Verification

A plain SQLite backup is marked successful only after:

- The current host-owned database image passes SQLite integrity and foreign-key checks.
- The bytes are written to a temporary file in the configured backup folder and reopened independently.
- The copied file passes SQLite integrity and foreign-key checks and contains the supported schema and company record.
- The temporary file is atomically renamed to its timestamped final name.

An attachment-inclusive archive is marked verified only after:

- SQLite integrity check succeeds.
- Manifest and attachment hashes match.
- Required files and supported schema metadata are present.
- A validation open can read company metadata and core record counts.

Attempted and verified backup timestamps are stored separately.

### 15.3 Restore

The user chooses a `.sqlite` backup. Restore opens and validates that file without modifying it. Before activation the application creates a verified timestamped safety backup of the current books. It then writes the selected bytes to a temporary file beside the configured live database, validates the temporary copy, atomically replaces the live database, and restarts. The active path does not change during restore. Any failure leaves the prior live database, selected backup, and configured paths unchanged.

### 15.4 Database locations and relocation

Electron owns a small local settings file containing the configured live-database path, backup folder, and latest verified backup metadata. The Angular UI receives those values only through typed application services.

The default live path remains Electron's per-user application-data directory. Changing it uses a Save dialog, requires a configured backup folder, creates a verified safety backup, copies the current database atomically to the chosen path, persists that path only after validation, and restarts. The previous live database is retained as an additional recovery copy. Directly operating on a file inside the backup folder is not supported.

### 15.5 Portable export

Export all transactions, accounts, chart entries, splits, transfers, rules, mappings, batches, source-row dispositions, tax settings, and audit history through documented CSV/JSON schemas. Export is for portability and inspection; it is not a complete backup unless it also satisfies the backup manifest and restore contract.

## 16. Error model

Application operations return typed outcomes. At minimum, failures must distinguish:

| Category | Examples |
| --- | --- |
| Validation | Required field, invalid date, unsupported type, unbalanced split, empty exclusion reason |
| State conflict | Invalid transition, stale transaction version, already matched, archived destination |
| Import | Unsupported source, malformed structure, ambiguous mapping, stale preview, row rejection |
| Rule | Invalid condition tree, duplicate priority, missing chart reference |
| Persistence | Constraint failure, transaction rollback, migration failure, integrity failure |
| Filesystem | Permission denied, missing file, changed source, insufficient space |
| Backup/restore | Manifest mismatch, corrupt database, unsupported schema, missing attachment |
| Report | Invalid date range, missing tax configuration, reconciliation failure |

Each failure includes a stable code, human-readable message, affected entity/row when applicable, and retry or correction guidance. Raw native stack traces and sensitive filesystem/database details are not shown in the user interface.

## 17. User-interface requirements

The initial Angular UI must provide these feature areas while remaining replaceable:

1. **Company setup:** company details, accounting basis, active tax year, and account creation.
2. **Account overview:** account cards, balances, unresolved counts, active/archived state.
3. **Import wizard:** file/account selection, inspection, mapping, preview, errors, commit, and summary.
4. **Transaction ledger:** state tabs, filters, search, columns, selection, detail, editing, bulk actions, and audit history.
5. **Transfer review:** ranked candidates, alternatives, rationale, confirmation, and unmatch.
6. **Chart exchange:** workbook import validation and export.
7. **Rules:** list, priority, enable/disable, editor, test results, collisions, and create-from-transaction.
8. **Reports:** P/L, drill-down, Schedule C-ready settings/disclosure, exceptions, reconciliation, and exports.
9. **Data safety:** backup, verification status, restore validation, portable export, and reminders.

The primary work area presents **Transactions**, **Rules**, and **Profit & Loss** as three prominent button tabs, not a select/dropdown. Only the selected work area is rendered at a time; Transactions is the default. Rules provides the priority-ordered list, complete editor/actions, test-before-save, exchange controls, and transaction-originated Edit/Create Rule flows from RUL-01. Profit & Loss retains its own P/L Summary and P/L Detail controls.

Components must render view models and forward intent. They must not parse files, construct SQL, calculate accounting results, or coordinate multi-step persistence.

## 18. Privacy, security, and operability

- Source files, database, attachments, exports, and backups remain local by default.
- The application requests and stores no bank credentials.
- Core workflows require no network access and tests run offline.
- The Angular renderer is sandboxed.
- Bridge inputs are validated in Angular and again at the privileged boundary.
- Arbitrary path access and process execution are not exposed to renderer code.
- Database paths and source contents are not stored in browser storage.
- Parameterized SQL is required.
- Foreign-key enforcement is enabled and verified on every database connection.
- Integrity checks run at startup and before backup; failures are visible and prevent unsafe operations.
- Database/backup encryption must either be implemented or the product must clearly document and display its reliance on macOS FileVault and protected user storage.

## 19. Automated verification

### 19.1 Required layers

| Layer | Required proof |
| --- | --- |
| T1 — Angular business-service unit | Money, state transitions, posting, splits, rules, transfers, reports, tax settings, reconciliation |
| T2 — Angular application-service unit | Command/query orchestration, validation, typed outcomes, audit, and gateway calls |
| T3 — Application-interface contract | Any assembled implementation satisfies the stable surface expected by either Angular UI |
| T4 — Importer fixture | Sanitized real CSV, Excel, QBO/OFX, Amazon, chart, and rule files normalize to reviewed expected outputs |
| T5 — SQLite integration | Real temporary databases prove migrations, constraints, transactions, reports, audit, backup, and restore |
| T6 — Angular UI/facade | Rendering, user intent, loading, validation, failure state, filters, and selection using fake application services |
| T7 — End-to-end | Packaged source-file-to-report and backup/restore workflows |

### 19.2 Function-level standard

- Every public Application Service Interface method has successful, expected-failure, and relevant-boundary tests.
- Every meaningful accounting or parsing decision is tested.
- Private helpers are covered through observable behavior unless they contain an independent financial or parsing decision.
- Trivial accessors and framework-generated wiring do not require ceremonial tests.
- Money, posting, undo, splits, P/L aggregation, tax adjustments, rules, and import normalization require 100% branch coverage.
- Wider code coverage uses a high threshold selected in Phase 0, but assertions and fixtures remain the acceptance evidence.

### 19.3 Fixture standard

Each source fixture asserts:

- Accepted, rejected, skipped, and warning counts.
- Date, signed amount, description, payee, reference, destination account, and source type.
- Raw values and batch/row provenance.
- Validation codes and messages.
- Exact expected transaction and report totals.
- Cross-format zero-row rejection and complete disposition of every source row without batch failure.

Fixtures are sanitized, readable, immutable during tests, independent of the network, and paired with separately reviewed expected results. Every production parsing defect adds a regression fixture.

### 19.4 Release gates

- All relevant automated suites pass offline.
- Reports reconcile exactly to drill-down detail.
- Every adapter passes the common contract suite.
- Migrations pass from a representative previous schema.
- Backup restores successfully into a new location and matches counts, totals, schema, attachments, and audit history.
- A replacement Angular UI/test harness completes major workflows using only the Application Service Interface and shared DTOs.
- No UI imports repositories, parsers, SQLite/native types, desktop-host modules, or previous UI components.

## 20. End-to-end acceptance scenarios

### A1 — New company setup

Create a new local company file, create representative Bank, Credit Card, and Marketplace Entity accounts, import the fictional sample chart, and import fictional rules. Invalid chart/rule data must not partially apply.

### A2 — Bank CSV import

Select a Bank account, map and preview representative CSV files both with and without statement-summary rows above the transaction table, inspect row errors and totals, save the mapping, commit accepted rows to Pending, and prove original-file-row-to-transaction provenance.

### A3 — Excel and QBO/OFX imports

Repeat the preview/commit flow with representative XLS/XLSX and QBO/OFX files. Each adapter must produce the same normalized candidate contract and exact disposition totals.

### A4 — Amazon import

Import the third-party Amazon summary into the Entity account. Exact-zero normalized transactions are rejected individually without aborting the batch, every source row is accepted or rejected with a reason, original labels remain visible, and sign-sensitive rules produce explainable suggestions.

### A5 — Review and posting

Filter Pending transactions by account/date, use the category picker to find a category by a partial contains search and select it, manually categorize another, split a transaction, bulk post a valid set, exclude another with a reason, and undo both a Posted and Excluded transaction. P/L and balance effects must change exactly as specified.

### A6 — Transfer matching

Find and confirm a bank/credit-card equal-and-opposite pair. Both account balances reflect the activity and net profit is unchanged. Unmatch returns both to Pending. An Amazon deposit is never auto-matched.

### A7 — P/L and drill-down

Generate monthly and annual P/L reports. Every cell drills into the exact contributing splits and all section/net totals reconcile to `$0.00` difference.

### A8 — Schedule C-ready report

For a selected tax year, verify the default federal exclusion/state inclusion, exercise all four combinations, disclose the affected accounts and removed total, drill into removed postings, and prove the unadjusted P/L and stored transactions are unchanged.

### A9 — Accountant handoff

Export summary/detail P/L, Schedule C-ready report, settings disclosure, exclusions, exceptions, reconciliation, and notes. CSV/XLSX/PDF values must agree with on-screen results.

### A10 — Recovery and replacement

Create and verify a backup, restore it into a validation location, compare records/totals/attachments/audit history, and activate it safely. Then complete the major workflows through an alternate Angular UI or harness using only the stable Application Service Interface.

### A11 — Add and edit a financial account

Add a Bank/Savings account with institution, last four, description, opening balance/date, and optional parent. Verify its card and calculated balance, edit it to another valid Bank detail type without changing its ID, lock it, prove archive is blocked, unlock/archive it, and prove import is blocked while historical activity remains available. Reopen SQLite and verify every editable attribute and audit event.

## 21. Requirements traceability

| PRD story | Specification sections | Plan phase |
| --- | --- | --- |
| IMP-01 | 6.2, 7.5–7.6, 9, 16, 20 A2–A3 | Phase 3 |
| AMZ-01 | 9.5, 10, 20 A4 | Phase 3 |
| REV-01 | 6.3, 8, 11 | Phase 5 |
| CAT-01 | 6.4, 7.10, 10 | Phase 4 |
| REV-02 | 7.7–7.8, 8, 11, 20 A5 | Phases 2 and 5 |
| XFR-01 | 7.9, 8, 12, 20 A6 | Phase 6 |
| ACC-01 | 6.1, 7.3, 13.0, 20 A11 | Phase 4 |
| COA-01 | 6.1, 7.4, 13, 20 A1 | Phase 4 |
| RUL-01 | 6.4, 7.10, 10, 20 A1/A4 | Phase 4 |
| RPT-01 | 6.5, 14.1–14.3, 14.5–14.6, 20 A7/A9 | Phase 7 |
| TAX-01 | 7.11, 14.4, 20 A8 | Phase 7 |
| OPS-01 | 6.6, 15, 20 A10 | Phase 8 |

## 22. Phase 0 decisions still open

This specification constrains but does not prematurely select:

| Decision | Required result |
| --- | --- |
| Accounting basis | Confirm cash basis for MVP or record accountant-required adjustments before report implementation. |
| Desktop shell and bridge | Select a TypeScript-oriented local shell and narrow typed bridge; Electron is evaluated first. |
| SQLite driver/migrations | Support transactions, parameterized queries, packaging, backup, ordered migrations, and isolated real-database tests. |
| Angular presentation state | Remain within feature facades and leave the Application Service Interface unchanged. |
| Test runners/coverage | Support all seven layers, offline execution, standard commands, and enforced thresholds. |
| Backup bundle format | Define versioned packaging, manifest, integrity checks, validation restore, and activation behavior. |

## 23. Definition of product-spec completion

The MVP described by this specification is complete only when all A1–A10 acceptance scenarios pass, all applicable automated test layers pass, every source row has an explicit disposition, all P/L totals reconcile exactly to drill-down detail, Schedule C adjustments remain report-only and disclosed, a verified restore succeeds, and the replacement-UI proof confirms that the stable Angular Application Service Interface is the only functional entry point required by a new Angular UI.
