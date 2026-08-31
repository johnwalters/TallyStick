# Local books for a small online business

*Product Requirements Document · Version 1.1 · Current milestone implemented through Statement of Cash Flows*

Companion: [Technical architecture →](Quicken%20Replacement%20Technical%20Architecture.md)

A focused, local-first accounting application for a small online business: ingest transactions, review and categorize them, and produce accountant-ready financial reports with supporting transaction detail.

- **Primary user:** **Business owner / bookkeeper**
- **Primary output:** **Cash-basis P/L, reconciled as-of Balance Sheet, indirect-method Statement of Cash Flows, and transaction detail**
- **Deployment:** **Single-user local desktop app**

**Product thesis:** the application is not a general accounting suite and does not replace the existing Amazon analytics service. It is a dependable transaction ledger and classification system that makes year-end tax preparation faster, traceable, and repeatable.

- **5** — Current account-like ledgers
- **183** — Chart-of-account entries
- **105** — Existing categorization rules
- **3** — Required import families

*01 · Direction*

## Goals and boundaries

### Goals

- Replace the used subset of Quicken with a local application.
- Import bank, credit-card, and Amazon-summary data without live bank connections.
- Make review efficient through reusable deterministic rules and transfer matching.
- Maintain a clear Pending, Posted, Excluded, and Transfer-matched lifecycle.
- Produce a date-filtered P/L, a reconciled as-of Balance Sheet, and an indirect-method Statement of Cash Flows, all with exportable detail.
- Preserve an audit trail so any reported number can be traced to its source transaction.

### Not in the initial product

- Direct bank or credit-card connections.
- Amazon sales analytics, inventory forecasting, SKU profitability, or order management.
- Invoices, bills, payroll, sales-tax filing, or accounts-payable workflows.
- A general-journal workspace, closing-entry workflow, direct-method Cash Flow presentation, or other financial statements beyond the implemented P/L, Balance Sheet, and Statement of Cash Flows.
- Multi-company, multi-user, or cloud collaboration.
- Automatic tax filing or Schedule C mapping/categorization.

*02 · Operating model*

## Core workflow

**1. Import**

Select an account and load CSV, Excel, or QBO/OFX data.

**2. Validate**

Map columns, normalize signs and dates, and show errors.

**3. Suggest**

Apply transfer logic and deterministic rules.

**4. Review**

Edit, split, categorize, exclude, or bulk-approve pending transactions.

**5. Report**

Posted P/L activity rolls into monthly and annual views.

**Transaction states:** Pending · Posted · Excluded · Matched transfer

**State rule:** only Posted income and expense lines affect the P/L. A matched transfer affects account balances but not the P/L. Excluded and Pending transactions affect neither. Undo returns a Posted, Excluded, or Matched transaction to Pending and reverses its reporting effect while retaining history.

*03 · User needs*

## Use cases and user stories

### IMP-01 — Import a statement into a selected account [MVP]

As the owner, I want to import a downloaded bank or card statement into the correct account so that new activity enters a review queue without sharing credentials with another service.

- Accept CSV, XLS/XLSX, and QBO/OFX source files.
- Require the destination account: Bank, Credit Card, or Entity such as Amazon.
- Support header detection, date format, one signed amount column or separate debit/credit columns, description, payee, reference/check number, and memo.
- For CSV files that contain statement summaries or other preamble rows above the transaction table, detect the first row containing recognized date and amount headers, discard only the preceding rows from the parsed transaction input, and preserve original file row numbers for provenance and error reporting. Reject the file with a visible missing-header error when no valid transaction header row exists.
- Save reusable import mappings by institution/file shape.
- Show a preview, row-level validation errors, accepted/skipped counts, and final import summary before committing.

### AMZ-01 — Import Amazon summary transactions [MVP]

As the owner, I want to upload the third-party Amazon accounting export into an Amazon entity account so that Amazon sales, refunds, fees, taxes, storage, shipping, promotions, and other adjustments feed the books.

