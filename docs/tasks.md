# Accounting Application Task Tracker

*Updateable implementation checklist · Created August 6, 2026*

## Source documents

- [Quicken Replacement PRD](Quicken%20Replacement%20PRD.md)
- [Quicken Replacement Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md)
- [Accounting Application Implementation Plan](accounting_plan.md)
- [Product Specification](PRODUCT_SPEC.md)
- [Follow-up TODOs](TODO.md)

The PRD controls product behavior, the Technical Architecture controls system boundaries, the plan controls phase order, and the Product Specification controls implementation detail. Resolve conflicts according to that authority order before changing code.

## Resume status

| Field | Current value |
| --- | --- |
| Overall status | MVP implementation in progress; Phase 7 P/L Summary, P/L Detail, hierarchical subtotals, exports, reconciliation, and Electron acceptance are complete |
| Current phase | Phase 8 backup, restore, and portable export |
| Next task | P8-002 — include managed attachments in the backup bundle and integrity manifest |
| Current branch | Workspace working tree |
| Development run command | `npm start` |
| Build command | `npm run build` |
| Full test command | `npm run test:ci` |
| Last verified test | `npm run test:ci` — 83 passed; 77.41% statements / 60.92% branches; Angular build and desktop build passed; last isolated Electron smoke passed |
| Last tracker update | August 11, 2026 |
| Known blocker | None |

## How to update this file

- Work from top to bottom within the current phase unless a dependency is explicitly noted.
- Mark a task `[x]` only after its stated behavior and applicable tests pass.
- Do not mark a phase exit gate until every required task and verification item in that phase is complete.
- When pausing, update the Resume status table with the next task, branch, run command, last passing test command, date, and blocker.
- Add concise, public-safe evidence for phase gates, architectural decisions, fictional fixture baselines, and release acceptance.
- If scope changes, update the authority document first and then revise affected tasks here.

## Locked implementation guardrails

- Angular and TypeScript contain both UI and non-UI application behavior.
- All user-visible behavior is available through the typed Angular Application Service Interface; it is not HTTP or a Web API.
- Angular UI components call feature facades/application contracts and contain no accounting, parsing, SQL, or persistence decisions.
- SQLite is the only database. .NET, SQL Server, and provider portability are out of scope.
- The desktop host is a minimal typed SQLite/filesystem adapter with no business logic.
- Initial import adapters are CSV, XLS/XLSX, and QBO/OFX; PDF and live bank connections are future work.
- Categorization is deterministic/manual; AI categorization is out of scope.
- Zero-amount transactions from every source are rejected and counted at row level; valid rows in the same batch continue to commit.
- Amazon payout matching and automatic duplicate detection are out of scope.
- Schedule C tax handling is disclosed, tax-year-specific, and report-only.

## Phase status

| Phase | Outcome | Status |
| --- | --- | --- |
| 0 | Foundation decisions and desktop-boundary proof | Complete |
| 1 | Angular application foundation | Complete |
| 2 | SQLite, repositories, migrations, and audit | In progress |
| 3 | Import framework and initial adapters | In progress |
| 4 | Accounts, chart of accounts, and rules | In progress |
| 5 | Transaction review, editing, and posting | In progress |
| 6 | Bank and credit-card transfer matching | In progress |
| 7 | P/L and Schedule C-ready reporting | In progress |
| 8 | Backup, restore, and portable export | In progress |
| 9 | Replacement proof and MVP release | Not started |

## Phase 0 — Foundation decisions

**Trace:** Plan Phase 0; Product Spec §§22; PRD open decisions; Architecture open technical decisions.

### Product and architecture decisions

- [x] **P0-001** Confirm cash basis for MVP reporting or record the accountant-required adjustment. Evidence: ADR-001 records cash basis and report implications.
- [x] **P0-002** Create an architectural decision record format and location.
- [x] **P0-003** Record the accounting-basis decision and its report implications.
- [x] **P0-004** Define the desktop-shell spike acceptance criteria from the architecture security boundary. Evidence: ADR-005 and typed bridge proof.
- [x] **P0-005** Evaluate Electron first and record the selected desktop shell.
- [x] **P0-006** Select the typed Angular-to-native bridge approach.
- [x] **P0-007** Prove the bridge requires no HTTP listener or network server.
- [x] **P0-008** Select the SQLite driver against transaction, parameterization, packaging, backup, and test-isolation requirements.
- [x] **P0-009** Select schema-migration tooling and define ordered migration conventions.
- [x] **P0-010** Select the Angular feature-facade presentation-state convention.
- [x] **P0-011** Select unit, Angular, integration, contract, fixture, and end-to-end test tools.
- [x] **P0-012** Define coverage collection and enforcement for local and CI-equivalent commands. Evidence: `test:ci` runs ChromeHeadless with coverage and reports thresholds.
- [x] **P0-013** Define the versioned backup bundle, manifest, verification, and restore format.

### Source data and fixture preparation

- [x] **P0-014** Inventory representative bank CSV, Excel, and QBO/OFX source files. Evidence: `fixtures/imports/` and importer contract tests.
- [x] **P0-015** Inventory the Amazon summary export and identify exact-zero and sign-sensitive examples. Evidence: `fixtures/imports/amazon/monthly-summary.csv` and Amazon importer tests.
- [x] **P0-016** Add a fictional, balance-sheet-ready chart-of-accounts baseline. Evidence: `sample-data/chart/chart-of-accounts.csv` and the expected balance sheets.
- [x] **P0-017** Cover the public rule exchange shape with fictional test definitions and deterministic matcher tests.
- [x] **P0-018** Sanitize personal names, account identifiers, and sensitive values in test fixtures. Evidence: fixture README and sanitized import fixtures.
- [x] **P0-019** Store expected fixture results separately from source fixtures for intentional review. Evidence: `fixtures/imports/expected.json`.
- [x] **P0-020** Record fixture provenance and confirm no test requires network access or a live bank. Evidence: `fixtures/README.md` and offline test commands.

### Technical spike proof

- [x] **P0-021** Create a disposable spike proving an Angular service can call the typed local bridge.
- [x] **P0-022** Open a temporary SQLite database and execute a parameterized transaction through the bridge.
- [x] **P0-023** Read a user-selected fixture through the narrow filesystem boundary.
- [x] **P0-024** Verify the Angular renderer remains sandboxed and the bridge exposes no arbitrary file/process access.
- [x] **P0-025** Verify the spike desktop host contains no accounting, import, posting, or reporting logic.
- [x] **P0-026** Execute one test in each selected test category and record the commands. Evidence: package scripts `test:unit`, `test:contract`, `test:fixtures`, `test:integration`, `test:angular`, `test:e2e`, and `test:ci`.
- [x] **P0-027** Record all six final Phase 0 decisions in architectural decision records. Evidence: ADR-001 through ADR-006.
- [x] **P0-GATE** Exit gate: all foundation decisions are recorded and no unresolved choice blocks the production workspace. Evidence: ADR set, boundary script, build, and 27-test suite.

## Phase 1 — Angular application foundation

**Trace:** Plan Phase 1; Product Spec §§4–6, 7.1, 16–19; all PRD stories.

### Workspace and boundaries

- [x] **P1-001** Create the Angular/TypeScript application workspace.
- [x] **P1-002** Create the minimal selected desktop-host workspace. Evidence: `site/src/desktop-host` Electron host.
- [x] **P1-003** Establish `site/src/app/ui`, `features`, `core`, and `infrastructure` boundaries from the architecture.
- [x] **P1-004** Establish `site/src/desktop-host/bridge`, `sqlite-driver`, and `filesystem-adapter` boundaries. Evidence: typed preload bridge and isolated host modules.
- [x] **P1-005** Configure strict TypeScript, formatting, linting, and production builds.
- [x] **P1-006** Configure stable `build`, `test:unit`, `test:contract`, `test:fixtures`, `test:integration`, `test:angular`, `test:e2e`, and `test:ci` commands.
- [x] **P1-007** Add dependency-boundary enforcement preventing UI imports of repositories, parsers, SQLite/native types, and desktop-host modules. Evidence: `npm run test:boundaries`.
- [x] **P1-008** Add dependency-boundary enforcement preventing desktop-host imports of application/accounting services. Evidence: `site/scripts/check-boundaries.mjs`.
- [x] **P1-009** Confirm the development build and all empty test suites run offline.

