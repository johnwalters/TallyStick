# TallyStick Balance Sheet Implementation Slices

*Execution catalog · August 21, 2026*

This document divides the Balance Sheet feature into small, independently reviewable implementation slices. It supplements the [Balance Sheet Product Specification](Balance%20Sheet%20PRODUCT_SPEC.md) and [Balance Sheet Task Tracker](Balance%20Sheet%20TASKS.md); it does not change their requirements or completion status.

## How to invoke a slice

The user may start a slice by naming it alone, for example:

> Implement `BS-SLICE-10-SOURCE-BALANCES`.

That instruction authorizes implementation and testing of only the named slice. The implementing agent must:

1. Read this document's entry for the named slice.
2. Read the Product Specification sections and Task Tracker items listed in that entry.
3. Inspect the current implementation and git status before editing.
4. Confirm that the listed dependencies are complete in the Task Tracker. If they are not, stop and identify the first unmet dependency.
5. Implement the named scope, including its focused tests, without implementing later slices or unrelated cleanup.
6. Run the slice's required verification commands.
7. Update applicable checkboxes, Resume status, and the Evidence log in the Task Tracker only after the required behavior passes.
8. Report the behavior completed, files changed, verification results, and the next slice. Do not commit or push unless separately instructed.

The Task Tracker remains the source of truth for progress. Status is not duplicated here.

## Rules shared by every slice

- Preserve all locked implementation guardrails in the Task Tracker.
- Use signed integer minor units for money and calendar dates for business dates.
- Do not add company-, institution-, marketplace-, account-name-, or stable-ID-specific logic.
- Keep financial-source account role, accounting classification, and import eligibility separate.
- Add focused tests in the same slice as the behavior they verify.
- Run `cd site && npm run test:ci` and `cd site && npm run build` before completing every slice.
- Also run `cd site && npm run test:desktop-host` when the slice changes schema, persistence, backup/restore, filesystem, export, print, or Electron behavior.
- Run `cd site && npm run desktop:smoke` only where a slice explicitly requires it.
- Do not mark a slice complete from types, mocks, static UI, or a successful build alone.
- Do not weaken, delete, or skip an existing test to make a slice pass.
- Keep the live user database out of tests. Native tests and smoke tests must use an isolated temporary profile and database.

## Slice order

| Order | Slice name | Outcome |
| ---: | --- | --- |
| 1 | `BS-SLICE-01-BASELINE-ORACLE` | Verified starting point and exact fixture expectations |
| 2 | `BS-SLICE-02-TAXONOMY-CORE` | Exhaustive accounting taxonomy and validation |
| 3 | `BS-SLICE-03-PUBLIC-CONTRACTS` | Typed company and Balance Sheet application contracts |
| 4 | `BS-SLICE-04-SCHEMA-6-MIGRATION` | Safe schema-5-to-6 migration |
| 5 | `BS-SLICE-05-PERSISTENCE-RECOVERY` | Repository, revision, backup, and recovery support |
| 6 | `BS-SLICE-06-COMPANY-SERVICE` | Persistent, validated, masked Company Settings service |
| 7 | `BS-SLICE-07-COMPANY-UI` | Company Settings editor and reusable identity |
| 8 | `BS-SLICE-08-ACCOUNT-SERVICE` | Account classification, validation, and placement service |
| 9 | `BS-SLICE-09-ACCOUNT-UI` | Generic account editor behavior |
| 10 | `BS-SLICE-10-SOURCE-BALANCES` | Source-account balances and transaction-state rules |
| 11 | `BS-SLICE-11-CHART-EQUATION` | Chart contributions and accounting-equation totals |
| 12 | `BS-SLICE-12-FISCAL-EARNINGS` | Current and retained earnings |
| 13 | `BS-SLICE-13-OPENING-BALANCES` | Opening Balance Equity and opening modes |
| 14 | `BS-SLICE-14-HIERARCHY-WARNINGS` | Hierarchy, zero hiding, archived/unclassified rows, and warnings |
| 15 | `BS-SLICE-15-DETAIL-REVISION-CACHE` | Reconciling drill-down, report identity, and refresh behavior |
| 16 | `BS-SLICE-16-WORKSPACE` | Complete interactive Balance Sheet workspace |
| 17 | `BS-SLICE-17-CSV` | Summary CSV parity |
| 18 | `BS-SLICE-18-XLSX` | Summary and detail XLSX parity |
| 19 | `BS-SLICE-19-PRINT-PDF` | Print preview and PDF/system-print behavior |
| 20 | `BS-SLICE-20-RELEASE-PROOF` | Full acceptance, performance, regression, and release evidence |