- Map the summary export's date, description/type, and signed amount to pending transactions.
- Reject any row from any import source whose normalized amount is exactly zero, show the row-level reason, and continue processing and committing the remaining valid batch rows.
- Apply Amazon-specific rules that distinguish the same description by positive versus negative sign when necessary.
- Preserve the original label (for example Commission or FBAStorageFee) and source batch for audit.
- Reject or quarantine malformed rows rather than silently dropping non-zero activity.

### REV-01 — Review pending transactions by account and date [MVP]

As the owner, I want a fast account-centered review queue so that I can finish bookkeeping in batches.

- Switch among account cards and Pending, Posted, Excluded, and Matched views.
- Filter by custom date range, transaction state, amount, source/import batch, category, payee, and match status.
- Search description, memo, payee, reference number, and category.
- Show date, raw description, normalized payee, amount, account, suggested GL account, suggestion source, and available actions.
- Sort the visible register by clicking a data-column heading; a new column starts ascending and repeated clicks toggle ascending and descending with a visible direction indicator.
- Support checkbox selection and bulk post, categorize, exclude, or return to pending.

### CAT-01 — Categorize with deterministic rules [MVP]

As the owner, I want the app to suggest the correct GL account using my existing behavior so that most transactions require only confirmation.

- Evaluate enabled deterministic rules first, in explicit priority order.
- Rule conditions may include account, money-in/out, exact/contains/starts-with description, payee, amount/range, and source type; conditions support AND/OR and exclusions.
- Rule outputs may set GL account, payee, memo/description, transfer account, tags, or exclusion suggestion.
- When no rule applies, leave the category unresolved for manual review.
- Every non-manual suggestion shows its origin (Rule or Prior match) and rationale.

### REV-02 — Edit, split, post, exclude, and undo [MVP]

As the owner, I want control over each transaction's accounting treatment so that the ledger reflects business reality.

- Edit date, payee/from-to, memo, reference, tags, GL category, and business note while preserving raw imported values.
- Split one transaction across multiple GL accounts; split amounts must reconcile exactly to the transaction total.
- Post only when every required field is valid and the line or split is balanced.
- Exclude with a reason such as duplicate summary, personal, non-business, or source error.
- Undo Posted, Excluded, or Matched items back to Pending, removing their reporting/balance effect as appropriate.
- Record who/when/what changed in an append-only audit history.

### XFR-01 — Match payments and transfers automatically [MVP]

As the owner, I want payments between my accounts to match automatically so that credit-card payments and bank transfers do not appear as business income or expense twice.

- Search eligible transactions in other accounts for equal-and-opposite amounts within a configurable date window, with payee/reference clues.
- Auto-suggest high-confidence pairs and present alternatives when multiple candidates exist.
- Confirming a pair creates linked transfer entries; neither side affects the P/L.
- Amazon deposits appearing in BofA remain pending until manually categorized or excluded; Amazon payout/clearing matching is out of scope.
- Allow the user to exclude any pending transaction for any reason, recording the supplied reason and warning that exclusions may cause account-balance reconciliation to differ.
- Unmatching returns both transactions to Pending and preserves the audit trail.

### ACC-01 — Add and edit financial accounts [MVP]

As the owner, I want to add and edit the bank, credit-card, and entity accounts that receive imported transactions so that the books reflect my real institutions without changing the chart of accounts.

