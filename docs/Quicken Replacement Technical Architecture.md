# Replace the interface. Keep the application.

*Technical Architecture Document · Draft 0.2*

Companion: [← Product requirements](Quicken%20Replacement%20PRD.md)

The Quicken Replacement will be an Angular application from end to end: replaceable Angular UI components over stable Angular application, accounting, import, reporting, and persistence-gateway services, with local SQLite and automated tests that prove behavior from source file to report.

- **Companion document:** **[Quicken Replacement PRD · Draft 0.3](Quicken%20Replacement%20PRD.md)**
- **Persistence:** **Local SQLite only**
- **Network server:** **None required**

**Architectural intent:** Angular is the application framework, not merely the presentation technology. The UI components, routes, and presentation state may be replaced wholesale while the non-UI Angular services for accounting, imports, transactions, reports, and persistence coordination remain intact.

- **1** — Supported database: SQLite
- **0** — Required HTTP endpoints
- **3** — Initial import families
- **7** — Automated test layers

*01 · Decision record*

## Decisions already made

**Angular throughout the application**

The UI and non-UI application code are written in Angular and TypeScript. Angular dependency injection manages feature facades, application services, accounting services, import orchestration, rules, reports, repository gateways, backup coordination, and other application dependencies.

**Stable Angular Application Service Interface**

All application capabilities are available through typed Angular-injectable services and contracts that are independent of any particular component tree. It is deliberately not described as a Web API and does not imply HTTP.

**Replaceable Angular UI**

A new Angular UI—components, templates, routes, and presentation state—can replace the original while retaining the non-UI Angular application and business services.

**Local SQLite only**

SQLite is the sole supported database. SQL Server portability and multi-provider testing are not requirements. Database isolation is retained to protect the application from persistence details, not to pre-build a second provider.

**Adaptable import boundary**

CSV, Excel, and QBO/OFX are initial adapters. A future PDF parser or bank connector can be added by implementing the same importer contract without changing transaction posting or reporting.

**Testing is product work**

Every public application operation and every meaningful accounting or parsing function has automated tests for success, failure, and relevant boundaries. Real sample files and real temporary SQLite databases are part of the test strategy.

**Explicitly not selected**

No .NET backend, no SQL Server support, no required HTTP service, no separate framework-neutral business application behind Angular, and no direct database access from Angular UI components.

*02 · Guardrails*

## Architectural principles

### 1. Angular services are the application

UI components depend on injected Angular facades and application services. Those Angular services own application orchestration and business behavior; they are not thin clients for a separate backend.

### 2. One path to each capability

The current UI, a replacement UI, automated tests, and future tools invoke the same application operations rather than duplicating business logic.

### 3. Accounting behavior is explicit

Angular accounting and domain services define Money, transaction states, posting, splits, transfers, exclusions, report adjustments, and audit behavior with named rules and direct tests. Pure value objects may remain plain TypeScript inside the Angular workspace.

### 4. Infrastructure is reached through Angular gateways

Angular importer, repository, filesystem, export, and backup gateway services isolate privileged adapters. Replacing an adapter does not require changes to the UI or application services.

### 5. No silent accounting decisions

Malformed source rows, sign ambiguity, exclusions, tax-report adjustments, and failed persistence operations produce visible, typed outcomes.

### 6. Tests use the real seams

Pure rules are unit tested. File adapters read real sanitized fixtures. Persistence tests use real SQLite. A small end-to-end suite verifies the assembled product.

*03 · System shape*

## Layered architecture

1. **Replaceable Angular UI** — Components, templates, routes, feature state, view models
2. **Angular feature facades** — UI orchestration and presentation-friendly state
3. **Stable Angular Application Service Interface** — Injectable services, typed commands, queries, DTOs, and errors
4. **Angular application and accounting services** — Transactions, rules, reports, imports, audit, backup
5. **Angular infrastructure gateway services** — Repositories, importers, exports, filesystem, SQLite bridge
6. **Minimal privileged desktop adapters** — SQLite driver and local filesystem access; no business rules
7. **Local resources** — SQLite company database, source files, attachments, backups

