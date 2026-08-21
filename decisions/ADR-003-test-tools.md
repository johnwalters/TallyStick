# ADR-003 — Test tools

## Status

Accepted for the initial workspace

## Decision

Use Angular CLI with Jasmine/Karma and ChromeHeadless for unit, application-service, fixture, facade, and contract tests. The standard CI-style command is `npm run test:ci`.

## Consequence

The browser runner requires permission to bind a local test port in restricted environments. Tests remain deterministic, offline, and isolated.