- Show each financial account's name, account type, detail type, institution/entity, optional last four digits, current calculated balance, and active/archive state in the Account overview.
- Provide **Add account** and **Edit** actions that open a populated focused editor rather than requiring a file import or database edit.
- Edit account name, type, type-specific detail type, institution/entity, optional last-four identifier, optional same-type parent/subaccount, description, opening balance/date, lock state, and active/archive state.
- Bank detail types include Cash on hand, Checking, Money Market, Rents Held in Trust, Savings, and Trust account. Credit-card accounts use Credit Card. Entity accounts use Marketplace, Clearing account, or Other transactions.
- Preserve the stable financial-account ID during edits so imported transactions, transfer matches, rules, reports, and audit history remain connected.
- Treat calculated balance as read-only derived information; changing the opening balance/date changes the account basis but does not rewrite imported transactions.
- Require non-empty unique names, a detail type compatible with the selected account type, a four-digit last-four value when supplied, a valid opening-balance date, and an active same-type parent without cycles.
- Locked accounts cannot be archived. Archived accounts retain history and reports but cannot receive new imports. Create, edit, archive, and restore actions are transactional and audited.

### COA-01 — Manage the chart of accounts [MVP]

As the owner, I want a complete Chart of Accounts workspace so that I can inspect and maintain the account hierarchy without leaving the application, while retaining safe Excel exchange.

- Provide a dedicated Chart of Accounts workspace with a searchable, sortable list showing account name/path, account type, detail type, parent/subaccount relationship, active status, and actions.
- Allow the owner to create and edit an account with name, QuickBooks-style account type, detail type, optional parent account, description, display order, active/archive status, and lock state.
- When an account is a subaccount, require an existing compatible parent, prevent self-parenting and hierarchy cycles, and show the resulting hierarchy before save.
- Preserve stable chart-account identifiers so edits do not break posted transactions, Pending classifications, rules, tax settings, or reports.
- Import the complete chart from CSV or XLS/XLSX and export it to XLSX with stable IDs and every editable field needed for round-trip maintenance.
- Validate an imported chart before applying it, including required fields, unique identifiers/names, supported account types, required detail types, valid parents, compatible parent types, acyclic hierarchy, display order, and references from existing transactions, rules, and tax settings.
- Show actionable import errors and apply the replacement atomically; an invalid import must leave the active chart unchanged.
- Record account creation, edit, archive/restore, and chart import in the append-only audit history.

### RUL-01 — Manage, exchange, and test transaction rules [MVP]

As the owner, I want a complete Rules workspace and direct access to the rule behind a Pending transaction so that I can understand and maintain automatic categorization without leaving the application.

- Provide a dedicated Rules workspace, mutually exclusive with Transactions and Profit & Loss, containing a searchable list of every rule in priority order.
- Show rule name, priority, account scope, match conditions, category/output settings, enabled status, and actions in a readable list.
- Allow the owner to create a new rule and to Edit, Copy, Disable/Enable, or Delete each existing rule. Copy creates a disabled independent rule. Delete requires explicit confirmation and leaves an audit record.
- The rule editor must populate name, enabled state, priority, account/direction scope, ALL/ANY matching, one or more conditions, destination category, payee, memo, tags, and exclusion suggestion. The owner can add/remove conditions and test the unsaved rule against transactions before saving.
- On every Pending transaction, show **Edit rule** when its current deterministic suggestion came from a rule and **Create rule** when no rule was applied. Edit opens that applied rule with all data populated. Create opens an unsaved rule populated from the transaction, selected account, direction, description/payee, and currently selected category when available.
- Saving a rule re-evaluates visible Pending transactions so changed or newly enabled rules are reflected immediately. Rules never recategorize Posted transactions.
- Export every current rule on demand to the documented Excel/CSV rule-exchange format, including stable rule identifier, name, enabled status, priority, conditions, actions, payee/memo outputs, and referenced chart category.
- Allow the exported workbook/CSV to be edited externally and imported back at any time as the complete replacement rule set.
- Preview and validate the entire proposed replacement before any change: required fields, unique stable identifiers and priorities, supported conditions/operators/actions, valid ranges and values, valid category references, and well-formed rule logic.
- Show row-level errors and actionable reasons; warnings such as collisions must be reviewable. An invalid file must not change any existing rule.
- Apply only an explicitly confirmed, fully valid replacement atomically, retain an audit record of the exchange, and report the imported/updated/disabled rule counts.
- Import rule definitions through the public exchange format.

