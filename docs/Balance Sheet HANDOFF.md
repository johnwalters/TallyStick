# Balance Sheet implementation handoff

The first Balance Sheet release is complete on `main` through `BS-SLICE-20-RELEASE-PROOF`.

This handoff closes the Balance Sheet implementation milestone. No Balance Sheet slice remains open, and the next product feature has not yet been selected.

## Implemented boundaries

- `BalanceSheetReportService` owns immutable as-of calculation, hierarchy, warnings, exact detail, revision checks, and report caching.
- `BalanceSheetOutputService` consumes only a supplied report for CSV, verified two-sheet XLSX, and escaped print/PDF-ready HTML.
- Electron owns save dialogs, atomic file finalization, preview windows, and File > Print / Command-P.
- The Angular workspace owns filters, date shortcuts, rendering, accessible detail interaction, and focus return.

## Verification baseline

Run from `site/`:

```bash
npm run test:ci
npm run build
npm run test:desktop-host
npm run desktop:smoke
```

The release proof recorded August 21, 2026 passed the 19-scenario, two-company oracle; 164 ChromeHeadless tests; the 10,000-transaction/2,000-account performance fixture; eight desktop-host tests; production build; and isolated Electron smoke. The build retains the previously documented initial-bundle and component-style warning categories.

Future work will be selected from a separate product discussion. Preserve the immutable-report/output boundary and create new requirements, a product specification, and a separate implementation tracker before extending behavior.
