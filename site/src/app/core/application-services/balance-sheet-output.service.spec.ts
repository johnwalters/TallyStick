import { balanceSheetCsv } from './balance-sheet-output.service';
import { balanceSheetDetailKey, balanceSheetReportId, databaseRevision, syntheticBalanceSheetRowId } from '../domain-model/balance-sheet.types';

describe('Balance Sheet CSV output', () => {
  it('exports immutable rows, metadata, warnings, special characters, and final totals without tax data', () => {
    const query = { asOfDate: '2026-12-31', includeZeroBalanceAccounts: false };
    const revision = databaseRevision('revision-1');
    const rowId = syntheticBalanceSheetRowId('TOTAL_ASSETS', query.asOfDate);
    const csv = balanceSheetCsv({
      reportId: balanceSheetReportId(revision, query), databaseRevision: revision, generatedAt: '2026-01-01T00:00:00Z', query,
      company: { companyId: 'company', legalName: 'Café, "North" LLC', displayName: 'Café\nNorth', addressLines: [], contactLines: [] }, currencyCode: 'USD', accountingBasis: 'CASH', fiscalPeriod: { startDate: '2026-01-01', endDate: '2026-12-31' },
      rows: [{ rowId, rowType: 'TOTAL', section: 'ASSETS', label: 'Total Assets', depth: 0, amountMinor: -123n, detailKey: balanceSheetDetailKey(rowId), bold: true, derived: true, archived: false, unclassified: false }],
      totalAssetsMinor: -123n, totalLiabilitiesMinor: 0n, totalEquityMinor: -123n, totalLiabilitiesAndEquityMinor: -123n, differenceMinor: 0n,
      warnings: [{ warningId: 'warning', code: 'ARCHIVED_NONZERO_ACCOUNT', message: 'Review, please' }], detailIndex: {},
    });
    expect(csv.startsWith('\uFEFFReport,Balance Sheet\r\n')).toBeTrue();
    expect(csv).toContain('"Café, ""North"" LLC"');
    expect(csv).toContain('"Café\nNorth"');
    expect(csv).toContain('Total Assets,-1.23');
    expect(csv).toContain('ARCHIVED_NONZERO_ACCOUNT,"Review, please"');
    expect(csv.toLowerCase()).not.toContain('tax identifier');
  });
});
