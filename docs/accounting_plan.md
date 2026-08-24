# Accounting Application Implementation Plan

*Initial implementation plan · Based on PRD Draft 0.3 and Technical Architecture Draft 0.2 · August 6, 2026*

## Purpose

This plan turns the requirements in [Quicken Replacement PRD](Quicken%20Replacement%20PRD.md) and [Quicken Replacement Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md) into an ordered implementation path for the local accounting application.

The plan is organized around usable vertical slices. Each phase must leave the application in a tested, coherent state and must satisfy its exit gate before dependent work begins.

## Current status

- **Overall status:** Feature-complete checkpoint through the first Balance Sheet release
- **Current phase:** No active implementation phase; the next product feature has not been selected
- **Implementation started:** Yes; the current milestone is implemented and verified
- **Current report status:** P/L Summary and Detail, Schedule C controls, as-of Balance Sheet, exact drill-down, CSV/XLSX exports, print/PDF-ready preview, browser tests, production builds, and isolated Electron smoke are complete.
- **Current product outcome:** Import source transactions, review and classify them, maintain local books, and produce traceable cash-basis P/L and reconciled as-of Balance Sheet reports.

The phase plan below is retained as the original implementation map. Some unchecked hardening and documentation items remain in the legacy task tracker, but they are deferred rather than an active feature phase. Balance Sheet delivery and acceptance are recorded separately in the completed [Balance Sheet Task Tracker](Balance%20Sheet%20TASKS.md).

## Locked scope and architectural decisions

These decisions come from the source documents and are not reopened by this plan:

- The application is a single-user, local desktop application for one company.
- Angular and TypeScript are used throughout both UI and non-UI application code.
- Angular services contain application, accounting, import, rule, report, repository-gateway, and backup behavior.
- Every user-visible capability is exposed through a stable, typed Angular **Application Service Interface**. It is an in-process application boundary, not an HTTP or Web API.
- Angular UI components are replaceable and contain no accounting, parsing, SQL, or persistence logic.
- SQLite is the only supported database. SQL Server portability and .NET are out of scope.
- A minimal TypeScript desktop host provides only privileged SQLite and filesystem access through a narrow typed bridge.
- Initial transaction inputs are CSV, XLS/XLSX, and QBO/OFX. PDF parsing and direct bank connections are future adapters, not MVP features.
- Categorization uses prioritized deterministic rules and manual review. AI categorization is out of scope.
- The chart of accounts is maintained in Excel and imported/exported by the application; an in-app chart editor is out of scope.
- Transactions from any import source with a normalized amount of exactly zero are rejected individually with a stated reason; other valid rows in the batch continue.
- Bank and credit-card transfers may be matched. Amazon payout/clearing matching is out of scope for MVP.
- Schedule C treatment is a report adjustment, not a transaction recategorization. Federal income-tax expense is excluded by default and state/local income-tax expense is included by default, with tax-year-specific overrides and disclosure.

## MVP exclusions

- Live bank and credit-card connections
- PDF statement parsing
- Amazon analytics, inventory, SKU profitability, or order management
- Invoicing, bill payment, payroll, sales-tax filing, and accounts payable
- Full general-ledger financial statements beyond the transfer and P/L behavior required by the PRD
- Automatic Schedule C category mapping or tax filing
- Multi-company, multi-user, cloud, or network-server operation
- Duplicate detection beyond the explicit review and exclusion workflow
- Amazon payout/clearing auto-matching

## Delivery principles

1. **One functional path:** the production UI, replacement Angular UIs, automated tests, and future tools call the same Application Service Interface.
2. **Accounting behavior before presentation:** posting, undo, splits, transfers, exclusions, rule evaluation, reporting, and tax adjustments are implemented and tested in Angular services before UI polish.
3. **Source-to-report traceability:** imported source, normalization decisions, edits, state changes, report adjustments, and audit events remain traceable.
4. **No silent loss:** a source row is accepted, deliberately skipped under a named rule, or rejected with a visible reason.
5. **Exact arithmetic:** money uses signed 64-bit integer minor units behind a `Money` value object; floating-point values never determine accounting totals.
6. **Atomic changes:** imports, posting, splits, matching, restore, and migration operations either complete fully or leave the active books unchanged.
7. **Tests are part of each feature:** a phase is not complete when only its production code works.