### RPT-01 — Produce and drill into the P/L [MVP]

As the owner, I want a date-filtered P/L grouped by month or year so that I can monitor the books and prepare annual tax data.

- Filter by start/end date and default to the selected calendar year.
- Group columns by month or year and include a total column.
- When Year grouping produces only one year, display one `Total` amount column rather than repeating the same value under both the year and `Total`.
- Display the chart hierarchy for Income, COGS, Gross Profit, Expenses, Other Income/Expense, and Net Profit. Indent child accounts, show a subtotal after each chart-account group, and use bold type for all `Total for ...`, Gross Profit, and Net Profit amounts.
- Use readable account-description text and keep label/amount emphasis paired: an amount is bold exactly when its row label is bold.
- Click any amount to see its contributing posted transactions and splits.
- Exclude transfers, Pending transactions, and Excluded transactions by definition.
- Allow any GL account/category to be included or excluded from a report without changing the transaction's posted state.
- Export detailed and summary reports to CSV/XLSX and a print-ready PDF.

### TAX-01 — Control which tax expenses appear on the Schedule C-ready report [MVP]

As the owner, I want to remove federal income-tax expense—and, when appropriate, state or other tax expense—from the Schedule C-ready report so that the accountant receives the correct expense totals without changing the underlying books.

- Keep the existing chart-of-accounts categories as they are; no Schedule C category mapping or recategorization system is required.
- Provide report controls to include or exclude federal income-tax accounts, state/local income-tax accounts, or both.
- Default the Schedule C-ready report to exclude federal income-tax expense and include state/local income-tax expense, based on the owner's current understanding.
- Mark that default as an annual tax-treatment setting that the owner should review and confirm with the accountant each tax year.
- Allow the owner to change the setting for a tax year if the correct treatment is federal only, state only, both, or neither.
- Apply the choice only to the Schedule C-ready report and accountant export; do not delete, recategorize, exclude, or otherwise alter the posted transactions or the unadjusted P/L.
- Show the active tax settings and the total amount removed prominently on-screen and in every exported Schedule C-ready report.
- Allow drill-down from the removed-tax total to the affected posted transactions so the adjustment can be reviewed.

### OPS-01 — Back up, restore, and export all data [MVP]

As the owner, I want reliable local backups and portable exports so that years of financial history are not trapped in the app.

- Provide a persistent backup-folder setting and display the configured live SQLite database path.
- Create a one-click, timestamped `tallystick-YYYY-MM-DD-HHMMSS.sqlite` backup in the configured folder without requiring the application to quit.
- Verify SQLite integrity and foreign-key consistency before reporting a backup as successful.
- Allow the live database location to be changed. Before relocation, create and verify an automatic safety backup, copy the current database atomically to the chosen location, persist the new path, and restart the application.
- Allow an existing `.sqlite` backup to be selected for restore. Validate it in isolation before changing active data, create and verify an automatic safety backup of the current database, copy the selected backup into the configured live location without modifying the selected backup, and restart the application.
- A failed backup, validation, relocation, or restore must leave the current database and configured paths unchanged.
- Keep the plain SQLite backup distinct from portable CSV/JSON export and from any future attachment-inclusive archive format.
- Export all transactions, accounts, rules, mappings, and change history in documented CSV/JSON formats.
- Display the latest successful backup path and time. Scheduled backups and reminders may follow after the manual and pre-change safety workflows are proven.

*04 · Product behavior*

## Functional requirements

