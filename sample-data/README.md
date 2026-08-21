# TallyStick public sample/test data

This folder contains a fully fictional two-year bookkeeping dataset derived from the **shapes and accounting scenarios** found in the private 2025 and 2026 source material. It does not copy real company names, people, account numbers, transaction references, SKUs, addresses, or amounts.

## What is covered

- 2025 full-year activity and 2026 activity through August 31.
- CSV, Excel, QBO/OFX, and marketplace-summary import shapes.
- Bank assets, an archived savings account, credit-card liability, marketplace clearing, inventory tracking, and a migration-review clearing account.
- Balance-sheet chart accounts for current assets, fixed assets, liabilities, and owner equity.
- Income, refunds, shipping income, COGS, marketplace fees, storage fees, advertising, insurance, software, interest income, and interest expense.
- Opening Balance Equity, prior-year Retained Earnings, Current Earnings, parent/child subtotals, matched transfers, excluded and pending activity, and a post-as-of transaction.

## Folder map

| Path | Purpose |
| --- | --- |
| `company/` | Fictional company settings. |
| `chart/` | Public-safe chart of accounts with stable IDs and balance-sheet taxonomy. |
| `ledger/` | Canonical financial accounts, transactions, posting splits, and confirmed transfers. Amount Minor is authoritative. |
| `imports/2025/` | 2025 import fixtures; the checking fixture is XLSX. |
| `imports/2026/` | 2026 import fixtures; the checking fixture is QBO. |
| `imports/negative-cases/` | Deliberately invalid rows for preview/rejection tests. |
| `expected/` | Expected P/L, Balance Sheet, counts, and reconciliation values. |
| `tallystick-sample-data.xlsx` | Human-readable audit workbook with checks and the complete canonical dataset. |

## Sign convention

- Asset-source deposits are positive and withdrawals are negative.
- Credit-card charges are negative and payments are positive.
- A Posted transaction's posting splits sum exactly to the transaction amount.
- Balance-sheet Chart contributions follow the product spec: Asset = negative split; Liability/Equity = split.
- Matched transfers are equal and opposite and have no posting splits.

## Import notes

- Import the two sides of a transfer into their named destination accounts, then match them; do not categorize them.
- Marketplace summary rows belong in `fin-marketplace`; marketplace payout rows are the clearing-account side of the bank deposits.
- Inventory activity belongs in `fin-inventory` and intentionally includes the 2025 year-end COGS adjustment and its 2026 reversal.
- Exact-zero marketplace rows are intentional rejection fixtures and are absent from the canonical ledger.
- The canonical ledger already assigns states and splits; raw import files do not encode those review decisions.

## Expected balance-sheet checks

Both `2025-12-31` and `2026-08-31` reconcile exactly in integer minor units. The 2026 report carries 2025 net profit into derived Retained Earnings. The post-August 2026 trade-show transaction must not affect the August 31 report.