### Domain primitives and contracts

- [x] **P1-010** Implement opaque identifier types for company, account, chart account, transaction, batch, rule, transfer, and audit records.
- [x] **P1-011** Implement the signed 64-bit minor-unit `Money` value object.
- [x] **P1-012** Implement calendar business-date and UTC audit-time representations.
- [x] **P1-013** Define Pending, Posted, Excluded, and Matched Transfer states and allowed transitions.
- [x] **P1-014** Define immutable DTO conventions and typed validation/application failure contracts.
- [x] **P1-015** Define commands, queries, result DTOs, paging, sorting, and version/conflict fields.
- [x] **P1-016** Define the top-level `AccountingApplication` contract.
- [x] **P1-017** Define account, import, transaction, rule, report, and backup application-service contracts.
- [x] **P1-018** Create Angular injection tokens and default service-composition skeletons.
- [x] **P1-019** Create focused gateway contracts for repositories, SQLite, filesystem, imports, exports, clocks, identifiers, and audit.
- [x] **P1-020** Create in-memory/test-double implementations for application-service unit tests.
- [x] **P1-021** Create a minimal Angular shell and feature facade that call only the Application Service Interface.

### Verification

- [x] **P1-022** Test `Money` construction, signs, arithmetic, comparison, allocation, formatting, and overflow boundaries.
- [x] **P1-023** Test every valid and invalid transaction-state transition.
- [x] **P1-024** Add contract tests for typed success, validation failure, application failure, and boundary results.
- [x] **P1-025** Prove UI/facade code cannot bypass the Application Service Interface. Evidence: boundary script and facade-driven root workflow.
- [x] **P1-026** Prove application contracts expose no component, SQL, SQLite, bridge, parser, or repository types.
- [x] **P1-GATE** Exit gate: a minimal Angular UI invokes a stubbed operation through the stable interface and all foundation tests pass. Evidence: AppComponent test, boundary check, production build.

## Phase 2 — SQLite, repositories, migrations, and audit

**Trace:** Plan Phase 2; Product Spec §§7–8, 15–16, 18–19; REV-02 and OPS-01.

### Schema and persistence

- [x] **P2-001** Define the initial SQLite schema and schema-version record.
- [x] **P2-002** Add company metadata and financial-account tables.
- [x] **P2-003** Add chart-account hierarchy tables and constraints.
- [x] **P2-004** Add import-mapping, import-batch, and source-row provenance tables.
- [x] **P2-005** Add transaction and immutable raw-source field storage.
- [x] **P2-006** Add posting-split tables with active chart references.
- [x] **P2-007** Add transfer-match tables and pair constraints.
- [x] **P2-008** Add rules, condition/action representation, and priority constraints.
- [x] **P2-009** Add tax-year report settings and tax-account group references.
- [x] **P2-010** Add append-only audit events and operation-correlation identifiers.
- [x] **P2-011** Add attachment metadata, hashes, and managed-file references.
- [x] **P2-012** Enable and verify foreign-key enforcement on every connection.
- [x] **P2-013** Implement parameterized SQLite execution through the typed native bridge.
- [x] **P2-013a** Keep Electron's host-owned in-memory SQLite image synchronized after every successful renderer database write so a renderer refresh/reload cannot restore and persist the launch-time snapshot. Evidence: `SqliteHostStore.persistAndReplace()` validates the incoming image, writes it, atomically swaps the host image, and retains the prior image on write failure.
- [ ] **P2-014** Implement focused Angular account and company repository gateways.
- [ ] **P2-015** Implement focused transaction, split, and transfer repository gateways.
- [ ] **P2-016** Implement focused import, chart, rule, tax-setting, and audit repository gateways.
- [ ] **P2-017** Implement focused reporting/query gateways without a generic CRUD abstraction.

### Reliability and migrations

- [x] **P2-018** Wrap all multi-record mutations in explicit SQLite transactions.
- [x] **P2-019** Implement ordered migrations and application startup schema checks.
- [ ] **P2-020** Implement recoverable pre-migration backup behavior.
- [x] **P2-021** Implement startup and pre-backup SQLite integrity checks. Evidence: repository startup checks `integrity_check` and `foreign_key_check`; backup verification validates manifest/data.
- [x] **P2-022** Implement optimistic/stale-operation protection where commands edit existing records. Evidence: expected modification timestamp checks and stale-edit tests.
- [x] **P2-023** Implement temporary-database builders and deterministic seed helpers.

### Verification

- [x] **P2-024** Test every repository against a real isolated temporary SQLite database. Evidence: SQLite repository persistence/reopen integration tests plus Electron host-store reload and failed-write regressions.
- [x] **P2-025** Test foreign-key, uniqueness, check-constraint, and rollback failures. Evidence: SQLite constraint/rollback test.
- [x] **P2-026** Test a failed multi-record operation leaves no partial records or audit events. Evidence: repository rollback test and atomic bulk operation tests.
- [x] **P2-027** Test initial bootstrap and migration from a representative prior schema. Evidence: schema bootstrap and idempotent reopen migration test.
- [ ] **P2-028** Test pre-migration backup and recovery after injected migration failure.
- [x] **P2-029** Test immutable source fields and append-only audit behavior. Evidence: persisted raw-source fields and audit assertions in application/repository tests.
- [x] **P2-030** Test exact minimum, maximum, positive, negative, and zero supported money storage.
- [x] **P2-031** Test integrity failures produce typed, visible outcomes. Evidence: repository initialization rejects failed integrity/FK checks with a visible startup error.
- [ ] **P2-GATE** Exit gate: core records persist through Angular gateways, migrations pass, and failed mutations leave the database unchanged. Remaining: pre-migration backup/recovery evidence.

## Phase 3 — Import framework and initial adapters

**Trace:** Plan Phase 3; Product Spec §§6.2, 7.5–7.6, 9, 16, 19; IMP-01 and AMZ-01.

### Shared import pipeline

- [x] **P3-001** Implement source descriptors, inspection results, parsed rows, normalized candidates, previews, and disposition DTOs.
- [x] **P3-002** Implement the shared importer adapter contract and registry.
- [x] **P3-003** Implement source detection without modifying the selected file.
- [x] **P3-004** Implement mapping for header/sheet selection, dates, signed amount or debit/credit columns, signs, description, payee, memo, and reference.
- [x] **P3-005** Implement reusable mapping identification by source kind and institution/file shape.
- [x] **P3-006** Implement shared date, amount, sign, text, and source-metadata normalization.
- [x] **P3-007** Implement accepted, rejected, skipped, and warning dispositions with stable validation codes.
- [x] **P3-008** Implement preview counts, totals, row detail, and human-readable explanations.
- [x] **P3-009** Bind previews to source hash, parser version, mapping version, and destination account.
- [x] **P3-010** Reject stale previews and require regeneration.
- [x] **P3-011** Implement atomic accepted-row commit to one batch of Pending transactions.
- [x] **P3-012** Preserve source rows, raw values, mapping version, and batch provenance.
- [x] **P3-013** Ensure source hashes are provenance only and do not silently de-duplicate imports.

### Initial adapters

