# TallyStick Balance Sheet Task Tracker

*Updatable implementation checklist · Created August 16, 2026*

## Source documents and authority

1. [Balance Sheet PRD](Balance%20Sheet%20PRD.md) Draft 0.2 controls product intent and acceptance.
2. [Balance Sheet Product Specification](Balance%20Sheet%20PRODUCT_SPEC.md) Draft 0.1 controls implementation contracts and calculations.
3. [Technical Architecture](Quicken%20Replacement%20Technical%20Architecture.md) controls system boundaries.
4. [Application Product Specification](PRODUCT_SPEC.md) controls existing application-wide behavior outside this feature.
5. This tracker controls implementation order and records verified progress; it does not override the documents above.

Execution is divided into token-conscious, independently testable units in the [Balance Sheet Implementation Slices](Balance%20Sheet%20IMPLEMENTATION%20SLICES.md). Naming a slice from that catalog is sufficient to authorize only that slice's implementation and verification; this tracker remains the source of truth for completion status.

## Resume status

| Field | Current value |
| --- | --- |
| Overall status | Slices 7–12 complete; fiscal Current and Retained Earnings share the unadjusted P/L identity |
| Current phase | Phase 4 — Balance Sheet engine, hierarchy, warnings, and drill-down |
| Next task | `BS-SLICE-13-OPENING-BALANCES` — eligible openings and derived Opening Balance Equity |
| Current branch | `main` working tree |
| Development command | `cd site && npm start` |
| Production build | `cd site && npm run build` |
| Full browser/unit suite | `cd site && npm run test:ci` |
| Desktop-host suite | `cd site && npm run test:desktop-host` |
| Electron smoke | `cd site && npm run desktop:smoke` |
| Last verified Balance Sheet test | Focused Slice 12/P&L suite: 42 ChromeHeadless tests passed, including non-calendar fiscal earnings and the shared P/L reconciliation identity |
| Last tracker update | August 21, 2026 |
| Known blocker | None |

## How to update this tracker

- Work from the first unchecked task in the current phase unless a dependency is stated. When a named implementation slice is invoked, the catalog's declared order and dependencies control the next task across checkbox subsections.
- Mark a task `[x]` only after its behavior and applicable tests pass.
- Do not mark a phase gate complete merely because a DTO, migration, service method, static UI, or build exists.
- A report task is complete only when displayed values and applicable drill-down/export values reconcile.
- When pausing, update Resume status with the next task, branch, last passing command, date, and blocker.
- Add concise command/result evidence to the Evidence log for migrations, calculation fixtures, phase gates, and release acceptance.
- If scope changes, update the PRD first, then the product specification, then this tracker.
- Preserve unrelated working-tree changes, including the existing `.DS_Store` modification.

## Locked implementation guardrails

- Angular components call the typed in-process `AccountingApplication`; there is no HTTP API.
- SQLite is authoritative. Electron owns only the native database/filesystem/print boundary.
- Money uses signed integer minor units; reports never calculate with binary floating point.
- Business dates do not receive time-zone conversion.
- Company and account behavior never depends on a particular company, institution, marketplace, account ID, or category name.
- Financial-source account classification and import eligibility remain separate concepts.
- Screen, detail, CSV, XLSX, print preview, and PDF consume one immutable Balance Sheet result.
- Report viewing and export never mutate the books or store editable report totals.
- Pending and Excluded activity never affects the Balance Sheet.
- Current Earnings always comes from the existing unadjusted P/L logic for the same fiscal period.
- Nonzero archived, migrated, or unclassified balances remain visible.
- The shared schema-version constant must be updated consistently across Angular persistence, backups, restore validation, desktop-host tests, and smoke fixtures.
- No task is complete until its tests run; no release gate is complete until browser tests and isolated Electron smoke pass.

## Phase status

| Phase | Outcome | Status |
| --- | --- | --- |
| 0 | Accepted documentation and verified implementation baseline | Complete |
| 1 | Shared company, account-taxonomy, and Balance Sheet contracts | Complete |
| 2 | Schema 6, migrations, repositories, and backup compatibility | Complete |
| 3 | Company Settings and generic account management | In progress; downstream cross-output acceptance remains |
| 4 | Balance Sheet calculation, hierarchy, warnings, and drill-down | In progress |
| 5 | Balance Sheet workspace and interaction | Not started |
| 6 | CSV, XLSX, print preview, and PDF parity | Not started |
| 7 | Acceptance scenarios, performance, regression, and release proof | Not started |

