# Balance Sheet classification-review fix plan

## Problem

A user can save a valid Cash Flow classification for a financial-source account, yet the Balance Sheet continues to label that same nonzero account `Unclassified` and emits `<account> requires account classification review.`

Example: `Assets > Other Current Assets > Other Transactions` has a persisted Cash Flow classification of `cashRole: NOT_CASH` and `treatment: OPERATING_ASSET`, but remains `classificationStatus: REVIEW_REQUIRED` on the financial account. The Balance Sheet reads the latter field, not the saved Cash Flow classification, so the warning cannot be cleared through the available workflow.

## Goal

Treat an explicit, valid, user-confirmed Cash Flow classification for a financial-source account as confirmation of that account's outstanding generic classification review. The persisted account status, Cash Flow review, and regenerated Balance Sheet must agree.

## Scope and constraints

- Change only the confirmation path for `FINANCIAL_SOURCE` accounts.
- Do not infer confirmation from defaults, previews, invalid classifications, or a treatment/cash-role of `REVIEW_REQUIRED`.
- Do not change a chart account's status; chart accounts do not carry `classificationStatus`.
- Preserve optimistic-concurrency behavior, auditability, import/export contracts, and unrelated dirty-worktree changes.
- Do not change balance calculations or suppress warnings merely in the presentation layer.

## Implementation steps

1. Define the confirmation invariant in `CashFlowClassificationService`.

   A save is an account-classification confirmation only when all of the following hold:

   - `accountRole === 'FINANCIAL_SOURCE'`;
   - validation succeeds;
   - the normalized classification has `status === 'CONFIRMED'`; and
   - the target financial account currently has `classificationStatus === 'REVIEW_REQUIRED'`.

2. Persist the classification and account-status update atomically.

   In `CashFlowClassificationService.save`, wrap the valid classification write and the financial-account update in the repository transaction boundary. Update only the target account's `classificationStatus` from `REVIEW_REQUIRED` to `CONFIRMED`; do not alter its account type, detail type, parent, import capability, or balances.

   Record a dedicated audit event that includes the prior and resulting financial account, the linked Cash Flow classification ID/role, and the user-provided rationale. A stale write or validation failure must leave both records unchanged.

3. Apply identical semantics to confirmed spreadsheet imports.

   In `commitImport`, after a successful atomic batch of valid classification updates, confirm only financial-source accounts represented by confirmed imported rows. Keep the entire import atomic: a stale or invalid import changes neither Cash Flow classifications nor financial-account statuses.

4. Report the impact accurately.

   In `CashFlowClassificationSaveImpact`, list `BALANCE_SHEET` as affected when the financial account status changed, in addition to `CASH_FLOW`. Keep the existing Cash Flow-only impact for chart-account saves and source-account saves that did not change the account status.

5. Refresh affected report state in the application UI.

   In `AppComponent.saveClassificationEditor`, retain Cash Flow invalidation. When the returned impact includes `BALANCE_SHEET`, reload the current Balance Sheet query if a Balance Sheet report is already loaded (or mark it stale if the product's report-refresh policy requires an explicit user refresh). Update the success copy to say which report was refreshed or marked stale.

6. Keep Balance Sheet warning logic authoritative but unchanged in principle.

   `BalanceSheetReportService` should continue to flag nonzero financial-source accounts whose persisted `classificationStatus` is `REVIEW_REQUIRED`. Once the transaction above confirms the account, a regenerated Balance Sheet naturally removes both the row's `Unclassified` label and `UNCLASSIFIED_NONZERO_ACCOUNT` warning. Do not add a special-case exclusion for `Other Transactions`.

## Tests and acceptance evidence

1. `CashFlowClassificationService` unit tests:

   - Start with a nonzero `OTHER_CURRENT_ASSET` source account whose account status is `REVIEW_REQUIRED`.
   - Save a valid `NOT_CASH` / `OPERATING_ASSET` classification with a rationale.
   - Assert the classification is confirmed, the same source account is now `CONFIRMED`, a classification-confirmation audit event exists, and the save impact lists Balance Sheet.
   - Assert invalid, `REVIEW_REQUIRED`, stale, and chart-account saves do not alter a financial account's generic status.

2. Import tests:

   - A confirmed source-account row clears its source status on commit.
   - Invalid or stale imports leave every affected account status and classification unchanged.
   - Chart-only import rows never mutate financial-account statuses.

3. Balance Sheet integration test:

   - Generate a report before confirmation and assert `Other Transactions` is unclassified and produces `UNCLASSIFIED_NONZERO_ACCOUNT`.
   - Save the valid source classification, regenerate with the same as-of date, and assert the row is no longer unclassified and the warning is absent; totals and detailed contributions remain byte-for-byte equivalent.

4. Application/UI test:

   - From Cash Flow Review, save the confirmed source classification.
   - Verify the save message identifies the Balance Sheet as affected and a currently loaded Balance Sheet no longer displays the stale warning after its specified refresh behavior.

5. Required validation:

   - focused Cash Flow classification, Balance Sheet report, and AppComponent tests;
   - `npm run test:boundaries`;
   - `npm run build`;
   - `git diff --check`.

## Acceptance criteria

- Saving the valid `Other Transactions` source classification clears its Balance Sheet `Unclassified` marker and warning after regeneration.
- The behavior is generic and works for any eligible reviewed financial-source account; no account name or ID is hard-coded.
- Invalid, unresolved, stale, and chart-only classification changes cannot clear a source-account review status.
- The complete operation is atomic, auditable, and leaves financial statement totals unchanged.