| Area | Required behavior | MVP test |
| --- | --- | --- |
| Accounts | Add and edit Bank, Credit Card, and Entity ledgers with type-specific detail type, institution/entity, optional last-four and same-type parent, description, opening balance/date, lock and active/archive state, and calculated balance. | The supplied accounts can be represented, a new account can be added, and an existing account can be edited without changing its stable ID or transaction history. |
| Imports | Preview-first CSV, Excel, and QBO/OFX imports; CSV summary/preamble removal before the detected transaction header; reusable mappings; row errors; sign normalization; batch provenance; zero-amount rows rejected individually without aborting the batch. | A valid source file, including a BofA-style CSV with summary rows above its table, imports to Pending with every rejected transaction row and its original file row visible before completion. |
| Ledger | Per-account state tabs, date filtering, search, multi-select, bulk actions, configurable visible columns, and transaction detail. | A user can take a fresh import from Pending to fully Posted/Excluded/Matched without leaving the ledger. |
| Categorization | Priority: transfer detection → deterministic rule → prior confirmed match → unresolved. | The app displays both the category and how it was chosen for every non-manual suggestion. |
| Posting | Posted activity changes reports; edits and undo are audited; split lines must balance; raw source is immutable. | Undoing a posted transaction removes exactly its amount from the P/L and returns it to Pending. |
| Transfers | Link equal-and-opposite transactions across accounts and suppress them from income/expense reporting. | A credit-card payment or bank transfer does not alter net profit after matching; any pending transaction can instead be excluded with a reason. |
| Reporting | Date range, month/year grouping, hierarchical totals, drill-down, export, reconciliation warnings, and a Schedule C-ready view with tax-account inclusion controls. | Every P/L total reconciles exactly to posted detail; the Schedule C-ready view separately identifies its active federal/state tax settings and removed amount. |
| Data safety | Persistent live-database and backup-folder locations; manual verified SQLite backup; automatic safety backup before relocation/restore; isolated restore validation; atomic activation; restart into the selected books. | A verified backup can be created while the app is open, restored without modifying the backup file, and reopened with matching company data; every injected failure preserves the prior live database. |

*05 · Accounting model*

## Data and accounting rules

### Core records

- **Business:** name, tax year, default basis, fiscal year.
- **Financial account:** stable ID, type, detail type, name, institution/entity, optional last four/parent/description, opening balance/date, calculated balance, lock state, and active/archive status.
- **Import batch:** source file hash, parser/mapping, destination, timestamps, counts.
- **Transaction:** raw and normalized fields, signed amount, state, and source/import batch.
- **Posting/split:** one or more balanced GL allocations.
- **Transfer match:** linked pair, score, confirmation state.
- **Rule and suggestion:** conditions, outputs, priority, and rationale.
- **Audit event:** immutable before/after record, timestamp, reason.

### Required transaction attributes

- Posting date; optional transaction/settlement date.
- Source account; transaction type; signed amount and currency.
- Raw description; normalized description; payee/from-to.
- Memo, reference/check/order identifier, optional tags and attachment.
- GL account or balanced split lines.
- State, exclusion reason, transfer link, and import batch.
- Categorization source, rule ID, rationale, and reviewer confirmation.
- Created, modified, posted, excluded, and undone timestamps.

**Canonical sign convention**

Store signed amounts from the perspective of the selected account: money in is positive and money out is negative. Reports derive debit/credit behavior from the GL account type. Import preview must make sign reversal explicit and testable.

**Amazon deposits in BofA**

Detailed Amazon income and fees belong to the Amazon entity ledger. BofA deposits from Amazon are not automatically matched against Amazon activity. They remain pending until the user manually categorizes, matches, or excludes them; exclusions are permitted for any reason and can cause reconciliation differences.

**Posted transaction behavior**

Posted transactions are included in reports. They may be corrected through an audited edit or returned to Pending. Original imported values remain immutable, making the current value and the source value independently visible.

*06 · Outputs*

## Reports and year-end handoff