## Phase 0 — Baseline and implementation preflight

**Trace:** PRD §§1–16; Product Spec §§1–2, 17–19.

- [x] **BS0-001** Create the Balance Sheet PRD with BS-001 through BS-030 and A1 through A19.
- [x] **BS0-002** Create the implementation-ready Balance Sheet Product Specification with contracts, calculations, schema proposal, outputs, and test gates.
- [x] **BS0-003** Create this resumable, phase-based checkbox tracker from the PRD and Product Specification.
- [x] **BS0-004** Run and record the pre-change `npm run test:ci`, production build, desktop-host suite, and isolated Electron smoke baseline.
- [x] **BS0-005** Record the current schema-5 database fixture counts and a pre-migration backup/restore proof for later comparison.
- [x] **BS0-006** Add at least two neutral company fixtures with different names, addresses, fiscal-year starts, institutions, and account names.
- [x] **BS0-007** Add deterministic fixture expectations for A1 through A19, including exact minor-unit totals and detail contributions.
- [x] **BS0-008** Confirm the implementation slice introduces no unresolved product or architecture decision; document an ADR before coding if one appears.
- [x] **BS0-GATE** Exit gate: current tests/build/smoke pass, neutral fixtures and exact expectations exist, and no open decision blocks implementation.

## Phase 1 — Shared contracts and domain catalog

**Trace:** PRD BS-001, BS-006, BS-010–BS-013, BS-019, BS-021–BS-030; Product Spec §§3–6, 8, 10–11.

### Company and taxonomy contracts

- [x] **BS1-001** Add `CompanyProfile`, masked report identity, address/contact, and optimistic update command contracts.
- [x] **BS1-002** Add exhaustive `ReportingGroup`, `AccountingAccountType`, `BalanceSheetSection`, `AccountRole`, import-capability, and classification-status types without colliding with the legacy financial `AccountType`.
- [x] **BS1-003** Create one grouped Account Type catalog with natural balance, reporting placement, compatible detail types, valid parents, opening-balance support, and default import capability.
- [x] **BS1-004** Include every PRD-required Bank and Credit Card detail type and all remaining standard detail-type catalogs.
- [x] **BS1-005** Define preservation behavior for imported/custom legacy detail types and `REVIEW_REQUIRED` classifications.
- [x] **BS1-006** Add account-use, classification, placement-preview, and reference-validation command/result contracts.

### Balance Sheet contracts

- [x] **BS1-007** Add `BalanceSheetQuery`, normalized default query, immutable report, row, warning, contribution, and detail-key contracts.
- [x] **BS1-008** Use `bigint`/existing `Money` values for all Balance Sheet amounts and exclude numeric floating-point money fields.
- [x] **BS1-009** Define stable semantic row identities independent of labels and stable report/database revision identities for detail/export requests.
- [x] **BS1-010** Extend `AccountingApplication` with Company Settings, catalog, placement-preview, report, detail, export, and print-preview operations.
- [x] **BS1-011** Add typed company, account, report, stale-revision, reconciliation, and export failure codes.
- [x] **BS1-012** Extend feature facade state without exposing repositories, SQL, Electron, or filesystem types to Angular components.

### Contract verification

- [x] **BS1-013** Test exhaustive Account Type-to-reporting-group mapping and unknown-type failure.
- [x] **BS1-014** Test all Account Type/Detail Type, parent, role, import-capability, and opening-balance-mode validations.
- [x] **BS1-015** Test immutable report contracts, semantic row keys, stale report revision rejection, and integer money types.
- [x] **BS1-016** Run dependency-boundary checks proving UI and desktop-host boundaries remain intact.
- [x] **BS1-GATE** Exit gate: every new contract compiles, all catalog/contract tests pass, and no presentation or persistence type leaks across the application boundary.

## Phase 2 — Schema 6, migration, repositories, and recovery compatibility

**Trace:** PRD §§5.1–5.3, BS-021–BS-030, A16, A19; Product Spec §§5–7, 16, 17.2.

### Schema and persistence

