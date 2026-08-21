# ADR-006 — Initial SQLite driver

## Status

Accepted for the initial implementation slice

## Decision

Use SQLite WASM through `sql.js` behind the Angular `SqliteDatabaseGateway` and the Electron host bridge. Database bytes are opened, migrated, queried with parameters, exported, and written locally; business logic remains in Angular services.

## Consequence

This keeps one SQLite implementation across browser tests and the initial desktop spike. A later native SQLite driver may replace the gateway/host adapter without changing the Application Service Interface, repositories, imports, or reports.