## BS-SLICE-01-BASELINE-ORACLE

**Depends on:** Documentation already present.

**Authority:** Product Specification §§17–19; PRD acceptance scenarios A1–A19; Task Tracker BS0-004–BS0-008 and BS0-GATE.

**Scope:**

- Run and record the pre-change browser suite, production build, desktop-host suite, and isolated Electron smoke.
- Record schema-5 fixture counts and prove a pre-migration backup can be restored.
- Establish at least two neutral fictional company fixtures with different fiscal calendars, institutions, and account names.
- Convert A1–A19 into deterministic expected minor-unit totals and expected detail contributions, reusing the public sample data where suitable.
- Resolve or document any blocking architecture decision before production implementation begins.

**Acceptance:** The baseline commands pass, fixture expectations are exact rather than approximate, valid fixture books reconcile to zero Difference, and no fixture contains personal or prior-customer data.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** New production contracts, schema 6, UI, or Balance Sheet calculations.

## BS-SLICE-02-TAXONOMY-CORE

**Depends on:** `BS-SLICE-01-BASELINE-ORACLE`.

**Authority:** Product Specification §§4 and 6; Task Tracker BS1-002–BS1-006, BS1-013, and BS1-014.

**Scope:**

- Add the exhaustive reporting-group, accounting-account-type, section, role, import-capability, and classification-status domain types.
- Create one grouped account catalog with natural balance, statement placement, compatible detail types, valid parents, opening-balance support, and default import capability.
- Include every required standard detail type while defining how imported/custom values are preserved.
- Add pure validation for type/detail, parent, role, import-capability, opening-balance mode, and placement compatibility.

**Acceptance:** Every catalog entry is covered by unit tests; mappings are exhaustive; unsupported or unknown values return typed failures and never silently default.

**Not in scope:** Database columns, repositories, application-interface changes, or editor UI.

## BS-SLICE-03-PUBLIC-CONTRACTS

**Depends on:** `BS-SLICE-02-TAXONOMY-CORE`.

**Authority:** Product Specification §§3, 5.1–5.2, 8, 10–11, and 14; Task Tracker BS1-001, BS1-007–BS1-012, BS1-015–BS1-016, and BS1-GATE.

**Scope:**

- Add Company Profile, masked report identity, update command, and reveal-operation contracts.
- Add immutable Balance Sheet query, report, row, warning, contribution, detail-key, report-ID, and database-revision contracts.
- Add typed company, account, report, stale-revision, reconciliation, and export failures.
- Extend `AccountingApplication` and the feature facade boundary without exposing repository, SQL, Electron, or filesystem types.

**Acceptance:** Contracts compile; money fields use `bigint` or the existing `Money` type; stable semantic identities do not depend on labels; immutability and boundary tests pass.

**Not in scope:** Working persistence, report calculations, screen rendering, or exporters.

## BS-SLICE-04-SCHEMA-6-MIGRATION

**Depends on:** `BS-SLICE-03-PUBLIC-CONTRACTS`.

**Authority:** Product Specification §7 and §17.2; Task Tracker BS2-001–BS2-004, BS2-008–BS2-015, and BS2-018–BS2-020.

**Scope:**

- Add schema-6 company-profile and financial-account classification storage plus report-query indexes.
- Preserve the legacy financial `type` column as provenance while making generic `account_type` authoritative for new behavior.
- Migrate BANK and CREDIT_CARD structurally and map ENTITY using metadata and role—not account names.
- Mark ambiguous ENTITY records `REVIEW_REQUIRED` and retain their visible provenance.
- Preserve IDs, links, ledger records, rules, mappings, opening data, archive/lock state, and audit history.
- Validate required data, foreign keys, cycles, classifications, and record counts within one migration transaction.