- [x] **BS2-001** Add schema-6 `company_profile` storage with required legal/display names and optional DBA, entity, address, contact, website, and local tax identifier fields.
- [x] **BS2-002** Add financial-account `account_type`, `classification_status`, `import_enabled`, supported-source-kinds, and `opening_balance_source` fields.
- [x] **BS2-003** Keep the legacy financial `type` column as migration provenance while making generic `account_type` authoritative for new behavior.
- [x] **BS2-004** Add report-query indexes for transaction state/date/account, transfer date/account, split transaction/chart account, and chart hierarchy/display order.
- [x] **BS2-005** Implement company-profile repository mapping with full tax identifier excluded from normal reads.
- [x] **BS2-006** Extend financial and Chart account repository mappings for shared classification and preserved custom detail metadata.
- [x] **BS2-007** Add repository/query support for one consistent as-of report snapshot and database revision.

### Migration

- [x] **BS2-008** Seed company legal/display names from the existing company row without changing currency, fiscal year, accounting basis, or tax year.
- [x] **BS2-009** Migrate legacy Bank accounts to generic Bank classifications and retain their compatible detail types and import capability.
- [x] **BS2-010** Migrate legacy Credit Card accounts to generic Credit Card classifications and import capability.
- [x] **BS2-011** Migrate structurally identified marketplace/clearing Entity accounts to Other Current Assets without using account-name assumptions.
- [x] **BS2-012** Migrate ambiguous Entity accounts to review-required Other Current Asset/Clearing classifications and retain visible warnings.
- [x] **BS2-013** Preserve all stable IDs, parent links, transactions, splits, transfers, rules, mappings, opening data, lock/archive state, and audit history.
- [x] **BS2-014** Record correlated migration audit events and retain original type/detail provenance.
- [x] **BS2-015** Validate foreign keys, cycles, record counts, required profile fields, and classification compatibility before commit; roll back completely on failure.

### Recovery and migration verification

- [x] **BS2-016** Update the shared current-schema constant to 6 only after migrations are registered.
- [x] **BS2-017** Update backup, restore, portable-export, Electron validator, temporary database, and smoke-fixture schema acceptance through that shared constant.
- [x] **BS2-018** Test schema-5-to-6 migration, close/reopen, and idempotent subsequent startup.
- [x] **BS2-019** Test migration with generic names proving no customer, institution, marketplace, or special account-name dependency.
- [x] **BS2-020** Test preservation of all referenced records and exact pre/post ledger/report totals.
- [x] **BS2-021** Test corrupt/incompatible migration rollback and verified pre-migration recovery behavior.
- [x] **BS2-022** Test schema-6 backup, restore, relocation, future-schema rejection, and integrity checks.
- [x] **BS2-GATE** Exit gate: migration and recovery tests pass, schema-5 data reopens as schema 6 without ledger drift, and backup/restore accepts the new schema.

## Phase 3 — Company Settings and generic account management

**Trace:** PRD §§5.2–5.3, 7.1–7.2, BS-021–BS-030, A15–A19; Product Spec §§5–6, 12.5–12.6.

### Company Settings service and UI

- [x] **BS3-001** Implement `getCompanyProfile` returning a masked reusable profile.
- [x] **BS3-002** Implement transactional, audited, optimistic-concurrency `updateCompanyProfile` validation.
- [x] **BS3-003** Implement explicit tax-identifier reveal/edit without placing the full value in general app state, logs, or standard exports.
- [x] **BS3-004** Build the focused Company Settings editor with required-field validation, masking, save/cancel, and accessible controls.
- [x] **BS3-005** Add reusable Edit company information access from the Balance Sheet header and an application settings entry point.
- [x] **BS3-006** Drive application header identity from configured display name while retaining TallyStick product branding separately.
- [ ] **BS3-007** Drive P/L, Balance Sheet, CSV/XLSX metadata, print/PDF, and accountant-package identity from Company Settings.
- [x] **BS3-008** Omit blank optional company fields cleanly and exclude the tax identifier from standard outputs.

### Generic account service and editor