## Phase summary

| Phase | Outcome | Primary PRD trace | Status |
| --- | --- | --- | --- |
| 0 | Resolve foundation choices and prove the desktop boundary | Architectural prerequisites | Complete |
| 1 | Establish the Angular workspace, stable interface, and domain model | All stories | Complete |
| 2 | Build the SQLite system of record, migrations, and audit foundation | REV-02, OPS-01 | Implemented; legacy gate follow-up deferred |
| 3 | Deliver fixture-driven import preview and atomic commit | IMP-01, AMZ-01 | Implemented; legacy fixture gate follow-up deferred |
| 4 | Deliver account setup, chart import/export, and rule management | COA-01, CAT-01, RUL-01 | Implemented; legacy checklist follow-up deferred |
| 5 | Deliver the transaction review and posting workflow | REV-01, REV-02 | Implemented; legacy checklist follow-up deferred |
| 6 | Deliver bank and credit-card transfer matching | XFR-01 | Complete |
| 7 | Deliver P/L, drill-down, and Schedule C-ready reporting | RPT-01, TAX-01 | Complete |
| 8 | Deliver backup, restore, portable export, and operational safeguards | OPS-01 | Implemented; optional hardening follow-up deferred |
| 9 | Complete replacement-UI proof, end-to-end acceptance, and release hardening | Entire MVP | Partially complete; remaining hardening deferred |
| BS | Deliver reconciled as-of Balance Sheet, outputs, and release proof | Balance Sheet PRD | Complete |

## Phase 0 — Resolve foundation decisions

### Objective

Make the few remaining choices that affect project scaffolding, native integration, and test commands. Record each choice as a short architectural decision record.

### Work

- Confirm cash basis for MVP reporting, or document any accountant-required adjustment before report design begins.
- Spike the desktop shell and typed Angular-to-native bridge, evaluating Electron first as recommended by the architecture.
- Select the SQLite driver and migration tooling based on transactions, parameterized queries, backup support, test isolation, packaging, and compatibility with the chosen desktop shell.
- Select the Angular presentation-state convention for feature facades without changing the Application Service Interface.
- Select the unit, Angular component, integration, and end-to-end test runners and establish coverage reporting.
- Define the backup bundle format for the SQLite database, attachments, metadata, hashes, and integrity manifest.
- Inventory and sanitize representative source fixtures: bank CSV, bank/card Excel, QBO/OFX, Amazon export, chart of accounts, and existing rules.

### Required proof

- A minimal Angular service calls a typed bridge operation without HTTP.
- The desktop host opens a temporary SQLite database, performs a parameterized transaction, and returns a typed result.
- A packaged development build reads a user-selected fixture through the narrow filesystem boundary.
- Unit, integration, Angular, and end-to-end test commands execute successfully in the proposed workspace.
- No accounting or import decision exists in the desktop-host spike.

### Exit gate

The desktop shell, bridge, SQLite tooling, migration approach, test tools, state convention, backup format, and accounting basis are recorded and no unresolved choice blocks the project skeleton.

## Phase 1 — Angular application foundation

### Objective

Create the application skeleton and the stable contracts on which every UI and feature will depend.

### Work

- Create the Angular/TypeScript workspace and minimal desktop host.
- Establish the architecture directories under `site/src/app` and `site/src/desktop-host` described in the Technical Architecture.
- Configure strict TypeScript, formatting, linting, test commands, coverage enforcement, and an offline-capable build/test workflow.
- Define typed identifiers, business dates, UTC audit timestamps, `Money`, transaction states, import outcomes, commands, queries, DTOs, and typed errors.
- Define the top-level `AccountingApplication` and focused account, import, transaction, rule, report, and backup application-service interfaces.
- Provide injectable default service composition and in-memory gateway test doubles.
- Establish feature facades and a minimal replaceable Angular shell that calls only the Application Service Interface.
- Add dependency-boundary checks preventing UI imports of repositories, parsers, SQLite/native types, and desktop-host modules.