**Acceptance:** Representative schema-5 databases migrate and reopen idempotently as schema 6; exact pre/post ledger totals and record relationships match; an invalid migration rolls back completely.

**Additional verification:** `npm run test:desktop-host`.

**Not in scope:** Company/account editors, Balance Sheet calculations, or output formats.

## BS-SLICE-05-PERSISTENCE-RECOVERY

**Depends on:** `BS-SLICE-04-SCHEMA-6-MIGRATION`.

**Authority:** Product Specification §§3.3, 7, 14, 16, and 17.2; Task Tracker BS2-005–BS2-007, BS2-016–BS2-017, BS2-021–BS2-022, and BS2-GATE.

**Scope:**

- Implement company-profile and account-classification repository mapping, excluding the full tax identifier from normal reads.
- Add one consistent as-of query snapshot/database revision capability.
- Update the shared current-schema constant only after migrations are registered.
- Make backup, restore, portable export, Electron validation, temporary databases, and smoke fixtures accept schema 6 through the shared constant.
- Retain future-schema rejection, corruption checks, recovery behavior, and database relocation support.

**Acceptance:** Schema-6 data survives close/reopen, backup/restore, portable export, and relocation; corrupt or future schemas are rejected safely; database revision behavior is deterministic.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Settings UI, account UI, or report math.

## BS-SLICE-06-COMPANY-SERVICE

**Depends on:** `BS-SLICE-05-PERSISTENCE-RECOVERY`.

**Authority:** Product Specification §§5.1–5.3, 16, and 17.3; Task Tracker BS3-001–BS3-003 and the service portions of BS3-021.

**Scope:**

- Implement masked `getCompanyProfile`.
- Implement validated, transactional, audited, optimistic-concurrency `updateCompanyProfile`.
- Implement explicit tax-identifier reveal/edit without placing the full value in general application state, logs, standard reports, or exports.
- Normalize optional blank fields to null and default a blank display name to legal name.

**Acceptance:** Service tests cover every validation, masking, explicit reveal, audit event, stale update, persistence round trip, and ledger non-mutation.

**Not in scope:** Company editor, application header, report header, or export presentation.

## BS-SLICE-07-COMPANY-UI

**Depends on:** `BS-SLICE-06-COMPANY-SERVICE`.

**Authority:** Product Specification §§5.4, 12.2, 12.5, 16, and 17.4; Task Tracker BS3-004–BS3-008, BS3-022, and the company portions of BS3-026.

**Scope:**

- Build the accessible Company Settings editor with validation, masking, reveal/edit, save, and cancel behavior.
- Add access from application settings and the future Balance Sheet header integration point.
- Drive application display identity from Company Settings while preserving TallyStick product branding.
- Provide reusable report/export identity formatting and omit blank optional fields cleanly.
- Prove that the tax identifier never enters standard output models.

**Acceptance:** Component/browser tests pass for two neutral companies, keyboard behavior, validation and concurrency errors, save/cancel, identity refresh, and tax-ID exclusion.

**Not in scope:** Balance Sheet calculations or the full Balance Sheet workspace.

## BS-SLICE-08-ACCOUNT-SERVICE

**Depends on:** `BS-SLICE-05-PERSISTENCE-RECOVERY` and `BS-SLICE-02-TAXONOMY-CORE`.

**Authority:** Product Specification §6 and §17.3; Task Tracker BS3-009–BS3-013, BS3-018, BS3-020, and BS3-023–BS3-025.

**Scope:**

- Implement the shared catalog service and account-use routing to the existing financial or Chart stores.
- Enforce financial-source role restrictions without coupling classification to import capability.
- Preserve existing account roles and stable IDs; reject unsupported cross-store conversion.
- Implement type/detail/parent/reference validation and return every blocking reference.
- Implement placement preview and Current Earnings behavior for P/L account types.
- Enforce mutual exclusion between `DERIVED_EQUITY` and `LEDGER_ACTIVITY`.