- [x] **BS3-009** Implement the grouped shared Account Type/Detail Type catalog service.
- [x] **BS3-010** Add user-facing Account use choices for Track transactions directly and Category only, routing saves to the existing financial or Chart store.
- [x] **BS3-011** Restrict financial-source roles to supported Asset/Liability types and keep Equity/Income/Expense account creation in the Chart role.
- [x] **BS3-012** Separate import eligibility and supported source kinds from accounting Account Type.
- [x] **BS3-013** Preserve the role of existing accounts during edit and reject unsupported cross-store conversion clearly.
- [x] **BS3-014** Filter Detail Type and compatible parent choices immediately when Account Type changes.
- [x] **BS3-015** Preserve and label valid imported/custom detail types instead of silently replacing them.
- [x] **BS3-016** Implement live Balance Sheet placement/path/current-balance preview for Asset, Liability, and Equity accounts.
- [x] **BS3-017** Show Current Earnings behavior instead of a Balance Sheet line for Income, COGS, Expense, Other Income, and Other Expense accounts.
- [x] **BS3-018** Validate all transactions, splits, rules, tax settings, mappings, transfers, parent/children, lock state, and report effects before a type/detail/parent change.
- [x] **BS3-019** Display every blocking reference and preserve the stable account ID on all accepted edits.
- [x] **BS3-020** Enforce `DERIVED_EQUITY` versus `LEDGER_ACTIVITY` opening-balance mutual exclusion.

### Company/account verification

- [x] **BS3-021** Test company validation, masking, concurrency, audit history, migration values, and ledger non-mutation.
- [ ] **BS3-022** Test two neutral company identities throughout header, reports, exports, print, and accountant package.
- [x] **BS3-023** Test every standard Account Type/Detail Type and parent compatibility path.
- [x] **BS3-024** Test import capability independently from classification, including marketplace/clearing source accounts.
- [x] **BS3-025** Test placement previews, Current Earnings notices, reference rejection, role preservation, and stable IDs.
- [x] **BS3-026** Add browser coverage for company and account editors, including keyboard use and error states.
- [ ] **BS3-GATE** Exit gate: Company Settings drive required product identity, the complete generic taxonomy is editable, and account/migration acceptance A15–A19 passes outside the final full-suite run.

## Phase 4 — Balance Sheet engine, hierarchy, warnings, and drill-down

**Trace:** PRD §§6, 8–9, BS-001–BS-013, BS-017–BS-020, A1–A12, A14; Product Spec §§8–11, 14–15.

### Query and calculations

- [x] **BS4-001** Implement query normalization and active-tax-year fiscal-period-end default for calendar and non-calendar fiscal years.
- [x] **BS4-002** Implement Today, previous-month-end, current-month-end, and fiscal-year-end date calculations, including leap years.
- [x] **BS4-003** Read one consistent database revision/snapshot for report generation.
- [x] **BS4-004** Include Posted activity and confirmed Matched Transfer source-account effects on or before the as-of date.
- [x] **BS4-005** Exclude Pending, Excluded, and post-as-of activity from every report amount.
- [ ] **BS4-006** Calculate Asset financial-source balances from applicable opening balance plus signed Posted and Matched activity. *(Posted/Matched activity complete in Slice 10; opening component is intentionally deferred to Slice 13.)*
- [x] **BS4-007** Calculate Liability financial-source balances with the correct natural-sign presentation.
- [x] **BS4-008** Calculate Asset Chart contributions as the inverse of stored split signs.
- [x] **BS4-009** Calculate Liability and Equity Chart contributions using their natural credit-balance sign.
- [x] **BS4-010** Derive Current Earnings from the existing unadjusted P/L for the exact fiscal-year start through as-of date.
- [x] **BS4-011** Derive prior-period Retained Earnings from unadjusted P/L activity before the current fiscal period.
- [ ] **BS4-012** Derive Opening Balance Equity only from eligible stored opening balances and exclude ledger-activity opening mode.
- [x] **BS4-013** Keep Schedule C and P/L report-only exclusions out of Current and Retained Earnings.

### Hierarchy and totals

- [x] **BS4-014** Combine financial-source and Chart balances into Assets, Liabilities, and Equity without name-based merging or double counting.
- [ ] **BS4-015** Order Account Types, parents, children, and direct postings deterministically from the catalog and Chart display order.
- [ ] **BS4-016** Calculate each parent subtotal from direct parent activity plus descendants exactly once.
- [ ] **BS4-017** Hide zero-balance leaves by default while preserving structural parents and unchanged subtotals.
- [ ] **BS4-018** Include nonzero archived and review-required/unclassified accounts visibly.
- [x] **BS4-019** Calculate Total Assets, Total Liabilities, Total Equity, Total Liabilities and Equity, and exact minor-unit Difference.
- [x] **BS4-020** Return a valid empty report with zero totals and zero Difference.