- [x] **P3-014** Implement the CSV inspection and parsing adapter.
- [x] **P3-014a** Add CSV preprocessing that detects the first row containing recognized date and amount headers and removes statement-summary or other preamble rows above it without modifying the source file. Evidence: the shared `preprocessCsv()`/`isTransactionHeaderRow()` path scans parsed CSV rows for recognized date plus amount/debit/credit headers and passes only the detected table to normalization while hashing the unchanged original content.
- [x] **P3-014b** Preserve original CSV file row numbers for accepted and rejected transaction rows after preamble removal, and return `MISSING_HEADER` when no valid transaction header exists. Evidence: parser offsets dispositions and transaction provenance from the detected header's original row; missing-header and BofA row 8/9/10 assertions pass.
- [x] **P3-015** Implement the XLS/XLSX inspection and parsing adapter.
- [x] **P3-016** Implement the QBO/OFX inspection and parsing adapter.
- [x] **P3-017** Implement the Amazon Entity import profile on the shared pipeline.
- [x] **P3-018** Preserve original Amazon activity labels and source-batch references.
- [x] **P3-019** Reject normalized exact-zero rows from every source with `ZERO_AMOUNT`, count them, and continue the valid remainder of the batch. Evidence: cross-format parser fixtures and mixed-batch application commit test.
- [x] **P3-020** Reject or quarantine malformed Amazon rows with visible reasons.
- [x] **P3-021** Support sign-sensitive Amazon rule inputs.

### Angular workflow

- [x] **P3-022** Implement the import feature facade and presentation state.
- [x] **P3-023** Implement file/account selection, inspection, and mapping UI.
- [x] **P3-024** Implement preview tables, row errors/warnings, counts, and totals.
- [x] **P3-025** Implement explicit commit confirmation and final batch summary.
- [x] **P3-026** Confirm no UI component parses files or coordinates database writes.

### Verification

- [x] **P3-027** Create the shared importer contract suite.
- [x] **P3-028** Pass the contract suite with CSV, Excel, and QBO/OFX adapters.
- [x] **P3-029** Add sanitized real-file success fixtures for every initial source family. Evidence: bank/Amazon CSV fixtures plus Excel and QBO/OFX contract fixtures.
- [x] **P3-030** Add malformed input, missing header, ambiguous date/sign, empty file, and interrupted commit fixtures. Evidence: importer tests cover empty, missing header, missing amount, ambiguous debit/credit, invalid date, and rollback.
- [x] **P3-030a** Add a sanitized BofA-style CSV fixture with statement summary rows above the transaction table and prove preview/normalization starts at the detected header with exact counts and original-row provenance. Evidence: `fixtures/imports/bank/bofa-summary-preamble.csv` and parser/application tests prove header row 7, rejected beginning-balance row 8, and committed transaction rows 9–10 with exact 2 accepted/1 rejected counts.
- [x] **P3-031** Prove preview counts and totals equal final commit outcomes.
- [x] **P3-032** Prove commit failure creates no batch, transactions, or partial audit records.
- [x] **P3-033** Prove every Amazon row is accepted or rejected with a reason.
- [x] **P3-034** Prove exact-zero transactions are rejected across CSV, Excel, QBO/OFX, and Amazon inputs without rejecting their batch.
- [x] **P3-035** Prove all source fixture files remain byte-for-byte unchanged.
- [x] **P3-036** Add regression fixtures for every parsing defect found during implementation. Evidence: `fixtures/imports/expected.json` and importer regression tests.
- [ ] **P3-GATE** Exit gate: all initial formats preview and commit to Pending with exact disposition accounting and reusable mappings. Remaining: full supplied Excel/QBO real-file fixture pair.

## Phase 4 — Accounts, chart of accounts, and rules

**Trace:** Plan Phase 4; Product Spec §§6.1, 6.4, 7.3–7.4, 7.10, 10, 13; ACC-01, COA-01, CAT-01, and RUL-01.

### Accounts

- [x] **P4-001** Implement Bank, Credit Card, and Entity account creation and validation. Evidence: typed create command and account tests.
- [x] **P4-002** Implement optional institution/entity, last-four identifier, opening balance/date, and active/archive metadata. Evidence: validation and persisted fields.
- [x] **P4-003** Implement account list/detail DTOs with calculated balance and unresolved counts. Evidence: `listAccounts()`.
- [x] **P4-004** Prevent new imports to archived accounts while retaining history and reports. Evidence: archive/import rejection test.
- [x] **P4-005** Implement account overview cards and navigation through a feature facade. Evidence: `AccountFacade` and root account cards.
- [x] **P4-060** Extend the financial-account domain and stable application interface with type-specific detail type, optional parent/description, lock state, calculated detail retrieval, and stable-ID update. Evidence: `SaveAccountCommand`, `getAccount`, `updateAccount`, and application-service regressions.
- [x] **P4-061** Validate financial-account names, account/detail combinations, four-digit identifiers, opening-balance dates, same-type active parents, cycles, lock/archive rules, and stable reference preservation transactionally with audit history. Evidence: create/update/archive/import rollback and audit assertions passed.
- [x] **P4-062** Add an in-place SQLite migration and repository round trip for financial-account detail type, parent, description, and lock metadata while preserving existing books. Evidence: schema-v4-to-v5 migration and repository reopen regressions passed.
- [x] **P4-063** Extend `AccountFacade` with add, populated edit, archive, and restore operations behind the Application Service Interface. Evidence: facade behavior and validation-error regressions passed.
- [x] **P4-064** Implement Account overview Add/Edit controls and a focused populated editor for all financial-account attributes, calculated-balance context, type-specific details, hierarchy preview, validation, lock, and active/archive state. Evidence: Angular create/edit regression and production build passed.
- [x] **P4-065** Add fixture-driven unit, persistence, facade, integration, and UI coverage proving create/edit retains the stable ID and references, invalid changes roll back, and archived accounts reject imports. Evidence: `npm run test:ci` passed 103/103 and `npm run test:desktop-host` passed 7/7.
- [x] **P4-066** Extend isolated Electron smoke coverage to open and close the financial-account editor without mutating the live profile; update owner documentation and handoff after all acceptance evidence passes. Evidence: unrestricted isolated `npm run desktop:smoke:launch` returned `financialAccountEditor: true`; PRD HTML/Markdown, Product Spec, tracker, and handoff updated August 11, 2026.

### Chart of accounts

- [x] **P4-006** Define the chart workbook round-trip schema. Evidence: stable ID/name/parent/type/order/archive export columns.
- [ ] **P4-007** Implement XLS/XLSX chart inspection and preview.
- [x] **P4-008** Validate required fields, unique IDs/names, supported types, hierarchy, cycles, and display order. Evidence: chart validation code and atomic replacement tests.
- [x] **P4-009** Protect transaction, rule, and tax-setting references during chart replacement. Evidence: orphaned split guard and active chart reference validation.
- [x] **P4-010** Apply a fully valid chart atomically and apply nothing when any row is invalid. Evidence: repository transaction wrapper.
- [x] **P4-011** Preserve parent:child hierarchy and active/archive state. Evidence: colon hierarchy import test.
- [x] **P4-012** Export the current chart to a safe round-trip XLS/XLSX workbook. Evidence: `exportChartAccounts()`.
- [ ] **P4-013** Implement chart import errors with sheet, row, field, code, and message.

### Rules and suggestions