### Required tests

- `Money` construction, sign handling, addition, subtraction, comparison, allocation, overflow boundaries, and formatting.
- Transaction-state transition tables, including invalid transitions.
- Contract tests proving typed success, validation failure, application failure, and boundary behavior for the initial service surface.
- Boundary tests proving UI/facade code cannot bypass the Application Service Interface.

### Exit gate

A minimal Angular UI can invoke a stubbed application operation through dependency injection, every public contract has executable tests, and neither UI code nor application contracts expose SQLite, native bridge, parser, or component-specific types.

## Phase 2 — SQLite, repositories, migrations, and audit

### Objective

Establish a reliable local system of record before feature data is accumulated.

### Work

- Define the initial schema for company metadata, accounts, chart entries, transactions, splits, import batches, source rows, mappings, rules, transfer links, tax-year settings, audit events, attachments, and schema history.
- Implement focused Angular repository and query gateway services; do not create a generic CRUD layer.
- Implement the typed bridge and minimal desktop adapters for parameterized SQLite and managed filesystem operations.
- Enable and verify foreign keys for every connection.
- Implement explicit transactions, schema versioning, ordered migrations, pre-migration backup, and integrity checks.
- Preserve immutable imported source values separately from editable accounting values.
- Add append-only audit events for mutations and retain application-generated opaque identifiers.
- Establish temporary-database builders and deterministic seed helpers for tests.

### Required tests

- Repository integration tests against a real temporary SQLite database.
- Foreign-key, unique-key, transaction rollback, and concurrent-operation failure tests.
- Migration tests from a representative prior schema, plus an empty-database bootstrap test.
- Audit append-only behavior and immutable source-field tests.
- Exact storage/retrieval of minimum, maximum, positive, negative, and zero supported money values.
- Integrity-check failure is surfaced as a typed failure.

### Exit gate

The application services can persist and retrieve the core domain model through gateways, a failed multi-record operation leaves no partial state, and migrations and integrity checks pass on real SQLite files.

## Phase 3 — Import framework and initial adapters

### Objective

Deliver the full select → inspect → map → normalize → validate → preview → commit workflow while keeping source-specific parsing replaceable.

### Work

- Implement the shared importer adapter, inspection, parsed-row, normalizer, validation, preview, and commit contracts.
- Implement reusable mappings by institution and file shape.
- Implement header detection, date normalization, signed-amount and debit/credit-column mapping, and common source metadata. CSV preprocessing scans past statement summaries or other preamble rows to the first valid transaction header and retains original file row numbers.
- Implement CSV, XLS/XLSX, and QBO/OFX adapters.
- Implement the Amazon summary profile, including source labels, positive/negative distinctions, and malformed-row quarantine; apply shared row-level zero-amount rejection without aborting the batch.
- Present accepted, rejected, skipped, and warning counts before commit, with row-level explanations.
- Commit accepted rows as one atomic import batch of Pending transactions with source provenance and audit events.
- Build a thin Angular import UI through a feature facade; the UI selects files and mappings but never parses them.

### Required tests

- A shared importer contract suite run against every adapter.
- Sanitized real-file fixtures for all initial formats and institutions represented in the source material.
- Success, BofA-style CSV summary preamble, malformed input, missing header, ambiguous date/sign, empty file, large file, and interrupted commit cases.
- Cross-format fixtures proving exact-zero rows are rejected and every valid row in the same batch can still commit.
- Preview counts exactly equal commit outcomes; a failed commit creates no transaction or partial batch.
- Source files remain byte-for-byte unchanged.

### Exit gate