### Angular UI

Replaceable Angular components render view models and forward user intent. No accounting rules, SQL, file parsing, or persistence entities appear in UI components.

### Angular facades

Injectable Angular feature facades translate UI actions into Application Service Interface calls and expose loading, success, validation, and failure state to components.

### Angular application

Injectable Angular use-case services coordinate transactions, repository gateways, importers, reports, auditing, and transaction boundaries. This is the stable functional surface retained when the Angular UI is replaced.

### Angular business services

Angular accounting and domain services implement posting, splits, transfers, category rules, report inclusion, and reconciliation. Small immutable value objects may be plain TypeScript classes within the Angular project where dependency injection adds no value.

### Angular gateways

Injectable Angular repository, importer, export, filesystem, and backup gateway services present typed infrastructure operations to the rest of the Angular application.

### Native adapters

A minimal TypeScript desktop boundary executes privileged SQLite-driver and filesystem operations that the sandboxed Angular runtime cannot safely perform. It contains no accounting, import-mapping, posting, or reporting decisions.

*04 · Stable functional boundary*

## Angular Application Service Interface

The Application Service Interface is implemented by Angular-injectable services and supported by TypeScript contracts. It is not a network protocol. It defines every user-visible capability independently of the replaceable Angular component tree.

```typescript
export interface AccountingApplication {
  readonly accounts: AccountApplicationService;
  readonly imports: ImportApplicationService;
  readonly transactions: TransactionApplicationService;
  readonly rules: RuleApplicationService;
  readonly reports: ReportApplicationService;
  readonly backups: BackupApplicationService;
}

export interface TransactionApplicationService {
  list(query: TransactionQuery): Promise<TransactionPageDto>;
  get(id: TransactionId): Promise<TransactionDetailDto>;
  update(command: UpdateTransactionCommand): Promise<TransactionDetailDto>;
  post(command: PostTransactionCommand): Promise<PostedTransactionDto>;
  exclude(command: ExcludeTransactionCommand): Promise<ExcludedTransactionDto>;
  undo(command: UndoTransactionCommand): Promise<PendingTransactionDto>;
}

export const ACCOUNTING_APPLICATION =
  new InjectionToken<AccountingApplication>('AccountingApplication');

@Injectable({ providedIn: 'root' })
export class DefaultAccountingApplication implements AccountingApplication {
  // Composes the Angular application services retained across UI replacements.
}
```

### Contract rules

- Expose capabilities through injected Angular services.
- Use commands and queries with explicit inputs.
- Return immutable DTOs, not database rows or component-specific view models.
- Return typed validation and application errors.
- Do not expose SQLite connections, SQL, repository objects, or lazy queries.
- Do not accept components, forms, templates, or browser events.
- Treat interface changes as reviewed architectural changes.

### Replacement test

A replacement Angular UI is viable when it can perform every PRD workflow using only this interface and shared DTO definitions. If it must import a repository, parser, SQLite type, or old component, the boundary has failed.

*05 · Whole-application Angular design*

## Angular with heavy service usage

| Construct | Responsibility | Must not do |
| --- | --- | --- |
| Page component | Compose feature components, bind view state, and forward user actions. | Contain accounting rules, parse files, construct SQL, or coordinate multi-step persistence. |
| Feature component | Render reusable transaction, import, account, rule, or report controls. | Know how data is stored or how source files are parsed. |
| Feature facade | Own presentation state and translate UI intent into application-interface calls. | Reimplement domain rules or bypass the Application Service Interface. |
| View-model mapper | Convert application DTOs into labels, table rows, summaries, and display state. | Change financial amounts or make posting decisions. |
| Application service | Implement a complete use case as an injectable Angular service, coordinating business services and gateways. | Depend on components, templates, routes, or component state. |
| Accounting/domain service | Implement posting, split, transfer, rule, Money, P/L, tax-adjustment, and reconciliation behavior inside the Angular application. | Access the DOM, SQLite driver, or filesystem directly. |
| Importer/report service | Implement import orchestration, normalization, validation, report construction, and drill-down as Angular services. | Put parsing or financial logic into UI components or the desktop host. |
| Repository/gateway service | Provide Angular-injectable persistence and local-resource operations through typed interfaces. | Expose SQL, native handles, or desktop-shell details to application services. |

