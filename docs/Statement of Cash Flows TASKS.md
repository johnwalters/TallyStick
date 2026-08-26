# TallyStick Statement of Cash Flows Task Tracker

*Proposed implementation checklist · Created August 25, 2026*

## Source documents and authority

1. [Statement of Cash Flows PRD](Statement%20of%20Cash%20Flows%20PRD.md) Draft 0.1 controls product intent and acceptance.
2. [Statement of Cash Flows Product Specification](Statement%20of%20Cash%20Flows%20PRODUCT_SPEC.md) Draft 0.1 controls implementation contracts and calculations.
3. [Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md) controls system boundaries.
4. [Application Product Specification](PRODUCT_SPEC.md) controls existing application-wide behavior outside this feature.
5. This tracker controls implementation order and records verified progress; it does not override the documents above.

Execution is divided into token-conscious, independently testable units in the [Statement of Cash Flows Implementation Slices](Statement%20of%20Cash%20Flows%20IMPLEMENTATION%20SLICES.md). Naming a slice from that catalog authorizes only that slice's implementation and verification. It does not authorize a commit, push, later slice, or unrelated cleanup.

## Resume status

| Field | Current value |
| --- | --- |
| Overall status | Phase 3 classification services and review UI complete; Phase 2 recovery gate remains independently open |
| Current phase | Phase 2 — Schema 7 migration, persistence, and recovery compatibility |
| Next task | Resume the separate Phase 2 recovery gate (`CF2-008`, `CF2-011`, `CF2-012`, and `CF2-GATE`) |
| Current branch | `cash-flow` |
| Development command | `cd site && npm start` |
| Production build | `cd site && npm run build` |
| Full browser/unit suite | `cd site && npm run test:ci` |
| Desktop-host suite | `cd site && npm run test:desktop-host` |
| Electron smoke | `cd site && npm run desktop:smoke` |
| Last verified Cash Flow test | `npm run test:ci`: 232 browser/unit tests passed plus boundary and both fixture oracles; production build, app/spec type checks, desktop-host suite (8 tests), and `git diff --check` passed. |
| Last tracker update | August 25, 2026 — `CF-SLICE-07-CLASSIFICATION-UI` browser regression gate revalidated and closed |
| Known blocker | Recovery acceptance gate remains open pending explicit review of pre-migration backup, strict schema-7 restore, classification preservation, portable bundle, and in-memory parity cases |

## Tracker use

- Work from the named slice and its declared dependencies. Without a named slice, the first unchecked task is only the resume point, not authorization to edit application code.
- Mark a task `[x]` only after its behavior and applicable tests pass.
- Do not mark a phase gate complete merely because contracts, a migration, a service method, static UI, or a build exists.
- A calculation task is complete only when exact report, detail, reconciliation, and applicable output values agree.
- When pausing, update Resume status with the next task, branch, last passing command, date, and blocker.
- Add concise command/result evidence for baselines, migrations, calculation fixtures, phase gates, and release acceptance.
- If scope changes, update the PRD first, then the Product Specification, then this tracker and the slice catalog.
- Preserve unrelated working-tree changes. Do not commit or push unless separately instructed.

## Locked implementation guardrails

- Angular components call the typed in-process `AccountingApplication`; there is no HTTP API.
- SQLite is authoritative. Electron owns only native database, filesystem, workbook, and print boundaries.
- Money uses signed integer minor units; reporting code never calculates with binary floating point.
- Business dates do not receive time-zone conversion.
- Company and account behavior never depends on a particular company, institution, marketplace, account name, stable ID, or category name.
- Cash role and Cash Flow treatment are explicit classifications independent from Account Type, statement placement, and import eligibility.
- The indirect method starts with the existing unadjusted P/L Net Profit for the exact period.
- Opening and ending balances, report rows, details, and outputs use one consistent database revision and accounting basis.
- Screen, detail, CSV, XLSX, print preview, and PDF consume one immutable Statement of Cash Flows result.
- Report viewing and export never mutate the books or store editable report totals.
- Pending and Excluded activity never affects the statement.
- Confirmed cash-to-cash transfers do not change Operating, Investing, Financing, or Net Change totals.
- Noncash investing and financing activity is excluded from cash totals and disclosed separately when identifiable.
- Nonzero archived, migrated, review-required, and unclassified activity remains visible.
- Complete status requires zero Difference and no material unclassified cash activity.
- The shared schema-version constant must be updated consistently across persistence, backups, restore validation, desktop-host tests, and smoke fixtures.
- Tests and smoke runs use isolated temporary profiles and databases, never the live user database.
- No task is complete until its required tests pass; no release gate is complete until browser tests and isolated Electron smoke pass.
- The classification review is isolated in a standalone component and its shared styles are global. The measured production initial bundle is 1.33 MB; `angular.json` uses a 1.35 MB warning budget and a 1.5 MB hard ceiling as an explicit interim architecture decision while the broader application shell is split into feature-level lazy boundaries.