Representative CSV—including a file with summary rows before its detected transaction header—Excel, QBO/OFX, and Amazon files can be previewed and committed into Pending, all row counts and original row references reconcile, mappings can be reused, and a new test importer can be added without changing posting or reporting services.

## Phase 4 — Accounts, chart of accounts, and categorization rules

### Objective

Load the owner's accounting structure and deterministic categorization behavior before high-volume review begins.

### Work

- Implement Bank, Credit Card, and Entity account setup and account-centered navigation data.
- Import and export the chart of accounts in XLS/XLSX while preserving parent:child hierarchy.
- Validate required fields, uniqueness, account types, hierarchy, and references before replacing the active chart.
- Define the documented Excel/CSV rule-exchange format and implement on-demand export of every current rule for external spreadsheet maintenance.
- Implement non-mutating rule-import preview and full validation of edited exchange files, including row-level errors, collision warnings, stable IDs/priorities, conditions/actions, values/ranges, logic, and chart references.
- Require explicit confirmation before atomically replacing the rule set from a fully valid preview; audit the exchange and report imported/updated/disabled counts.
- Implement rule import through the public exchange format using fictional definitions.
- Build a dedicated Rules workspace with search, enabled-status filtering, priority-ordered rows, account scope, conditions, output summary, status, and direct Edit/Copy/Disable-Enable/Delete actions.
- Build a populated rule editor for new, copied, and existing rules. Support enabled state, priority, account and direction scope, ALL/ANY logic, add/remove conditions, category/payee/memo/tags/exclusion outputs, and unsaved-rule testing.
- Add Pending-transaction **Edit rule** and **Create rule** actions. Resolve the applied rule by stable rule ID, or create an unsaved draft populated from the transaction and current category; refresh Pending suggestions after save without changing Posted transactions.
- Keep all rule mutations behind the typed application interface, transactional and audited. Copy creates a disabled independent rule; deletion requires confirmation and compacts priority ordering.
- Implement ordered rule conditions for account, direction, description, payee, amount/range, and source type, including AND/OR and exclusions.
- Implement rule outputs for GL account, payee, memo/description, transfer account, tags, and exclusion suggestions.
- Implement enable, disable, duplicate, prioritize, collision explanation, test-before-save, and create-from-transaction operations.
- Show suggestion origin and rationale; leave unmatched transactions unresolved for manual review.

### Required tests

- Round-trip every rule through the documented Excel/CSV exchange format without semantic loss.
- Prove malformed or invalid rule exchange files leave the active rule set unchanged and return row-level validation errors.
- Prove a confirmed valid replacement is atomic and records the exchange audit/count summary.
- Prove create/edit/copy/disable-enable/delete persistence, priority compaction, populated transaction drafts, rule testing, and immediate Pending suggestion refresh through unit, SQLite integration, Angular UI, and Electron smoke tests.

- Chart import/export round-trip and hierarchy preservation using representative workbooks.
- Invalid chart rows prevent the entire replacement and produce row-level errors.
- Existing posted references are protected during chart replacement.
- Rule priority, AND/OR, exclusions, sign-sensitive Amazon behavior, collisions, disabled rules, and no-match behavior.
- A migrated representative rule set produces expected suggestions against fixture transactions.

### Exit gate

The fictional sample chart and rules can be loaded into a new company file, invalid changes cannot partially apply, and deterministic suggestions are explainable and repeatable.

## Phase 5 — Transaction review, editing, and posting

### Objective

Deliver the main bookkeeping workflow from Pending through Posted or Excluded, with safe undo and exact report effects.

### Work

- Implement account-centered Pending, Posted, Excluded, and Matched transaction queries.
- Implement date, amount, source batch, category, payee, and match-status filters plus text search.
- Show raw description, normalized payee, account, amount, suggested GL account, suggestion source, and available actions.
- Implement edit operations while preserving raw imported fields.
- Implement exact balanced splits across GL accounts.
- Implement individual and bulk categorize, post, exclude, and return-to-pending operations.
- Require a user-supplied exclusion reason and warn that exclusions may affect account reconciliation.
- Implement undo for Posted and Excluded transactions, reversing report effects while preserving history.
- Record append-only who/when/what audit detail for all changes.
- Keep workflow UI logic inside feature facades; keep accounting and persistence decisions inside Angular services.

