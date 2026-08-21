# ADR-001 — MVP accounting basis

## Status

Proposed for accountant confirmation

## Decision

Use cash-basis P/L behavior for the MVP. The application reports posted transaction activity by business date and does not implement accrual or modified-cash adjustments.

## Rationale

The product's primary output is annual tax-preparation data for the accountant. The PRD identifies cash basis as the proposed MVP basis.

## Consequence

The accountant must confirm this basis before annual production use. A later basis adjustment must be implemented as an explicit report/application feature; it must not be hidden in import or posting behavior.