### Warnings, detail, and refresh

- [ ] **BS4-021** Implement typed warnings for unclassified balances, nonzero Difference, future opening dates, archived balances, unsupported currency, hierarchy errors, classification errors, and opening-mode conflicts.
- [ ] **BS4-022** Implement financial-source drill-down with opening balance, Posted activity, Matched transfers, provenance, and signed running balance.
- [ ] **BS4-023** Implement Chart-account drill-down with every contributing Posted split and source transaction metadata.
- [ ] **BS4-024** Reuse exact-period P/L Detail for Current Earnings and prior-period P/L Detail for derived Retained Earnings.
- [ ] **BS4-025** Implement Opening Balance Equity detail from contributing account opening records.
- [ ] **BS4-026** Implement subtotal/detail union with stable ordering and no duplicate contribution.
- [ ] **BS4-027** Reject detail display when integer contribution sum does not equal the selected row.
- [ ] **BS4-028** Implement Difference explanation linking contributing account or derived-equity issues.
- [ ] **BS4-029** Invalidate cached reports after every specified ledger, account, opening-balance, company-fiscal-setting, restore, or relocation mutation.
- [ ] **BS4-030** Keep report cache stable across unrelated workspace and Transaction-filter changes.

### Engine verification

- [ ] **BS4-031** Unit-test every source-account and split natural-sign path, including contra/negative balances.
- [ ] **BS4-032** Unit-test fiscal dates, state/date exclusions, opening dates/modes, transfers, hierarchy, zero hiding, archived rows, and warnings.
- [ ] **BS4-033** Prove Current Earnings and Retained Earnings parity with the existing P/L service across neutral fixtures.
- [ ] **BS4-034** Prove every account/subtotal/synthetic total equals the exact sum of its detail contributions.
- [ ] **BS4-035** Prove report generation and detail lookup do not mutate any persisted record.
- [ ] **BS4-GATE** Exit gate: A1–A12 and A14 calculation assertions pass with exact detail reconciliation and `$0.00` Difference for valid fixtures.

## Phase 5 — Balance Sheet workspace and interaction

**Trace:** PRD §§7–9, BS-009–BS-013, BS-016–BS-017; Product Spec §12.

- [ ] **BS5-001** Add Balance Sheet with a Bootstrap Icon to the left primary navigation.
- [ ] **BS5-002** Make Balance Sheet a mutually exclusive workspace without changing Transaction or P/L filters.
- [ ] **BS5-003** Build the report header with configured company name, accounting basis, as-of date, four headline totals, and Difference.
- [ ] **BS5-004** Add as-of date input and Today, previous month end, current month end, and fiscal year end shortcuts.
- [ ] **BS5-005** Persist Balance Sheet filters independently from other workspace filters.
- [ ] **BS5-006** Render Assets, Liabilities, Equity, hierarchy, derived lines, totals, and Difference from returned rows only.
- [ ] **BS5-007** Match P/L label size, indentation, tabular/prominent-decimal amount style, and negative/zero formatting.
- [ ] **BS5-008** Bold an amount exactly when its row label is bold; keep detail labels and amounts unbolded.
- [ ] **BS5-009** Add show/hide zero-balance control without changing totals.
- [ ] **BS5-010** Display Archived and Unclassified indicators with text, not color alone.
- [ ] **BS5-011** Display actionable warning summaries and prominent nonzero Difference.
- [ ] **BS5-012** Make every amount keyboard-accessible and open its exact detail view with descriptive accessible labeling.
- [ ] **BS5-013** Render financial, Chart, P/L-derived, opening-balance, subtotal, and Difference detail appropriately.
- [ ] **BS5-014** Render the valid empty report, loading state, stale-revision refresh, and actionable failure state without stale data.
- [ ] **BS5-015** Add component tests for navigation, filters, shortcuts, hierarchy, typography, zero toggle, warnings, detail, empty, loading, and failure states.
- [ ] **BS5-016** Add browser tests for keyboard navigation, screen-reader names, focus return, and report/account/company side panels.
- [ ] **BS5-GATE** Exit gate: the visible workspace satisfies BS-009–BS-013 and BS-016–BS-017, and every rendered amount opens reconciling detail.