### Required tests

- Valid and invalid posting transitions and required-field validation.
- Balanced split success; under-allocation, over-allocation, and rounding-boundary failures with no partial persistence.
- Posted lines affect the correct P/L category exactly once.
- Excluded and Pending items do not affect the P/L.
- Undo restores Pending and reverses the prior effect exactly.
- Bulk operations are atomic according to the documented command behavior and return per-item outcomes where applicable.
- Filters, search, pagination, selection, and facade loading/error state.

### Exit gate

The owner can complete a representative account review from Pending through posting or exclusion, undo any completed action, and trace each result to immutable source and audit history.

## Phase 6 — Bank and credit-card transfer matching

### Objective

Prevent internal bank and credit-card movements from appearing as business income or expense twice.

### Work

- Find equal-and-opposite candidates in other eligible bank/card accounts within a configurable date window.
- Add payee and reference clues to confidence scoring.
- Auto-suggest only high-confidence pairs and show alternatives when a match is ambiguous.
- Confirm a pair as linked transfer entries that affect balances but not the P/L.
- Implement unmatch to return both sides to Pending with retained history.
- Keep Amazon deposits Pending for manual categorization or exclusion; do not implement Amazon payout matching.

### Required tests

- Exact match, date-window boundary, multiple candidates, no candidate, same-account rejection, already-matched rejection, and sign mismatch.
- A confirmed transfer changes neither income, expense, nor net profit.
- Unmatch restores both original Pending transactions and leaves a complete audit trail.
- No automatic match is created for Amazon payout/clearing activity.

### Exit gate

Representative bank transfers and credit-card payments can be suggested, confirmed, and reversed without changing net profit, while ambiguous and Amazon cases remain under user control.

## Phase 7 — P/L and Schedule C-ready reporting

### Objective

Produce the primary business and accountant outputs directly from posted detail.

### Work

- Implement date-filtered cash-basis P/L queries with selected-calendar-year default.
- Group columns by month or year and provide total columns.
- Collapse a single-year Year-grouped report to one `Total` column so the same value is not displayed twice.
- Present Income, COGS, Gross Profit, Expenses, Other Income/Expense, and Net Profit using the recursive chart hierarchy, with an indented account tree, a `Total for ...` subtotal after every group, and bold subtotal/synthetic-total amounts.
- Keep statement labels readable and use matching font weight for each row's label and amount.
- Implement drill-down from every displayed amount to contributing posted transactions and splits.
- Exclude Pending, Excluded, and Matched transfers by definition.
- Add report-only inclusion/exclusion controls for any GL category without changing posted state.
- Add tax-year settings for federal and state/local income-tax expense treatment.
- Default the Schedule C-ready report to exclude federal income-tax expense and include state/local income-tax expense.
- Permit federal, state/local, both, or neither to be removed for a selected tax year.
- Display and export the active tax settings, removed-tax total, and drill-down to affected postings.
- Keep the unadjusted P/L and underlying books unchanged by Schedule C-ready settings.
- Export summary and detail to CSV/XLSX and a print-ready PDF; assemble the accountant package.

### Required tests

- Monthly, annual, partial-period, empty-period, and year-boundary aggregation.
- Gross profit and net profit identities using exact integer arithmetic.
- Every displayed total equals the exact sum of returned drill-down detail, with a `$0.00` reconciliation difference.
- Category report exclusions change only the selected report.
- Federal tax excluded/state tax included default; all four tax-treatment combinations; tax-year isolation; unadjusted P/L unchanged.
- Exported CSV/XLSX/PDF values and disclosures agree with the on-screen report.

### Exit gate

The owner can generate monthly and annual P/L reports and a Schedule C-ready accountant package whose totals reconcile exactly to posted detail and whose tax adjustments are explicit, reversible, and report-only.

