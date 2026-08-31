# TallyStick Statement of Cash Flows

*Product Requirements Document · Version 1.0 · Implemented August 31, 2026*

Companion documents: [TallyStick Product Specification](PRODUCT_SPEC.md) · [Statement of Cash Flows Product Specification](Statement%20of%20Cash%20Flows%20PRODUCT_SPEC.md) · [Balance Sheet PRD](Balance%20Sheet%20PRD.md)

## 1. Product summary

TallyStick provides a period-based Statement of Cash Flows that explains how the configured company's cash and cash equivalents changed between two dates. The first release uses the **indirect method**: it begins with unadjusted P/L Net Profit, adjusts for noncash activity and changes in operating assets and liabilities, then presents investing and financing cash flows and reconciles calculated ending cash to the Balance Sheet.

The feature completes TallyStick's core financial-statement set:

- Profit & Loss explains operating performance over a period.
- Balance Sheet explains financial position as of a date.
- Statement of Cash Flows explains the period's change in cash and cash equivalents.

The report is regenerated from ledger detail and account classifications. Report totals are not stored or directly editable.

**Primary user:** Owner or bookkeeper of a one-person or small business  
**Primary question:** Why did cash change during this period, and do the reported cash flows reconcile to the Balance Sheet?  
**Method:** Indirect method for operating activities; direct presentation of investing and financing cash transactions  
**Deployment:** Single-user local desktop application

## 2. Problem

TallyStick currently reports profit and financial position but does not explain why cash increased or decreased. A profitable company can still consume cash through inventory purchases, receivable growth, fixed-asset purchases, debt repayment, or owner draws. Conversely, cash can increase through borrowing or owner contributions without improving profit.

A reliable Statement of Cash Flows cannot be produced from account names or bank activity alone. TallyStick must know:

- which financial accounts are cash or cash equivalents;
- which balance-sheet accounts are operating, investing, financing, restricted, or review-required;
- which P/L accounts represent noncash or reclassification adjustments;
- how confirmed transfers affect cash without double counting;
- how opening and ending cash reconcile to Balance Sheet snapshots; and
- which material activity remains unclassified.

Without this structure, a report could appear complete while silently omitting or misclassifying cash activity. The feature must prefer an explicit review-required result over a misleading clean statement.

## 3. Goals

### 3.1 Product goals

- Generate an indirect-method Statement of Cash Flows for any valid start and end date.
- Reuse the existing unadjusted P/L and immutable Balance Sheet snapshot logic rather than introducing stored report totals.
- Identify cash and cash-equivalent financial accounts explicitly and independently from Account Type.
- Assign deterministic cash-flow treatment to financial and Chart accounts using structural taxonomy metadata, never customer-specific names.
- Allow the user to review and override cash-flow classifications without changing an account's P/L or Balance Sheet placement.
- Present Operating, Investing, and Financing activities in a familiar statement hierarchy.
- Reconcile Beginning Cash plus net cash flows to Ending Cash from the Balance Sheet.
- Make every amount traceable to transactions, posting splits, matched transfers, opening balances, Balance Sheet changes, P/L contributions, or disclosed formulas.
- Exclude noncash investing and financing transactions from cash totals and disclose them separately when TallyStick can identify them.
- Show unclassified or unsupported material activity prominently instead of forcing it into an arbitrary section.
- Provide screen, drill-down, CSV, XLSX, and print/PDF parity from one immutable report result.
- Keep report generation, configuration, drill-down, export, and print local.

### 3.2 Success measures

- **$0.00** Cash Reconciliation Difference for a complete, valid book.
- **$0.00** unclassified cash activity for a report marked Complete.
- **100%** of displayed amounts reproducible from returned detail or a disclosed formula.
- **100%** parity between screen, CSV, XLSX, and print/PDF amounts and warnings.
- **0** Pending or Excluded transactions included.
- **0** double counting from confirmed cash-to-cash transfers or credit-card activity.
- **0** noncash investing or financing transactions included in cash totals.
- **0** account-name-based classification behavior.
- **100%** of nonzero participating accounts assigned a valid treatment or surfaced as Review required.