**Acceptance:** Service tests cover every account type, detail type, parent path, role, import combination, placement result, blocking reference, opening mode, and stable-ID requirement.

**Not in scope:** Editor rendering or Balance Sheet aggregation.

## BS-SLICE-09-ACCOUNT-UI

**Depends on:** `BS-SLICE-08-ACCOUNT-SERVICE` and `BS-SLICE-07-COMPANY-UI`.

**Authority:** Product Specification §12.6 and §17.4; Task Tracker BS3-014–BS3-017, BS3-019, BS3-026, and BS3-GATE.

**Scope:**

- Group Account Type choices by reporting group and filter Detail Type and parent choices immediately.
- Show Account use where applicable while keeping existing roles fixed during edit.
- Preserve and label imported/custom detail types.
- Display live placement/current-balance preview or Current Earnings behavior before save.
- Display all blocking references and confirmation requirements accessibly.

**Acceptance:** Browser tests cover valid and invalid creation/edit flows, keyboard operation, imported detail preservation, placement previews, stable IDs, opening-mode conflict, and complete blocking-reference display.

**Not in scope:** Balance Sheet report rows, navigation, or exports.

## BS-SLICE-10-SOURCE-BALANCES

**Depends on:** `BS-SLICE-05-PERSISTENCE-RECOVERY` and `BS-SLICE-03-PUBLIC-CONTRACTS`.

**Authority:** Product Specification §§8.1, 9.1–9.2, and 17.1; Task Tracker BS4-001–BS4-007 and the applicable portions of BS4-031–BS4-032.

**Scope:**

- Normalize and validate as-of queries and implement fiscal-period-end default dates and date shortcuts at the domain level.
- Read one consistent database revision/snapshot.
- Include Posted and confirmed Matched Transfer activity through the as-of date.
- Exclude Pending, Excluded, and post-as-of activity.
- Calculate financial-source Asset and Liability balances with correct natural-sign presentation.

**Acceptance:** Exact fixture tests for A1, A2, A3, A5, A7, and A9 pass for source-account effects; negative/contra balances remain visible; report reads do not mutate data.

**Not in scope:** Chart splits, earnings, opening balances, hierarchy, UI, or exports.

## BS-SLICE-11-CHART-EQUATION

**Depends on:** `BS-SLICE-10-SOURCE-BALANCES` and `BS-SLICE-02-TAXONOMY-CORE`.

**Authority:** Product Specification §§9.3 and 9.7 and §17.1; Task Tracker BS4-008–BS4-009, BS4-014, BS4-019–BS4-020, and applicable portions of BS4-031 and BS4-034.

**Scope:**

- Calculate Asset Chart contributions as the inverse of stored split signs.
- Calculate Liability and Equity Chart contributions using natural credit-balance signs.
- Combine financial-source and Chart contributions without name-based merging or double counting.
- Calculate Total Assets, Total Liabilities, Total Equity, Total Liabilities and Equity, and exact Difference.
- Return a valid all-zero empty report.

**Acceptance:** A4 and A6 pass; sign-path tests cover positive, negative, and contra balances; valid fixture books have `differenceMinor === 0`; the empty report is valid.

**Not in scope:** Earnings, opening balances, hierarchy, drill-down, UI, or output formats.

## BS-SLICE-12-FISCAL-EARNINGS

**Depends on:** `BS-SLICE-11-CHART-EQUATION`.

**Authority:** Product Specification §§9.4 and 17.1; Task Tracker BS4-010–BS4-011, BS4-013, and BS4-033.

**Scope:**

- Calculate fiscal-year start for calendar and non-calendar fiscal years, including leap years.
- Derive Current Earnings from the existing unadjusted P/L for the exact current fiscal period.
- Derive prior-period Retained Earnings without creating closing entries.
- Keep Schedule C and report-only P/L exclusions out of both derived amounts.

**Acceptance:** A11 passes for multiple fiscal calendars and as-of dates; Current Earnings and Retained Earnings exactly match unadjusted P/L detail for their respective periods.