## Phase 6 — CSV, XLSX, print preview, and PDF parity

**Trace:** PRD §10, BS-014–BS-016, BS-018–BS-020, A13; Product Spec §13, 17.5.

- [ ] **BS6-001** Route screen and all output formats through the same immutable report identity/result.
- [ ] **BS6-002** Implement UTF-8 Summary CSV with company/report metadata, hierarchy fields, stable account IDs, flags, amounts, final totals, and Difference.
- [ ] **BS6-003** Implement XLSX Balance Sheet sheet with screen order, indentation, matching bold styles, numeric currency cells, warnings, and totals.
- [ ] **BS6-004** Implement XLSX Balance Sheet Detail sheet with every contribution and row/detail key needed to reproduce the statement.
- [ ] **BS6-005** Reopen and verify generated XLSX structure, formulas/values, numeric types, styles, and totals before reporting success.
- [ ] **BS6-006** Build print-preview rendering from the same report rows, metadata, warnings, and Difference.
- [ ] **BS6-007** Open preview without automatically invoking the system print dialog.
- [ ] **BS6-008** Title preview `<configured company display name> — Balance Sheet` and add File > Print with Command-P.
- [ ] **BS6-009** Repeat headings across print pages and avoid separating a subtotal from its immediately preceding group when practical.
- [ ] **BS6-010** Exclude the tax identifier from CSV, XLSX, print, PDF, logs, and error output.
- [ ] **BS6-011** Use safe temporary writes, atomic finalization, cancellation cleanup, and no success result for a partial export.
- [ ] **BS6-012** Add parity tests proving every screen row and total equals CSV, XLSX, detail, print-preview, and PDF model values.
- [ ] **BS6-013** Test special characters, neutral company identities, zero/negative values, warnings, archived/unclassified rows, and multi-page output.
- [ ] **BS6-GATE** Exit gate: A13 passes, generated workbooks reopen, preview requires an explicit print action, and all output amounts reconcile exactly.

## Phase 7 — Acceptance, performance, regression, and release proof

**Trace:** PRD A1–A19, §§13–14; Product Spec §§15–19.

### Acceptance scenarios

- [ ] **BS7-A01** A1 Income received: Bank and Current Earnings increase equally; Difference is zero.
- [ ] **BS7-A02** A2 Expense paid from bank: Bank and Current Earnings decrease equally; Difference is zero.
- [ ] **BS7-A03** A3 Credit-card expense: liability increases and Current Earnings decreases; Difference is zero.
- [ ] **BS7-A04** A4 Fixed-asset purchase: Bank decreases, Fixed Assets increase, and earnings do not change.
- [ ] **BS7-A05** A5 Loan proceeds: Bank and Liabilities increase equally without changing earnings.
- [ ] **BS7-A06** A6 Owner contribution/draw: Bank and Equity move together without changing Current Earnings.
- [ ] **BS7-A07** A7 Matched transfer: participating accounts change without changing earnings or net assets.
- [ ] **BS7-A08** A8 Opening balances: account openings and derived Opening Balance Equity reconcile exactly.
- [ ] **BS7-A09** A9 State exclusions: Pending/Excluded are absent and undo reverses Posted/Matched effects.
- [ ] **BS7-A10** A10 Hierarchy: direct-parent and child activity appears exactly once in subtotals.
- [ ] **BS7-A11** A11 Current Earnings: amount equals identical-period unadjusted P/L and ignores Schedule C settings.
- [ ] **BS7-A12** A12 Unclassified: nonzero migrated/unmapped balance stays visible with a warning.
- [ ] **BS7-A13** A13 Export parity: screen, CSV, XLSX, detail, print, and PDF totals match.
- [ ] **BS7-A14** A14 Historical stability: later activity does not change an earlier as-of report; archived balances remain.
- [ ] **BS7-A15** A15 Configurable identity: two neutral profiles appear correctly everywhere without prior-customer data.
- [ ] **BS7-A16** A16 Company migration: settings migrate/audit without changing ledger history or totals.
- [ ] **BS7-A17** A17 Bank details: all six required detail types persist and preview under Assets.
- [ ] **BS7-A18** A18 Full placement: every required account type maps correctly; P/L accounts flow through earnings.
- [ ] **BS7-A19** A19 Entity migration: IDs/history remain and ambiguous records stay reviewable without name-based classification.

