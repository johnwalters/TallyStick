# TallyStick Statement of Cash Flows Implementation Slices

*Proposed execution catalog · August 25, 2026*

This document divides the Statement of Cash Flows feature into 20 small, independently reviewable and testable slices. It supplements the [Statement of Cash Flows Product Specification](Statement%20of%20Cash%20Flows%20PRODUCT_SPEC.md) and [Statement of Cash Flows Task Tracker](Statement%20of%20Cash%20Flows%20TASKS.md).

## Slice workflow

Start a slice by naming it alone, for example:

> Implement `CF-SLICE-01-BASELINE-ORACLE`.

That instruction authorizes implementation and verification of only the named slice. The implementing agent must:

1. Read this document's complete entry for the named slice.
2. Read the Product Specification sections and Task Tracker items listed as authority.
3. Inspect the current implementation and git status before editing.
4. Confirm every dependency is complete in the Task Tracker. If not, stop and identify the first unmet dependency.
5. Implement the named scope and its focused tests without beginning a later slice or unrelated cleanup.
6. Run the required verification commands.
7. Update applicable checkboxes, Resume status, and the Evidence log only after the required behavior passes.
8. Report behavior completed, files changed, verification results, and the next slice. Do not commit or push unless separately instructed.

The Task Tracker is the source of truth for completion status. A slice name is an execution handle, not evidence that the slice is complete.

## Rules shared by every slice

- Preserve every locked guardrail in the Task Tracker.
- Use signed integer minor units for money and calendar dates for business dates.
- Do not add company-, institution-, marketplace-, account-name-, stable-ID-, or category-name-specific logic.
- Keep cash role, Cash Flow treatment, Account Type, statement placement, and import eligibility separate.
- Add focused tests in the same slice as the behavior they verify.
- Run `cd site && npm run test:ci` and `cd site && npm run build` before completing every slice.
- Also run `cd site && npm run test:desktop-host` for schema, persistence, backup/restore, native export, print, filesystem, or Electron changes.
- Run `cd site && npm run desktop:smoke` only where a slice explicitly requires it.
- Do not mark a slice complete from contracts, mocks, static UI, or a successful build alone.
- Do not weaken, delete, or skip an existing test to make a slice pass.
- Tests and smoke runs must use isolated temporary profiles and databases, never the live user database.
- If implementation reveals a product decision not settled by the authority documents, stop that slice and record the decision before continuing.

## Slice order

| Order | Slice name | Outcome |
| ---: | --- | --- |
| 1 | `CF-SLICE-01-BASELINE-ORACLE` | Verified starting point and exact A1–A20 fixture expectations |
| 2 | `CF-SLICE-02-CLASSIFICATION-CORE` | Exhaustive cash-role and Cash Flow treatment domain |
| 3 | `CF-SLICE-03-PUBLIC-CONTRACTS` | Typed query, report, detail, classification, and failure contracts |
| 4 | `CF-SLICE-04-SCHEMA-7-MIGRATION` | Safe schema-6-to-7 structural migration |
| 5 | `CF-SLICE-05-PERSISTENCE-RECOVERY` | Repository, snapshot, revision, backup, and recovery support |
| 6 | `CF-SLICE-06-CLASSIFICATION-SERVICE` | Validated classification service and Chart exchange |
| 7 | `CF-SLICE-07-CLASSIFICATION-UI` | Account controls and classification review workflow |
| 8 | `CF-SLICE-08-QUERY-CASH-BALANCES` | Normalized periods and exact beginning/ending cash |
| 9 | `CF-SLICE-09-NET-PROFIT-NONCASH` | Net Profit and noncash Operating adjustments |
| 10 | `CF-SLICE-10-WORKING-CAPITAL` | Operating asset/liability changes and Operating subtotal |
| 11 | `CF-SLICE-11-INVESTING-FINANCING` | Actual cash-side Investing and Financing activity |
| 12 | `CF-SLICE-12-TRANSFERS-RESTRICTED-CASH` | Transfer elimination and restricted-cash behavior |
| 13 | `CF-SLICE-13-OPENING-NONCASH` | Opening events and supplemental noncash disclosures |
| 14 | `CF-SLICE-14-RECONCILIATION-WARNINGS` | Reconciliation, completeness status, and warning model |
| 15 | `CF-SLICE-15-DETAIL-REVISION-CACHE` | Exact drill-down, stale rejection, and cache invalidation |
| 16 | `CF-SLICE-16-WORKSPACE` | Complete interactive Statement of Cash Flows workspace |
| 17 | `CF-SLICE-17-CSV` | Deterministic Summary CSV parity |
| 18 | `CF-SLICE-18-XLSX` | Verified three-sheet workbook parity |
| 19 | `CF-SLICE-19-PRINT-PDF` | Print preview and explicit system-print/PDF behavior |
| 20 | `CF-SLICE-20-RELEASE-PROOF` | Acceptance, performance, privacy, regression, and release evidence |

