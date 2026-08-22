# TallyStick Balance Sheet

*Version 1.0 · Implemented August 21, 2026*

*Product Requirements Document · Draft 0.2 · August 16, 2026*

Companion documents: [Quicken Replacement PRD](Quicken%20Replacement%20PRD.md) · [Balance Sheet Product Specification](Balance%20Sheet%20PRODUCT_SPEC.md) · [Balance Sheet Task Tracker](Balance%20Sheet%20TASKS.md)

## 1. Product summary

TallyStick will add an as-of-date Balance Sheet that presents what the configured company owns, owes, and retains. The feature also establishes application-wide company settings and a generic account taxonomy so TallyStick does not depend on one company's name, institutions, marketplaces, categories, or account arrangement. The report will be calculated from financial accounts, opening balances, Posted transactions, matched transfers, posting splits, chart-account hierarchy, and P/L results. Report totals will not be stored or directly editable.

The first release must provide the same core confidence expected from a QuickBooks Balance Sheet:

- Assets, Liabilities, and Equity shown in accounting hierarchy.
- Bold subtotals and totals that follow the Chart of Accounts.
- Click-through from every amount to the exact contributing detail.
- A visible accounting-equation check.
- CSV, XLSX, and print/PDF output that agrees with the screen.

**Primary user:** Owner / bookkeeper of a one-person or small business  
**Primary question:** What is the company's financial position as of this date?  
**Accounting equation:** Assets = Liabilities + Equity  
**Deployment:** Single-user local desktop application

## 2. Problem

TallyStick currently explains operating performance through P/L Summary and Detail reports, but it does not show the configured company's financial position. The owner cannot see cash, bank, receivable, marketplace-clearing, credit-card, payable, loan, asset, and equity balances in one reconciled statement.

The current product also exposes company-specific assumptions. Company identity is not fully configurable throughout the UI and exports, and the financial-account editor uses the application-specific `ENTITY` type instead of the complete accounting account taxonomy shown in the supplied account-editor references. A generic Balance Sheet requires both gaps to be resolved as part of this feature.

Without a Balance Sheet, TallyStick cannot fully replace the financial-statement portion of QuickBooks or expose incomplete conversion balances and account-classification problems before year-end.

## 3. Goals

### 3.1 Product goals

- Produce a Balance Sheet for any valid as-of date.
- Reuse the existing transaction, split, transfer, and chart hierarchy without requiring a fundamental ledger redesign; use additive migrations for company profile and account classification where required.
- Make company identity and report information configurable and reusable by this and all future features.
- Remove hard-coded company names, institutions, account IDs, marketplaces, and category names from product behavior and test expectations.
- Use one grouped accounting taxonomy across account creation, account editing, Chart of Accounts, and Balance Sheet placement.
- Present financial accounts and balance-sheet Chart of Accounts entries in a single hierarchy without double counting.
- Derive current earnings from the same P/L logic used by the Profit & Loss workspace.
- Include Posted activity and confirmed matched transfers while excluding Pending and Excluded activity.
- Make every amount traceable to opening balances, transactions, transfers, posting splits, or derived earnings.
- Reconcile Assets to Liabilities plus Equity and clearly disclose any difference.
- Match the established P/L visual language: readable account labels, indentation, bold subtotal amounts, currency formatting, and print parity.
- Keep all report generation and exports local.

### 3.2 Success measures

- **$0.00** unexplained Balance Sheet difference for valid books.
- **100%** of displayed amounts reproducible from returned drill-down detail or a disclosed derived calculation.
- **100%** parity between on-screen, CSV, XLSX, and print/PDF totals.
- **0** Pending, Excluded, or P/L-only Schedule C adjustments included in Balance Sheet balances.
- **0** silent omissions of nonzero accounts.
- **0** hard-coded customer/company identity values in application behavior, report contracts, exports, print output, and generic acceptance fixtures.
- **100%** of selectable account and detail types map deterministically to a financial-statement section or are visibly identified as not applicable to the Balance Sheet.

## 4. Non-goals

The Balance Sheet feature will not initially:

- Add invoicing, bills, accounts receivable workflows, accounts payable workflows, payroll, or inventory management.
- Add live bank connections.
- Add a general journal-entry workspace.
- Add consolidation across multiple companies or support multiple companies in one database file. Each company file has one configurable company profile.
- Add foreign-currency translation or remeasurement.
- Add budgets, forecasts, ratios, or lender dashboards.
- Apply Schedule C report-only tax exclusions to book balances.
- Produce a Statement of Cash Flows; that is a separate feature.
- Attempt to certify GAAP compliance independently of the completeness and correctness of the owner's books.

## 5. Existing data-structure fit

The first Balance Sheet can be calculated from the current structure:

| Existing data | Balance Sheet use |
| --- | --- |
| Company name, currency, fiscal-year start, and accounting basis | Initial company profile, report labeling, and current-earnings period |
| Financial account type and detail type | Starting point for the expanded generic account taxonomy and statement placement |
| Financial account opening balance and opening-balance date | Beginning account position |
| Posted transaction amount and financial account | Change the source financial-account balance |
| Posting splits and chart-account IDs | Change Asset, Liability, and Equity counteraccounts |
| Chart-account reporting type, account type, detail type, parent, and display order | Build the report hierarchy and natural-balance presentation |
| Confirmed transfer match | Move value between financial accounts without changing earnings |
| P/L report service | Derive current earnings using the exact existing income and expense logic |
| Audit events and source-batch references | Drill-down provenance |

No new stored report-total table is permitted. The report is always regenerated from ledger detail. Additive company-profile and account-classification migrations are permitted and required where the current fields cannot represent the requirements below.

### 5.1 Required structural evolution

- Expand the account classification available through account create/edit from the legacy `BANK`, `CREDIT_CARD`, and `ENTITY` choices to the full grouped account taxonomy in Section 5.3.
- Treat the ability to receive imported transactions as an account capability, not as an accounting reporting type. Reporting classification and import eligibility must not be conflated.
- Migrate legacy `ENTITY` accounts without changing stable IDs or transaction history. Marketplace and clearing ledgers migrate to Other Current Assets with an appropriate detail type. A legacy Other Transactions ledger migrates to a reviewable clearing/unclassified classification and remains visible until the owner confirms its placement.
- Extend the company record or add a one-to-one company-profile record for the settings in Section 5.2. Existing company data migrates without loss.
- Opening balances exist on financial accounts without a separately stored offsetting entry. The report will calculate and disclose Opening Balance Equity so the opening position is represented without inventing operating activity.
- The structure does not store a formal year-end closing journal. Current earnings will therefore be derived, not posted.
- Archived accounts remain part of historical reports whenever their as-of balance is nonzero.

### 5.2 Company settings and product-wide genericity

Company Settings are delivered with the Balance Sheet feature but are application-wide infrastructure. This and every future feature must read company identity and accounting defaults from the company settings service; no feature may hard-code a particular company, institution, marketplace, bank, account ID, category ID, or category name as a universal product assumption.

The company profile supports:

| Field | Requirement |
| --- | --- |
| Legal company name | Required; used where a formal company name is needed |
| Display/report name | Optional; defaults to legal name and appears in application and report headers |
| Doing-business-as name | Optional |
| Business entity type | Optional selection or text, such as Sole proprietor, LLC, Partnership, S corporation, C corporation, or Nonprofit |
| Address | Optional address lines, city/locality, state/region, postal code, and country |
| Contact information | Optional phone, email, and website |
| Tax identifier | Optional, stored locally and masked outside explicit edit/reveal contexts |
| Base currency | Required; defaults to USD for a new company file |
| Fiscal-year start month | Required |
| Accounting basis | Required: Cash, Accrual, or Modified Cash |
| Active tax year | Required |

Company Settings behavior:

- Provide an **Edit company information** action from the Balance Sheet header and a reusable application settings entry point.
- The TallyStick product name remains product branding; the configured company name is displayed separately.
- The application header, Balance Sheet, P/L reports, exports, print previews, PDFs, accountant packages, and future reports use the configured display/report name and applicable company information.
- Blank optional fields are omitted cleanly; they never produce empty labels or placeholder company-specific text.
- Changing company information affects future screen rendering and generated outputs but does not rewrite transaction history.
- Company-setting changes are validated, transactional, local, and audited.
- Existing databases migrate their current company name and accounting settings. A new database requires a legal company name before financial activity is committed.
- Generic automated fixtures use neutral example companies and must not depend on the migrated value from an existing installation.

### 5.3 Generic account taxonomy

The account editor will use the grouped account types shown in the supplied QuickBooks reference images. Account type determines the financial-statement section; detail type refines purpose and display. The same taxonomy is used in Chart of Accounts, account create/edit, validation, imports, transfers, and reports.

| Reporting group | Account type | Required detail types |
| --- | --- | --- |
| Asset | Bank | Cash on hand; Checking; Money Market; Rents Held in Trust; Savings; Trust account |
| Asset | Accounts receivable (A/R) | Accounts receivable |
| Asset | Other Current Assets | Inventory; Prepaid expenses; Marketplace clearing; Clearing account; Other current assets |
| Asset | Fixed Assets | Furniture and fixtures; Machinery and equipment; Vehicles; Other fixed assets |
| Asset | Other Assets | Goodwill; Security deposits; Other long-term assets |
| Liability | Credit Card | Credit Card |
| Liability | Accounts payable (A/P) | Accounts payable |
| Liability | Other Current Liabilities | Loan payable; Payroll liabilities; Sales tax payable; Other current liabilities |
| Liability | Long Term Liabilities | Notes payable; Shareholder notes payable; Other long-term liabilities |
| Equity | Equity | Owner equity; Owner draw; Retained earnings |
| Income | Income | Sales of product income; Service income; Other primary income |
| Income | Other Income | Interest earned; Other investment income; Other miscellaneous income |
| Expense | Cost of Goods Sold | Cost of labor; Shipping, freight and delivery; Supplies and materials; Other costs of goods sold |
| Expense | Expenses | Advertising; Bank charges; Insurance; Office expenses; Other business expenses |
| Expense | Other Expense | Depreciation; Penalties and settlements; Other miscellaneous expense |

Account create/edit behavior:

- Display Account Type options under Asset, Liability, Equity, Income, and Expense group headings.
- Filter Detail Type to values compatible with the selected Account Type.
- Support name, type, detail type, optional same-reporting-group parent/subaccount, description, opening balance/date where applicable, lock, archive/restore, and stable account ID.
- Show a live **Balance Sheet preview** for Asset, Liability, and Equity accounts, including the proposed hierarchy location and current as-of balance.
- For Income, COGS, Expense, Other Income, and Other Expense accounts, state that activity flows to the P/L and Current Earnings rather than appearing as an individual Balance Sheet line.
- A type change must validate existing transactions, splits, rules, parent relationships, and report effects before saving. It must never silently reinterpret history.
- Bank and Credit Card accounts are import-capable by default. Other Current Asset marketplace/clearing accounts may be marked import-capable. Other account types are not import destinations unless a future workflow explicitly supports them.
- Account types, detail types, and report placement are generic product configuration. Institution names and marketplace names are account data, not application constants.

## 6. Accounting behavior

### 6.1 Report date

The Balance Sheet is an **as-of** report. The user selects one date, and the report includes recognized activity on or before that date, subject to the account's opening-balance date.

- Default as-of date: the end of the company's active tax year.
- Quick choices: Today, End of previous month, End of current month, and End of year.
- The selected date persists independently from Transaction and P/L filters.
- An invalid or missing date prevents report generation and produces a clear validation message.

### 6.2 Included transaction states

| State | Balance Sheet treatment |
| --- | --- |
| Posted | Included in the financial account and applicable posting-split balance |
| Matched Transfer | Included in both participating financial-account balances; excluded from earnings and chart-account activity |
| Pending | Excluded |
| Excluded | Excluded |

Undoing a Posted or Matched Transfer transaction must immediately reverse its Balance Sheet effect.