- [x] **P4-014** Define the persisted rule condition tree and action model. Evidence: `RuleCondition`/`TransactionRule` and SQLite persistence.
- [x] **P4-015** Implement account, direction, description, payee, amount/range, and source-type conditions. Evidence: deterministic matcher.
- [x] **P4-016** Implement AND, OR, and explicit exclusion logic. Evidence: matchMode and negate handling.
- [x] **P4-017** Implement outputs for GL account, payee, memo/description, transfer account, tags, and exclusion suggestion. Evidence: persisted action fields and import mapping.
- [x] **P4-018** Implement unique priority ordering and first-winning-rule behavior. Evidence: priority validation and suggestion order.
- [x] **P4-019** Implement rule import/migration for the supplied definitions. Evidence: XLS workbook importer, fixture shape test, and reusable exact-rule overlay for reviewed Amazon labels.
- [x] **P4-019a** Define and implement the documented Excel/CSV rule-exchange format; export every current rule on demand with stable ID, name, enabled status, priority, conditions, actions/outputs, and chart reference. Evidence: `exportRules()` XLSX/CSV exchange output and setup controls.
- [x] **P4-019b** Implement non-mutating rule-import preview and row-level validation for externally edited exchange files, including IDs/priorities, conditions/operators/actions, values/ranges, rule logic, and active chart references. Evidence: `previewRulesImport()` previews with row errors/collision warnings; UI review panel.
- [x] **P4-019c** Require explicit confirmation before atomically replacing the full rule set from a fully valid preview; retain audit history and report imported/updated/disabled counts. Evidence: preview-token commit, confirmation dialog, transactional `IMPORT_RULES` audit, and count summary.
- [x] **P4-019d** Test rule export/import round trips and prove invalid exchange files leave the active rules unchanged. Evidence: exchange round-trip/invalid-preview application test.
- [x] **P4-020** Implement enable, disable, duplicate-as-disabled, edit, and reorder operations. Evidence: rule mutation commands and tests.
- [x] **P4-021** Implement test-before-save with no transaction mutations. Evidence: `testRule()` returns matches without repository writes.
- [x] **P4-022** Implement collisions, winning-rule, matched-condition, and rationale explanations. Evidence: deterministic test results and suggestion rationale; exact upstream Amazon rules are proven to win before the broader advertising rule.
- [x] **P4-023** Implement create-rule-from-manually-categorized-transaction. Evidence: disabled learned-rule command and test.
- [x] **P4-024** Implement deterministic prior-confirmed-match suggestions and historical-source explanation. Evidence: prior-match test.
- [x] **P4-025** Implement suggestion order: transfer, rule, prior match, unresolved. Evidence: `suggestTransaction()`.
- [x] **P4-026** Ensure suggestions never auto-post, auto-exclude, or auto-confirm transfers. Evidence: suggestions are DTOs only; mutations require explicit commands.
- [x] **P4-027** Implement the Angular rule list/editor/test workflow through a feature facade. Evidence: `RuleFacade`.

### Verification

- [x] **P4-028** Test creation and archive behavior for all three financial-account types. Evidence: account validation and archive tests.
- [x] **P4-029** Test chart workbook round-trip and representative 183-entry hierarchy preservation. Evidence: manifest plus chart hierarchy/round-trip tests.
- [x] **P4-030** Test every invalid chart condition prevents the full replacement. Evidence: validation occurs before transactional replacement.
- [x] **P4-031** Test posted, rule, and tax-setting references cannot be orphaned. Evidence: three independent chart-replacement rollback regressions preserve the referenced account and active chart.
- [x] **P4-051** Extend the chart account domain and SQLite schema with QuickBooks-style account type, detail type, description, and lock state while preserving the existing report classification and stable IDs. Evidence: typed account catalog, schema-v3 migration, repository persistence, and v2-to-v3 migration regression.
- [x] **P4-052** Add stable application-interface commands for chart account creation, edit, archive/restore, list, import, and export without exposing persistence or UI types. Evidence: `AccountingApplication` commands and `ChartAccountFacade` contract regression.
- [x] **P4-053** Validate chart-account names, supported account types, required detail types, display order, compatible parents, self-parenting, cycles, locked-account archive behavior, and stable reference preservation transactionally. Evidence: application-service CRUD, hierarchy, lock/archive, incompatible-parent, rollback, and orphan-reference regressions.
- [x] **P4-054** Extend CSV/XLS/XLSX import and XLSX export to round-trip stable ID, name, parent, account type, reporting classification, detail type, description, order, archive state, and lock state; invalid input must leave the chart unchanged. Evidence: enhanced workbook round-trip plus invalid-parent and reference rollback regressions.
- [x] **P4-055** Add a Chart of Accounts feature facade and an exclusive workspace with searchable/filterable hierarchical list, New Account, Edit, Archive/Restore, Import, and Export actions. Evidence: facade regression and Angular workspace/list/filter/sort/action regression.
- [x] **P4-056** Implement the populated account editor with type/detail fields, optional compatible parent, hierarchy preview, description, order, active and lock state, validation feedback, and save/cancel behavior. Evidence: responsive side editor, lock/archive guard, and Angular create/edit/archive regression.
- [x] **P4-057** Add fixture-driven application, SQLite migration/persistence, facade, round-trip import/export, invalid rollback, and Angular UI tests for enhanced Chart of Accounts behavior. Evidence: `npm run test:ci` passed 99/99; `npm run test:desktop-host` passed 5/5.
- [x] **P4-058** Extend isolated Electron smoke coverage to open the Chart of Accounts workspace and verify the list and New Account editor without mutating the live profile. Evidence: isolated `desktop:smoke:launch` passed with `chartWorkspace`, `chartTable`, and `chartEditor` all true.
- [x] **P4-059** Repair legacy chart rows whose version-3 migration left the required detail type blank so creating or editing one account does not fail validation on a different existing row. Evidence: schema-v4 migration assigns type-compatible defaults only where detail type is blank and the version-3 regression passes.
- [x] **P4-032** Test rule priority, AND/OR, exclusions, signs, ranges, disabled rules, collisions, and no-match behavior. Evidence: matcher and import tests.
- [x] **P4-033** Regression-test fictional representative rules against fixture transactions. Evidence: public rule-shape and deterministic matcher tests.
- [x] **P4-034** Test sign-sensitive Amazon rules for identical descriptions with opposite signs. Evidence: direction condition and Amazon sign tests.
- [x] **P4-035** Test prior-match behavior is exact, local, deterministic, and never auto-posts. Evidence: prior-match test.
- [x] **P4-036** Remove the `Amazon Duplicate Summary Payments` rule (currently priority 5). Its transactions remain uncategorized and cannot be posted until the user explicitly selects a category. Evidence: retired-rule filter and regression test.
- [x] **P4-037** Prove an incomplete imported rule cannot block a later actionable storage rule or prior-confirmed match. Evidence: fictional QFX regression and deterministic rule-priority test.
- [x] **P4-038** Add an exact outgoing Amazon rule mapping `FBALongTermStorageFee` to `Cost of goods sold:Storage:Amazon FBA Storage`. Evidence: representative Amazon import regression, idempotent migration rehearsal, backup-first live migration, and verified live rule target.
- [x] **P4-039** Add an exact Amazon rule mapping `AmazonUpstreamStorageTransportationFeePromo` to `Amazon AWD Storage` for either amount direction. Evidence: positive/negative Amazon regression rows, idempotent migration rehearsal, backup-first live migration, and verified live rule target.
- [x] **P4-040** Prove a two-condition software rule is scoped to the selected card and does not match identical text in another account. Evidence: fictional QFX variants plus a checking-account non-match regression.
- [x] **P4-041** Keep prior-match explanations user-facing by omitting internal transaction GUIDs while retaining the matched description/direction rationale. Evidence: exact rationale regression asserts `A prior confirmed transaction used the same description and direction.`
- [x] **P4-042** Add a dedicated Rules primary workspace with button-tab navigation, search, enabled-status filtering, priority-ordered list rows, account scope, conditions, output summary, and status. Evidence: three-button accessible workspace tablist and filterable priority table.
- [x] **P4-043** Expose New Rule, Edit, Copy, Disable/Enable, and Delete actions through the typed application interface and `RuleFacade`; keep mutations transactional and audited, copy as disabled, confirm deletion, and compact priorities after deletion. Evidence: `saveRule`, `duplicateRule`, `setRuleEnabled`, `deleteRule`, facade commands, audit assertions, and SQLite reopen coverage.
- [x] **P4-044** Implement the populated rule editor for name, enabled state, priority, account/direction scope, ALL/ANY logic, add/remove conditions, category, payee, memo, tags, and exclusion suggestion. Evidence: responsive side editor and populated component regressions.
- [x] **P4-045** Implement unsaved-rule testing and display the match count and representative matching transactions without persisting the draft. Evidence: validated `testRule` results and UI match preview regression.
- [x] **P4-046** Move rule Excel/CSV export and validated import-preview/confirmed replacement controls into the Rules workspace without weakening the existing atomic exchange contract. Evidence: Rules toolbar uses existing preview-token exchange operations and confirmed atomic replacement.
- [x] **P4-047** Add Pending-transaction Edit Rule when a deterministic rule was applied and Create Rule otherwise; open a populated existing rule or unsaved transaction-derived draft, including the current selected category when available. Evidence: matched and unmatched Pending-row component regression.
- [x] **P4-048** Refresh visible Pending suggestions after a rule save, enable/disable, copy, delete, or import; never recategorize Posted transactions. Evidence: rule mutations reload both rule state and Pending suggestions; service behavior retains Posted state/splits.
- [x] **P4-049** Add application-service, persistence, facade, Angular UI, and Electron smoke tests for list/filter/editor/actions/import-export/transaction-originated flows. Evidence: 83 browser tests, production builds, and isolated Electron Rules/editor/report smoke passed.
- [x] **P4-050** Update owner documentation and handoff evidence for in-app rule management and its destructive-action boundary. Evidence: PRD HTML/Markdown, plan, tracker, and handoff updated August 11, 2026.
- [ ] **P4-GATE** Exit gate: a fictional chart and rules load safely and all non-manual suggestions are explainable and repeatable.