**Not in scope:** Opening Balance Equity, hierarchy, drill-down presentation, or UI.

## BS-SLICE-13-OPENING-BALANCES

**Depends on:** `BS-SLICE-12-FISCAL-EARNINGS` and `BS-SLICE-08-ACCOUNT-SERVICE`.

**Authority:** Product Specification §§6.3, 9.5, 11, and 17.1; Task Tracker BS4-012 and the applicable opening-balance and warning portions of BS4-021 and BS4-032.

**Scope:**

- Include eligible stored opening balances only on or before the as-of date.
- Derive Opening Balance Equity from natural Asset and Liability opening positions.
- Exclude stored openings for `LEDGER_ACTIVITY` accounts.
- Fail affected report amounts for opening-mode conflicts and warn for future opening dates.

**Acceptance:** A8 passes exactly; stored and ledger-entered openings cannot double count; opening-date and mode-conflict tests prove the affected account and amount are handled explicitly.

**Not in scope:** Opening-balance drill-down UI, general hierarchy, exports, or print.

## BS-SLICE-14-HIERARCHY-WARNINGS

**Depends on:** `BS-SLICE-13-OPENING-BALANCES`.

**Authority:** Product Specification §§9.6, 11, 15, and 17.1; Task Tracker BS4-015–BS4-021 and the applicable portions of BS4-032.

**Scope:**

- Produce deterministic type, parent, child, and direct-posting order.
- Calculate parent subtotals from direct and descendant activity exactly once.
- Hide zero leaves without changing subtotals and retain structural parents when needed.
- Keep nonzero archived and review-required/unclassified accounts visible.
- Emit every typed report warning and place hierarchy failures under Unclassified without losing nonzero amounts.

**Acceptance:** A10, A12, and the archived/historical portion of A14 pass; repeated identical queries return identical rows, keys, totals, and warnings.

**Not in scope:** Detail contributions, cache invalidation, Angular rendering, or exports.

## BS-SLICE-15-DETAIL-REVISION-CACHE

**Depends on:** `BS-SLICE-14-HIERARCHY-WARNINGS`.

**Authority:** Product Specification §§8.2–8.3, 10, 14, and 17.3; Task Tracker BS4-022–BS4-030, BS4-034–BS4-035, and BS4-GATE.

**Scope:**

- Produce financial-source, Chart, Current Earnings, Retained Earnings, Opening Balance Equity, subtotal, and Difference detail contributions.
- Keep contribution order and semantic identifiers stable and prevent duplicates.
- Refuse partial detail when its integer sum does not equal the selected row.
- Reject detail/export requests against a stale report/database revision.
- Invalidate cached reports after every specified mutation while retaining them across unrelated workspace/filter changes.

**Acceptance:** Every account, subtotal, derived row, total, and Difference reconciles to its disclosed detail or formula; A1–A12 and A14 engine assertions pass; report/detail operations do not mutate persisted books.

**Not in scope:** Visible workspace, CSV, XLSX, print, or PDF.

## BS-SLICE-16-WORKSPACE

**Depends on:** `BS-SLICE-15-DETAIL-REVISION-CACHE`, `BS-SLICE-07-COMPANY-UI`, and `BS-SLICE-09-ACCOUNT-UI`.

**Authority:** Product Specification §12 and §17.4; Task Tracker BS5-001–BS5-016 and BS5-GATE.

**Scope:**

- Add the Balance Sheet navigation item and mutually exclusive workspace.
- Render configured company identity, accounting basis, as-of controls, headline totals, rows, hierarchy, warnings, and Difference from the immutable report result.
- Implement independent report filters, date shortcuts, zero toggle, loading, valid-empty, stale-refresh, and actionable failure states.
- Make every amount keyboard accessible and open its exact reconciled detail with focus return.
- Match the required P/L typography, indentation, bold parity, and amount formatting.

**Acceptance:** Component/browser tests cover all workspace states and accessibility behavior; each rendered amount matches the engine and opens reconciled detail; no Transaction or P/L filter is changed.

**Additional verification:** `npm run desktop:smoke`.