### 6.3 Financial-account balances

For each financial account:

`as-of balance = applicable opening balance + Posted signed activity + Matched Transfer signed activity`

- Activity after the selected as-of date is excluded.
- An opening balance is included only when its opening-balance date is on or before the report date.
- Bank and other Asset-classified source accounts use their natural Asset presentation.
- Credit Card and other Liability-classified source accounts use their natural Liability presentation so an amount owed appears as positive.
- Marketplace and clearing source accounts are classified as Other Current Assets rather than as a special company-specific Entity account type.
- A migrated or unmapped source account appears in a clearly labeled unclassified/clearing section and cannot be silently dropped.

### 6.4 Chart-account balances

Only splits belonging to Posted transactions and dated on or before the as-of date contribute.

- Asset chart-account balances use the inverse of the stored source-account split sign.
- Liability and Equity chart-account balances use their natural credit-balance presentation.
- Income, COGS, Expense, Other Income, and Other Expense accounts do not appear as individual Balance Sheet accounts; their net result contributes through earnings.
- Parent-account amounts include direct postings separately from descendant activity so hierarchical subtotals do not double count.

### 6.5 Earnings and equity

The Equity section will distinguish:

- Directly posted Equity account balances, including contributions and draws.
- Retained Earnings represented by historical Posted activity or explicit Equity postings.
- Current Earnings derived from the start of the applicable fiscal year through the report date.

Current Earnings must equal the unadjusted P/L Net Profit for the identical period. Schedule C report-only exclusions must not affect it.

The report must not create or mutate a year-end closing transaction.

### 6.6 Opening Balance Equity

When financial-account opening balances do not have stored counterpart entries, the report will show a derived **Opening Balance Equity** amount.

- The value is calculated only from applicable financial-account opening balances.
- It is labeled as derived and is drillable to the contributing account opening balances.
- It is not stored as a transaction or editable report total.
- It does not affect the P/L.
- If the owner later represents the conversion position through explicit ledger activity, the report must avoid counting both the explicit activity and the derived opening amount for the same opening balance.

### 6.7 Accounting-equation check

The report calculates:

`difference = Total Assets - Total Liabilities - Total Equity`

- A valid report displays **Balance Sheet difference: $0.00**.
- A nonzero difference is displayed prominently and never hidden by rounding.
- The report provides a drill-down explanation identifying the contributing accounts or derived amounts.
- Exports and print/PDF include the difference.

## 7. Report presentation

### 7.1 Navigation

- Add **Balance Sheet** to the left application navigation.
- Balance Sheet is a mutually exclusive primary workspace alongside Transactions, Chart of Accounts, Rules, Profit & Loss, and Backups.
- Opening the workspace does not change Transaction filters or the selected transaction account.
- Provide access to reusable Company Settings without embedding company-specific fields directly in report logic.

### 7.2 Header and controls

The workspace displays:

- Heading: **Balance Sheet**
- Configured company display/report name
- Applicable configured address or company information in print/export contexts
- Selected as-of date
- Accounting basis
- Total Assets
- Total Liabilities
- Total Equity
- Balance Sheet difference
- As-of date control and date shortcuts
- Show/hide zero-balance accounts control
- Export and Print/PDF actions

### 7.3 Hierarchy

The default report order is:

1. **Assets**
   - Bank and cash accounts
   - Accounts receivable
   - Other current assets
   - Fixed assets
   - Other assets
   - Total Assets
2. **Liabilities**
   - Credit cards
   - Accounts payable
   - Other current liabilities
   - Long-term liabilities
   - Total Liabilities
3. **Equity**
   - Owner equity, contributions, and draws
   - Retained earnings
   - Current earnings
   - Opening Balance Equity, when applicable
   - Total Equity
4. **Total Liabilities and Equity**
5. **Balance Sheet difference**

Chart-account parent/child relationships and display order control the hierarchy within each account-type group.

### 7.4 Typography and amounts