## CF-SLICE-01-BASELINE-ORACLE

**Depends on:** The four planning documents already present.

**Authority:** PRD A1–A20; Product Specification §§18–20; Task Tracker CF0-005–CF0-010 and CF0-GATE.

**Scope:**

- Run and record the pre-change browser suite, production build, desktop-host suite, and isolated Electron smoke.
- Record schema-6 fixture counts and prove a pre-migration backup restores.
- Create neutral fictional fixtures spanning every A1–A20 accounting case, including non-calendar fiscal periods and structurally different names.
- Encode exact signed minor-unit row, detail, reconciliation, status, and warning expectations.
- Resolve or formally document any blocking architecture decision before production implementation.

**Acceptance:** Baseline commands pass, recovery proof exists, A1–A20 expectations are exact, valid books reconcile to zero, and fixtures contain no personal or prior-customer data.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Production Cash Flow contracts, schema 7, calculations, exporters, or UI.

## CF-SLICE-02-CLASSIFICATION-CORE

**Depends on:** `CF-SLICE-01-BASELINE-ORACLE`.

**Authority:** Product Specification §§4–5; Task Tracker CF1-001–CF1-005 and the classification portions of CF1-012.

**Scope:**

- Add exhaustive cash-role and Cash Flow treatment types.
- Define structural defaults, compatibility, review-required, and custom-provenance behavior.
- Add pure validation for financial-account cash roles and financial/Chart-account treatments.
- Test every mapping and invalid combination without reading names or stable IDs.

**Acceptance:** Mappings are exhaustive, valid combinations are accepted, invalid/unknown values produce typed failures, and ambiguous records never receive a guessed classification.

**Not in scope:** Public application operations, database columns, editors, or report calculations.

## CF-SLICE-03-PUBLIC-CONTRACTS

**Depends on:** `CF-SLICE-02-CLASSIFICATION-CORE`.

**Authority:** Product Specification §§3, 6, and 9; Task Tracker CF1-006–CF1-012 and CF1-GATE.

**Scope:**

- Add immutable query, report, section, row, contribution, disclosure, warning, status, and reconciliation contracts.
- Add stable semantic row IDs, report IDs, database revisions, and exact detail keys.
- Add classification preview/save/review and Chart exchange contracts.
- Add typed query, classification, stale-revision, reconciliation, output, and print failures.
- Extend `AccountingApplication` and facade state without leaking infrastructure types.

**Acceptance:** Contracts compile, money is integer-safe, IDs do not depend on labels, objects are immutable, and application-boundary tests pass.

**Not in scope:** Persistence, working operations, calculations, UI, or output files.

## CF-SLICE-04-SCHEMA-7-MIGRATION

**Depends on:** `CF-SLICE-03-PUBLIC-CONTRACTS`.

**Authority:** Product Specification §7 and §18.2; Task Tracker CF2-001–CF2-007.

**Scope:**

- Add schema-7 classification, provenance, review, audit, and report-index structures.
- Migrate cash roles and treatments from structural Account Type/detail/role metadata only.
- Mark ambiguity review-required and preserve the originating evidence.
- Preserve all stable IDs, hierarchy, ledger data, transfers, rules, opening data, state, and audit history.
- Validate counts, foreign keys, cycles, enum values, and compatibility within the migration transaction.

**Acceptance:** Representative schema-6 databases migrate and reopen idempotently; invalid migrations roll back; record relationships and existing ledger/P&L/Balance Sheet totals remain exact.

**Additional verification:** `npm run test:desktop-host`.

**Not in scope:** Repository API changes beyond migration support, backup format changes, editors, or Cash Flow calculations.

## CF-SLICE-05-PERSISTENCE-RECOVERY

**Depends on:** `CF-SLICE-04-SCHEMA-7-MIGRATION`.

**Authority:** Product Specification §§7–8, 15, and 17; Task Tracker CF2-008–CF2-013 and CF2-GATE.

**Scope:**

- Implement classification repository mapping, atomic batch updates, audit linkage, and revision increments.
- Extend consistent report snapshots with classifications, balances, splits, transfers, opening data, hierarchy, and state.
- Update the shared current-schema constant and every backup/restore/native fixture consumer to schema 7.
- Verify reopen, rollback, backup, restore, relocation, integrity checks, and future-schema rejection.

