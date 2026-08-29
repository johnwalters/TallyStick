import { cashFlowCsv, cashFlowCsvFileName, CashFlowOutputService } from './cash-flow-output.service';
import { cashFlowReportDisclaimer, CashFlowContractError, CashFlowReport } from '../domain-model/cash-flow.types';

describe('Cash Flow CSV output', () => {
  afterEach(() => {
    delete (globalThis as { localAccounting?: unknown }).localAccounting;
  });

  it('writes deterministic metadata, screen-order rows, warnings, reconciliation, and disclosures', () => {
    const report = reportFixture();
    const first = cashFlowCsv(report);
    const second = cashFlowCsv(report);

    expect(first).toBe(second);
    expect(first.startsWith('\uFEFFReport,Statement of Cash Flows\r\n')).toBeTrue();
    expect(first).toContain('Company legal name,North Company');
    expect(first).toContain('Status,REVIEW_REQUIRED');
    expect(first).toContain(`Disclaimer,${cashFlowReportDisclaimer(report.query)}`);
    expect(first).toContain('ACCOUNT:OPERATING:CHART:expense,ACCOUNT_ACTIVITY,OPERATING');
    expect(first).toContain('Difference,0,0.00');
    expect(first).toContain('WARN-1,UNCLASSIFIED_CASH_ACTIVITY');
    expect(first).toContain('DISC-1,NONCASH_DISCLOSURE');
    expect(cashFlowCsvFileName(report)).toBe('north-company-statement-of-cash-flows-2026-01-01-2026-12-31.csv');
  });

  it('round-trips Unicode, quoting, newlines, and spreadsheet formula text safely', () => {
    const base = reportFixture();
    const report = reportFixture({
      company: { companyId: 'company', legalName: 'Café, "North" LLC', displayName: '=North\nStudio', addressLines: [], contactLines: [] },
      rows: [{ ...base.rows[0], label: '=2+2, "unsafe"\nlabel' }],
      warnings: [{ ...base.warnings[0], message: '@run-me' }],
    });
    const csv = cashFlowCsv(report);
    expect(csv).toContain('"Café, ""North"" LLC"');
    expect(csv).toContain("'=North\nStudio");
    expect(csv).toContain(`'=2+2, ""unsafe""\nlabel`);
    expect(csv).toContain("'@run-me");
    expect(csv).not.toContain('\n=North');
  });

  it('uses the local save bridge when present and returns the same immutable content', async () => {
    const report = reportFixture();
    const save = jasmine.createSpy('save').and.resolveTo('SAVED' as const);
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };
    const result = await new CashFlowOutputService().export(report, 'CSV');

    expect(save).toHaveBeenCalledOnceWith(cashFlowCsvFileName(report), jasmine.any(Uint8Array), 'CSV', 'Statement of Cash Flows');
    expect(result.status).toBe('SAVED');
    if (result.status !== 'SAVED') throw new Error('Expected a saved export.');
    expect(result.path).toBe(cashFlowCsvFileName(report));
    expect(result.suggestedFileName).toBe(result.path);
    expect(result.content).toBe(cashFlowCsv(report));
    expect(result.rowCount).toBe(report.rows.length);
  });

  it('returns a browser-download-ready result without success-only save fields when no host bridge exists', async () => {
    const result = await new CashFlowOutputService().export(reportFixture(), 'CSV');

    expect(result).toEqual(jasmine.objectContaining({ format: 'CSV', status: 'DOWNLOAD_READY', rowCount: 1, suggestedFileName: jasmine.any(String), content: jasmine.any(String) }));
    expect('path' in result).toBeFalse();
    expect('completedAtUtc' in result).toBeFalse();
  });

  it('returns a field-minimal cancellation and never labels it as saved', async () => {
    const report = reportFixture();
    const save = jasmine.createSpy('save').and.resolveTo('CANCELLED' as const);
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };
    const result = await new CashFlowOutputService().export(report, 'CSV');

    expect(result).toEqual({ format: 'CSV', status: 'CANCELLED', rowCount: report.rows.length });
    expect('path' in result).toBeFalse();
    expect('completedAtUtc' in result).toBeFalse();
  });

  it('redacts private host paths from typed export failures', async () => {
    const report = reportFixture();
    const privatePath = '/Users/private/Documents/secret-ledger.csv';
    const save = jasmine.createSpy('save').and.rejectWith(new Error(`EACCES: cannot write ${privatePath}`));
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };

    try {
      await new CashFlowOutputService().export(report, 'CSV');
      fail('Expected a typed export failure.');
    } catch (error) {
      expect(error).toEqual(jasmine.any(CashFlowContractError));
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_EXPORT_FAILED');
      expect((error as CashFlowContractError).message).toBe('Cash Flow CSV export failed. Choose another location and try again.');
      expect((error as CashFlowContractError).message).not.toContain(privatePath);
      expect((error as CashFlowContractError).message).not.toContain('EACCES');
    }
  });

  it('keeps XLSX deferred and does not invoke the save bridge', async () => {
    const save = jasmine.createSpy('save');
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };
    await expectAsync(new CashFlowOutputService().export(reportFixture(), 'XLSX')).toBeRejectedWithError(/later output slice/);
    expect(save).not.toHaveBeenCalled();
  });
});

function reportFixture(overrides: Partial<CashFlowReport> = {}): CashFlowReport {
  const detailKey = 'DETAIL:ACCOUNT:OPERATING:CHART:expense' as CashFlowReport['rows'][number]['detailKey'];
  const row = {
    rowId: 'ACCOUNT:OPERATING:CHART:expense' as never, rowType: 'ACCOUNT_ACTIVITY' as const, section: 'OPERATING' as const,
    treatment: 'OPERATING_REVENUE_EXPENSE' as const, accountRole: 'CHART' as const, accountId: 'expense',
    label: 'Operating expense', fullPath: 'Expenses > Operating expense', depth: 2, amountMinor: -125n,
    detailKey, bold: false, derived: true, archived: false, reviewRequired: false,
  };
  const warning = {
    warningId: 'WARN-1' as never, code: 'UNCLASSIFIED_CASH_ACTIVITY' as const, message: 'Review, please', references: ['tx-1'],
  };
  const disclosure = {
    disclosureId: 'DISC-1', section: 'NONCASH_DISCLOSURE' as const, label: 'Debt-financed asset', amountMinor: 500n,
    rationale: 'Recorded opposite-side classifications.',
  };
  return {
    reportId: 'CASH_FLOW:revision:2026-01-01:2026-12-31:INDIRECT:v1' as never, databaseRevision: 'revision' as never,
    generatedAt: '2026-08-29T00:00:00.000Z', query: { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: false },
    company: { companyId: 'company', legalName: 'North Company', displayName: 'North Company', addressLines: [], contactLines: [] },
    currencyCode: 'USD', accountingBasis: 'CASH', method: 'INDIRECT', status: 'REVIEW_REQUIRED', rows: [row], disclosures: [disclosure],
    netOperatingMinor: -125n, netInvestingMinor: 0n, netFinancingMinor: 0n, netChangeInCashMinor: -125n,
    beginningCashMinor: 1000n, calculatedEndingCashMinor: 875n, endingCashMinor: 875n, differenceMinor: 0n,
    restrictedCashBeginningMinor: 0n, restrictedCashEndingMinor: 0n, unclassifiedCashActivityMinor: 0n,
    warnings: [warning], detailIndex: { [detailKey!]: [{ contributionId: 'contribution', detailKey: detailKey!, contributionType: 'CASH_TRANSACTION', contributionMinor: -125n }] },
    ...overrides,
  };
}