## 4. Non-goals

The first Statement of Cash Flows release will not:

- Add a direct-method operating statement.
- Add forecasts, cash runway, budgets, liquidity ratios, or a treasury dashboard.
- Add live bank feeds.
- Add invoicing, bills, payroll, inventory management, or automated depreciation schedules.
- Add a general journal-entry workspace. If manual journals are unavailable, the report reflects only activity recorded in TallyStick and discloses that limitation.
- Add foreign-currency translation, exchange-rate effects, or consolidated multi-company statements.
- Add per-transaction cash-flow overrides. Mixed transactions must use posting splits mapped to appropriately classified accounts.
- Infer cash-flow treatment from company, bank, marketplace, vendor, payee, or account names.
- Silently classify unresolved activity as Operating.
- Certify GAAP, IFRS, tax, lender, or audit compliance independently of the owner's accounting policies and completeness of the books.

## 5. Existing product fit

| Existing capability | Statement of Cash Flows use |
| --- | --- |
| Company profile | Report identity, base currency, accounting basis, fiscal-year shortcuts |
| Unadjusted P/L | Net Profit starting point and P/L contribution detail |
| Balance Sheet report service | Opening and ending account balances, cash reconciliation, immutable revision model |
| Financial accounts | Cash/cash-equivalent balances and cash-side transaction activity |
| Chart accounts and hierarchy | Operating adjustments and investing/financing classification |
| Posted transactions and posting splits | Cash movements and section-level detail |
| Confirmed transfer matches | Cash-to-cash exclusion and cash-to-noncash classification without double counting |
| Opening balances and opening-balance source | Beginning cash and review of in-period opening activity |
| Stable account IDs | Classification persistence and report identity independent of names |
| CSV, XLSX, print-preview native boundary | Output delivery and parity verification |
| Database revision | Stale report/detail/export protection |

No new stored report-total table is permitted.

### 5.1 Required structural additions

- Add a cash role to financial accounts: Cash, Cash equivalent, Restricted cash, Not cash, or Review required.
- Add a cash-flow treatment to participating financial and Chart accounts.
- Keep cash-flow treatment separate from Account Type, reporting group, Balance Sheet placement, and import capability.
- Persist classification status and audit classification changes.
- Add classification fields to Chart of Accounts import/export and portable backup/export contracts.
- Seed new books with structural defaults based on Account Type and Detail Type.
- Migrate existing accounts using structural metadata only. Ambiguous accounts become Review required.

## 6. Accounting policy and terminology

### 6.1 Statement sections

The report classifies cash flows into:

- **Operating activities:** principal revenue-producing activity and other activity that is not investing or financing.
- **Investing activities:** acquisition and disposal of long-term assets and other investments that are not cash equivalents.
- **Financing activities:** activity that changes contributed equity or borrowings.

These definitions establish report structure but do not represent a compliance certification. Interest, income taxes, owner taxes, dividends, restricted cash, and unusual activity require an explicit product default and user-reviewable policy.

Structural reference: [IFRS IAS 7 Statement of Cash Flows](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows.html/). TallyStick uses the familiar section, cash-equivalent, indirect-method, reconciliation, and noncash-disclosure concepts without claiming that the application alone establishes standards compliance.

### 6.2 Method

The first release uses the indirect method for Operating activities:

```text
Net Profit
+ Noncash and reclassification adjustments
+/- Changes in operating assets and liabilities
= Net cash provided by operating activities
```

Investing and Financing sections use actual cash-side transactions and classified confirmed transfers. Changes in Balance Sheet balances alone must not be treated as cash when a transaction did not use cash or a cash equivalent.

### 6.3 Accounting basis

The report displays the configured accounting basis: Cash, Accrual, or Modified Cash. It does not convert the books from one basis to another. Net Profit and opening/ending Balance Sheets must use the same recorded basis and report revision.

For cash-basis books, only applicable operating-asset and operating-liability adjustments are shown. Credit-card balances may still require an operating-liability adjustment so expenses recognized when charged are reconciled to cash paid.