**UI state may change; the application contract remains**

The original Angular UI may use one routing, state-management, or component strategy and its replacement may use another. Both call the same application operations and receive the same DTOs and typed outcomes.

*06 · Local execution*

## Desktop runtime without a Web API

The complete UI and non-UI application—including application services, accounting rules, import orchestration, reports, repository gateways, and backup coordination—runs in Angular. Because Angular runs in a browser-like renderer, a minimal desktop adapter performs privileged SQLite-driver and filesystem calls through a narrow typed bridge.

1. **Angular application** — UI, facades, application services, accounting, imports, reports, gateways
2. **Typed local bridge** — Internal calls; no HTTP requirement
3. **Minimal desktop adapter** — SQLite driver and filesystem access only; no application logic

**Desktop shell remains to be selected**

Electron is the natural TypeScript-oriented candidate because it can host Angular and a Node-capable application process. The exact shell and bridge library should be chosen through a small technical spike; the Application Service Interface must remain independent of that choice.

### Security boundary

- Keep the Angular runtime sandboxed.
- Keep all business decisions in Angular services.
- Expose only the minimum typed SQLite and filesystem operations required by Angular gateways.
- Validate bridge inputs in the Angular application and again at the privileged boundary.
- Do not expose arbitrary filesystem, process-execution, or module-loading functions.
- Do not place database paths or source-file contents into browser storage.

*07 · Local data*

## SQLite persistence

### Database boundary

- One local SQLite company database is the system of record.
- Angular application services depend on focused Angular repository and query services.
- Angular repository gateways own application-facing persistence behavior; the minimal desktop adapter owns native SQLite-driver execution.
- Do not build a generic repository abstraction that merely mirrors CRUD.
- Complex report queries use focused Angular services such as `ProfitLossQueryService` .

### Reliability requirements

- Enable and verify foreign-key enforcement.
- Wrap multi-record operations in database transactions.
- Maintain an explicit schema version and ordered migrations.
- Create a recoverable backup before applying a migration.
- Run integrity checks during backup and expose failures clearly.
- Never edit stored report totals; recalculate reports from posted detail.

| Concern | Canonical representation | Reason |
| --- | --- | --- |
| Money | Signed 64-bit integer minor units, exposed through a `Money` value object | Exact sums and comparisons without floating-point rounding. |
| Transaction date | Calendar date independent of time zone | Bank and tax reporting is based on the source business date. |
| Audit time | UTC timestamp | Consistent ordering of application events. |
| Identity | Application-generated opaque identifiers | Records are not coupled to SQLite row-number behavior. |
| Original source | Immutable normalized source fields plus import-batch reference | Edited accounting values remain traceable to imported data. |
| Attachments | Managed local files with database metadata and hashes | Keeps the database focused while preserving backup integrity. |

**No speculative SQL Server layer**

Repositories isolate persistence because it is sound design and improves tests—not because a second database is promised. SQL Server provider configuration, provider-neutral migrations, and dual-database CI are explicitly out of scope.

*08 · Extensibility*

## Adaptable import architecture

1. **Select source and destination account** — UI supplies intent; it does not parse the file
2. **Detect and parse through an importer adapter** — CSV, Excel, or QBO/OFX
3. **Normalize to transaction candidates** — Dates, signs, descriptions, source metadata
4. **Validate and preview** — Accepted, rejected, skipped, warnings
5. **Commit one import batch** — Atomic creation of Pending transactions and audit data