## Phase 5 — Transaction review, editing, and posting

**Trace:** Plan Phase 5; Product Spec §§6.3, 7.7–7.8, 8, 11; REV-01 and REV-02.

### Queries and ledger UI

- [x] **P5-001** Implement paged account-centered transaction queries. Evidence: `listTransactions()` pagination.
- [x] **P5-002** Implement Pending, Posted, Excluded, and Matched Transfer views. Evidence: state filters and transaction facade; register UI exposes Pending, Posted, and Excluded views with valid state actions.
- [x] **P5-003** Implement inclusive date, amount, source batch, category, payee, and match-status filters. Evidence: typed transaction query filters; register UI exposes inclusive From/Through date controls.
- [x] **P5-004** Implement search across description, memo, payee, reference, and category. Evidence: normalized query search.
- [x] **P5-005** Implement stable sorting, paging, and configurable columns. Evidence: deterministic query sorting plus clickable Date/account, Source transaction, Categorization, and Amount register headings that start ascending and toggle descending.
- [x] **P5-006** Return raw/accounting values, suggestions, splits, source batch, match, and audit history in detail DTOs. Evidence: `getTransactionDetail()`.
- [x] **P5-007** Implement ledger facade state, loading, validation, selection, errors, and refresh. Evidence: `TransactionFacade` signals and mutation wrappers; selected account and transaction-view filters persist and restore as one validated UI preference so ledger scope and account highlighting remain consistent after restart.
- [ ] **P5-008** Implement ledger rows and transaction detail/edit views.
- [x] **P5-008a** Replace the row-level category drop-down with an accessible searchable pop-up category picker. Filter active chart accounts by case-insensitive contains matching, show the full account path/type for each result, support keyboard selection/dismissal, and retain the selected category without posting. Evidence: picker UI/search/keyboard regressions plus durable Pending split persistence across account switches, SQLite export/reopen, and explicit clear.
- [ ] **P5-008b** After committing an imported batch, switch the ledger to Pending so the newly accepted transactions are immediately visible for review.
- [x] **P5-009** Implement checkbox selection, selection count, and clear-selection behavior. Evidence: root review table, visible-row select-all with partial-selection state, selection actions, and the always-available Clear control that clears selection together with active register filters.

### Editing and state operations

- [ ] **P5-010** Implement editing of date, payee/from-to, memo, reference, tags, and business note while preserving raw values.
- [x] **P5-011** Implement confirmed accounting-amount correction with prominent audit detail. Evidence: `correctAmount()` requires rationale and writes audit event.
- [x] **P5-012** Implement one-category posting as one split. Evidence: `postWithCategory()` applies the selected category and inferred provenance within the posting transaction.
- [x] **P5-013** Implement ordered multi-category splits using integer minor units. Evidence: `split()` uses ordered bigint splits.
- [x] **P5-014** Reject under-allocated and over-allocated splits without partial persistence. Evidence: split balance test.
- [x] **P5-015** Validate required fields and active references before posting. Evidence: posting validation.
- [x] **P5-016** Implement individual Pending-to-Posted behavior. Evidence: post command.
- [x] **P5-017** Implement individual Pending-to-Excluded behavior with required reason and reconciliation warning. Evidence: exclusion reason and exception/report path.
- [x] **P5-018** Implement Posted-to-Pending undo and exact report/balance reversal. Evidence: undo transition, audit test, and state-aware register Undo action.
- [x] **P5-019** Implement Excluded-to-Pending undo. Evidence: undo transition and state-aware register Undo action.
- [x] **P5-020** Implement audited Posted edits with atomic report/balance replacement. Evidence: posted amount correction and edited-after-posting exception.
- [x] **P5-021** Prevent direct Posted-to-Excluded or Posted-to-Matched transitions. Evidence: state validation.
- [x] **P5-022** Implement atomic bulk categorize, post, exclude, and undo validation/application. Evidence: repository transaction wrapper and bulk tests.
- [x] **P5-022a** Add confirmed batch actions to the register: post all selected Pending transactions (only when each has an explicit category), undo all selected Posted transactions, delete all selected Excluded transactions, and exclude all selected Pending transactions. Surface only actions valid for the active state and require a user confirmation before each bulk mutation. Evidence: state-specific selection toolbar, atomic batch post, and UI regression test.
- [ ] **P5-023** Return every failing item and reason when a bulk operation is rejected.
- [x] **P5-024** Correlate audit events for bulk operations and preserve append-only history. Evidence: bulk correlation IDs and append-only audit collection.

### Verification

- [x] **P5-025** Test filters, search, sorting, paging, configurable columns, and selection state. Evidence: transaction query contract, facade state tests, UI heading-click tests for ascending/descending sorting on every sortable register column, and a Clear regression test covering date/state/search/category filters plus selection.
- [ ] **P5-026** Test all valid and invalid edit/state transitions, including category-picker contains search, keyboard selection/dismissal, and no posting on category selection alone.
- [x] **P5-027** Test balanced split success and exact under/over-allocation failures. Evidence: split failure test.
- [x] **P5-028** Test Posted activity affects the correct P/L category exactly once. Evidence: application report test.
- [x] **P5-029** Test Pending and Excluded activity affects neither balance nor P/L. Evidence: state-filtered report/balance calculations.
- [x] **P5-030** Test undo reverses the former effect exactly and retains audit history. Evidence: transfer/undo audit tests.
- [x] **P5-031** Test Posted edit replacement is atomic and raw source values remain immutable. Evidence: correction test and raw fields.
- [x] **P5-032** Test any Pending transaction can be excluded with a user-entered reason. Evidence: exclusion validation.
- [x] **P5-033** Test invalid bulk selection changes no selected item. Evidence: atomic bulk-selection failure test.
- [x] **P5-034** Test every public transaction operation for success, failure, and relevant boundaries. Evidence: 27-test application suite.
- [ ] **P5-GATE** Exit gate: a representative imported account can be fully reviewed, posted/excluded, undone, and audited.

## Phase 6 — Bank and credit-card transfer matching

**Trace:** Plan Phase 6; Product Spec §§7.9, 8, 12; XFR-01.

### Matching behavior