- Account descriptions use the same readable size established for P/L reports.
- Child accounts are indented by hierarchy depth.
- If an account label is bold, its corresponding amount is also bold.
- Detail account amounts are not bold.
- `Total for ...`, Total Assets, Total Liabilities, Total Equity, Total Liabilities and Equity, and the accounting-equation check are bold.
- Currency values use the application's prominent-decimal, tabular-number style.
- Negative values use a leading minus sign consistently with existing TallyStick reports.
- Zero is displayed as `$0.00`.

### 7.5 Zero balances

- Zero-balance leaf accounts are hidden by default.
- Structural parent headings needed to explain visible descendants remain visible.
- The user can show all zero-balance accounts.
- Nonzero archived accounts are always shown with an Archived indicator.

## 8. Drill-down and explainability

Every displayed amount is actionable.

### 8.1 Financial-account detail

Clicking any Asset- or Liability-classified source-account balance shows:

- Opening balance and opening-balance date
- Posted transactions through the as-of date
- Matched transfers through the as-of date
- Signed running balance
- Source batch and transaction provenance

### 8.2 Chart-account detail

Clicking an Asset, Liability, or Equity chart amount shows every contributing Posted split with:

- Date
- Financial account
- Description
- Payee
- Memo/reference
- Chart account and full path
- Stored source amount
- Balance Sheet contribution
- Source batch

### 8.3 Derived equity detail

- Current Earnings opens the existing P/L Detail constrained to the fiscal-year start and Balance Sheet as-of date.
- Opening Balance Equity opens a list of contributing financial-account opening balances.
- A subtotal opens the combined detail for itself and all included descendants.

The sum of displayed drill-down contributions must exactly equal the selected report amount.

## 9. Warnings and exceptions

The report must show actionable warnings for:

- Nonzero balance in a migrated or unclassified clearing/source account.
- A nonzero accounting-equation difference.
- An account whose opening-balance date is after the report date.
- An archived account with a nonzero balance.
- Unsupported or mixed currencies.
- A parent/child hierarchy problem that prevents deterministic grouping.
- An account whose type/detail type cannot be mapped to its financial-statement section.

Warnings must not silently remove balances. A nonzero unmapped balance appears in an **Unclassified accounts** section until corrected.

## 10. Export and print requirements

### 10.1 Summary CSV

Include:

- Configured company legal and display/report name, as applicable
- As-of date
- Accounting basis
- Row type
- Account ID, name, and full path when applicable
- Hierarchy depth
- Displayed amount
- Derived/archived/unclassified indicators
- Total Assets, Total Liabilities, Total Equity, Total Liabilities and Equity, and difference

### 10.2 Summary XLSX

- Preserve report order, hierarchy indentation, bold totals, currency number formats, and report metadata.
- Include a second **Balance Sheet Detail** sheet containing the drill-down rows required to reproduce every amount.

### 10.3 Print/PDF

- Open a print-preview window before the system print dialog.
- Provide a Print menu command with **Command-P** in the preview window.
- Repeat report headings on subsequent pages.
- Avoid splitting a subtotal from its immediately preceding account group when practical.
- Include warnings and the accounting-equation difference.

All export formats must use the same report result object as the on-screen report.

## 11. Functional requirements