### Quality and release commands

- [ ] **BS7-020** Verify deterministic row order, row keys, warnings, and totals for identical revision/query inputs.
- [ ] **BS7-021** Meet the under-500-ms report and under-300-ms drill-down targets on the specified 10,000/2,000-row fixtures.
- [ ] **BS7-022** Run `npm run test:ci` and record test counts and coverage.
- [ ] **BS7-023** Run the production Angular build with no new budget warning or TypeScript error.
- [ ] **BS7-024** Run `npm run test:desktop-host` and record schema-6 backup/restore results.
- [ ] **BS7-025** Run `npm run desktop:smoke` in an isolated temporary profile and verify navigation, Company Settings, account preview, report detail, CSV/XLSX, print preview, Command-P, warnings, totals, and Difference.
- [ ] **BS7-026** Verify the desktop smoke and exports do not read or mutate the live user database.
- [ ] **BS7-027** Verify report viewing, drill-down, export, print, failed generation, and cancelled export leave database bytes/records unchanged except permitted operational metadata.
- [ ] **BS7-028** Update the PRD/spec traceability, main application spec where superseded, implementation plan, handoff, README/user help, and this Resume status with final evidence.
- [ ] **BS7-GATE** Release gate: BS-001–BS-030 and A1–A19 pass; screen/detail/export/print reconcile; valid books have zero Difference; schema recovery and isolated Electron smoke pass; no implementation task remains unchecked.

## Evidence log

Add one concise row when a migration, calculation baseline, phase gate, or final command is verified.