### 6.4 Cash and cash equivalents

Cash roles are applied to financial accounts:

| Cash role | Report behavior |
| --- | --- |
| Cash | Included in Beginning Cash and Ending Cash |
| Cash equivalent | Included in Beginning Cash and Ending Cash |
| Restricted cash | Excluded from standard cash totals and disclosed separately unless the configured policy includes it |
| Not cash | Excluded from cash totals |
| Review required | Excluded and produces a blocking review warning when nonzero |

Reasonable new-book defaults may include Cash on hand and Checking as Cash, and eligible Savings or Money Market accounts as Cash equivalent. Trust, rents-held-in-trust, marketplace-clearing, and ambiguous custom accounts must not be assumed to be available cash.

### 6.5 Cash-flow treatment

Every noncash account that participates in the calculation has one treatment:

| Treatment | Use |
| --- | --- |
| Operating revenue/expense | Included in Net Profit; no separate cash-flow row unless adjustment is required |
| Operating asset | Period balance change adjusts Operating cash flow with the asset sign rule |
| Operating liability | Period balance change adjusts Operating cash flow with the liability sign rule |
| Noncash P/L adjustment | Reverses the related P/L contribution, such as depreciation or a gain/loss reclassification |
| Investing | Cash-side activity appears in Investing |
| Financing | Cash-side activity appears in Financing |
| Noncash disclosure | Excluded from cash totals and disclosed separately |
| Excluded | Deliberately omitted with disclosed policy |
| Review required | Not forced into a section; produces a warning and may create a reconciliation difference |

The user can override a default. Overrides are stable-ID based, audited, and historical reports use the current classification unless a future effective-dated policy feature is introduced.

## 7. Calculation behavior

### 7.1 Report period

The Statement is a period report with inclusive `startDate` and `endDate`.

- `startDate` must be on or before `endDate`.
- Beginning Cash is calculated as of the calendar day before `startDate`.
- Ending Cash is calculated as of `endDate`.
- Default period is the configured active fiscal year.
- Quick choices: Current month, Previous month, Current quarter, Year to date, Active fiscal year, Previous fiscal year, and Custom.
- Filters persist independently from Transactions, P/L, and Balance Sheet filters.

### 7.2 Included states

| State | Treatment |
| --- | --- |
| Posted | Included when within the report period or applicable to an opening/ending balance |
| Matched Transfer | Included in account balances; classified according to transfer rules without double counting |
| Pending | Excluded |
| Excluded | Excluded |

### 7.3 Operating activities

Operating cash flow starts with unadjusted P/L Net Profit for the exact report period.

Adjustments include:

- the inverse of P/L contributions mapped as noncash or reclassification adjustments;
- opening-to-ending changes in classified operating assets; and
- opening-to-ending changes in classified operating liabilities.

Sign rules using normal Balance Sheet presentation amounts:

```text
Operating asset adjustment = Opening balance - Ending balance
Operating liability adjustment = Ending balance - Opening balance
```

Cash accounts, cash equivalents, restricted cash, investing accounts, financing accounts, Equity, Current Earnings, Retained Earnings, and Opening Balance Equity are excluded from working-capital adjustments unless a specific supported treatment requires otherwise.

### 7.4 Investing activities

Investing cash flows are calculated from cash/cash-equivalent transactions and confirmed transfers whose counteraccount is classified Investing. Examples include:

- purchases and sales of fixed assets;
- purchases and sales of long-term investments; and
- cash movements involving other assets classified as Investing.

A noncash asset acquisition is excluded from the section total and disclosed separately.

### 7.5 Financing activities

Financing cash flows are calculated from cash/cash-equivalent transactions and confirmed transfers whose counteraccount is classified Financing. Examples include:

- loan and note proceeds;
- principal repayments;
- owner contributions; and
- owner draws or distributions.

A split loan payment can classify principal as Financing and interest according to the configured interest policy. A noncash debt or equity transaction is excluded from cash totals and disclosed separately.

### 7.6 Transfers