- [x] **P6-001** Add configurable inclusive transfer date-window settings. Evidence: optional date-window argument on candidate query.
- [x] **P6-002** Query equal-and-opposite Pending candidates in other eligible Bank/Credit Card accounts. Evidence: candidate matcher.
- [x] **P6-003** Reject same-account, same-sign, different-amount, archived-account, and already-matched candidates. Evidence: eligibility filters and confirmation validation.
- [x] **P6-004** Rank candidates using date proximity, payee, memo, and reference clues. Evidence: confidence/rationale scoring.
- [x] **P6-005** Return confidence and human-readable rationale without automatically confirming a pair. Evidence: suggestion DTO path.
- [x] **P6-006** Present alternatives for ambiguous candidates. Evidence: ordered candidate list.
- [x] **P6-007** Confirm both sides as one Matched Transfer atomically. Evidence: transactional pair confirmation.
- [x] **P6-008** Include both matched amounts in their source-account calculated balances. Evidence: balance calculation includes Matched Transfer.
- [x] **P6-009** Exclude matched transfers from all P/L calculations. Evidence: report includes Posted only.
- [x] **P6-010** Implement atomic unmatch returning both sides to Pending. Evidence: `unmatchTransfer()`.
- [x] **P6-011** Preserve confirmation and unmatch audit history. Evidence: correlated transfer audit events.
- [x] **P6-012** Exclude Entity/Amazon payout activity from automatic transfer matching. Evidence: Bank/Credit Card eligibility guard.
- [x] **P6-013** Implement transfer-review UI through transaction/transfer facades. Evidence: transaction facade exposes review mutations.

### Verification

- [x] **P6-014** Test exact match and inclusive date-window boundaries. Evidence: transfer application test and date-window parameter.
- [x] **P6-015** Test multiple candidates, no candidate, invalid account pair, already matched, and sign/amount mismatches. Evidence: transfer eligibility guards.
- [x] **P6-016** Test confirmation changes neither income, expense, nor net profit. Evidence: transfer test asserts zero P/L.
- [x] **P6-017** Test account balances include both matched source-account amounts. Evidence: calculated account balance path.
- [x] **P6-018** Test unmatch restores both transactions to Pending with full audit history. Evidence: unmatch test.
- [x] **P6-019** Test Amazon deposits/payouts are never automatically matched. Evidence: Entity account eligibility guard.
- [x] **P6-GATE** Exit gate: bank/card transfers can be suggested, confirmed, and reversed with `$0.00` net-profit effect. Evidence: transfer integration test.

## Phase 7 — P/L and Schedule C-ready reporting

**Trace:** Plan Phase 7; Product Spec §§6.5, 7.11, 14, 19; RPT-01 and TAX-01.

> **Status — August 11, 2026:** The calculation services, recursive chart hierarchy, bold account-group subtotals, exact detail query, export generators, owner-facing Angular Reports workspace, browser acceptance suite, production builds, and isolated Electron smoke all pass.

### P/L calculation and drill-down

- [x] **P7-001** Implement inclusive date-range report queries with selected-calendar-year default. Evidence: report services and root selected-year view.
- [x] **P7-002** Implement month and year grouping with total columns. Evidence: period/cell report model.
- [x] **P7-003** Implement chart hierarchy for Income, COGS, Expenses, Other Income, and Other Expense. Evidence: report cells follow chart `parentId` relationships recursively, separate direct parent activity from descendant activity, and aggregate every ancestor exactly.
- [x] **P7-004** Implement exact report-sign transformation from signed posting splits and GL type. Evidence: report builder and detail export.
- [x] **P7-005** Implement `Gross Profit = Income - COGS`. Evidence: report section identity.
- [x] **P7-006** Implement `Net Profit = Gross Profit - Expenses + Other Income - Other Expense`. Evidence: report calculation.
- [x] **P7-007** Exclude Pending, Excluded, and Matched Transfer activity by definition. Evidence: Posted-only P/L filter.
- [x] **P7-008** Implement report-only inclusion/exclusion for any GL account/category. Evidence: optional excluded-category set on `getProfitLoss()`/detail exports, report filter panel, and fixture-driven exclusion tests.
- [x] **P7-009** Return stable report-cell identifiers and exact contributing split drill-down. Evidence: cell keys and detail DTO.
- [x] **P7-010** Include transaction, source account, date, payee, memo, GL, amount, and source batch in drill-down. Evidence: `ReportDetailRow`.
- [x] **P7-011** Complete the owner-facing P/L Summary and P/L Detail UI through the report facade. Evidence: selection-aware Summary/Detail workspace, exports, 74 passing ChromeHeadless tests, production builds, and isolated Electron report smoke.

### Schedule C-ready behavior

- [x] **P7-012** Implement tax-year settings with federal and state/local GL account sets. Evidence: persisted `TaxYearSettings`.
- [x] **P7-013** Default federal income-tax inclusion to false. Evidence: default settings and test.
- [x] **P7-014** Default state/local income-tax inclusion to true. Evidence: default settings and test.
- [x] **P7-015** Support all four federal/state inclusion combinations independently per tax year. Evidence: independent settings fields and report adjustment.
- [x] **P7-016** Remove the annual-review confirmation and accountant-note controls from Schedule C settings and exports. Evidence: simplified settings UI and disclosure contract; legacy database columns remain compatible.
- [x] **P7-017** Calculate the Schedule C-ready result as a report-only adjustment to the unadjusted P/L. Evidence: separate adjusted/unadjusted report test.
- [x] **P7-018** Display tax year, active settings, affected account names, and removed total prominently. Evidence: Schedule C settings panel with configured account names, removed-tax total, and removed-tax detail action.
- [x] **P7-019** Implement drill-down to every posting removed by the tax adjustment. Evidence: detail filtering by tax account IDs.
- [x] **P7-020** Prove tax settings never mutate chart entries, splits, states, transactions, or other tax years. Evidence: report-only calculation path.

### Other reports and exports

- [x] **P7-021** Implement the exception report for Pending, unresolved, unmatched, parse-warning, and edited-after-posting items. Evidence: `getExceptions()`.
- [x] **P7-022** Implement reconciliation as opening balance + Posted activity + Matched Transfer activity. Evidence: `getReconciliation()`.
- [x] **P7-023** Support optional statement-ending balance and difference. Evidence: reconciliation DTO.
- [x] **P7-024** Implement summary/detail CSV export generation in the Application Service Interface. UI exposure remains under P7-045.
- [x] **P7-025** Implement summary/detail XLSX export generation in the Application Service Interface. UI exposure remains under P7-045.
- [x] **P7-026** Implement print-ready report generation. Evidence: print-ready HTML accepted by the local print flow; user-facing print/PDF exposure remains under P7-045.
- [x] **P7-027** Implement the accountant package and manifest. Evidence: `exportAccountantPackage()`.
- [x] **P7-028** Include unadjusted P/L, Schedule C-ready P/L, settings, detail, exclusions, exceptions, reconciliation, and notes. Evidence: accountant package JSON manifest.

### Owner-facing P/L Summary and P/L Detail completion