**Acceptance:** Schema-7 data survives close/reopen and recovery paths; snapshots carry one consistent revision; no existing ledger or statement total drifts.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Classification UI, report calculations, or report outputs.

## CF-SLICE-06-CLASSIFICATION-SERVICE

**Depends on:** `CF-SLICE-05-PERSISTENCE-RECOVERY`.

**Authority:** Product Specification §§5–7, 12.4, and 15; Task Tracker CF3-001–CF3-007 and service portions of CF3-011.

**Scope:**

- Implement catalog, current-state, review-queue, preview, and optimistic save operations.
- Save valid edits transactionally with audit evidence, impacted-record reporting, and cache invalidation.
- Extend Chart export with stable classification fields.
- Implement non-mutating Chart import preview using stable ID first and unique normalized path fallback.
- Commit an accepted valid preview atomically; reject ambiguous, missing, archived, or incompatible mappings with row-level issues.

**Acceptance:** Service and exchange tests prove deterministic resolution, no partial writes, no name-based universal assumptions, correct conflicts, and clear review state.

**Not in scope:** Account-editor controls, review screens, or Cash Flow report generation.

## CF-SLICE-07-CLASSIFICATION-UI

**Depends on:** `CF-SLICE-06-CLASSIFICATION-SERVICE`.

**Authority:** Product Specification §§12–13.2; Task Tracker CF3-008–CF3-011 and CF3-GATE.

**Scope:**

- Add cash-role controls to financial-account editing and treatment controls to appropriate financial/Chart-account editing.
- Build the review queue with reason, current value, structural suggestion, provenance, and accessible save/cancel flows.
- Surface warnings and direct review entry points without blocking unrelated accounting work.
- Test keyboard use, validation, conflicts, archived records, generic names, and immediate refreshed state.

**Acceptance:** Users can identify and resolve every review-required classification, invalid combinations cannot save, and changed classifications persist and invalidate affected reports.

**Not in scope:** The Statement of Cash Flows report screen or calculations.

## CF-SLICE-08-QUERY-CASH-BALANCES

**Depends on:** `CF-SLICE-07-CLASSIFICATION-UI`.

**Authority:** Product Specification §§9, 10.1–10.2; Task Tracker CF4-001–CF4-004 and related CF4-010 cases.

**Scope:**

- Normalize inclusive custom periods and fiscal presets independently from other workspaces.
- Build one immutable, revision-consistent report snapshot excluding Pending and Excluded activity.
- Calculate Beginning Cash on the day before the period and Ending Cash on the through date.
- Separate unrestricted cash/cash equivalents from restricted cash using explicit roles.
- Cover state exclusion, empty reports, fiscal periods, and opening-balance boundaries.

**Acceptance:** Beginning/ending balances match exact Balance Sheet snapshot values for the same revision and accounting basis; no time-zone or state leakage occurs.

**Not in scope:** Net Profit, Operating adjustments, Investing, Financing, or screen rendering.

## CF-SLICE-09-NET-PROFIT-NONCASH

**Depends on:** `CF-SLICE-08-QUERY-CASH-BALANCES`.

**Authority:** Product Specification §§10.3–10.4; Task Tracker CF4-005–CF4-006 and relevant CF4-009–CF4-010 cases.

**Scope:**

- Reuse unadjusted P/L Net Profit for the exact report period and revision.
- Identify classified noncash/reclassification P/L contributions and reverse each exactly once.
- Produce deterministic Net Profit and noncash Operating rows with exact detail contributions.
- Test cash P/L activity, depreciation, other noncash adjustments, signs, and zero behavior.

**Acceptance:** Net Profit equals P/L exactly; noncash adjustments bridge profit toward cash without duplication; row detail sums exactly.

**Not in scope:** Working-capital changes, Investing/Financing, reconciliation status, or UI.

## CF-SLICE-10-WORKING-CAPITAL

**Depends on:** `CF-SLICE-09-NET-PROFIT-NONCASH`.

**Authority:** Product Specification §§10.5–10.6 and 10.12; Task Tracker CF4-007–CF4-010 and CF4-GATE.

**Scope:**

- Calculate operating-asset adjustments as Opening minus Ending balance.
- Calculate operating-liability adjustments as Ending minus Opening balance.
- Build deterministic working-capital hierarchy, sign presentation, zero handling, subtotals, and Net Cash from Operating Activities.
- Cover receivables, inventory, payables, credit-card operating balances, hierarchy, archived values, and exact detail.