## Phase status

| Phase | Outcome | Status |
| --- | --- | --- |
| 0 | Accepted documents, verified baseline, and exact calculation oracle | Complete |
| 1 | Cash Flow classification domain and public contracts | Complete |
| 2 | Schema 7 migration, persistence, revision, and recovery compatibility | In progress |
| 3 | Classification services, chart exchange, and review UI | Complete |
| 4 | Cash balances and indirect Operating activities | Not started |
| 5 | Investing, Financing, transfers, restricted cash, and disclosures | Not started |
| 6 | Reconciliation, warnings, detail, revision, and cache behavior | Not started |
| 7 | Statement of Cash Flows workspace | Not started |
| 8 | CSV, XLSX, print preview, and PDF parity | Not started |
| 9 | Acceptance, performance, privacy, regression, and release proof | Not started |

## Phase 0 — Baseline and calculation oracle

**Trace:** PRD §§1–19 and A1–A20; Product Spec §§1–2 and 18–20.

- [x] **CF0-001** Create the Statement of Cash Flows PRD with CF-001 through CF-035 and A1 through A20.
- [x] **CF0-002** Create the implementation-ready Product Specification with contracts, schema proposal, calculations, outputs, and verification gates.
- [x] **CF0-003** Create this resumable phase-based tracker.
- [x] **CF0-004** Create the 20-slice implementation catalog and map every slice to tracker authority.
- [x] **CF0-005** Run and record pre-change `npm run test:ci`, production build, desktop-host suite, and isolated Electron smoke.
- [x] **CF0-006** Record current schema-6 fixture counts and prove a pre-migration backup can be restored.
- [x] **CF0-007** Add neutral fictional fixtures for cash sales and expenses, receivables, inventory/payables, fixed assets, debt, equity, transfers, restricted cash, noncash events, opening balances, and review-required activity.
- [x] **CF0-008** Encode exact signed minor-unit expectations for every report row, cash reconciliation, warning, and detail contribution in A1–A20.
- [x] **CF0-009** Include a non-calendar fiscal-year fixture and a structurally different company/account naming fixture.
- [x] **CF0-010** Confirm there is no unresolved product or architecture decision; add an ADR before implementation if one appears.
- [x] **CF0-GATE** Exit gate: baseline commands pass, recovery proof exists, exact neutral fixture expectations cover A1–A20, and no open decision blocks implementation.

## Phase 1 — Classification domain and public contracts

**Trace:** PRD §§6, 10, 13; CF-001–CF-006, CF-018–CF-022, CF-029–CF-034; Product Spec §§3–6 and 9.

### Classification core

- [x] **CF1-001** Add exhaustive `CashRole` values: `CASH`, `CASH_EQUIVALENT`, `RESTRICTED_CASH`, `NOT_CASH`, and `REVIEW_REQUIRED`.
- [x] **CF1-002** Add exhaustive `CashFlowTreatment` values from the Product Specification.
- [x] **CF1-003** Define structural defaults and compatibility rules without account-name or category-name matching.
- [x] **CF1-004** Add pure validators for financial-account cash roles and financial/Chart-account treatments.
- [x] **CF1-005** Preserve imported/custom provenance while making unresolved classifications explicitly review-required.

### Public contracts

- [x] **CF1-006** Add immutable query, report, section, row, status, warning, contribution, disclosure, and reconciliation contracts.
- [x] **CF1-007** Add stable semantic row IDs, immutable report IDs, and database revision IDs independent of labels.
- [x] **CF1-008** Add classification preview/save/review and Chart import/export contracts.
- [x] **CF1-009** Add exact detail-key contracts for every report row and supplemental disclosure.
- [x] **CF1-010** Add typed invalid-query, classification, stale-revision, reconciliation, export, and print failures.
- [x] **CF1-011** Extend `AccountingApplication` and feature-facade state without leaking SQL, repository, Electron, workbook, or filesystem types.
- [x] **CF1-012** Test exhaustive mappings, invalid combinations, immutability, stable IDs, integer money, and dependency boundaries.
- [x] **CF1-GATE** Exit gate: domain mappings and application contracts compile, are exhaustive, and pass focused boundary tests.