- [x] **P7-039** Add a clearly accessible Reports workspace with distinct **P/L Summary** and **P/L Detail** views; do not treat the existing dashboard total card as either report. Evidence: Angular report workspace with Summary/Detail tabs.
- [x] **P7-040** Add report controls for inclusive start date, end date, selected-calendar-year default, and Month/Year grouping, and keep the selected report parameters stable while moving between Summary and Detail. Evidence: report toolbar and facade load parameters.
- [x] **P7-041** Render the complete P/L Summary hierarchy for Income, COGS, Gross Profit, Expenses, Other Income, Other Expense, and Net Profit, with period columns and a Total column that remain readable without horizontal dragging at the normal desktop width. Evidence: recursive chart-account rows, direct-parent activity, indented children, responsive report styles, and bold `Total for ...`, Gross Profit, and Net Profit rows.
- [x] **P7-042** Make every P/L Summary amount drillable and open the exact contributing posted splits in P/L Detail while preserving the selected period, category, and report settings. Evidence: shared `ReportDrilldownQuery`, context-specific `reportContributionMinor`, exact ancestor-category ID sets, and passing component/service fixtures.
- [x] **P7-043** Render P/L Detail with transaction date, source account, payee, description/memo, GL category, amount, and source batch; provide useful date, category, account, and text filtering and deterministic sortable columns. Evidence: detail table, filters, sortable headers, and richer `ReportDetailRow` contract.
- [x] **P7-044** Expose report-only GL category inclusion/exclusion controls and prove they change only the current report, never the posted transaction, split, or transaction state. Evidence: exclusion panel, optional excluded IDs in the application interface, and service/UI tests.
- [x] **P7-045** Expose Summary and Detail CSV/XLSX downloads and the print/PDF flow in the Reports workspace, using the Application Service Interface export operations. Evidence: Summary CSV/XLSX/print share the on-screen recursive matrix, subtotal labels, values, and disclosures; Detail CSV/XLSX use the exact active drill-down query and P/L contributions; browser export assertions pass.
- [x] **P7-046** Expose Schedule C-ready annual settings, active federal/state-local treatment, removed-tax total, and removed-tax detail without changing the unadjusted P/L. Evidence: settings panel, configured-account disclosure, and removed-tax detail selection.
- [x] **P7-047** Add fixture-driven facade, component, integration, and desktop UI tests covering report navigation, parameters, hierarchy, drill-down, detail fields, exclusions, exports, Schedule C disclosures, empty periods, and exact Summary-to-Detail reconciliation. Evidence: 74/74 ChromeHeadless tests pass; Angular and desktop builds pass; isolated Electron smoke verifies The Books, Reports workspace, Summary, Detail, and Detail table.
- [x] **P7-048** Render chart-of-accounts subtotals in the P/L Summary and all summary exports. Evidence: nested parent/child fixtures verify direct and descendant values, a bold `Total for ...` row follows each group, subtotal drill-down returns the exact subtree, and CSV/XLSX/print preserve the hierarchy and subtotal rows.
- [x] **P7-049** Match the QuickBooks single-year statement presentation. Evidence: a Year-grouped report with one period renders and exports only one `Total` column; Summary account labels render at 14px; parent, leaf, subtotal, Gross Profit, and Net Profit rows apply identical font weight to their label and amount; component and export fixtures pass.
- [x] **P7-050** Make the selected Unadjusted or Schedule C-ready basis drive the on-screen headline, summary hierarchy, detail drill-down, and Summary/Detail exports. Evidence: explicit basis controls, adjusted tax-account exclusions, removed-tax drill-down, component/service regression tests, and Electron smoke coverage.
- [x] **P7-051** Open print output as a preview without immediately showing the system dialog, and expose File → Print with ⌘P for the focused report window. Evidence: preview regression test and Electron menu smoke coverage.

### Verification

- [x] **P7-029** Test monthly, annual, partial-period, empty-period, and year-boundary results. Evidence: report period generation and application tests.
- [x] **P7-030** Test sign transformation, refunds/reversals, Gross Profit, and Net Profit identities. Evidence: report calculation tests.
- [x] **P7-031** Prove every generated report cell equals the exact sum of returned drill-down contributions at the service layer. Evidence: passing fixtures cover Income, COGS, Gross Profit, Expenses, Other Income, Other Expense, Net Profit, nested category totals, monthly periods, and the full report.
- [x] **P7-032** Prove report-to-detail reconciliation difference is always `$0.00` for valid books. Evidence: report reconciliation field and detail test.
- [x] **P7-033** Test arbitrary category exclusions affect only the selected report. Evidence: application-service and AppComponent tests prove excluded categories change report/export results while posted state and splits remain unchanged.
- [x] **P7-034** Test federal-excluded/state-included defaults and all four annual combinations. Evidence: tax settings fields and default test.
- [x] **P7-035** Test tax-year isolation and unchanged unadjusted P/L. Evidence: separate report path.
- [x] **P7-036** Test removed-tax total equals its exact drill-down. Evidence: tax account summation.
- [x] **P7-037** Test CSV/XLSX/print-PDF values and disclosures against the complete on-screen P/L Summary and P/L Detail reports. Evidence: passing fixtures compare Summary period/total values, recursive subtotal rows, Detail contribution sums, Schedule C disclosures, and print content across UI/service exports.
- [x] **P7-038** Test accountant package contents and manifest. Evidence: package manifest test.
- [x] **P7-GATE** Exit gate: the owner can generate, inspect, drill into, and export monthly and annual P/L Summary and P/L Detail reports; every displayed amount reconciles exactly to displayed detail; Schedule C adjustments are explicit and report-only; and the workflow passes in the isolated Electron smoke. Evidence: 74/74 browser tests, Angular production build, desktop-host build, and Electron report smoke passed August 11, 2026.

## Phase 8 — Backup, restore, and portable export

**Trace:** Plan Phase 8; Product Spec §§6.6, 15–16, 18–19; OPS-01.

### Backup and verification

- [x] **P8-001** Implement a one-click backup command through the Application Service Interface.
- [ ] **P8-002** Include the SQLite database, managed attachments, mappings, metadata, and integrity manifest. SQLite bytes, normalized records/mappings/rules/tax/audit data, and hashes are implemented; attachment packaging remains the next unchecked backup task.
- [x] **P8-003** Record schema version, application version, company identity, creation time, and hashes.
- [x] **P8-004** Run SQLite integrity checks before marking a backup verified. Evidence: repository startup integrity checks precede backup operations.
- [x] **P8-005** Verify required files, manifest entries, attachment hashes, and supported schema.
- [x] **P8-006** Store attempted and verified backup timestamps separately. Evidence: `BackupBundleService.status()`.
- [ ] **P8-007** Implement scheduled backup reminders and latest verified status.

### Restore and export

- [x] **P8-008** Restore every backup into a separate validation location first. Evidence: raw SQLite restore opens the selected backup independently, writes a sibling temporary activation copy, revalidates it, and only then atomically replaces the configured live path.
- [x] **P8-009** Compare company identity, schema, counts, totals, attachments, mappings, rules, and audit history. Evidence: manifest/data validation and round-trip data test; separate-location activation remains.
- [x] **P8-010** Return a typed validation report without changing active data.
- [x] **P8-011** Require successful validation and explicit confirmation before activation. Evidence: Data & Backups requires user confirmation before opening the restore picker; the host refuses activation until source and temporary-copy verification pass.
- [x] **P8-012** Ensure activation failure preserves or recovers the prior active data. Evidence: repository transaction rollback and restore tests.
- [x] **P8-013** Implement documented CSV/JSON portable schemas for all records.
- [x] **P8-014** Export transactions, accounts, chart, splits, transfers, rules, mappings, batches, source-row dispositions, tax settings, and audit history.
- [x] **P8-015** Distinguish portable export from a verified restorable backup in the UI/documentation.
- [x] **P8-016** Implement backup/restore/export UI through a backup facade. Evidence: the Data & Backups workspace uses `BackupFacade` and the stable application interface for displayed paths, manual backup, relocation, and restore; Electron/filesystem types remain behind the gateway.

### Verification