**Acceptance:** A1–A5, A7, A13, and A15–A17 Operating expectations pass and every Operating row reconciles to its detail.

**Not in scope:** Investing, Financing, transfer elimination, final report status, or UI.

## CF-SLICE-11-INVESTING-FINANCING

**Depends on:** `CF-SLICE-10-WORKING-CAPITAL`.

**Authority:** Product Specification §10.7; Task Tracker CF5-001–CF5-004 and relevant CF5-009–CF5-010 cases.

**Scope:**

- Calculate Investing and Financing from actual cash-side transactions and supported transfer sides.
- Allocate split debt payments among principal, interest, and other posted accounts without description inference.
- Present owner contributions and distributions as Financing activity without affecting Net Profit.
- Build deterministic row hierarchies, subtotals, signs, and exact detail.

**Acceptance:** Fixed-asset, debt, split-payment, contribution, and draw fixtures produce exact A6, A8, and A9 values with no cash duplication.

**Not in scope:** Cash-to-cash elimination, restricted cash, noncash disclosure, reconciliation, or UI.

## CF-SLICE-12-TRANSFERS-RESTRICTED-CASH

**Depends on:** `CF-SLICE-11-INVESTING-FINANCING`.

**Authority:** Product Specification §§10.8 and 10.11; Task Tracker CF5-005–CF5-006 and relevant CF5-010 cases.

**Scope:**

- Eliminate confirmed cash-to-cash transfers from Operating, Investing, Financing, and Net Change.
- Handle cash/noncash transfer sides according to the classified counter-account treatment.
- Handle unrestricted-to-restricted cash transfers without duplication and with required presentation or warning.
- Detect unsupported, partial, or ambiguous transfer structures and retain explainable contributions.

**Acceptance:** A10 and A12 pass exactly; transfers cannot manufacture cash flow; unresolved structures remain visible and never silently disappear.

**Not in scope:** Opening events, noncash acquisition disclosures, final completeness status, or UI.

## CF-SLICE-13-OPENING-NONCASH

**Depends on:** `CF-SLICE-12-TRANSFERS-RESTRICTED-CASH`.

**Authority:** Product Specification §§10.9–10.10; Task Tracker CF5-007–CF5-010 and CF5-GATE.

**Scope:**

- Identify supported noncash investing and financing events.
- Exclude noncash events from activity totals and present them in a supplemental disclosure hierarchy.
- Handle in-period opening-balance events according to their explicit source and treatment.
- Add exact disclosure/opening detail and deterministic ordering.

**Acceptance:** A11 and A13 pass; noncash events never alter cash totals; opening events are neither omitted nor double counted; Phase 5 fixtures all pass.

**Not in scope:** Final reconciliation/status, warnings UI, report workspace, or exporters.

## CF-SLICE-14-RECONCILIATION-WARNINGS

**Depends on:** `CF-SLICE-13-OPENING-NONCASH`.

**Authority:** Product Specification §§10.11–10.12 and 12; Task Tracker CF6-001–CF6-004 and warning portions of CF6-010.

**Scope:**

- Calculate Net Change, Calculated Ending Cash, Balance Sheet Ending Cash, and Difference.
- Assign Complete only when Difference is zero and material unclassified cash activity is absent.
- Emit deterministic typed warnings for all specified review, archived, unclassified, transfer, restricted-cash, opening, and reconciliation conditions.
- Keep nonzero archived and review-required contributions visible and ordered.

**Acceptance:** Valid fixtures reconcile to zero and Complete; A14 remains incomplete with the exact warning; no warning state can overstate certainty.

**Not in scope:** Interactive warning presentation, drill-down service, cache, outputs, or release proof.

## CF-SLICE-15-DETAIL-REVISION-CACHE

**Depends on:** `CF-SLICE-14-RECONCILIATION-WARNINGS`.

**Authority:** Product Specification §§11 and 15; Task Tracker CF6-005–CF6-010 and CF6-GATE.

**Scope:**

- Implement exact detail for every eligible row and disclosure against report ID and database revision.
- Represent balance changes, transfers, opening items, and exclusions in explainable contributions.
- Reject stale detail, export, and print requests after relevant mutation.
- Cache by normalized query plus database revision and invalidate on every specified report-affecting mutation.
- Prove historical result stability until the books or classifications change.

**Acceptance:** Detail sums exactly, stale reads fail clearly, repeated unchanged queries are deterministic, and all invalidation tests pass.

**Not in scope:** Report-screen layout or file generation.

## CF-SLICE-16-WORKSPACE