## Phase 2 — Schema 7, persistence, and recovery

**Trace:** PRD CF-004–CF-006, CF-019, CF-022, CF-029–CF-034, A19–A20; Product Spec §§7–8, 15, 17, and 18.2.

### Schema and migration

- [x] **CF2-001** Add schema-7 cash-role and Cash Flow treatment storage defined by the Product Specification.
- [x] **CF2-002** Add classification provenance, review state, audit fields, and report-query indexes.
- [x] **CF2-003** Migrate financial accounts and Chart accounts from structural Account Type/detail/role metadata only.
- [x] **CF2-004** Mark ambiguous records `REVIEW_REQUIRED` rather than guessing.
- [x] **CF2-005** Preserve all IDs, hierarchy, transactions, splits, transfers, rules, opening data, archive/lock state, and audit history.
- [x] **CF2-006** Validate record counts, foreign keys, cycles, enum values, and classification compatibility in one migration transaction.
- [x] **CF2-007** Record correlated migration audit events and retain original classification provenance.

### Persistence and recovery

- [ ] **CF2-008** Implement classification repository mappings, atomic batch updates, and revision increments.
- [x] **CF2-009** Extend report snapshots with cash roles, treatments, opening balances, transfers, splits, hierarchy, state, and one consistent revision.
- [x] **CF2-010** Update the shared current-schema constant to 7 only after the migration is registered.
- [ ] **CF2-011** Update backup, restore, portable export, Electron validation, temporary databases, and smoke fixtures through the shared schema constant.
- [ ] **CF2-012** Test schema-6-to-7 migration, idempotent reopen, corrupt migration rollback, backup/restore, relocation, and future-schema rejection.
- [x] **CF2-013** Prove exact pre/post ledger and completed-report totals remain unchanged except for newly derived Cash Flow reporting.
- [ ] **CF2-GATE** Exit gate: schema-6 data safely reopens as schema 7, recovery paths pass, and no existing ledger or statement value drifts.

## Phase 3 — Classification services, exchange, and review UI

**Trace:** PRD §§10–11; CF-004–CF-006, CF-019, CF-021–CF-022, CF-030; Product Spec §§5–7, 12–13, and 15.

- [x] **CF3-001** Implement classification catalog and current-state read operations.
- [x] **CF3-002** Implement transactional, audited, optimistic-concurrency classification saves.
- [x] **CF3-003** Return impacted reports/accounts and invalidate affected cached results after save.
- [x] **CF3-004** Implement a review queue for missing, ambiguous, archived, or structurally incompatible classifications.
- [x] **CF3-005** Extend Chart of Accounts export with stable IDs, cash roles/treatments, review state, and provenance fields.
- [x] **CF3-006** Extend Chart of Accounts import preview with ID-first resolution, unique normalized-path fallback, and row-level issues.
- [x] **CF3-007** Commit valid imports atomically only after explicit confirmation; reject ambiguous or missing mappings without mutation.
- [x] **CF3-008** Add cash-role and treatment controls to the appropriate financial/Chart account editors.
- [x] **CF3-009** Build the classification review workflow with reason, suggested structural default, current value, save/cancel, and accessible controls.
- [x] **CF3-010** Show classification warnings and review entry points without blocking unrelated accounting work.
- [x] **CF3-011** Test save conflicts, invalid combinations, import preview/commit rollback, archived accounts, generic names, keyboard operation, composite-role selection, period-specific impact, and immediate refresh.
- [x] **CF3-GATE** Exit gate: classifications can be reviewed, edited, exchanged, recovered, and audited without name-based assumptions or partial writes.

## Phase 4 — Cash balances and indirect Operating activities

**Trace:** PRD §§6–7; CF-001–CF-003, CF-007, CF-009–CF-011, CF-016–CF-018, CF-033–CF-034; A1–A5, A7, A13, A15–A17; Product Spec §§8–10.6.