- [ ] **P8-017** Restore a verified backup into a new location and compare schema, counts, totals, attachments, and audit history.
- [x] **P8-018** Test corrupt, incomplete, wrong-version, missing-attachment, and hash-mismatch bundles. Evidence: backup validation tests.
- [x] **P8-019** Prove every failed validation/restore leaves active books unchanged. Evidence: transactional import/restore behavior.
- [ ] **P8-020** Test portable export schemas and reconcile exported totals to SQLite.
- [x] **P8-021** Test reminder and latest-attempted/latest-verified status behavior. Evidence: backup service status DTO.
- [ ] **P8-022** Test pre-migration backup uses the same verified safety guarantees.
- [x] **P8-023** Define typed database-location, backup-result, relocation, and restore contracts on the stable Application Service Interface; keep filesystem and Electron types behind a gateway. Evidence: `DatabaseLocations`, `DatabaseFileOperationResult`, application methods, `DatabaseLifecycleGateway`, and boundary test.
- [x] **P8-024** Persist the configured live SQLite path, backup folder, and latest verified backup metadata in a host-owned settings file; retain the Electron user-data database as the default. Evidence: atomic versioned `database-locations.json` writes and manager reopen/location tests.
- [x] **P8-025** Create timestamped plain SQLite backups from the current host-owned database image while the app is open; verify source and copied-file integrity/foreign keys/schema before success and use temporary-file plus atomic rename activation. Evidence: host test creates a Pacific-local `tallystick-2026-08-11-100405.sqlite`, reopens it, and verifies company data; isolated Electron smoke creates a real backup.
- [x] **P8-026** Require and verify an automatic safety backup before relocating or restoring the current database. Evidence: relocation/restore host tests inspect the returned pre-change backup and prove it contains the prior company data.
- [x] **P8-027** Relocate the live database through a chosen Save path: validate the target copy, persist the new path only after success, retain the old database, and restart into the new location. Evidence: host relocation test verifies target data, safety backup, and persisted startup path; Electron handler swaps its host path and schedules relaunch only after success.
- [x] **P8-028** Restore a chosen `.sqlite` backup by validating it separately, preserving the selected backup, atomically replacing only the configured live database, and restarting; every failure preserves current books and settings. Evidence: successful and corrupt restore host tests verify restored data, byte-identical selected backup, current-data safety backup, unchanged path, and no mutation on failure.
- [x] **P8-029** Add a fourth `Data & Backups` workspace showing both configured paths and latest verified backup status, with Choose backup folder, Back Up Now, Move current database, and Restore from backup actions. Evidence: Angular UI regression and Electron smoke.
- [x] **P8-030** Add host filesystem tests, Angular contract/facade/UI tests, and failure-injection coverage for settings, live backup, relocation, restore, and unchanged-active-data guarantees. Evidence: 5 Node host tests plus 89 ChromeHeadless tests pass.
- [x] **P8-031** Extend the isolated Electron smoke to verify the Data & Backups workspace and create a real verified backup without touching the live profile. Evidence: `npm run desktop:smoke:launch` passed using an isolated temporary `userData` directory.
- [x] **P8-032** Keep the Angular database migration, portable backup bundle, and Electron backup/restore validator on one shared current-schema constant; accept the current schema and reject unknown future schemas. Evidence: shared schema constant now resolves to schema 5, current/future-version host regression, `npm run test:desktop-host` passed 7/7, and `npm run test:ci` passed 103/103.
- [x] **P8-033** Generate backup filename timestamps in a configurable IANA timezone, defaulting to `UTC`, while retaining UTC verification timestamps. Evidence: persisted `backupTimeZone`, summer-PDT and winter-PST filename regressions, `npm run test:desktop-host` passed 7/7, and the live **Back Up Now** action created `tallystick-2026-08-11-231932.sqlite`, reconciled to schema 4 and Example Outfitters LLC.
- [ ] **P8-GATE** Exit gate: a company backup restores and verifies with no financial/audit differences, and invalid restores cannot replace active data.

## Phase 9 — Replacement proof and MVP release

**Trace:** Plan Phase 9; Product Spec §§17–23; all PRD stories.

### Replacement-UI proof

- [x] **P9-001** Build a small alternate Angular UI or harness against shared Application Service Interface contracts. Evidence: `AlternateUiHarness`.
- [x] **P9-002** Complete account, import, transaction, rule, report, and backup workflows through the alternate UI/harness. Evidence: harness snapshot plus application integration tests cover the workflows.
- [x] **P9-003** Prove it imports no repository, parser, SQLite/native, desktop-host, or original-component implementation. Evidence: harness has only the Application Service Interface import and boundary script passes.
- [ ] **P9-004** Fix any contract gaps discovered by replacement testing without creating a UI-specific side path.

### End-to-end acceptance

- [x] **A1** New company: create accounts and atomically load a fictional chart and rules. Evidence: account/chart/rule application tests.
- [x] **A2** Bank CSV: preview, validate, save mapping, commit to Pending, and trace source provenance. Evidence: CSV/import persistence tests.
- [x] **A3** Excel and QBO/OFX: complete equivalent preview/commit flows through the shared candidate contract. Evidence: shared importer contract tests.
- [x] **A4** Amazon: reject exact-zero transactions without aborting the batch, account for every row, preserve labels, and explain sign-sensitive suggestions. Evidence: Amazon importer tests and direction matcher.
- [x] **A5** Review/posting: filter, categorize, split, post, exclude, bulk-act, and undo with exact effects and audit history. Evidence: application transaction suite.
- [x] **A6** Transfers: confirm and unmatch a bank/card pair with `$0.00` net-profit effect and no Amazon auto-match. Evidence: transfer integration test.
- [x] **A7** P/L: generate monthly/annual reports and reconcile every cell exactly to detail. Evidence: report/detail/reconciliation tests.
- [x] **A8** Schedule C-ready: verify defaults, four combinations, disclosures, drill-down, and unchanged unadjusted books. Evidence: TAX-01 tests and report DTO.
- [x] **A9** Accountant handoff: export matching CSV/XLSX/PDF outputs and complete package contents. Evidence: export/package tests.
- [ ] **A10** Recovery/replacement: verify restore equivalence and repeat major workflows through the alternate Angular UI/harness. Alternate-interface proof and SQLite round-trip are complete; separate-location restore equivalence remains.

### Release hardening

- [x] **P9-005** Run the complete offline `test:ci` suite from a clean workspace. Evidence: 30 passing ChromeHeadless tests and boundary check.
- [ ] **P9-006** Confirm required 100% branch coverage areas and the wider agreed threshold.
- [ ] **P9-007** Run representative full-year transaction/rule volume checks and record results.
- [ ] **P9-008** Test packaged application startup, file selection, local database creation, exports, and backup paths.
- [ ] **P9-009** Test upgrade from the previous packaged schema and injected-failure recovery.
- [ ] **P9-010** Review keyboard workflow, accessibility, error clarity, and long-running progress feedback.
- [ ] **P9-011** Verify no bank credentials, source contents, database paths, or sensitive data enter browser storage or logs.
- [x] **P9-012** Verify no runtime network server or required network call exists. Evidence: Electron uses IPC/file access only; no HTTP server dependency.
- [ ] **P9-013** Document local-data protection, including encryption or reliance on macOS FileVault.
- [ ] **P9-014** Write user documentation for setup, imports, review, rules, transfers, reports, year-end processing, and backups.
- [ ] **P9-015** Write data/export schema documentation and recovery instructions.
- [x] **P9-016** Record final versions, build command, test command, schema version, and verified backup evidence. Evidence: README, HANDOFF, tasks evidence log, schema version 5, version-2/version-3/version-4 migration regressions, and backup tests.
- [ ] **P9-GATE** Exit gate: A1–A10 and all release gates pass; the MVP is ready for production bookkeeping.

## Global definition of done

Apply these checks to every feature before marking its task complete:

- Behavior is exposed through the stable Angular Application Service Interface.
- UI components use feature facades/contracts and contain no accounting, parser, SQL, or persistence behavior.
- Public operations have success, failure, and relevant boundary tests.
- Financial/parsing decision branches have meaningful assertions and required branch coverage.
- Persistence behavior uses real isolated SQLite tests when applicable.
- Source rows and native failures are never silently discarded or coerced.
- Raw source and append-only audit requirements are verified.
- Report changes reconcile exactly to contributing detail.
- Tests are deterministic, offline, order-independent, and isolated.
- Documentation, migrations, fixtures, and decision records are updated.
- Standard build and all applicable test commands pass.

## Deferred work register

Do not add these to MVP phases unless an authority document is changed:

- **FUTURE-001 — Deferred:** PDF/OCR statement importer using the shared adapter contract.
- **FUTURE-002 — Deferred:** Direct bank connector using the shared adapter contract.
- **FUTURE-003 — Deferred:** Amazon payout/clearing auto-matching.
- **FUTURE-004 — Deferred:** Automatic duplicate detection/de-duplication.
- **FUTURE-005 — Deferred:** AI-assisted categorization.
- **FUTURE-006 — Deferred:** Multi-company, multi-user, cloud, or collaboration support.
- **FUTURE-007 — Deferred:** Full accounting-suite features or automatic Schedule C mapping/tax filing.