**Depends on:** `CF-SLICE-15-DETAIL-REVISION-CACHE`.

**Authority:** Product Specification §13; Task Tracker CF7-001–CF7-011 and CF7-GATE.

**Scope:**

- Add navigation and independent period controls for every required preset and Custom range.
- Render company/report metadata, method, status, disclaimer, all statement sections, disclosures, and reconciliation.
- Add deterministic expansion, zero-row behavior, exact drill-down, warnings, and classification-review navigation.
- Add loading, empty, invalid, incomplete, error, and stale states.
- Meet specified keyboard, focus, accessible-name, reading-order, contrast, screen-reader, and desktop-size behavior.

**Acceptance:** The workspace exposes the complete immutable report, independently maintains filters, provides exact explainability, and is usable without a mouse.

**Not in scope:** CSV, XLSX, print/PDF, or release-wide acceptance proof.

## CF-SLICE-17-CSV

**Depends on:** `CF-SLICE-16-WORKSPACE`.

**Authority:** Product Specification §§14.1–14.2; Task Tracker CF8-001–CF8-002, CSV portions of CF8-008–CF8-009.

**Scope:**

- Generate deterministic Summary CSV from the supplied immutable report without recalculation.
- Include metadata, method, status, warnings, disclaimer, semantic row IDs, sections, amounts, disclosures, and reconciliation.
- Add safe formatting, quoting, spreadsheet-injection protection, stable filenames, and stale-revision rejection.

**Acceptance:** Parsed CSV values and order match the screen report exactly; regeneration from the same report is byte-stable where the spec requires it.

**Not in scope:** XLSX, print/PDF, or release proof.

## CF-SLICE-18-XLSX

**Depends on:** `CF-SLICE-17-CSV`.

**Authority:** Product Specification §§14.1 and 14.3; Task Tracker CF8-003–CF8-005, XLSX portions of CF8-008–CF8-009.

**Scope:**

- Generate Statement, Detail, and Classifications sheets from the immutable report and associated classification snapshot.
- Include status, warnings, disclaimer, semantic identities, exact details, review state, and reconciliation.
- Apply safe workbook typing, presentation-only decimal conversion, spreadsheet-injection protection, stable ordering, and stale-revision rejection.
- Parse generated workbooks in tests and verify detail-to-statement and screen parity.

**Acceptance:** The three-sheet workbook opens cleanly, contains no recalculated drift, and all statement rows reconcile to exported detail.

**Additional verification:** `npm run test:desktop-host` if workbook generation crosses the native filesystem boundary.

**Not in scope:** Print/PDF or release proof.

## CF-SLICE-19-PRINT-PDF

**Depends on:** `CF-SLICE-18-XLSX`.

**Authority:** Product Specification §§14.1 and 14.4; Task Tracker CF8-006–CF8-009 and CF8-GATE.

**Scope:**

- Build print/PDF preview from the same immutable report with page-safe sections and repeated context.
- Include identity, period, basis, method, status, warnings, disclaimer, sections, disclosures, and reconciliation.
- Wire Command-P to preview and require explicit user action before invoking system print/save-to-PDF.
- Reject stale revisions and test no automatic printing, page layout, value parity, and native boundary behavior.

**Acceptance:** A18 passes across screen, CSV, XLSX, and print; Command-P opens preview; no print dialog or file save occurs without explicit action.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Release-wide performance, privacy scan, documentation status changes, or final proof.

## CF-SLICE-20-RELEASE-PROOF

**Depends on:** `CF-SLICE-19-PRINT-PDF`.

**Authority:** Product Specification §§16–20; PRD A1–A20; Task Tracker CF9-001–CF9-011 and CF9-GATE.

**Scope:**

- Run A1–A20 with exact report, detail, warning, status, reconciliation, and output assertions.
- Prove integer-money discipline, determinism, required performance, local-only operation, and no report mutation.
- Run privacy/public-fixture scans and all browser, build, desktop-host, backup/restore, and isolated Electron smoke suites.
- Re-run P/L, Balance Sheet, Transactions, Rules, Chart of Accounts, Backups, and branding regressions.
- Update product/readme/feature documentation only after all release evidence passes.
- Record final commands, counts, timings, limitations, and results in the Task Tracker.

**Acceptance:** Every Task Tracker item and gate is supported by passing evidence, A1–A20 pass, regression and privacy checks pass, and documentation accurately marks the feature implemented.

**Additional verification:** `npm run test:desktop-host` and `npm run desktop:smoke`.

**Not in scope:** Future direct-method presentation, forecasting, bank feeds, consolidated entities, or unrelated product work.

