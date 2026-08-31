# TallyStick

TallyStick is a local-first desktop accounting application for small businesses and independent operators. It provides a reviewable bookkeeping workflow—from statement import through categorization, posting, and financial reporting—without requiring a cloud account, live bank connection, or hosted database.

The application is built with Angular, TypeScript, Electron, and SQLite. Your books remain in a local SQLite file that you control.

Inspired by Quickbooks and the desire to avoid seeing ads on a constant basis.

All code created by (ChatGPT) models. Kudos to everybody who put stuff on the web to be absorbed. 

## What TallyStick does today

- Maintains bank, credit-card, marketplace, and other transaction-source accounts.
- Imports CSV, XLS/XLSX, QBO, OFX, QFX, and marketplace-summary (for example, Amazon sales and cost of sales data) files.
- Previews imports before committing them, with row-level errors, source provenance, reusable mappings, and exact-zero rejection.
- Provides Pending, Posted, Excluded, and Matched Transfer transaction states with state-appropriate actions.
- Supports transaction categorization, splits, payee, memo, tags, exclusions, undo, and bulk workflows.
- Applies deterministic categorization rules and prior-confirmed matches without silently posting transactions.
- Includes in-app rule creation, editing, copying, ordering, testing, enable/disable, deletion, and spreadsheet exchange.
- Matches transfers between bank and credit-card accounts without affecting profit.
- Maintains a hierarchical Chart of Accounts with import/export support and guarded replacement.
- Produces Profit & Loss summary and detail reports with drill-down and reconciliation.
- Produces an as-of-date Balance Sheet with Assets, Liabilities, Equity, Current Earnings, Retained Earnings, Opening Balance Equity, exact drill-down, warnings, and an explicit accounting-equation Difference.
- Exports the Balance Sheet to UTF-8 CSV and verified two-sheet XLSX, and opens a print/PDF-ready preview without automatically printing.
- Produces an indirect-method Statement of Cash Flows with explicit cash classifications, Operating/Investing/Financing sections, supplemental noncash disclosures, exact reconciliation and drill-down, and deterministic CSV/XLSX/print/PDF parity.
- Produces a Schedule C-ready reporting view with disclosed, tax-year-specific adjustments that do not alter the underlying ledger.
- Exports accounting and report data to CSV and XLSX and supports print-ready output.
- Creates verified SQLite backups, restores validated backups, and safely relocates the active database.
- Preserves an audit trail for accounting and administrative changes.

## Quick start

Prerequisites:

- Node.js and npm
- Google Chrome or Chromium for the headless test suite
- macOS for the current desktop packaging script

Run the desktop application:

```bash
cd site
npm install
npm run desktop:start
```

The desktop command builds the Angular renderer and desktop host, packages the branded macOS application, then opens `TallyStick.app` with the TallyStick name and icon. The default database is `tallystick.sqlite` under the application's per-user data directory.

After the application has been built once, `npm run desktop:launch` opens the existing TallyStick bundle without rebuilding it. `npm run desktop:launch:electron` remains available for framework-level development, where macOS will identify the process as Electron.

For browser-only UI development:

```bash
cd site
npm start
```

The browser version is useful for interface development, but it does not provide Electron's durable filesystem and SQLite bridge.

## Build and test

```bash
cd site
npm run test:ci
npm run build
npm run test:desktop-host
npm run test:cash-flow-release-proof
```

The test suite covers domain behavior, imports, transaction state changes, rules, persistence, reports, backups, feature facades, and Angular UI behavior.

To build a clickable macOS application bundle:

```bash
cd site
npm run desktop:package
```

The bundle is written to `site/release/TallyStick-darwin-<architecture>/TallyStick.app`.

## Local data and backups

TallyStick does not require an HTTP service, bank credentials, analytics service, or cloud synchronization. Electron owns the local SQLite file and exposes a narrow typed bridge to the Angular application.

The **Backups** workspace can:

1. Select a backup directory.
2. Create and independently verify a timestamped SQLite backup.
3. Relocate the active database after making a safety backup and validating the new copy.
4. Restore a selected backup without modifying the backup file.

Backup and restore operations use temporary files, integrity checks, foreign-key checks, and atomic activation so a failed operation leaves the current books intact.

## Completed Balance Sheet milestone

The Balance Sheet is calculated from ledger detail rather than stored report totals. It includes:

