import { cashFlowCsv, cashFlowCsvFileName, cashFlowPrintHtml, cashFlowPrintModel, cashFlowXlsx, cashFlowXlsxDecimalNumber, cashFlowXlsxFileName, CashFlowOutputService, verifyCashFlowXlsx } from './cash-flow-output.service';
import * as XLSX from 'xlsx';
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
    if (result.format !== 'CSV') throw new Error('Expected a CSV export.');
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
      expect((error as CashFlowContractError).message).toBe('Cash Flow export failed. Choose another location and try again.');
      expect((error as CashFlowContractError).message).not.toContain(privatePath);
      expect((error as CashFlowContractError).message).not.toContain('EACCES');
    }
  });

  it('builds a page-safe immutable print preview with the complete frozen report contract and no automatic print action', () => {
    const base = reportFixture();
    const report = reportFixture({
      company: { ...base.company, displayName: 'North <Studio>' },
      rows: [{ ...base.rows[0], label: 'Operations & cash' }],
      warnings: [
        { ...base.warnings[0], message: 'Check & review', accountRole: 'FINANCIAL_SOURCE', accountId: 'cash', businessDate: '2026-01-10', detailKey: 'DETAIL:WARN' as never, references: ['transaction-1', 'transfer-2'] },
        { ...base.warnings[0], warningId: 'WARN-2' as never, message: 'Check & review', accountRole: 'CHART', accountId: 'cash', references: ['transaction-3'] },
      ],
      restrictedCashBeginningMinor: 300n, restrictedCashEndingMinor: 275n, unclassifiedCashActivityMinor: -25n,
    });
    const model = cashFlowPrintModel(report);
    const output = cashFlowPrintHtml(report);
    const document = new DOMParser().parseFromString(output, 'text/html');
    expect(output).toContain('<title>North &lt;Studio&gt; — Statement of Cash Flows</title>');
    expect(output).toContain('thead{display:table-header-group}');
    expect(output).toContain('.identity-part{white-space:nowrap}');
    expect(document.querySelectorAll('.identity-part')).toHaveSize(3);
    expect(document.querySelectorAll('thead .running-context')).toHaveSize(document.querySelectorAll('table').length);
    expect(output).toContain(`Report ID: ${report.reportId}`);
    expect(output).toContain(`Database revision: ${report.databaseRevision}`);
    expect(output).toContain(`Generated at: ${report.generatedAt}`);
    expect(model.reconciliation).toEqual([
      { label: 'Net Cash from Operating Activities', amountMinor: -125n }, { label: 'Net Cash from Investing Activities', amountMinor: 0n }, { label: 'Net Cash from Financing Activities', amountMinor: 0n },
      { label: 'Net Change in Cash', amountMinor: -125n }, { label: 'Beginning Cash', amountMinor: 1000n }, { label: 'Calculated Ending Cash', amountMinor: 875n }, { label: 'Ending Cash', amountMinor: 875n },
      { label: 'Restricted Cash Beginning', amountMinor: 300n }, { label: 'Restricted Cash Ending', amountMinor: 275n }, { label: 'Unclassified Cash Activity', amountMinor: -25n }, { label: 'Difference', amountMinor: 0n },
    ]);
    model.reconciliation.forEach(metric => {
      const absolute = metric.amountMinor < 0n ? -metric.amountMinor : metric.amountMinor;
      expect(document.querySelector('[aria-label="Cash reconciliation"]')?.textContent).toContain(`${metric.label}${metric.amountMinor < 0n ? '-' : ''}$${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`);
    });
    expect(output).toContain('@page{margin:16mm}');
    expect(output).toContain(cashFlowReportDisclaimer(report.query));
    expect(output).toContain('Check &amp; review');
    report.warnings.forEach(warning => {
      const row = document.querySelector(`[data-warning-id="${warning.warningId}"]`);
      expect(row?.textContent).toContain(warning.warningId);
      expect(row?.textContent).toContain(warning.code);
      expect(row?.textContent).toContain(warning.message);
      expect(row?.textContent).toContain(warning.accountRole!);
      expect(row?.textContent).toContain(warning.accountId!);
      (warning.references ?? []).forEach(reference => expect(row?.textContent).toContain(reference));
    });
    expect(output).toContain('Supplemental noncash disclosures');
    expect(output).toContain('Cash reconciliation');
    expect(output).toContain('Difference');
    expect(output).toContain('id="print-document"');
    expect(output).toContain('onclick="window.print()"');
    expect(output).not.toContain('onload=');
    expect(output.toLowerCase()).not.toContain('tax identifier');
  });

  it('keeps the frozen print model deterministic across zero-row display variants while retaining identity and provenance', () => {
    const shown = reportFixture({ query: { startDate: '2026-01-01', endDate: '2026-12-31', includeZeroRows: true } });
    const hidden = reportFixture({ query: { ...shown.query, includeZeroRows: false } });
    expect(cashFlowPrintModel(shown)).toEqual(cashFlowPrintModel(hidden));
    expect(cashFlowPrintHtml(shown)).toContain(`Report ID: ${shown.reportId}`);
    expect(cashFlowPrintHtml(hidden)).toContain(`Report ID: ${hidden.reportId}`);
  });

  it('opens a native preview without printing and returns a typed, safe preview failure', async () => {
    const report = reportFixture();
    const open = jasmine.createSpy('open').and.resolveTo('preview-1');
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportPreview: { open } };
    const result = await new CashFlowOutputService().openPrintPreview(report);
    expect(result).toEqual({ opened: true, title: 'North Company — Statement of Cash Flows', previewId: 'preview-1' });
    expect(open).toHaveBeenCalledOnceWith('North Company — Statement of Cash Flows', cashFlowPrintHtml(report));

    delete (globalThis as { localAccounting?: unknown }).localAccounting;
    expect(await new CashFlowOutputService().openPrintPreview(report)).toEqual({ opened: false, title: 'North Company — Statement of Cash Flows' });
    const privatePath = '/Users/private/Statement.pdf';
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportPreview: { open: jasmine.createSpy('failed-open').and.rejectWith(new Error(privatePath)) } };
    try {
      await new CashFlowOutputService().openPrintPreview(report);
      fail('Expected a typed print preview failure.');
    } catch (error) {
      expect(error).toEqual(jasmine.any(CashFlowContractError));
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_PRINT_PREVIEW_FAILED');
      expect((error as Error).message).not.toContain(privatePath);
    }
  });

  it('writes a deterministic, three-sheet XLSX workbook in browser mode', async () => {
    const report = reportFixture();
    const first = cashFlowXlsx(report);
    const second = cashFlowXlsx(report);
    expect(Array.from(first)).toEqual(Array.from(second));
    const workbook = XLSX.read(first, { type: 'array', cellStyles: true });
    expect(workbook.SheetNames).toEqual(['Statement of Cash Flows', 'Cash Flow Detail', 'Cash Flow Classifications']);
    const statement = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Statement of Cash Flows'], { header: 1, defval: '', raw: true });
    expect(statement[0].slice(0, 2)).toEqual(['Report', 'Statement of Cash Flows']);
    expect(statement.find(row => row[0] === 'Report ID')?.[1]).toBe(report.reportId);
    const row = statement.find(item => item[0] === report.rows[0].rowId)!;
    expect(row[0]).toBe(report.rows[0].rowId);
    expect(typeof row[8]).toBe('number');
    const detail = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Cash Flow Detail'], { header: 1, defval: '', raw: true });
    expect(detail[1][0]).toBe('CONTRIBUTION');
    expect(detail[1][1]).toBe(report.rows[0].rowId);
    expect(detail[1][29]).toBe(report.reportId);
    expect(detail[1][30]).toBe(report.databaseRevision);
    const classifications = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Cash Flow Classifications'], { header: 1, defval: '', raw: true });
    expect(classifications.length - 1).toBe(report.classifications.length);
    const browserResult = await new CashFlowOutputService().export(report, 'XLSX');
    expect(browserResult).toEqual(jasmine.objectContaining({ format: 'XLSX', status: 'DOWNLOAD_READY', suggestedFileName: cashFlowXlsxFileName(report), rowCount: report.rows.length, bytes: jasmine.any(Uint8Array) }));
    expect('path' in browserResult).toBeFalse();
    expect('completedAtUtc' in browserResult).toBeFalse();
  });

  it('keeps classification ordering and workbook bytes stable across input order and Unicode variants', () => {
    const base = reportFixture();
    const classifications = [
      { ...base.classifications[0], accountRole: 'CHART' as const, accountId: 'z-account', accountPath: 'Éclair' },
      { ...base.classifications[0], accountRole: 'CHART' as const, accountId: 'a-account', accountPath: 'E\u0301clair' },
      { ...base.classifications[0], accountRole: 'FINANCIAL_SOURCE' as const, accountId: 'financial-account', accountPath: 'Eclair' },
      { ...base.classifications[0], accountRole: 'CHART' as const, accountId: 'm-account', accountPath: 'İnvoice' },
    ];
    const first = cashFlowXlsx(reportFixture({ classifications }));
    const second = cashFlowXlsx(reportFixture({ classifications: [...classifications].reverse() }));
    expect(Array.from(second)).toEqual(Array.from(first));
    const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(first, { type: 'array' }).Sheets['Cash Flow Classifications'], { header: 1, defval: '', raw: true });
    expect(rows.slice(1).map(row => `${row[0]}:${row[1]}`)).toEqual([
      'CHART:a-account', 'CHART:z-account', 'FINANCIAL_SOURCE:financial-account', 'CHART:m-account',
    ]);
  });

  it('exports genuine contribution detail without fabricating structural records', () => {
    const base = reportFixture();
    const emptyDetailKey = 'DETAIL:ZERO:EMPTY' as NonNullable<CashFlowReport['rows'][number]['detailKey']>;
    const offsetDetailKey = 'DETAIL:ZERO:OFFSET' as NonNullable<CashFlowReport['rows'][number]['detailKey']>;
    const structural = { ...base.rows[0], rowId: 'SECTION:ZERO' as never, amountMinor: undefined, detailKey: undefined };
    const empty = { ...base.rows[0], rowId: 'ROW:ZERO:EMPTY' as never, amountMinor: 0n, detailKey: emptyDetailKey };
    const offset = { ...base.rows[0], rowId: 'ROW:ZERO:OFFSET' as never, amountMinor: 0n, detailKey: offsetDetailKey };
    const source = base.detailIndex[base.rows[0].detailKey!]![0];
    const report = reportFixture({
      rows: [structural, empty, offset],
      detailIndex: {
        [emptyDetailKey]: [],
        [offsetDetailKey]: [
          { ...source, contributionId: 'offset-positive', detailKey: offsetDetailKey, contributionMinor: 5n },
          { ...source, contributionId: 'offset-negative', detailKey: offsetDetailKey, contributionMinor: -5n },
        ],
      },
    });
    const detail = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(cashFlowXlsx(report), { type: 'array' }).Sheets['Cash Flow Detail'], { header: 1, defval: '', raw: true });
    expect(detail.slice(1).map(row => row[0])).toEqual(['ROW_CONTEXT', 'CONTRIBUTION', 'CONTRIBUTION']);
    expect(detail.some(row => row[1] === structural.rowId)).toBeFalse();
    const context = detail[1];
    expect(context[1]).toBe(empty.rowId);
    expect(context[3]).toBe('');
    expect(context[4]).toBe('');
    expect(context[5]).toBe('');
    expect(context[21]).toBe('');
    expect(context[23]).toBe('');
    expect(context[25]).toBe('');
    expect(detail.slice(2).map(row => row[3])).toEqual(['offset-positive', 'offset-negative']);
    expect(detail.slice(2).map(row => row[5])).toEqual(['5', '-5']);
    expect(detail.slice(2).reduce((sum, row) => sum + BigInt(String(row[5])), 0n)).toBe(0n);
  });

  it('serializes hierarchy indentation and bold styles, and rejects stripped styles', () => {
    const rows = [
      { ...reportFixture().rows[0], rowId: 'ROW-0' as never, detailKey: undefined, amountMinor: 0n, depth: 0, bold: true },
      { ...reportFixture().rows[0], rowId: 'ROW-1' as never, detailKey: undefined, amountMinor: 0n, depth: 1, bold: false },
      { ...reportFixture().rows[0], rowId: 'ROW-2' as never, detailKey: undefined, amountMinor: 0n, depth: 2, bold: true },
    ];
    const report = reportFixture({ rows, detailIndex: {} });
    const bytes = cashFlowXlsx(report);
    const cfb = XLSX.CFB.read(bytes, { type: 'array' }) as any;
    const styles = new TextDecoder().decode(cfb.FileIndex.find((entry: any) => entry.name === 'styles.xml').content);
    const sheet = new TextDecoder().decode(cfb.FileIndex.find((entry: any) => entry.name === 'sheet1.xml').content);
    const xfs = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '').matchAll(/<xf\b[\s\S]*?(?:<\/xf>|\/>)/g)].map(match => match[0]);
    const styleFor = (cell: string) => Number(sheet.match(new RegExp(`<c\\s+[^>]*\\br="${cell}"[^>]*>`))?.[0].match(/\bs="(\d+)"/)?.[1]);
    expect(xfs[styleFor('E17')]).toContain('indent="0"');
    expect(xfs[styleFor('E17')]).toContain('applyFont="1"');
    expect(xfs[styleFor('E18')]).toContain('indent="1"');
    expect(xfs[styleFor('E18')]).toContain('applyFont="0"');
    expect(xfs[styleFor('E19')]).toContain('indent="2"');
    expect(xfs[styleFor('E19')]).toContain('applyFont="1"');
    const brokenCfb = XLSX.CFB.read(bytes, { type: 'array' }) as any;
    const sheetEntry = brokenCfb.FileIndex.find((entry: any) => entry.name === 'sheet1.xml');
    const brokenSheet = new TextDecoder().decode(sheetEntry.content).replace(/<c\b[^>]*\br="E17"[^>]*>/, tag => tag.replace(/\s+s="\d+"/g, ''));
    sheetEntry.content = new TextEncoder().encode(brokenSheet);
    const brokenBytes = new Uint8Array(XLSX.CFB.write(brokenCfb, { type: 'array', compression: true, fileType: 'zip' }));
    expect(() => verifyCashFlowXlsx(brokenBytes, report)).toThrowError(/serialized cell|style/);
  });

  it('rejects XLSX export when a valid minor amount cannot be represented exactly', async () => {
    const huge = 9007199254740993n;
    const base = reportFixture();
    const detailKey = base.rows[0].detailKey!;
    const report = reportFixture({
      rows: [{ ...base.rows[0], amountMinor: huge }],
      detailIndex: { [detailKey]: [{ ...base.detailIndex[detailKey]![0], contributionMinor: huge }] },
    });
    expect(() => cashFlowXlsx(report)).toThrowError(/not exactly representable/);
    try {
      await new CashFlowOutputService().export(report, 'XLSX');
      fail('Expected typed export failure.');
    } catch (error) {
      expect(error).toEqual(jasmine.any(CashFlowContractError));
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_EXPORT_FAILED');
    }
    expect(cashFlowXlsxDecimalNumber(9007199254740991n)).toBe(90071992547409.91);
  });

  it('neutralizes formula-like workbook text while retaining numeric cells', () => {
    const base = reportFixture();
    const report = reportFixture({
      company: { ...base.company, displayName: '=North Studio' },
      rows: [{ ...base.rows[0], label: '=2+2' }],
      warnings: [{ ...base.warnings[0], message: '@run-me' }],
    });
    const workbook = XLSX.read(cashFlowXlsx(report), { type: 'array' });
    const statement = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['Statement of Cash Flows'], { header: 1, defval: '', raw: true });
    expect(statement.find(row => row[0] === 'Company display name')?.[1]).toBe("'=North Studio");
    expect(statement.find(row => row[0] === report.rows[0].rowId)?.[4]).toBe("'=2+2");
    expect(typeof statement.find(row => row[0] === report.rows[0].rowId)?.[8]).toBe('number');
  });

  it('saves XLSX through the local bridge and models cancellation without success fields', async () => {
    const report = reportFixture();
    const save = jasmine.createSpy('save').and.resolveTo('SAVED' as const);
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };
    const result = await new CashFlowOutputService().export(report, 'XLSX');
    expect(save).toHaveBeenCalledOnceWith(cashFlowXlsxFileName(report), jasmine.any(Uint8Array), 'XLSX', 'Statement of Cash Flows');
    expect(result.status).toBe('SAVED');
    if (result.status !== 'SAVED' || result.format !== 'XLSX') throw new Error('Expected a saved XLSX export.');
    expect(result.path).toBe(cashFlowXlsxFileName(report));
    expect(result.bytes).toEqual(jasmine.any(Uint8Array));

    delete (globalThis as { localAccounting?: unknown }).localAccounting;
    const cancelledBridge = jasmine.createSpy('cancel').and.resolveTo('CANCELLED' as const);
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save: cancelledBridge } };
    const cancelled = await new CashFlowOutputService().export(report, 'XLSX');
    expect(cancelled).toEqual({ format: 'XLSX', status: 'CANCELLED', rowCount: report.rows.length });
    expect('path' in cancelled).toBeFalse();
    expect('completedAtUtc' in cancelled).toBeFalse();
  });

  it('redacts host paths for XLSX failures', async () => {
    const report = reportFixture();
    const privatePath = '/Users/private/Documents/secret-ledger.xlsx';
    const save = jasmine.createSpy('save').and.rejectWith(new Error(`EACCES: cannot write ${privatePath}`));
    (globalThis as { localAccounting?: unknown }).localAccounting = { reportFiles: { save } };
    try {
      await new CashFlowOutputService().export(report, 'XLSX');
      fail('Expected a typed export failure.');
    } catch (error) {
      expect(error).toEqual(jasmine.any(CashFlowContractError));
      expect((error as CashFlowContractError).code).toBe('CASH_FLOW_EXPORT_FAILED');
      expect((error as CashFlowContractError).message).not.toContain(privatePath);
      expect((error as CashFlowContractError).message).not.toContain('EACCES');
    }
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
    classifications: [{
      accountRole: 'CHART', accountId: 'expense', accountPath: 'Expenses > Operating expense', accountType: 'EXPENSE', detailType: 'Office expenses',
      treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'USER', rationale: 'Operating expense classification.', archived: false,
    }],
    netOperatingMinor: -125n, netInvestingMinor: 0n, netFinancingMinor: 0n, netChangeInCashMinor: -125n,
    beginningCashMinor: 1000n, calculatedEndingCashMinor: 875n, endingCashMinor: 875n, differenceMinor: 0n,
    restrictedCashBeginningMinor: 0n, restrictedCashEndingMinor: 0n, unclassifiedCashActivityMinor: 0n,
    warnings: [warning], detailIndex: { [detailKey!]: [{ contributionId: 'contribution', detailKey: detailKey!, contributionType: 'CASH_TRANSACTION', contributionMinor: -125n }] },
    ...overrides,
  };
}