```typescript
export interface TransactionImporter {
  readonly kind: ImportSourceKind;
  canRead(source: ImportSourceDescriptor): Promise<boolean>;
  inspect(source: ImportSource): Promise<ImportInspection>;
  parse(source: ImportSource, mapping: ImportMapping): AsyncIterable<ParsedRow>;
}

export interface ImportNormalizer {
  normalize(row: ParsedRow, context: ImportContext): NormalizedTransactionCandidate;
}
```

### Adapter obligations

- Never modify the source file.
- Preserve source row and batch provenance.
- Report row-level errors rather than silently discarding activity; normalized zero-amount transactions are rejected individually without rejecting their batch.
- Produce the shared normalized candidate model.
- Keep posting, categorization, and reporting outside the adapter.
- Pass the shared importer contract test suite.

### Future sources

A PDF importer may add OCR and layout interpretation before producing normalized candidates. A bank connector may retrieve data instead of reading a local file. Neither changes the validation, preview, posting, rule, or reporting workflows.

**Formats:** CSV, Excel, QBO/OFX, Future PDF, Future bank connection

*09 · Verification architecture*

## Automated testing strategy

**Testing rule:** every public application operation and every meaningful accounting or parsing function must have automated tests covering successful execution, expected failures, and relevant boundary conditions.

### T1 — Angular business-service unit tests

Fast tests for Angular accounting services and their Money, state-transition, split, transfer, rule, report-inclusion, tax-adjustment, and reconciliation behavior.

### T2 — Angular application-service unit tests

Each injected Angular command and query service is tested through repository, clock, identifier, importer, and audit test doubles. Tests prove orchestration and typed outcomes.

### T3 — Application-interface contract tests

A reusable suite proves that the assembled application implementation satisfies the stable interface expected by any Angular UI.

### T4 — Importer fixture tests

Sanitized real files are parsed, normalized, and compared field-by-field and total-by-total with explicit expected results.

### T5 — SQLite integration tests

Real temporary SQLite databases verify migrations, constraints, repositories, transactions, reports, audit history, backup, and restore.

### T6 — Angular UI and facade tests

Components and facades use fake Angular application services to verify rendering, user intent, validation, loading, and error state without files or SQLite.

### T7 — End-to-end tests

A small suite drives the packaged application through representative import, review, post, report, adjustment, backup, and restore workflows.

**Meaningful function standard**

Private helpers are tested through observable behavior unless they contain independent accounting or parsing decisions. Trivial getters and framework-generated wiring do not require ceremonial tests. Every public application method and every decision branch that can change a financial result does.

*10 · Source-file proof*

## Fixture-driven functional tests

```text
fixtures/
  imports/
    bofa/
      checking-valid.csv
      checking-invalid-date.csv
      expected-transactions.json
    amex/
      statement-valid.xlsx
      expected-transactions.json
    amazon/
      monthly-summary.csv
      summary-with-zero-amounts.csv
      expected-transactions.json
    qbo/
      checking-valid.qbo
      expected-transactions.json
  unit/
    domain/
    application/
  contract/
    application-interface/
    importers/
  integration/
    sqlite/
  angular/
  end-to-end/
```

### Each fixture asserts

- Accepted, rejected, and skipped row counts.
- Date, signed amount, description, payee, reference, and source account.
- Original source values and batch provenance.
- Validation codes and human-readable reasons.
- Exact-zero rows from every source are rejected with a stable row-level reason.
- Every source row is accounted for and one rejected row does not prevent valid batch rows from committing.
- Expected transaction totals reconcile to parsed totals.

### Fixture rules

- Sanitize personal and account identifiers.
- Keep fixtures small enough to understand.
- Add a fixture for every production parsing defect.
- Never depend on internet access or a live bank.
- Never overwrite a fixture during a test.
- Store expected values separately and review changes intentionally.

*11 · Definition of done*

## Quality gates