- [ ] **CF4-001** Normalize inclusive period queries and fiscal presets independently from other workspaces.
- [ ] **CF4-002** Build one immutable report snapshot and exclude Pending and Excluded activity everywhere.
- [ ] **CF4-003** Calculate Beginning Cash as of the day before `startDate` and Ending Cash as of `endDate`.
- [ ] **CF4-004** Separate unrestricted cash/cash equivalents from restricted cash according to explicit roles.
- [ ] **CF4-005** Reuse unadjusted P/L Net Profit for the exact period and same database revision.
- [ ] **CF4-006** Reverse classified noncash and reclassification P/L contributions once in Operating activities.
- [ ] **CF4-007** Calculate operating-asset changes as Opening minus Ending balance.
- [ ] **CF4-008** Calculate operating-liability changes as Ending minus Opening balance.
- [ ] **CF4-009** Build deterministic Operating row hierarchy, sign rules, zero handling, subtotals, and Net Cash from Operating Activities.
- [ ] **CF4-010** Test cash sales/expenses, receivables, inventory/payables, depreciation, opening balances, empty books, fiscal years, and state exclusion.
- [ ] **CF4-GATE** Exit gate: indirect Operating totals and cash balances match exact A1–A5, A7, A13, and A15–A17 fixture expectations.

## Phase 5 — Investing, Financing, transfers, and disclosures

**Trace:** PRD §§6.4 and 7.5–7.10; CF-008, CF-012–CF-015, CF-017–CF-019; A6, A8–A12; Product Spec §§10.7–10.10.

- [ ] **CF5-001** Calculate Investing rows from actual cash-side transactions and supported transfers.
- [ ] **CF5-002** Calculate Financing rows from actual cash-side transactions and supported transfers.
- [ ] **CF5-003** Allocate split debt payments among principal, interest, and other posted accounts without inference from descriptions.
- [ ] **CF5-004** Present owner contributions and distributions in Financing without changing Net Profit.
- [ ] **CF5-005** Eliminate confirmed cash-to-cash transfers from all activity sections and Net Change.
- [ ] **CF5-006** Handle transfers between unrestricted and restricted cash without double counting and expose the required presentation/warning.
- [ ] **CF5-007** Identify supported noncash investing/financing events, exclude them from cash totals, and disclose them separately.
- [ ] **CF5-008** Handle in-period opening-balance events per the explicit opening-balance source/treatment rules.
- [ ] **CF5-009** Build deterministic Investing, Financing, and supplemental-disclosure hierarchies and subtotals.
- [ ] **CF5-010** Test fixed assets, debt, mixed payments, equity, transfers, noncash acquisitions, restricted cash, and opening events.
- [ ] **CF5-GATE** Exit gate: exact A6 and A8–A13 expectations pass with no duplicated cash or inferred accounting treatment.

## Phase 6 — Reconciliation, warnings, detail, revision, and cache

**Trace:** PRD §§7.11, 9, and 11; CF-017–CF-020, CF-028–CF-030, CF-034–CF-035; A14, A19; Product Spec §§10.11–12 and 15.

- [ ] **CF6-001** Calculate Net Change, Calculated Ending Cash, Balance Sheet Ending Cash, and Difference in integer minor units.
- [ ] **CF6-002** Assign Complete only when Difference is zero and no material unclassified cash activity remains.
- [ ] **CF6-003** Emit deterministic typed warnings for review-required, archived, unclassified, transfer, restricted-cash, opening-balance, stale, and reconciliation conditions.
- [ ] **CF6-004** Retain nonzero archived/review-required rows or warning contributions rather than silently dropping them.
- [ ] **CF6-005** Implement exact row-level detail against immutable report ID and database revision.
- [ ] **CF6-006** Make detail contributions sum exactly to their selected row, including balance-change and transfer explanations.
- [ ] **CF6-007** Reject stale detail/export/print requests after relevant mutation.
- [ ] **CF6-008** Cache by normalized query plus database revision and invalidate after every specified report-affecting mutation.
- [ ] **CF6-009** Verify historical reports remain stable until the books or classifications change.
- [ ] **CF6-010** Test warning order, stale revision, reconciliation failure, cache invalidation, and exact detail sums.
- [ ] **CF6-GATE** Exit gate: every visible amount is explainable, stale reads fail clearly, cache behavior is correct, and status cannot overstate completeness.

## Phase 7 — Statement of Cash Flows workspace

**Trace:** PRD §§8–11; CF-017–CF-024, CF-028, CF-035; Product Spec §13.

