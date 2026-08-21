# ADR-002 — Angular feature-facade state

## Status

Accepted

## Decision

Use Angular signals inside injectable feature facades for loading, data, selection, and error state. Components call facades or the stable Application Service Interface and do not own accounting state.

## Consequence

A replacement Angular UI may use another presentation-state convention while retaining the same application contracts. Signals are a UI/facade choice, not a domain or persistence contract.