## Phase 8 — Backup, restore, and portable export

### Objective

Make the local books recoverable, verifiable, and portable before production use.

### Work

- Create a one-click backup containing the database, attachments, mappings, rules, audit history, metadata, and integrity manifest.
- Run SQLite and attachment integrity checks before marking a backup verified.
- Restore into a validation location first; replace active data only after all checks pass and explicit user confirmation is captured.
- Export transactions, accounts, chart entries, rules, mappings, import history, and audit history in documented CSV/JSON formats.
- Add scheduled backup reminders and show the latest verified backup date.
- Add pre-migration backup and recovery behavior to the release path.

### Required tests

- Restore a backup to a new location and compare schema version, record counts, financial totals, attachment hashes, mappings, rules, and audit history.
- Corrupt, incomplete, wrong-version, and missing-attachment bundles fail without changing active books.
- Portable exports conform to documented schemas and reconcile to database totals.
- Backup reminders and latest-verified status distinguish attempted from successfully verified backups.

### Exit gate

A full company file can be backed up, restored into a new location, and verified with no financial or audit differences; an invalid restore cannot replace the active data.

## Phase 9 — Replacement proof and MVP release

### Objective

Prove that the product satisfies the PRD, the UI is genuinely replaceable, and the assembled application is safe for real bookkeeping.

### Work

- Build a small alternate Angular UI or test harness that completes every major workflow solely through the Application Service Interface and shared DTOs.
- Confirm that it imports no repository, parser, SQLite, desktop-host, or original-component implementation.
- Execute end-to-end flows from representative source files through preview, rules, review, posting, transfers, P/L, tax adjustment, export, backup, and restore.
- Measure performance using representative full-year transaction and rule volumes.
- Exercise upgrade and rollback recovery from the previous packaged application version.
- Complete accessibility, keyboard workflow, failure-message, packaging, and local-data privacy review.
- Produce user documentation for imports, year-end processing, backup/restore, and accountant exports.

### Required acceptance scenarios

1. Start with a new local company database and load the fictional sample chart of accounts and rules.
2. Create the existing bank, credit-card, and Amazon entity accounts.
3. Import representative CSV, XLS/XLS, and QBO/OFX statements with preview, errors, and reusable mappings.
4. Import an Amazon summary, reject exact-zero transactions individually without rejecting the batch, and account for every source row.
5. Review by account and date; accept suggestions; manually categorize; split; post; exclude; and undo.
6. Match bank/card transfers without changing net profit and leave Amazon deposits under manual control.
7. Generate monthly and annual P/L reports whose drill-down reconciles exactly to posted detail.
8. Generate a Schedule C-ready report with visible, tax-year-specific federal/state tax treatment and no mutation of the unadjusted books.
9. Export the accountant package and restore the company from a verified backup.
10. Repeat the major workflows through the alternate Angular UI using only the stable Application Service Interface.

### Exit gate

All MVP acceptance scenarios pass, all required automated suites pass offline, the accounting identities reconcile exactly, restore is verified, and the replacement-UI test proves the architectural boundary.

## Test architecture and commands to establish

The exact tools are selected in Phase 0, but the workspace must expose stable commands for these layers:

| Test layer | Purpose |
| --- | --- |
| T1 — Angular business-service unit | Money, states, posting, splits, transfers, rules, P/L, and tax adjustments |
| T2 — Angular application-service unit | Use-case orchestration, validation, typed outcomes, and gateway interactions |
| T3 — Application-interface contract | Stable behavior shared by the production UI, replacement UI, and test harnesses |
| T4 — Importer fixtures | Real sanitized CSV, Excel, QBO/OFX, Amazon, chart, and rule source files |
| T5 — SQLite integration | Real temporary databases, migrations, transactions, constraints, backup, and restore |
| T6 — Angular UI and facade | Rendering, user intent, state, validation, errors, filters, and bulk selection |
| T7 — End-to-end | Packaged source-file-to-report and backup/restore workflows |