| ID | Requirement |
| --- | --- |
| BS-001 | Generate a Balance Sheet for any valid as-of date. |
| BS-002 | Calculate financial-account balances from opening balances, Posted activity, and Matched Transfer activity. |
| BS-003 | Calculate Asset, Liability, and Equity chart-account balances from Posted splits. |
| BS-004 | Exclude Pending and Excluded transactions. |
| BS-005 | Exclude Matched Transfers from earnings while retaining their financial-account effects. |
| BS-006 | Derive Current Earnings from the unadjusted P/L for the same fiscal period. |
| BS-007 | Derive and disclose Opening Balance Equity when needed. |
| BS-008 | Follow chart hierarchy and display order without double counting parent and child activity. |
| BS-009 | Display Assets, Liabilities, Equity, their totals, and Total Liabilities and Equity. |
| BS-010 | Display the exact accounting-equation difference. |
| BS-011 | Provide amount-level drill-down whose contributions sum exactly to the selected amount. |
| BS-012 | Include nonzero archived and unclassified accounts rather than silently omitting them. |
| BS-013 | Support hiding and showing zero-balance accounts. |
| BS-014 | Export Summary CSV and XLSX with detail parity. |
| BS-015 | Provide print-preview and printable/PDF output with Command-P support. |
| BS-016 | Preserve the established P/L hierarchy, typography, amount, subtotal, and bolding conventions. |
| BS-017 | Recalculate immediately after posting, undoing, matching, unmatching, editing an opening balance, or changing the as-of date. |
| BS-018 | Keep all generation, drill-down, and export operations local. |
| BS-019 | Record report parameters in generated export metadata without persisting editable report totals. |
| BS-020 | Leave book balances unchanged when the user views, exports, or prints the report. |
| BS-021 | Provide reusable Company Settings with legal name, display/report name, optional company information, currency, fiscal year, accounting basis, and active tax year. |
| BS-022 | Use configured company information in the application header, reports, exports, print previews, PDFs, and accountant packages without hard-coded company identity. |
| BS-023 | Validate, persist, migrate, and audit company-setting changes without rewriting ledger history. |
| BS-024 | Expose the full grouped Asset, Liability, Equity, Income, and Expense account taxonomy in account create/edit. |
| BS-025 | Filter account Detail Type choices by Account Type, including all supplied Bank and Credit Card detail types. |
| BS-026 | Treat transaction import eligibility as a capability separate from financial-statement Account Type. |
| BS-027 | Show proposed Balance Sheet placement and hierarchy in the Asset/Liability/Equity account editor. |
| BS-028 | Preserve stable account IDs and validate all references when account type, detail type, or parent changes. |
| BS-029 | Migrate legacy Entity accounts to generic balance-sheet classifications without losing transactions, transfers, rules, or audit history. |
| BS-030 | Prevent new generic company files from depending on legacy Entity, Marketplace-name, institution-name, or company-specific account classifications. |

## 12. Acceptance scenarios

### A1 — Income received

Given a $100 Posted deposit categorized as Income, the report increases the Bank asset by $100 and Current Earnings by $100. The Balance Sheet difference remains $0.00.

### A2 — Expense paid from bank

Given a $40 Posted bank withdrawal categorized as Expense, the report decreases the Bank asset by $40 and Current Earnings by $40. The Balance Sheet difference remains $0.00.

### A3 — Credit-card expense

Given a $25 Posted credit-card charge categorized as Expense, the report increases Credit Card liability by $25 and decreases Current Earnings by $25. The Balance Sheet difference remains $0.00.

### A4 — Purchase of an asset

Given a $500 Posted bank withdrawal categorized to a Fixed Asset account, the report decreases Bank by $500 and increases Fixed Assets by $500 without changing earnings.

### A5 — Loan proceeds

Given a $1,000 Posted bank deposit categorized to a Liability account, the report increases Bank by $1,000 and increases Liabilities by $1,000 without changing earnings.

### A6 — Owner contribution and draw

Posted owner contributions increase Bank and Equity. Posted owner draws decrease Bank and Equity. Neither affects Current Earnings.

### A7 — Matched transfer

A confirmed transfer moves value between the participating financial accounts, changes neither Current Earnings nor total net assets, and is visible in account drill-down.

### A8 — Opening balances

Applicable financial-account opening balances appear in their accounts, and the derived Opening Balance Equity line makes the opening accounting equation balance. Its drill-down lists the exact source accounts and values.

### A9 — State exclusions

Pending and Excluded transactions have no Balance Sheet effect. Undoing a Posted or Matched transaction reverses its prior effect immediately.

### A10 — Hierarchical subtotal

Direct parent postings and child-account postings appear once, and the parent subtotal equals their exact combined amount.

### A11 — Current Earnings parity

Current Earnings exactly equals unadjusted P/L Net Profit from the fiscal-year start through the as-of date. Schedule C settings do not change the amount.

### A12 — Unclassified balance

A nonzero migrated clearing or unmapped account remains visible under Unclassified accounts and produces a warning rather than disappearing.

