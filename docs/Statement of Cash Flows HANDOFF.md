# Statement of Cash Flows implementation handoff

## Current feature state

The Statement of Cash Flows release is implemented and verified through `CF-SLICE-20-RELEASE-PROOF`. Phases 0–9, CF8-GATE, CF9-GATE, and A1–A20 are complete. The workspace, exact detail, CSV, reopened three-sheet XLSX, print preview, and native PDF all consume the same immutable report/revision and retain complete warning, disclosure, and reconciliation provenance.

The executable release command validates the canonical A1–A20 oracle, oracle-copy identity, privacy, determinism, integer money, no-mutation behavior, performance, full browser regressions, TypeScript contracts, production build, desktop-host backup/restore, and an isolated Electron PDF smoke. Command-P opens preview only; printing or Save as PDF requires an explicit action.

## Immediate resume point

No Statement of Cash Flows implementation work remains. For future regressions, run `cd site && npm run test:cash-flow-release-proof`. Direct-method presentation, forecasting, consolidation, and unrelated features remain out of scope.

## Checkout context

- Path: visible saved-project repository root (no alternate checkout or worktree)
- Branch: `cash-flow`
- Baseline HEAD for this final release-proof pass: `b44a9f9c215abeb207071042572a6dd1cdd1bbf2`.
- Current state: the working tree contains the focused Slice 20 release-proof, retry-safe desktop smoke, print identity layout, and completion-document updates. No commit or push has been performed for this pass.
- No alternate checkout or worktree is in use.

## Verification evidence

- `npm run test:cash-flow-release-proof`: passed end to end.
- Production fixture/oracle gate: 20 static A1–A20 scenarios plus 77 report/output/performance acceptance tests passed.
- `npm run test:ci`: 333/333 browser/unit tests passed, including dependency boundaries and both fixture oracles (Balance Sheet: 2 companies/19 scenarios; Cash Flow: 2 companies/20 scenarios).
- Performance: full report 135.90 ms, cached report 19.00 ms, detail 19.10 ms for 10,000 contributions, and classification review 30.60 ms for 10,000 transactions.
- `npm run build`: 1.41 MB initial bundle, no warnings. Application/specification/desktop TypeScript passed.
- `npm run test:desktop-host`: 17/17 passed, including validated backup/restore and print routing.
- Isolated `npm run desktop:smoke`: passed. Chromium generated a 134,843-byte, two-page A4 PDF; visual inspection found repeated context/headings and no clipping or overlap.
- Privacy, byte-identical oracle copies, and `git diff --check` passed.

## Historical context

Slice 10, `CF-SLICE-10-WORKING-CAPITAL`, was independently approved earlier and closed Phase 4. It calculates Operating asset changes as Opening minus Ending and Operating liability changes as Ending minus Opening, with deterministic hierarchy, exact detail/provenance, malformed-hierarchy review grouping, and an executable production gate.

Slice 09, `CF-SLICE-09-NET-PROFIT-NONCASH`, was independently approved as of August 26, 2026. It reuses exact-period unadjusted P/L Net Profit and reverses classified noncash P/L contributions once, retaining complete contribution provenance even when offsetting posted activity nets to zero. Slice 08, `CF-SLICE-08-QUERY-CASH-BALANCES`, was independently approved earlier and provides normalized inclusive-period queries, revision-consistent cash balances, explicit unrestricted/restricted cash separation, and Balance Sheet parity.