| Date | Task/gate | Evidence |
| --- | --- | --- |
| 2026-08-16 | BS0-001–BS0-003 | Balance Sheet PRD Draft 0.2, Product Specification Draft 0.1, and this tracker created; implementation remains unstarted. |
| 2026-08-21 | BS0-004 | `npm run test:ci`: boundary check, fixture oracle, and 106 ChromeHeadless tests passed; coverage 78.67% statements, 62.65% branches, 88.21% functions, 86.39% lines. Production build passed; 7 desktop-host tests passed; isolated Electron smoke passed. |
| 2026-08-21 | BS0-005 | Schema-5 canonical counts recorded: 1 company, 6 financial accounts, 27 Chart accounts, 198 transactions, 146 splits, and 25 transfers. Desktop restore proof activated verified restored bytes, preserved the selected backup, and safety-backed up the prior active database. |
| 2026-08-21 | BS0-006–BS0-007 | Added 2 deliberately different fictional companies and a machine-validated A1–A19 oracle; every expected money row reconciles to integer detail contributions and canonical 2025/2026 books have zero Difference. |
| 2026-08-21 | BS0-008–BS0-GATE | No unresolved product or architecture decision found. All Phase 0 artifacts and required baseline commands passed; production Balance Sheet behavior remains intentionally unimplemented. |
| 2026-08-21 | BS1-002–BS1-006, BS1-013–BS1-014 | Added the exhaustive 15-type grouped catalog, shared legacy Chart catalog projection, custom-detail preservation, typed validation/contracts, and 10 focused taxonomy tests. `npm run test:ci` passed boundary and fixture checks plus all 116 ChromeHeadless tests; coverage 78.98% statements, 63.49% branches, 88.43% functions, and 86.70% lines. Production build and all 7 desktop-host tests also passed. |
| 2026-08-21 | BS1-001, BS1-007–BS1-012, BS1-015–BS1-GATE | Added immutable Company/Balance Sheet/detail/export contracts, bigint money, semantic branded identities, typed failures, `AccountingApplication` operations, and a contract-only feature facade. `npm run test:ci` passed strengthened production-facade/desktop boundaries, the fixture oracle, and all 126 ChromeHeadless tests; coverage 79.11% statements, 63.72% branches, 87.70% functions, and 86.51% lines. Production build and all 7 desktop-host tests passed. |
| 2026-08-21 | BS2-001–BS2-004, BS2-008–BS2-015, BS2-018–BS2-020 | Registered transactional schema-5-to-6 migration with Company Settings storage, financial classification, report indexes, structural legacy mapping, correlated provenance audit, integrity/count/cycle validation, exact ledger/report-input preservation, idempotent reopen, and complete rollback. `npm run test:ci` passed all 130 ChromeHeadless tests with 79.36% statements, 63.70% branches, 87.80% functions, and 86.90% lines; production build and all 7 desktop-host tests passed. Shared current-schema activation intentionally remains at 5 for Slice 05 repository/recovery compatibility. |
| 2026-08-21 | BS2-005–BS2-007, BS2-016–BS2-017, BS2-021–BS2-022, BS2-GATE | Activated schema 6 with separate empty-database bootstrap and schema-5 migration paths; persisted masked Company Settings and generic financial classifications; added deterministic isolated report snapshots/database revisions; carried schema-6 metadata through portable data and backup bundles; and verified backup, restore, relocation, corrupt/incomplete/future-schema rejection, Electron host validation, and isolated smoke. `npm run test:ci` passed all 132 ChromeHeadless tests with 79.21% statements, 64.35% branches, 87.55% functions, and 86.64% lines; production build, all 8 desktop-host tests, and Electron smoke passed. |
| 2026-08-21 | BS3-001–BS3-003, BS3-021 | Added masked Company Settings reads, normalized validated transactional optimistic updates, explicit tax-identifier reveal/set/clear, sanitized audit history, and SQLite reopen coverage while proving ledger non-mutation. `npm run test:ci` passed all 137 ChromeHeadless tests with 79.84% statements, 65.03% branches, 88.41% functions, and 87.17% lines; production build and all 8 desktop-host tests passed. |
| 2026-08-21 | BS3-004–BS3-006, BS3-008 | Added the accessible Company Settings side panel with masked explicit tax reveal, validation, save/cancel/Escape behavior, stale-edit recovery, dynamic application identity, and a reusable tax-free report/export identity formatter. Two neutral identities and blank optional output were verified. `npm run test:ci` passed all 140 ChromeHeadless tests with 79.84% statements, 65.49% branches, 88.44% functions, and 87.28% lines; production build passed. |
| 2026-08-21 | BS3-009–BS3-013, BS3-018, BS3-020, BS3-023–BS3-025 | Added the generic account application service with exhaustive grouped catalog, role-aware two-store routing, import/classification separation, stable-ID edits, custom-detail retention, compatible hierarchy validation, exact affected/blocking references, confirmation requirements, as-of placement/current-balance previews, Current Earnings behavior, and mutually exclusive opening modes. `npm run test:ci` passed all 147 ChromeHeadless tests with 80.29% statements, 66.18% branches, 88.68% functions, and 87.74% lines; production build and all 8 desktop-host tests passed. |
| 2026-08-21 | BS3-014–BS3-017, BS3-019, BS3-026 | Replaced user-facing source/Chart Add and Edit actions with one accessible role-aware editor using grouped Account Types, immediate detail/parent filtering, imported/custom labels, immutable existing roles, live Balance Sheet or Current Earnings placement, as-of balances, opening-mode validation, and complete blocking/confirmation reference lists. Browser tests cover creation, stable-ID edit, Escape cancellation, custom retention, placement, opening conflict, and reference display. `npm run test:ci` passed all 150 ChromeHeadless tests with 80.01% statements, 66.01% branches, 88.71% functions, and 87.38% lines; production build passed. A15/A18 cross-output acceptance remains open until report/output slices exist. |
| 2026-08-21 | BS4-001–BS4-005, BS4-007; BS4-006 activity portion | Added validated fiscal defaults/date shortcuts and immutable source-balance snapshots with exact Posted/confirmed-transfer inclusion, state/date exclusions, natural Asset/Liability signs, and visible contra amounts. Focused Slice 10 suite passed all 10 ChromeHeadless tests; opening balances remain deferred to Slice 13 by the slice boundary. |
| 2026-08-21 | BS4-008–BS4-009, BS4-014, BS4-019–BS4-020 | Added immutable application-level Balance Sheet generation with separate source/Chart identities, exact debit/credit sign transforms, integer Asset/Liability/Equity totals and Difference, and valid empty-book behavior. Focused Slice 11 suite passed all 4 ChromeHeadless tests. |
| 2026-08-21 | BS4-010–BS4-011, BS4-013 | Extracted one unadjusted P/L detail identity used by P/L and Balance Sheet, added fiscal-period Current Earnings and pre-period Retained Earnings, and kept report-only/Schedule C exclusions out. Focused Balance Sheet plus existing P/L suite passed all 42 ChromeHeadless tests. |