- A confirmed transfer between two included cash/cash-equivalent accounts has zero net cash effect and is omitted from section totals.
- A confirmed transfer between an included cash account and an operating liability participates through the operating-liability adjustment and is not separately counted.
- A confirmed transfer between an included cash account and an Investing or Financing account uses the noncash endpoint's treatment.
- A transfer involving restricted cash follows the configured restricted-cash policy and is disclosed.
- A likely but unconfirmed transfer remains in its recorded state and may produce an unmatched-transfer warning; the report does not invent a match.

### 7.7 Opening balances

- Opening cash dated before `startDate` contributes to Beginning Cash.
- Opening balances dated after `endDate` are excluded.
- A cash opening balance dated within the report period is not silently classified as Operating, Investing, or Financing. It produces an in-period opening-balance warning and a reconciliation difference unless supported ledger activity explains it.
- Opening Balance Equity is not a period cash flow.
- `DERIVED_EQUITY` and `LEDGER_ACTIVITY` modes remain mutually exclusive.

### 7.8 Cash reconciliation

```text
Net change in cash = Operating + Investing + Financing
Calculated Ending Cash = Beginning Cash + Net change in cash
Cash Reconciliation Difference = Calculated Ending Cash - Balance Sheet Ending Cash
```

A Complete report requires:

- zero Cash Reconciliation Difference;
- zero material unclassified cash activity;
- valid opening and ending Balance Sheets;
- no nonzero Review-required cash accounts; and
- no blocking calculation error.

Otherwise the report is visibly marked Review required. It may remain viewable for diagnosis, but it must not be presented or exported as a clean completed statement.

## 8. Report presentation

### 8.1 Navigation

Add **Cash Flow** to the left navigation beside Profit & Loss and Balance Sheet. Selecting it renders an exclusive **Statement of Cash Flows** workspace and preserves filters in other workspaces.

### 8.2 Header and controls

Show:

- configured company display/report name;
- `Statement of Cash Flows`;
- inclusive report dates;
- configured accounting basis;
- `Indirect method`;
- Beginning Cash, Net Change in Cash, Ending Cash, and Difference;
- period shortcut and date controls;
- Show zero rows toggle;
- Review classifications action;
- CSV, XLSX, and Print / PDF actions.

### 8.3 Statement hierarchy

Screen order:

1. Cash flows from operating activities
   - Net Profit
   - Noncash adjustments
   - Changes in operating assets and liabilities
   - Net cash provided by operating activities
2. Cash flows from investing activities
   - Account/activity rows
   - Net cash provided by investing activities
3. Cash flows from financing activities
   - Account/activity rows
   - Net cash provided by financing activities
4. Net increase/decrease in cash
5. Beginning cash and cash equivalents
6. Ending cash and cash equivalents
7. Cash Reconciliation Difference
8. Supplemental noncash disclosures, when present

Use the established P/L and Balance Sheet hierarchy, indentation, currency formatting, label/amount font-weight parity, and accessible amount buttons.

### 8.4 Empty and incomplete states

- A valid empty report shows all section totals, Beginning Cash, Ending Cash, and Difference at `$0.00`.
- No configured cash account produces an actionable setup state rather than an all-zero statement.
- Review-required activity remains visible through warnings and Difference detail.
- A failure never reuses a stale prior report as though it were current.

## 9. Drill-down and explainability

Every displayed amount provides exact detail from the same report revision.

Detail types include:

- P/L transaction and posting-split contributions;
- opening and ending Balance Sheet account values;
- operating asset/liability changes showing opening, ending, change, and sign transformation;
- cash-side investing and financing transactions;
- confirmed transfer endpoints and classification rationale;
- opening-balance contributions;
- noncash disclosure items; and
- subtotal, total, and Difference formulas referencing stable child row IDs.

Each transaction-level contribution shows date, source account, payee/description, memo, chart account path, amount, import batch when available, and transaction/split IDs. Contributions sum exactly to the selected row.

## 10. Classification experience

### 10.1 Account editor

The unified account editor adds a Cash Flow section:

- Cash role for financial accounts.
- Cash-flow treatment for financial and Chart accounts.
- Default rationale based on Account Type and Detail Type.
- Statement placement preview.
- Review-required explanation when no safe default exists.

Changing Cash Flow classification does not change P/L or Balance Sheet placement, import eligibility, transaction categorization, or account ID.

### 10.2 Review classifications

Provide a focused review view listing:

- all included cash/cash-equivalent accounts;
- restricted and review-required cash accounts;
- accounts with nonzero period activity grouped by Cash Flow treatment;
- ambiguous or invalid classifications; and
- the effect of proposed changes on the current report before save.

Saving changes is validated, atomic, audited, and refreshes the report.

## 11. Warnings and exceptions

At minimum, support:

| Condition | Required behavior |
| --- | --- |
| No cash accounts | Block report completion and link to classification setup |
| Review-required cash account has a nonzero balance | Exclude from clean cash totals, show account and amount |
| Unclassified cash-side activity | Show Difference and exact diagnostic detail |
| In-period cash opening balance | Warn and do not invent a section |
| Unmatched transfer candidate affects cash | Show candidate information without auto-matching |
| Opening or ending Balance Sheet is out of balance | Mark report Review required and expose source Difference |
| Invalid account treatment | Show the account and block silent omission |
| Unsupported or mixed currency | Fail calculations requiring conversion |
| Noncash investing/financing activity | Exclude from cash totals and disclose separately |
| Archived participating account | Retain historical contribution and show Archived status |
| Stale report revision | Require regeneration before detail/export |

Warnings are included in every exported form.

## 12. Export and print requirements

### 12.1 Summary CSV

Export UTF-8 CSV from the immutable report result with:

- company/report metadata;
- method, accounting basis, currency, and dates;
- stable row ID, row type, section, label, depth, and amount;
- account role, stable account ID, cash role, and treatment when applicable;
- report status and warnings; and
- explicit Operating, Investing, Financing, Beginning Cash, Ending Cash, and Difference rows.

### 12.2 XLSX

Workbook sheets:

1. **Statement of Cash Flows** — screen order, hierarchy, numeric currency cells, totals, warnings, and reconciliation.
2. **Cash Flow Detail** — every contribution required to reproduce every amount.
3. **Cash Flow Classifications** — participating accounts, stable IDs, account paths, cash roles, treatments, status, and rationale.

The workbook must reopen successfully. Numeric amounts remain numeric.

### 12.3 Print/PDF

- Open preview without automatically printing.
- Title: `<configured company display name> — Statement of Cash Flows`.
- Include dates, basis, method, warnings, sections, supplemental noncash disclosures, Ending Cash, and Difference.
- Repeat headings on later pages and keep subtotals with their sections when practical.
- Support Command-P through the existing desktop boundary.
- Omit the full tax identifier.

## 13. Functional requirements

