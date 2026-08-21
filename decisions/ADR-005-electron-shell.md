# ADR-005 — Desktop shell

## Status

Accepted for the initial desktop spike

## Decision

Use Electron as the TypeScript-oriented desktop shell. The renderer runs the Angular application with `contextIsolation`, `nodeIntegration: false`, and sandboxing enabled. The preload bridge exposes only file selection and typed SQLite operations.

## Consequence

The shell can be replaced later without changing Angular application services. Packaging and signed-release behavior remain release-hardening work.
