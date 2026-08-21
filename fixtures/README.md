# Fictional parser test fixtures

These immutable, offline fixtures contain only fictional values. They exercise import source shapes; tests must never overwrite them. The larger two-year accounting and balance-sheet dataset lives in `sample-data/`.

| Fixture | Source shape | Expected use |
|---|---|---|
| `imports/bank/checking-valid.csv` | Fictional bank CSV | Preview, normalization, and pending commit |
| `imports/bank/bofa-summary-preamble.csv` | Fictional statement CSV with summary rows above the transaction header | CSV preamble removal, header detection, and original-row provenance |
| `imports/amazon/monthly-summary.csv` | Fictional marketplace summary CSV | Row-level exact-zero rejection and valid-row disposition |
| `balance-sheet/company-fixtures.json` | Two deliberately different fictional companies | Company identity, fiscal-calendar, institution, and account-name neutrality |
| `balance-sheet/baseline-oracle.json` | Schema-5 counts and exact A1–A19 expectations | Integer totals, detail reconciliation, migration, output parity, and acceptance targets |

No fixture requires network access, a live bank connection, or a real company file.

Run `cd site && npm run test:balance-sheet-fixtures` to validate the Balance Sheet oracle independently. The same validator runs as part of `npm run test:ci`.