- Assets, liabilities, and equity with hierarchical subtotals.
- Derived Current Earnings, Retained Earnings, and Opening Balance Equity.
- An explicit `Assets = Liabilities + Equity` reconciliation check.
- Drill-down from every report line to its contributing balances and transactions.
- Shared screen, CSV, XLSX, detail, print, and PDF values.
- Configurable company identity and accounting defaults used consistently across the application and reports.
- A unified accounting account taxonomy and Balance Sheet placement preview.
- Migration of legacy marketplace/entity accounts without changing stable IDs or transaction history.

The requirements, implementation contracts, and verification evidence are in the [Balance Sheet PRD](docs/Balance%20Sheet%20PRD.md), [Balance Sheet Product Specification](docs/Balance%20Sheet%20PRODUCT_SPEC.md), and [Balance Sheet Task Tracker](docs/Balance%20Sheet%20TASKS.md).

## Completed Statement of Cash Flows milestone

The Statement of Cash Flows uses one immutable, revision-consistent report for the workspace, exact detail, CSV, verified three-sheet XLSX, print preview, and native PDF rendering. It includes:

- Indirect-method Operating, Investing, and Financing activity in integer minor units.
- Explicit cash, cash-equivalent, restricted-cash, and account-treatment classifications without account-name inference.
- Transfer elimination, opening-balance diagnostics, supplemental noncash disclosures, typed warnings, and an explicit Difference.
- Stale-revision rejection, deterministic caching and invalidation, and read-only report/output behavior.
- Neutral A1-A20 acceptance fixtures, performance budgets, privacy checks, full regressions, backup/restore coverage, and isolated Electron smoke proof.

The requirements and release evidence are in the [Statement of Cash Flows PRD](docs/Statement%20of%20Cash%20Flows%20PRD.md), [Statement of Cash Flows Product Specification](docs/Statement%20of%20Cash%20Flows%20PRODUCT_SPEC.md), and [Statement of Cash Flows Task Tracker](docs/Statement%20of%20Cash%20Flows%20TASKS.md).

## Future feature candidates

- Comparative Balance Sheet columns and financial ratios.
- General journal entries and explicit closing entries.
- PDF/OCR statement import.
- Optional direct bank connectors.
- Marketplace payout and clearing automation.
- Duplicate-transaction detection with reviewable decisions.
- Optional assisted categorization while retaining explainability and user control.
- Multi-company, multi-user, collaboration, and synchronization capabilities.

The Balance Sheet and Statement of Cash Flows milestones are complete. These are candidates for the next product discussion, not committed work or promises for a particular release.

## Architecture

- Application contracts: `site/src/app/core/application-interface`
- Domain and application services: `site/src/app/core`
- Feature facades: `site/src/app/features`
- SQLite boundary: `site/src/app/core/sqlite-gateway`
- Import adapters: `site/src/app/core/import-services`
- Electron host and filesystem bridge: `site/src/desktop-host`

The renderer depends on typed application interfaces rather than SQL, filesystem APIs, or Electron objects. SQLite execution and native file operations stay behind dedicated boundaries, while isolated tests can substitute the in-memory repository.

Architectural decisions are recorded under `decisions/`.

## Documentation

- [Product Requirements](docs/Quicken%20Replacement%20PRD.md)
- [Product Specification](docs/PRODUCT_SPEC.md)
- [Technical Architecture](docs/Quicken%20Replacement%20Technical%20Architecture.md)
- [Implementation Plan](docs/accounting_plan.md)
- [Implementation Task Tracker](docs/tasks.md)
- [Completed Balance Sheet milestone documents](docs/Balance%20Sheet%20PRD.md)

## Repository layout

- `site/` — Angular application, Electron host, SQLite integration, tests, and build configuration.
- `docs/` — Product requirements, specifications, implementation plans, and feature roadmaps.
- `decisions/` — Architectural decision records.
- `fixtures/` — Small deterministic import fixtures used by automated tests.
- `sample-data/` — Optional two-year demo dataset with import examples and expected P/L and Balance Sheet results.

## Project status

TallyStick has reached a feature-complete checkpoint through core bookkeeping, rule management, P/L reporting, the first Balance Sheet release, exports, print preview, and local database recovery. No next feature has been selected yet. The application remains open to further development, and the future-feature list above will be prioritized separately. Database migrations are versioned, but forks should still keep verified backups before upgrading or modifying accounting behavior.
