# Fictional parser test fixtures

These immutable, offline fixtures contain only fictional values. They exercise import source shapes; tests must never overwrite them. The larger two-year accounting and balance-sheet dataset lives in `sample-data/`.

| Fixture | Source shape | Expected use |
|---|---|---|
| `imports/bank/checking-valid.csv` | Fictional bank CSV | Preview, normalization, and pending commit |
| `imports/bank/bofa-summary-preamble.csv` | Fictional statement CSV with summary rows above the transaction header | CSV preamble removal, header detection, and original-row provenance |
| `imports/amazon/monthly-summary.csv` | Fictional marketplace summary CSV | Row-level exact-zero rejection and valid-row disposition |

No fixture requires network access, a live bank connection, or a real company file.