### A13 — Export parity

Screen, Summary CSV, Summary XLSX, detail sheet, print preview, and PDF show identical totals and a $0.00 difference for valid books.

### A14 — Historical stability

Changing or adding activity after the report date does not change the earlier as-of report. Nonzero archived accounts remain visible for applicable historical dates.

### A15 — Configurable company identity

Given a new company profile with a legal name, a different display/report name, and optional address and contact information, the application header and newly generated Balance Sheet, P/L, CSV, XLSX, print preview, PDF, and accountant package show the configured values. No prior customer's identity appears.

### A16 — Company-setting migration

Opening an existing database migrates its company name, currency, fiscal-year start, accounting basis, and active tax year into Company Settings without changing transactions or report totals. Editing the profile writes audit history and does not rewrite ledger records.

### A17 — Bank account detail types

When creating or editing a Bank account, Detail Type offers Cash on hand, Checking, Money Market, Rents Held in Trust, Savings, and Trust account. The selected detail type persists and the editor previews the account under Assets.

### A18 — Full account-type placement

Accounts created as Accounts Receivable, Other Current Assets, Fixed Assets, Other Assets, Credit Card, Accounts Payable, Other Current Liabilities, Long Term Liabilities, or Equity appear in the correct Balance Sheet section and hierarchy. Income and Expense types state that they flow through Current Earnings.

### A19 — Legacy Entity migration

Existing marketplace and clearing Entity ledgers retain stable IDs and history while migrating to Other Current Assets. Any ambiguous legacy Other Transactions ledger remains visible, is flagged for review, and is never silently omitted or assigned based on a customer-specific name.

## 13. Quality requirements

- Use integer minor-unit currency arithmetic; never binary floating point.
- Use one report contract for screen, drill-down, CSV, XLSX, and print.
- Report generation must be deterministic for identical database state and parameters.
- Validate every subtotal and synthetic total against its contributing detail.
- Test signs independently for every supported account type, including Bank, Credit Card, Accounts Receivable, Accounts Payable, current and long-term assets/liabilities, Equity, Income, COGS, Expense, Other Income, and Other Expense activity.
- Test month-end, year-end, leap-day, opening-date, archived-account, and empty-report boundaries.
- Test with at least two neutral company profiles whose names, addresses, fiscal years, account names, and institutions differ; no behavior may depend on a particular customer's data.
- Test every Account Type/Detail Type compatibility rule and the legacy Entity migration.
- The report must remain usable with the current chart size and at least several thousand Posted transactions.
- A report failure must not mutate the ledger or leave a partial export presented as complete.

## 14. Delivery boundary

The Balance Sheet feature is complete only when:

1. All BS-001 through BS-030 requirements are implemented.
2. All A1 through A19 acceptance scenarios pass.
3. Every displayed amount drills into exactly reconciling detail.
4. Current Earnings agrees with the existing unadjusted P/L.
5. Assets equal Liabilities plus Equity for valid fixtures.
6. CSV, XLSX, print preview, and PDF agree with the on-screen report.
7. Browser tests and the Electron smoke test exercise navigation, parameters, drill-down, warnings, exports, print preview, and accounting-equation reconciliation.
8. Company Settings drive application/report identity everywhere, and generic fixtures prove there are no hard-coded customer assumptions.
9. The full account taxonomy, compatible detail types, Balance Sheet placement preview, and legacy Entity migration pass browser, persistence, and Electron acceptance.

## 15. Future extensions

Potential later additions that are not required for the first release:

- Comparative columns for prior month, prior year, and custom dates.
- Common-size percentages and financial ratios.
- Transaction-level or account-level cash-flow classification metadata.
- A general journal-entry workspace and explicit closing entries.
- Consolidated reporting across companies.
- Balance Sheet notes and accountant annotations.

## 16. Public validation data

The fictional `sample-data/` chart, ledgers, import files, and expected reports are the validation baseline. They exercise grouped account types, context-sensitive detail types, subaccounts, current balances, retained earnings, current earnings, and exact accounting-equation reconciliation without relying on private reference images or company-specific values.