- [ ] **CF7-001** Add Statement of Cash Flows to primary navigation without changing other workspace state.
- [ ] **CF7-002** Add current/previous month, current quarter, YTD, fiscal year, prior fiscal year, and Custom controls.
- [ ] **CF7-003** Keep Cash Flow dates and presets independent from P/L, Balance Sheet, and Transactions filters.
- [ ] **CF7-004** Render company identity, period, accounting basis, method, status, and local-record disclaimer.
- [ ] **CF7-005** Render Operating, Investing, Financing, supplemental disclosure, and reconciliation sections from semantic rows.
- [ ] **CF7-006** Provide deterministic expand/collapse and visible zero-row behavior without altering report values.
- [ ] **CF7-007** Open exact drill-down from every eligible amount and preserve report revision context.
- [ ] **CF7-008** Display warnings with direct classification-review navigation where actionable.
- [ ] **CF7-009** Provide loading, empty, invalid-period, incomplete, error, and stale-result states.
- [ ] **CF7-010** Meet keyboard, focus, accessible-name, reading-order, contrast, and screen-reader requirements.
- [ ] **CF7-011** Add responsive behavior for supported desktop window sizes without hiding reconciliation or status.
- [ ] **CF7-GATE** Exit gate: the complete workspace is usable by keyboard, independently filtered, exact, explainable, and honest about incomplete data.

## Phase 8 — CSV, XLSX, print preview, and PDF parity

**Trace:** PRD §12; CF-025–CF-029, CF-031, CF-034–CF-035; A18; Product Spec §14.

- [ ] **CF8-001** Generate Summary CSV from the supplied immutable report without recalculation.
- [ ] **CF8-002** Include metadata, status, warnings, semantic row IDs, sections, amounts, reconciliation, and disclaimer in deterministic CSV order.
- [ ] **CF8-003** Generate the three-sheet XLSX: Statement, Detail, and Classifications.
- [ ] **CF8-004** Make XLSX detail sum to exported statement rows and include exact classification/review context.
- [ ] **CF8-005** Apply safe workbook cell typing, integer-to-decimal conversion only at presentation, and spreadsheet-injection protection.
- [ ] **CF8-006** Build print/PDF preview from the same immutable report with repeated headers, page-safe sections, warnings, status, and reconciliation.
- [ ] **CF8-007** Wire Command-P to preview and require explicit user action before system print/save-to-PDF.
- [ ] **CF8-008** Enforce stale-revision and local-only rules for all outputs.
- [ ] **CF8-009** Test exact screen/CSV/XLSX/print parity, deterministic regeneration, filenames, escaping, and no automatic printing.
- [ ] **CF8-GATE** Exit gate: A18 passes and every output presents the same report revision, values, warnings, status, and disclaimer.

## Phase 9 — Acceptance and release proof

**Trace:** PRD §§14–16 and A1–A20; Product Spec §§16–20.

- [ ] **CF9-001** Run every A1–A20 acceptance scenario against neutral deterministic fixtures.
- [ ] **CF9-002** Reconcile every valid fixture to zero Difference and every incomplete fixture to the expected warning/status.
- [ ] **CF9-003** Prove all report, detail, export, and print money stays in integer minor units until presentation.
- [ ] **CF9-004** Meet the Product Specification performance budget on the required representative ledger.
- [ ] **CF9-005** Prove deterministic row, warning, detail, CSV, XLSX, and print ordering across repeated runs.
- [ ] **CF9-006** Run privacy/public-data scans and prove fixtures contain no personal, prior-customer, or live financial data.
- [ ] **CF9-007** Run full browser/unit, production build, desktop-host, backup/restore, and isolated Electron smoke suites.
- [ ] **CF9-008** Re-run P/L, Balance Sheet, Transactions, Rules, Chart of Accounts, Backups, and desktop-branding regressions.
- [ ] **CF9-009** Verify no report operation mutates the database and no live database/profile is touched by tests.
- [ ] **CF9-010** Update README, application/product documentation, feature status, and public sample guidance only after all release evidence passes.
- [ ] **CF9-011** Record final commands, counts, timings, acceptance results, and known limitations in the Evidence log.
- [ ] **CF9-GATE** Exit gate: A1–A20 and all quality/regression checks pass, documentation says implemented, and release evidence is recorded.

## Evidence log

