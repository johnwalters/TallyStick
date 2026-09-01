# Matched-payment confirmation plan

> Superseded by the simpler implemented workflow below: a person confirms a
> different-date pair when selecting **Match transfer**. Cash Flow trusts that
> explicit match; it is not a second review surface for a user-made match.

## Problem

Cash Flow currently emits a generic Review required warning when a confirmed
transfer cannot be used safely (for example, its bank and credit-card posting
dates differ). The warning neither identifies the payments nor offers a way to
record a decision. A person must never be asked to infer which records or
classification to change from a Cash Flow warning.

Example: a card issuer may post a $40 payment on January 9 while the bank posts
the $40 withdrawal on January 12. That can be one legitimate payment with a
settlement delay; it is not a Cash Role or Chart of Accounts decision.

## Product outcome

Keep transfer confirmation in **Transactions**, where a person reviews
Pending entries. It is distinct from Cash Flow classifications and transaction
categorization.

For every suggested Pending pair with different dates, the user sees both
dates before choosing the single matching outcome:

1. **Match anyway as one payment** — confirms that the two recorded entries
   are the same payment despite an explained timing difference.
2. **Cancel** — leaves both entries Pending and unmatched.

The existing match decision is persisted and audited with its date-lag
rationale. Cash Flow preserves normal transfer treatment and never double
counts either endpoint.

## User flow

1. Cash Flow shows a warning card headed **Review 2 transfer matches** rather
   than a generic classification message.
2. The card lists each pair using meaningful data, for example:
   - `Chase CC $40.00 — Jan 9` ↔ `BofA Checking -$40.00 — Jan 12`
   - Reason: `The two institutions posted this matched payment 3 days apart.`
3. **Review transfers** opens a modal/list with each pair, descriptions,
   amounts, dates, source accounts, existing transfer rationale, and the
   Cash Flow effect if unresolved.
4. The user chooses **Keep as one payment** or **Unmatch** for each pair.
   Keeping requires a short rationale, prefilled with a plain-language
   suggestion such as `Bank settlement delay; both entries are the same card
   payment.`
5. Saving shows the new decision and returns to Cash Flow. Resolved pairs no
   longer appear in the warning. Unmatched entries return to normal Pending or
   transaction-review handling according to existing transfer rules.

## Data and audit model

Add a transfer-review record keyed by the stable transfer ID:

- `transferId`
- `decision`: `KEEP_AS_ONE_PAYMENT` or `UNMATCH`
- `rationale`
- `reviewedAtUtc`
- `reviewedBy` when the application has a user identity
- expected endpoint IDs and endpoint revision/timestamps for stale protection

Do not overwrite the original `TransferMatch` rationale. A review decision is
an additive audit record. Saving must be atomic with its audit event and must
advance the shared database revision.

`UNMATCH` uses the existing unmatch behavior and retains the review/audit
history. A later new match requires a new review decision; an old decision may
not be silently reused for changed endpoints.

## Cash Flow behavior

- Maintain the existing conservative rule: malformed, missing, unequal, or
  ambiguous endpoints must never be silently treated as a transfer.
- A valid user-reviewed settlement-delay pair may participate as its recorded
  confirmed transfer even when posting dates differ.
- A reviewed decision is valid only when both endpoint IDs, amounts, states,
  account roles, and transfer ownership still match the saved review record.
  Any change restores Review required status.
- Cash-to-cash pairs remain excluded from Operating, Investing, Financing,
  and Net Change. Cash-to-card payments remain represented once through their
  established operating-liability behavior. Restricted-cash rules remain
  unchanged.
- The report warning must contain user-facing endpoint summaries and an
  actionable `Review transfers` target. It must not expose raw IDs as the
  primary explanation.

## Implementation slices

### Slice 1 — Contract, migration, and repository

- Define transfer-review commands, result types, stale failures, and
  user-facing reason codes.
- Add schema migration, SQLite/in-memory parity, audit records, backup/restore
  support, and snapshot inclusion.
- Add repository tests for atomic save, stale endpoints, endpoint changes,
  restore, and audit preservation.

### Slice 2 — Transfer review service

- Build a pure review projection from a single immutable snapshot.
- Produce deterministic pair labels, reasons, Cash Flow effects, and order.
- Implement keep/unmatch commands with required rationale and revision checks.
- Update Cash Flow transfer validation to accept only still-valid reviewed
  settlement-delay decisions.

### Slice 3 — UI and Cash Flow integration

- Add the Transfer review surface and link it from each Cash Flow warning.
- List every affected pair; provide side-by-side endpoint details and clear
  consequences before save.
- Add accessible confirmation controls, error copy, empty states, focus
  handling, and return-to-report behavior.
- Remove the misleading generic classification wording for transfer problems.

### Slice 4 — regression and acceptance proof

- Add production-service and browser coverage for same-day matches,
  reviewed 1–7 day settlement delays, unmatch, unequal amounts, stale/missing
  endpoints, duplicate claimants, Pending/Excluded endpoints, restricted cash,
  repeated decisions, audit history, deterministic ordering, and zero-row
  invariance.
- Verify Balance Sheet/Cash Flow parity, exact minor-unit reconciliation,
  no mutation outside explicit commands, cache invalidation, SQLite/in-memory
  parity, backup/restore, and no double counting.

## Acceptance criteria

- No generic transfer warning asks a person to guess which transactions need
  attention.
- Every warning names all affected payment pairs in plain language and opens
  their review records.
- Keeping a valid settlement-delay match removes its warning after save and
  changes no unrelated Cash Flow total.
- Unmatching removes the transfer relationship through the existing controlled
  workflow and makes resulting transaction work visible.
- Review decisions survive restart, backup/restore, and are auditable.
- Changed or stale endpoints cannot inherit a past decision.
- Existing confirmed same-day transfers, restricted-cash presentation, and
  malformed-transfer safeguards remain correct.

## Out of scope

- Automatic approval of transfer candidates.
- Changing transaction dates to make a transfer pass validation.
- Reclassifying Cash Roles or Chart categories to resolve transfer timing.
- Direct-method Cash Flow, exports beyond existing report provenance, and
  unrelated transaction-matching redesign.
