# Statement of Cash Flows implementation handoff

## Current feature state

The Statement of Cash Flows release is implemented and verified through `CF-SLICE-20-RELEASE-PROOF`. Phases 0–9, CF8-GATE, CF9-GATE, and A1–A20 are complete. The workspace, exact detail, CSV, reopened three-sheet XLSX, print preview, and native PDF all consume the same immutable report/revision and retain complete warning, disclosure, and reconciliation provenance.

The executable release command validates the canonical A1–A20 oracle, oracle-copy identity, privacy, determinism, integer money, no-mutation behavior, performance, full browser regressions, TypeScript contracts, production build, desktop-host backup/restore, and an isolated Electron PDF smoke. Command-P opens preview only; printing or Save as PDF requires an explicit action.

## Immediate resume point

No Statement of Cash Flows implementation work remains. For future regressions, run `cd site && npm run test:cash-flow-release-proof`. Direct-method presentation, forecasting, consolidation, and unrelated features remain out of scope.

### Post-release matched-payment confirmation (uncommitted)

The follow-up matched-payment usability fix is implemented but not committed. It addresses valid bank/card payment pairs that settle on different business dates at the point where the person chooses **Match transfer** in Transactions.

- A different-date match now states the two dates and asks whether to match them anyway as one payment before it writes the match.
- Accepting creates the existing audited `TransferMatch` with a rationale that records the date lag; it does not alter, exclude, or undo either transaction.
- Cash Flow trusts a valid explicit match regardless of posting-date lag and uses it exactly once. It retains warnings only for malformed, incomplete, or non-balancing matched records.
- Added regression coverage for the different-date match confirmation and its persisted rationale.

Verified: `npm run build`, `npm run desktop:build`, `npm run test:boundaries`, `npm run test:desktop-host` (17/17), and `git diff --check`. The Cash Flow fixture’s static oracle portion passes, but its browser production harness—and direct focused browser tests—cannot launch ChromeHeadless in this sandbox (it exits without stderr before tests execute). Rerun browser/release proof on the desktop host before release.

### Post-release guided-correction fix

Commit `5f422ef` fixes a post-release usability defect found while restoring a legacy database. If a posted transaction in an ordinary source account is paired with an Investing, Financing, or noncash Chart category, Cash Flow now creates a structured, actionable failure instead of showing an internal source-account ID or directing the person to an unrelated classification warning.

- The message identifies the transaction date and description, source account, current Chart category, and why the combination cannot be used in the statement.
- The Cash Flow workspace presents **Open transaction to correct category**. It takes the person directly to the exact posted transaction, limited to the source account and business date, so they can choose the appropriate Chart of Accounts category.
- The correction explicitly says not to change the source account’s Cash Role when the category is the problem.
- The example that prompted the fix was a January 31 `Goodwill` entry in the `Amazon` marketplace settlement account, incorrectly assigned to the `Goodwill` Other Asset/Investing category. The error path now points to that entry rather than the unrelated archived `Bad Debt` account.

The guided-correction browser tests passed 122/122. Application/specification TypeScript checks, `npm run build`, desktop packaging, code-signature verification, and `git diff --check` passed. A prior `npm run test:ci` wrapper run encountered an unrelated nondeterministic Cash Flow output-byte assertion in its production fixture gate; rerun the release-proof command before making a release claim.

### Post-release desktop startup and version-status follow-up (uncommitted)

The local desktop application can now reopen the schema-8 database created by
the earlier matched-payment work. The prior package understood only schema 7,
so it rejected the otherwise valid local database during host startup before
its deliberately hidden Electron window could be shown. This was an app
startup defect, not a macOS window-placement failure.

- Schema 8 is now a retained, validated compatibility boundary. It preserves
  the historical nullable `transfer_match` review columns but does not restore
  the retired separate Cash Flow transfer-review workflow.
- Fresh schema-7 databases migrate forward to schema 8; existing schema-8
  databases open without rewriting accounting records.
- The Electron startup promise now displays a native plain-English error
  dialog if opening the data fails, explicitly stating that data was not
  changed, rather than silently leaving no window.
- The rebuilt package was launched as a fresh instance from
  `site/release/TallyStick-darwin-arm64/TallyStick.app`.

Verified after this repair: production build, desktop host tests (17/17),
focused SQLite compatibility tests (11/11), desktop packaging, and
`git diff --check`.

The next planned usability/deployment work is documented in
`docs/APP_VERSIONING_AND_DATABASE_STATUS_PLAN.md`:

- Use `v0.4.0`-style release versions plus a strictly increasing numeric
  package build number.
- Increment the build number only when `desktop:package` creates a package;
  test and ordinary browser builds must not mutate it.
- Use a single tracked release manifest to generate renderer metadata and the
  macOS bundle's short-version/build-version values.
- In **Transactions** only, show `v<release> · build <number> · Database
  schema <number>` immediately to the right of `TALLYSTICK`, in the header
  above/alongside the Company settings action. The schema label must import
  the shared current-schema constant; it must never expose a database path,
  company ID, git hash, or per-database revision.

## Checkout context

- Path: visible saved-project repository root (no alternate checkout or worktree)
- Branch: `cash-flow`
- Baseline HEAD for this final release-proof pass: `b44a9f9c215abeb207071042572a6dd1cdd1bbf2`.
- Current HEAD: `5f422ef` (`various fixes`), also at `origin/cash-flow`.
- Current state: uncommitted post-release changes include the matched-payment
  confirmation, schema-8 startup compatibility, and related tests/docs. The
  packaged desktop application is `site/release/TallyStick-darwin-arm64/TallyStick.app`.
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