| ID | Requirement |
| --- | --- |
| CF-001 | Generate an indirect-method Statement of Cash Flows for any valid inclusive date range. |
| CF-002 | Use unadjusted P/L Net Profit for the exact report period. |
| CF-003 | Use opening and ending Balance Sheet snapshots from the same database revision and accounting basis. |
| CF-004 | Identify Cash, Cash equivalent, Restricted cash, Not cash, and Review-required financial accounts explicitly. |
| CF-005 | Persist user-reviewable Cash Flow treatment independently from Account Type and statement placement. |
| CF-006 | Seed and migrate classifications using structural metadata, never names. |
| CF-007 | Exclude Pending and Excluded transactions. |
| CF-008 | Handle confirmed transfers without double counting. |
| CF-009 | Calculate operating-asset adjustments as Opening minus Ending balance. |
| CF-010 | Calculate operating-liability adjustments as Ending minus Opening balance. |
| CF-011 | Reverse classified noncash/reclassification P/L contributions in Operating activities. |
| CF-012 | Calculate Investing activity from actual cash-side transactions and supported transfers. |
| CF-013 | Calculate Financing activity from actual cash-side transactions and supported transfers. |
| CF-014 | Support split principal, interest, and other mixed transactions through separate posting splits/accounts. |
| CF-015 | Exclude noncash investing and financing activity from cash totals and disclose identifiable items separately. |
| CF-016 | Calculate Beginning Cash as of the day before startDate and Ending Cash as of endDate. |
| CF-017 | Display Operating, Investing, Financing, Net Change, Beginning Cash, Ending Cash, and Difference. |
| CF-018 | Require a zero Difference and no material unclassified activity for Complete status. |
| CF-019 | Retain nonzero archived and review-required activity in warnings/detail rather than silently omitting it. |
| CF-020 | Provide exact amount-level drill-down from the immutable report revision. |
| CF-021 | Provide a Cash Flow classification editor and review workflow. |
| CF-022 | Include classification fields in Chart of Accounts import/export and backup/restore. |
| CF-023 | Provide Current month, Previous month, Current quarter, YTD, fiscal-year, prior-fiscal-year, and Custom period controls. |
| CF-024 | Keep report filters independent from other workspaces. |
| CF-025 | Export Summary CSV from the supplied immutable report without recalculation. |
| CF-026 | Export a verified three-sheet XLSX with statement, detail, and classifications. |
| CF-027 | Provide print/PDF preview with Command-P and no automatic printing. |
| CF-028 | Include report status and warnings in screen and every output. |
| CF-029 | Reject stale detail/export requests after a database revision change. |
| CF-030 | Invalidate cached reports after any transaction, transfer, account, classification, opening-balance, company-basis, or restore mutation that can affect the report. |
| CF-031 | Keep generation, drill-down, classification, export, and print operations local. |
| CF-032 | Never store editable report totals or mutate the books while reporting. |
| CF-033 | Use integer minor units for all calculations. |
| CF-034 | Preserve deterministic row order, stable semantic row IDs, and neutral public fixtures. |
| CF-035 | Disclose that the report reflects activity recorded in TallyStick and does not independently certify compliance. |

## 14. Acceptance scenarios

### A1 — Cash sale

A $100 Posted bank deposit categorized as Income produces $100 Net Profit and $100 net Operating cash flow. Ending Cash increases by $100 and Difference is $0.00.

### A2 — Cash operating expense

A $40 Posted bank withdrawal categorized as Expense reduces Net Profit and Operating cash flow by $40. Ending Cash decreases by $40 and Difference is $0.00.

### A3 — Credit-card purchase and payment

A $100 operating expense charged to a credit card reduces Net Profit without reducing cash. The increase in Credit Card operating liability adds $100 back. A later $100 confirmed bank-to-card payment reduces the liability adjustment and cash. Across the complete period, Operating cash flow reflects the cash payment exactly once.

### A4 — Accounts receivable

A $200 increase in Accounts Receivable subtracts $200 from Operating cash flow. Collection that returns A/R to zero reverses the adjustment without duplicating revenue.

### A5 — Inventory and accounts payable

Inventory and A/P changes use their respective operating-asset and operating-liability sign rules and reconcile to cash paid to suppliers.

### A6 — Fixed-asset purchase

A $500 cash purchase categorized to Fixed Assets appears as negative $500 Investing cash flow, does not affect Net Profit, and reduces Ending Cash by $500.

### A7 — Depreciation

A $60 depreciation expense reduces Net Profit and produces a positive $60 noncash Operating adjustment. It does not change cash.

### A8 — Loan proceeds and split payment

A $1,000 loan deposit appears as positive Financing cash flow. A $110 payment split between $100 principal and $10 interest reports negative $100 Financing cash flow and applies the configured interest treatment to $10.

### A9 — Owner contribution and draw

Owner contributions are positive Financing cash flow and Owner's Draw is negative Financing cash flow. Neither changes Net Profit.

### A10 — Cash-to-cash transfer

A confirmed transfer between two included cash accounts changes account composition but produces zero net cash flow and no report Difference.

### A11 — Noncash asset acquisition

An asset acquired directly through debt is excluded from Investing and Financing cash totals and appears in supplemental noncash disclosures when recorded data identifies both sides.

### A12 — Restricted cash