Minimum standard commands should include equivalents of:

- `test:unit`
- `test:contract`
- `test:fixtures`
- `test:integration`
- `test:angular`
- `test:e2e`
- `test:ci`
- `build`

## Global definition of done

A feature or phase is complete only when:

- Its production behavior is available through the stable Angular Application Service Interface.
- UI components use only feature facades and application contracts.
- Public operations have success, failure, and relevant boundary tests.
- Money, posting, undo, splits, P/L aggregation, tax adjustments, rules, and import normalization maintain 100% branch coverage.
- Import adapters pass both the shared contract suite and source-specific fixture tests.
- Persistence behavior is tested on isolated real SQLite databases when applicable.
- Tests are deterministic, order-independent, offline, and do not share mutable state.
- Errors and rejected source rows are visible and typed; no financial activity is silently discarded.
- Audit and immutable-source requirements are verified.
- Report totals reconcile exactly to drill-down detail.
- Required documentation, migration notes, and architectural decision records are updated.
- The standard build and all applicable automated test commands pass.

## Dependencies and sequencing rules

- Phase 0 decisions precede production scaffolding.
- The `Money`, state, error, DTO, and Application Service Interface contracts in Phase 1 precede persistence and feature code.
- SQLite transaction and audit foundations precede import commits and posting.
- The import framework precedes source-specific workflow expansion.
- Accounts and chart data precede posting; deterministic rules precede bulk review acceptance.
- Posting and splits precede P/L reporting.
- Transfer behavior precedes final net-profit acceptance testing.
- Reporting and tax settings precede accountant-package export.
- Backup and verified restore precede use with irreplaceable production books.
- The replacement-UI proof is a release gate, not a post-release aspiration.

## Risks and controls

| Risk | Control |
| --- | --- |
| Desktop host accumulates application logic | Enforce a narrow typed bridge, architecture checks, and host tests limited to SQLite/filesystem behavior. |
| UI becomes coupled to current implementation | Contract-only UI imports and a mandatory alternate-UI acceptance proof. |
| Source formats vary by institution or year | Inspection/mapping stage, versioned fixtures, reusable mappings, row-level errors, and adapter contract tests. |
| Incorrect sign or date normalization changes profit | Explicit preview, typed warnings, source provenance, boundary fixtures, and reconciled commit counts. |
| Floating-point or split rounding corrupts totals | Integer minor units, `Money` value object, exact split equality, and branch-complete tests. |
| A failed import or bulk action leaves partial books | SQLite transactions and failure-injection integration tests. |
| Tax treatment changes by year | Tax-year-scoped report settings, disclosures, and unchanged unadjusted P/L. |
| Local-only data is lost or corrupted | Verified backups, restore-to-validation-copy, integrity manifests, attachment hashes, and pre-migration backups. |
| Existing rules behave differently after migration | Human-readable migration output and regression fixtures against representative historical transactions. |

## Decision log to complete in Phase 0

| Decision | Required outcome | Status |
| --- | --- | --- |
| Accounting basis | Confirm cash basis or document required adjustment | Open |
| Desktop shell and bridge | Select shell and narrow typed bridge after spike | Open |
| SQLite driver and migrations | Select tools that satisfy transaction, test, backup, and packaging needs | Open |
| Angular presentation state | Select facade-level convention without changing application contracts | Open |
| Test runners and coverage | Select tools and encode all seven layers in standard commands | Open |
| Backup bundle | Define contents, manifest, verification, restore, and versioning | Open |

## Original first implementation milestone

The original first milestone was defined as completion of Phases 0 through 3: a packaged Angular desktop skeleton able to open a local SQLite company database and import representative CSV, Excel, QBO/OFX, and Amazon files through a preview into an atomic Pending transaction batch, with source provenance and fixture and integration tests.

This milestone deliberately stops before production posting. It proves the highest-risk architectural seams—Angular application services, the non-HTTP local bridge, SQLite, file access, adaptable importers, and real-source functional tests—before the ledger begins producing accounting results.