| Date | Slice or gate | Evidence | Result |
| --- | --- | --- | --- |
| 2026-08-25 | Documentation setup | PRD, Product Specification, Task Tracker, and Implementation Slices created and cross-referenced | Complete |
| 2026-08-25 | `CF-SLICE-01-BASELINE-ORACLE` | Fixture oracle, 181 browser/unit tests, production build, all 8 desktop-host tests, and isolated Electron smoke | Complete |
| 2026-08-25 | `CF-SLICE-02-CLASSIFICATION-CORE` | Corrected Loan payable to Financing, routed custom and ambiguous details to Review required, changed ambiguous financial cash role to Review required, separated default seeding from preservation/reclassification, and added exhaustive taxonomy/failure-path tests; `npm run test:ci` (192 browser/unit tests plus boundaries and fixture oracles) and `npm run build` passed | Complete |
| 2026-08-25 | `CF-SLICE-03-PUBLIC-CONTRACTS` | Added immutable query/report/detail/classification contracts, permissive raw exchange preview input with strict normalized output, role-valid catalog compatibility/defaults, classification exchange facade methods, Cash Flow feature facade state, dedicated deferred-operation failures, and exhaustive boundary tests; `npm run test:ci` (203 browser/unit tests plus boundaries and fixture oracles) and `npm run build` passed | Complete |
| 2026-08-25 | `CF-SLICE-04-SCHEMA-7-MIGRATION` | Added atomic schema-6-to-7 migration with one-to-one financial/Chart classification tables, checked enums, provenance/review/rationale/timestamps, classification indexes, structural-only defaults, correlated audit events, FK/integrity/cycle/count/compatibility validation, strict schema-6 table/column/index/version/profile preflight, role/type compatibility checks, canonical ISO-UTC timestamp validation, true legacy-review audit rationale, full taxonomy and malformed-source/constraint-rollback acceptance tests, and exact pre/post ledger/P&L/Balance Sheet totals; `npm run test:ci` (217 browser/unit tests plus boundaries and fixture oracles), `npm run build`, and `npm run test:desktop-host` (8 tests) passed | Complete |
| 2026-08-25 | `CF-SLICE-05-PERSISTENCE-RECOVERY` | Correction pass completed: full schema-7 object/relationship/constraint validation, safe configured and unconfigured pre-migration backups with post-write revalidation, reentrant SQLite/in-memory atomic Chart replacement, strict current/future/mismatched portable-schema validation, and complete malformed-classification plus preservation coverage. `npm run test:ci` (238 browser/unit tests plus boundaries and fixture oracles), `npm run build` (no budget warnings), `npm run test:desktop-host` (13 tests), isolated `npm run desktop:smoke`, app/spec/desktop type checks, and `git diff --check` passed. CF2-008/011/012 and CF2-GATE remain open pending independent re-review. | Ready for re-review; in progress |
| 2026-08-25 | `CF-SLICE-06-CLASSIFICATION-SERVICE` | Added validated classification service wiring, stable-ID-authoritative exchange, explicit review reasons/current-vs-suggested state, archived indicators, save impact reporting, one-pass review aggregation, and Chart workbook preview/confirmed atomic commit with Cash Flow classification round-trip; type-check, production build, boundaries, fixture oracles, desktop-host (8 tests), and `git diff --check` passed. ChromeHeadless could not launch in this environment, so browser revalidation remains pending | Review fixes implemented; Phase 3 UI and gate remain |
| 2026-08-25 | `CF-SLICE-07-CLASSIFICATION-UI` | Review corrections isolate the panel component, include complete period-aware classifications, preserve optimistic concurrency tokens, use the selected query for impact, trap keyboard focus, distinguish role/ID namespaces, and keep archived editors read-only. `npm run test:ci` passed 232 browser/unit tests plus boundaries and fixture oracles; production build, app/spec type checks, desktop-host (8 tests), and `git diff --check` passed | Complete |
| 2026-08-25 | Slice 1 pre-change baseline | `test:ci`: 181 passed; production build passed; `test:desktop-host`: 8 passed including validated restore/safety backup; isolated `desktop:smoke` passed | Complete |
| 2026-08-25 | `CF-SLICE-01-BASELINE-ORACLE` | Independent validator passed for 2 neutral companies, A1–A20, schema-6 counts, exact integer totals/source Balance Sheets/cash composition/detail/warnings, 2025–2026 fiscal coverage, migration targets, and privacy terms | Complete |
| 2026-08-25 | Slice 1 post-change verification | `test:ci`: Cash Flow oracle plus 181 browser/unit tests passed; production build passed; `test:desktop-host`: 8 passed; isolated `desktop:smoke` passed | Complete |
