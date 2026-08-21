# ADR-004 — Versioned backup bundle

## Status

Accepted for the initial application slice

## Decision

Represent the portable backup as a versioned JSON envelope containing schema version, UTC creation time, serialized application data, and a deterministic integrity hash. Verification occurs before restore.

## Consequence

The envelope is a foundation for the final local-file backup package. Attachment packaging, encryption, and validation-location activation remain follow-up work before production bookkeeping.