**Not in scope:** CSV, XLSX, print, or PDF actions beyond disabled/placeholder integration points needed for layout.

## BS-SLICE-17-CSV

**Depends on:** `BS-SLICE-16-WORKSPACE`.

**Authority:** Product Specification §§13.1–13.2 and 17.5; Task Tracker BS6-001–BS6-002 and the CSV portions of BS6-010–BS6-013.

**Scope:**

- Export UTF-8 Summary CSV directly from the supplied immutable report result without recalculation.
- Include required company/report metadata, hierarchy fields, stable account IDs, flags, amounts, warnings, and explicit final totals/Difference.
- Use safe temporary writes, atomic finalization, and cancellation cleanup.
- Exclude the tax identifier and sensitive filesystem details.

**Acceptance:** CSV round-trips commas, quotes, Unicode, newlines, neutral company identities, zero/negative values, warnings, and archived/unclassified rows; every exported amount equals the screen/report result.

**Additional verification:** `npm run test:desktop-host`.

**Not in scope:** XLSX, print preview, or PDF.

## BS-SLICE-18-XLSX

**Depends on:** `BS-SLICE-17-CSV`.

**Authority:** Product Specification §§13.1, 13.3, and 17.5; Task Tracker BS6-003–BS6-005 and the XLSX portions of BS6-010–BS6-013.

**Scope:**

- Create a Balance Sheet sheet with screen order, indentation, matching bold styles, numeric currency cells, warnings, and totals.
- Create a Balance Sheet Detail sheet with every contribution and the row/detail keys needed to reproduce each amount.
- Reopen and verify the produced workbook before reporting success.
- Use the same immutable report result, safe writes, cancellation cleanup, and privacy exclusions as CSV.

**Acceptance:** The workbook reopens with both sheets, numeric—not formatted-string—currency cells, required styles and metadata, and exact screen/detail/export parity.

**Additional verification:** `npm run test:desktop-host`.

**Not in scope:** Print preview, PDF, or release-wide acceptance.

## BS-SLICE-19-PRINT-PDF

**Depends on:** `BS-SLICE-18-XLSX`.

**Authority:** Product Specification §§3.4, 13.1, 13.4, 16, 17.5, and 17.6; Task Tracker BS6-006–BS6-009, the print portions of BS6-010–BS6-013, and BS6-GATE.

**Scope:**

- Build print-preview/PDF rendering from the immutable report rows, metadata, warnings, and Difference.
- Open preview without automatically opening the system print dialog.
- Use the configured company title and add File > Print with Command-P.
- Repeat headings across pages and keep subtotals with their groups when practical.
- Apply safe temporary-file handling and exclude tax identifiers, stack traces, and sensitive paths.

**Acceptance:** Print/PDF model values exactly match screen, detail, CSV, and XLSX; multi-page and special-character fixtures render; Command-P works; preview never auto-prints or touches the live database.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Performance tuning or final documentation beyond behavior-specific help text.

## BS-SLICE-20-RELEASE-PROOF

**Depends on:** `BS-SLICE-19-PRINT-PDF` and every earlier slice.

**Authority:** Product Specification §§15–19; PRD BS-001–BS-030 and A1–A19; Task Tracker BS7-A01–BS7-A19, BS7-020–BS7-028, and BS7-GATE.

**Scope:**

- Run and record every A1–A19 acceptance scenario against neutral fixtures.
- Verify deterministic row order, identifiers, warnings, totals, and exact detail/output parity.
- Meet report and drill-down performance targets on the specified large fixtures.
- Run the complete browser, build, desktop-host, and isolated Electron smoke suites.
- Prove report, detail, export, print, failure, and cancellation paths do not mutate book data or access the live user database.
- Update PRD/spec traceability, the application specification where superseded, implementation/handoff material, README/user help, Task Tracker Resume status, and final Evidence log.

**Acceptance:** The Product Specification completion gate and Task Tracker release gate are fully satisfied with recorded evidence; no Balance Sheet implementation task remains unchecked.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** New features, unrelated refactoring, or requirements beyond the approved Balance Sheet PRD.