A transfer into Restricted cash follows the configured policy, is disclosed, and does not silently disappear from reconciliation.

### A13 — In-period opening balance

A cash opening balance dated inside the report period produces an actionable warning and Difference unless supported ledger activity explains the change.

### A14 — Unclassified activity

Cash activity categorized to a Review-required account remains drillable, prevents Complete status, and is not assigned to Operating by default.

### A15 — State exclusion

Pending and Excluded transactions have no report effect. Undoing a Posted transaction immediately removes its P/L, Balance Sheet, and Cash Flow effects.

### A16 — Non-calendar fiscal year

Fiscal-year shortcuts use the company fiscal-year start and active tax year. Net Profit and both Balance Sheet snapshots use the same normalized period.

### A17 — Empty valid report

A configured company with at least one confirmed zero-balance Cash account, no applicable activity, and zero cash produces a complete all-zero statement with a $0.00 Difference.

### A18 — Export parity

Screen, CSV, XLSX statement, XLSX detail, print preview, and PDF contain identical amounts, status, warnings, and $0.00 Difference for a complete fixture.

### A19 — Historical stability

Renaming an account without changing its stable ID or classification changes labels but not historical amounts, row identity, or contribution identity.

### A20 — Structural migration

Existing schema-6 accounts receive safe structural defaults based on Account Type and Detail Type. Ambiguous accounts become Review required; no migration uses a company, institution, marketplace, or account name.

## 15. Quality requirements

- Report generation target: under 750 ms for 10,000 transactions and the current chart size on the supported desktop baseline.
- Drill-down target: under 300 ms for 2,000 contributions.
- Identical database revision and normalized query produce identical amounts, order, warnings, and row IDs.
- All calculations use signed integer minor units; formatting occurs only at output boundaries.
- Report reads, detail, exports, print, and classification previews do not mutate book data.
- Classification saves and schema migration are transactional, audited, foreign-key safe, and backup-compatible.
- Keyboard navigation, accessible names, focus states, and non-color warning indicators match existing report accessibility conventions.
- Public fixtures contain no private company, account, payee, memo, address, tax, or source-document data.

## 16. Delivery boundary

The feature is complete only when:

1. CF-001 through CF-035 pass.
2. A1 through A20 pass against deterministic public fixtures.
3. Every visible amount reconciles to detail or a disclosed formula.
4. Complete fixtures have zero unclassified cash activity and a $0.00 Difference.
5. Screen, CSV, XLSX, print preview, and PDF agree exactly.
6. Classification migration, editing, import/export, backup, and restore pass integration tests.
7. Browser tests and an isolated packaged Electron smoke test pass.
8. Reporting does not modify the books or access a live user database during automated verification.

A navigation item, report DTO, static table, or calculation service alone does not satisfy this boundary.

## 17. Dependencies and sequencing

The existing P/L, Balance Sheet, account taxonomy, transaction splits, transfer matching, and database revision model are required foundations and are already present.

Bank reconciliation, duplicate detection, and manual journal entries are strongly recommended before or alongside this feature because they improve source-data completeness. They are not hard blockers for the first report, but the product must disclose when the statement reflects only recorded activity and cannot identify noncash adjustments.

## 18. Future extensions

- Direct-method Operating activities.
- Comparative periods and monthly columns.
- Effective-dated Cash Flow classification policies.
- Per-transaction or per-split override with audit trail.
- Automated journal entries, depreciation schedules, and noncash transaction capture.
- Restricted-cash policy options and cash-equivalent maturity metadata.
- Foreign-currency effects on cash.
- Cash forecast, runway, and liquidity dashboard.
- Financing-liability roll-forward disclosure.

## 19. Public validation data

Use synthetic two-year fixtures that preserve realistic import shapes and accounting relationships. Fixture documentation must identify expected P/L Net Profit, opening and ending Balance Sheets, Operating/Investing/Financing totals, noncash disclosures, Ending Cash, and Difference for every scenario.

No test or documentation may depend on private source data, customer-specific names, real account numbers, personal payees, real transaction memos, or a live TallyStick database.