1. Every public Application Service Interface method has success, failure, and boundary tests appropriate to its behavior.
2. Money, posting, undo, splits, P/L aggregation, tax-report adjustments, transaction rules, and import normalization achieve 100% branch coverage.
3. The wider codebase maintains a high agreed coverage threshold; coverage never substitutes for meaningful assertions.
4. All tests are deterministic, order-independent, repeatable, and able to run without network access.
5. Every test creates its own temporary files and SQLite database or receives isolated test doubles.
6. All report totals reconcile exactly to the contributing posted transaction lines exposed through drill-down.
7. Every import adapter passes the shared contract suite and its source-specific fixtures.
8. Schema migrations are tested from a representative previous database version, not only from an empty database.
9. Backup tests restore into a new location and verify record counts, financial totals, schema version, attachments, and integrity.
10. A change cannot be accepted while required automated tests fail.

| PRD behavior | Required automated proof |
| --- | --- |
| Import preview | Fixture tests prove mapping, sign normalization, errors, counts, and atomic commit. |
| Zero amounts | Every normalized zero-value transaction is rejected individually with a reason; the remaining valid batch rows continue. |
| Pending → Posted | Posted amount enters the correct P/L line once and has an audit event. |
| Exclude and undo | Any pending item can be excluded with a reason; undo restores the correct state and report effect. |
| Split transaction | Balanced splits post; under- and over-allocated splits fail without partial persistence. |
| Transfer | Confirmed bank/card transfer affects balances but not net profit. |
| P/L drill-down | Displayed total equals the exact sum of returned contributing postings. |
| Schedule C-ready view | Federal tax is removed by default, state/local tax retained by default, yearly overrides work, and the unadjusted P/L is unchanged. |

*12 · Code organization*

## Proposed project structure

```text
site/
  src/
    app/
      ui/
        app-shell/
        pages/
        components/
        routes/
        view-models/
      features/
        accounts/
        imports/
        transactions/
        rules/
        reports/
        backups/
      core/
        application-interface/
        application-services/
        accounting-services/
        domain-model/
        import-services/
        report-services/
        repository-gateways/
        filesystem-gateways/
        backup-services/
      infrastructure/
        import-adapters/
          csv/
          excel/
          qbo-ofx/
        sqlite-gateway/
        export-adapters/
    desktop-host/
      bridge/
      sqlite-driver/
      filesystem-adapter/
docs/
decisions/
fixtures/
sample-data/
```

All business and application logic resides under the Angular `site/src/app` workspace. The desktop host resides under `site/src/desktop-host` and remains a minimal privileged adapter with no accounting or application behavior. Project documentation, architectural decisions, test fixtures, and source reference material remain outside the application workspace.

*13 · Follow-up decisions*

## Open technical decisions

**Desktop shell and bridge**

Select the local desktop host and typed Angular-to-native bridge. Electron is the current recommendation to evaluate first; acceptance must prove that application and business logic remain in Angular while the host is limited to sandboxed SQLite-driver and filesystem operations.

**SQLite library and migration tooling**

Select the TypeScript/Node SQLite access library after a focused comparison. It must support transactions, migrations, parameterized queries, test isolation, backup needs, and the chosen desktop runtime without leaking its types into application contracts.

**Angular state approach**

Select the presentation-state convention used inside feature facades. This is a UI implementation choice and must not alter the stable Application Service Interface.

**Backup bundle format**

Define how the SQLite database, attachments, metadata, and integrity manifest are packaged and restored as one recoverable local backup.

**Test runner and coverage enforcement**

Select the TypeScript and Angular test tools used by the workspace, then encode the required suites and thresholds in the standard local and continuous-integration commands.

*14 · Relationship to requirements*

## Document authority

The Product Requirements Document remains authoritative for product behavior. This Technical Architecture Document is authoritative for dependency direction, boundaries, persistence scope, extensibility mechanisms, and automated-testing obligations.

If the documents conflict:

1. Product behavior follows the PRD.
2. Implementation structure follows this architecture document unless a recorded architecture decision supersedes it.
3. A change that crosses either boundary updates the relevant document before it is considered complete.

Quicken Replacement Technical Architecture · Draft 0.2 · Prepared August 5, 2026 · Companion to PRD Draft 0.3