| Output | Purpose | Minimum contents |
| --- | --- | --- |
| P/L summary | Monthly operations and annual result | Income, COGS, Gross Profit, Expenses, Other Income/Expense, Net Profit; month/year columns; totals. |
| P/L detail | Audit and accountant review | Every included transaction/split with date, account, payee, memo, GL, amount, and source batch. |
| Balance Sheet | Financial-position review | Assets, Liabilities, Equity, Current Earnings, Retained Earnings, Opening Balance Equity, exact contribution detail, and accounting-equation Difference as of a selected date. |
| Schedule C-ready P/L | Tax-preparation review | The existing P/L categories with user-controlled federal and state/local tax-account exclusions, the removed-tax total, active annual settings, and drill-down. |
| Accountant export | Tax-preparation handoff | Annual unadjusted P/L, Schedule C-ready P/L, active tax settings, GL detail, transaction detail, exclusion log, and notes. |
| Exception report | Close the books cleanly | Pending, uncategorized, unmatched transfers, parse warnings, and edited-after-posting items. |
| Reconciliation report | Confidence in account completeness | Opening balance + posted net activity = calculated balance, with optional statement-ending balance and difference. |

*07 · Trustworthiness*

## Quality, privacy, and operability

### Local-first and private

- All source files, books, attachments, and backups remain local by default.
- No bank credentials are requested or stored.
- Rules, transfer matching, and review remain fully local; no AI service is part of the app.
- Support encrypted database/backups or clearly document reliance on macOS FileVault.

### Accuracy and resilience

- Use decimal currency arithmetic; never binary floating point for posted amounts.
- All imports are transactional: a failed batch cannot leave partial hidden results.
- Validate database integrity at startup and before backup.
- Recalculate reports from ledger data; do not store editable report totals.
- Show warnings rather than silently coercing invalid dates, missing amounts, or ambiguous signs.

*08 · Delivery*

## MVP boundary and success criteria

### MVP is complete when the owner can:

1. Import the fictional sample chart of accounts and rules into a new local company file.
2. Create the existing bank, credit-card, and Amazon entity accounts.
3. Import representative CSV, including a BofA-style file with statement summary rows above the transaction header, plus XLSX/XLS and QBO/OFX statements into Pending with preview, errors, saved mappings, and original-row provenance.
4. Import an Amazon summary while rejecting every exact-zero transaction at row level, continuing the batch, and accounting for every source row.
5. Review by account/date, accept rule suggestions, manually categorize, split, post, exclude, and undo.
6. Match bank/card transfers so they do not affect net profit; manually exclude any pending transaction when appropriate.
7. Generate a monthly and annual P/L whose drill-down reconciles exactly to posted detail.
8. Generate an as-of Balance Sheet whose displayed amounts reconcile to exact contribution detail and whose Difference is `$0.00` for valid books.
9. Generate a Schedule C-ready version that defaults to removing federal income-tax expense, retains state/local income-tax expense, lets the user change either treatment, and clearly discloses the selected settings and removed amount.
10. Export an accountant package and restore the books from a verified backup.

- **100%** — Import source rows accounted for
- **$0.00** — P/L-to-detail reconciliation difference
- **$0.00** — Balance Sheet accounting-equation Difference for valid books
- **100%** — Rejected import rows explained
- **1** — Restorable year-end backup

*09 · Decisions to refine*

## Open product decisions

**Accounting basis**

Proposed MVP: cash basis for the P/L, because the primary purpose is annual tax preparation. Confirm whether the accountant needs accrual or modified-cash adjustments.

**Annual federal and state tax treatment review**

The current product default is to exclude federal income-tax expense and retain state/local income-tax expense on the Schedule C-ready report. Because the correct treatment may need to be reconfirmed each year, the user can change either setting by tax year and the exported report must disclose the choice.

*10 · Basis for this draft*

## Public validation material

The fictional files under `sample-data/` provide the public validation baseline. They cover two accounting years, multiple import shapes, deterministic categorization scenarios, transfers, exclusions, pending activity, profit and loss, and balance-sheet reconciliation without containing source-company data.

TallyStick Product Requirements · Version 1.0 · Prepared August 5, 2026 · Updated through the completed Balance Sheet milestone August 24, 2026
