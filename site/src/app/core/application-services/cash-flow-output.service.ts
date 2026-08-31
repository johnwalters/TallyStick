import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import {
  cashFlowReportDisclaimer,
  CashFlowContractError,
  CashFlowContribution,
  CashFlowExportFormat,
  CashFlowExportResult,
  CashFlowPrintPreviewResult,
  CashFlowReport,
  CashFlowRow,
  CashFlowWarning,
  CashFlowDisclosure,
} from '../domain-model/cash-flow.types';

interface ReportFileBridge {
  save(suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML', reportTitle?: 'Balance Sheet' | 'Statement of Cash Flows'): Promise<'SAVED' | 'CANCELLED'>;
}

interface ReportPreviewBridge {
  open(title: string, html: string): Promise<string>;
}

/**
 * Builds Cash Flow output from the already-frozen report value. This service
 * deliberately has no repository dependency: output cannot recalculate,
 * reclassify, or observe a second snapshot.
 */
@Injectable({ providedIn: 'root' })
export class CashFlowOutputService {
  async export(report: CashFlowReport, format: CashFlowExportFormat): Promise<CashFlowExportResult> {
    const suggestedFileName = format === 'XLSX' ? cashFlowXlsxFileName(report) : cashFlowCsvFileName(report);
    let content: string | undefined;
    let bytes: Uint8Array;
    try {
      if (format === 'CSV') {
        content = cashFlowCsv(report);
        bytes = new TextEncoder().encode(content);
      } else {
        bytes = cashFlowXlsx(report);
      }
    } catch (_error) {
      throw exportFailure(report);
    }
    const bridge = (globalThis as { localAccounting?: { reportFiles?: ReportFileBridge } }).localAccounting?.reportFiles;
    if (!bridge) {
      return Object.freeze(format === 'CSV' ? {
        format: 'CSV' as const,
        status: 'DOWNLOAD_READY' as const,
        rowCount: report.rows.length,
        content: content!,
        suggestedFileName,
      } : {
        format: 'XLSX' as const,
        status: 'DOWNLOAD_READY' as const,
        rowCount: report.rows.length,
        bytes,
        suggestedFileName,
      });
    }
    let status: 'SAVED' | 'CANCELLED';
    try {
      status = await bridge.save(suggestedFileName, bytes, format, 'Statement of Cash Flows');
    } catch (_error) {
      throw exportFailure(report);
    }
    if (status === 'CANCELLED') {
      return Object.freeze({
        format,
        status: 'CANCELLED' as const,
        rowCount: report.rows.length,
      });
    }
    return Object.freeze(format === 'CSV' ? {
      format: 'CSV' as const,
      path: suggestedFileName,
      suggestedFileName,
      completedAtUtc: new Date().toISOString(),
      rowCount: report.rows.length,
      content: content!,
      status: 'SAVED' as const,
    } : {
      format: 'XLSX' as const,
      path: suggestedFileName,
      suggestedFileName,
      completedAtUtc: new Date().toISOString(),
      rowCount: report.rows.length,
      bytes,
      status: 'SAVED' as const,
    });
  }

  /** Opens a native preview only. The preview itself contains the explicit
   * Print / Save as PDF control; this boundary never invokes system printing. */
  async openPrintPreview(report: CashFlowReport): Promise<CashFlowPrintPreviewResult> {
    const title = `${report.company.displayName} — Statement of Cash Flows`;
    const bridge = (globalThis as { localAccounting?: { reportPreview?: ReportPreviewBridge } }).localAccounting?.reportPreview;
    if (!bridge) return Object.freeze({ opened: false, title });
    try {
      return Object.freeze({ opened: true, title, previewId: await bridge.open(title, cashFlowPrintHtml(report)) });
    } catch (_error) {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_PRINT_PREVIEW_FAILED',
        message: 'Cash Flow print preview could not be opened. Try again.',
        reportId: report.reportId,
        databaseRevision: report.databaseRevision,
        retryable: true,
      });
    }
  }
}

/** Page-safe print/PDF document built only from the frozen report. It contains
 * no tax identifier, host path, or implicit call to the system print dialog. */
export function cashFlowPrintHtml(report: CashFlowReport): string {
  const model = cashFlowPrintModel(report);
  const context = printContext(model);
  const tableHead = (first: string, second: string) => `<thead><tr class="running-context"><th colspan="2">${context}</th></tr><tr><th>${html(first)}</th><th>${html(second)}</th></tr></thead>`;
  const rows = report.rows.map(row => `<tr class="${printRowClass(row)}"><td style="padding-left:${14 + row.depth * 18}px">${html(row.label)}${row.archived ? ' <small>Archived</small>' : ''}${row.reviewRequired ? ' <small>Review required</small>' : ''}</td><td>${row.amountMinor === undefined ? '' : html(moneyText(row.amountMinor))}</td></tr>`).join('');
  const warnings = model.warnings.length ? `<section class="warnings"><h2>${report.status === 'REVIEW_REQUIRED' ? 'Review required' : 'Warnings and disclosures'}</h2><table aria-label="Cash Flow warnings">${tableHead('Warning', 'Provenance')}<tbody>${model.warnings.map(warning => `<tr data-warning-id="${html(warning.warningId)}"><td><strong>${html(warning.code)}</strong><small>${html(warning.message)}</small></td><td><small>Warning ID: ${html(warning.warningId)}<br>Account: ${html(warning.accountRole ?? '—')} ${html(warning.accountId ?? '')}<br>Business date: ${html(warning.businessDate ?? '—')}<br>Detail key: ${html(warning.detailKey ?? '—')}<br>References: ${html((warning.references ?? []).join(', ') || '—')}</small></td></tr>`).join('')}</tbody></table></section>` : '';
  const disclosures = model.disclosures.length ? `<section class="disclosures"><h2>Supplemental noncash disclosures</h2><table aria-label="Supplemental noncash disclosures">${tableHead('Description', 'Amount')}<tbody>${model.disclosures.map(disclosure => `<tr><td>${html(disclosure.label)}<small>${html(disclosure.rationale)}</small></td><td>${disclosure.amountMinor === undefined ? '' : html(moneyText(disclosure.amountMinor))}</td></tr>`).join('')}</tbody></table></section>` : '';
  const reconciliation = model.reconciliation.map(metric => `<tr class="${metric.label === 'Difference' ? 'difference' : ''}"><td>${html(metric.label)}</td><td>${html(moneyText(metric.amountMinor))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${html(model.title)}</title><style>@page{margin:16mm}body{font:13px Arial,sans-serif;color:#182b27}header{border-bottom:1px solid #899891;margin-bottom:14px}h1{margin:0 0 4px}h2{margin:18px 0 6px;font-size:16px}.identity{font-size:10px;color:#59675f}.identity-part{white-space:nowrap}.toolbar{margin:0 0 16px}.toolbar button{padding:8px 12px;color:#fff;background:#31564b;border:0;border-radius:4px;font:inherit;cursor:pointer}table{width:100%;border-collapse:collapse;margin-bottom:14px}thead{display:table-header-group}th,td{padding:7px 10px;border-bottom:1px solid #d8dedb;text-align:left;vertical-align:top}th:last-child,td:last-child{text-align:right;font-variant-numeric:tabular-nums}.running-context{font-size:10px;letter-spacing:.02em;text-transform:none;color:#59675f}.section-header,.group-header{background:#f4f7f4;font-weight:700;break-after:avoid-page;page-break-after:avoid}.section-header+tr,.group-header+tr{break-before:avoid-page;page-break-before:avoid}.subtotal,.total,.net-profit,.difference{font-weight:700;break-before:avoid-page;page-break-before:avoid;break-inside:avoid}.difference{border-top:2px solid #53645d}tr{break-inside:avoid;page-break-inside:avoid}small{display:block;color:#78452f;font-size:10px;margin-top:2px}.warnings,.disclosures,.reconciliation{break-inside:avoid}.disclaimer{color:#59675f;font-size:11px}@media print{.toolbar{display:none}header{break-after:avoid-page;page-break-after:avoid}h2{break-after:avoid-page;page-break-after:avoid}}</style></head><body><div class="toolbar"><button id="print-document" type="button" onclick="window.print()">Print / Save as PDF</button></div><header><h1>${html(report.company.displayName)}</h1><h2>Statement of Cash Flows</h2><p>${html(report.query.startDate)} through ${html(report.query.endDate)} · ${html(report.accountingBasis)} basis · ${html(report.method)} method · ${html(report.currencyCode)} · Status: ${html(report.status)}</p><p class="identity"><span class="identity-part">Report ID: ${html(report.reportId)}</span> · <span class="identity-part">Database revision: ${html(report.databaseRevision)}</span> · <span class="identity-part">Generated at: ${html(report.generatedAt)}</span></p><p class="disclaimer">${html(cashFlowReportDisclaimer(report.query))}</p></header>${warnings}<table aria-label="Statement of Cash Flows">${tableHead('Statement of Cash Flows', 'Amount')}<tbody>${rows}</tbody></table>${disclosures}<section class="reconciliation"><h2>Cash reconciliation</h2><table aria-label="Cash reconciliation">${tableHead('Metric', 'Amount')}<tbody>${reconciliation}</tbody></table></section></body></html>`;
}

export interface CashFlowPrintModel {
  readonly title: string;
  readonly reportId: string;
  readonly databaseRevision: string;
  readonly generatedAt: string;
  readonly disclaimer: string;
  readonly warnings: readonly CashFlowWarning[];
  readonly disclosures: readonly CashFlowDisclosure[];
  readonly reconciliation: readonly { readonly label: string; readonly amountMinor: bigint }[];
}

/** The public print model is deliberately a direct projection of the frozen
 * report and is used by both browser contract tests and the HTML renderer. */
export function cashFlowPrintModel(report: CashFlowReport): CashFlowPrintModel {
  return Object.freeze({
    title: `${report.company.displayName} — Statement of Cash Flows`, reportId: report.reportId,
    databaseRevision: report.databaseRevision, generatedAt: report.generatedAt,
    disclaimer: cashFlowReportDisclaimer(report.query),
    warnings: Object.freeze(report.warnings.map(warning => Object.freeze({ ...warning, references: Object.freeze([...(warning.references ?? [])]) }))),
    disclosures: Object.freeze([...(report.disclosures ?? [])]),
    reconciliation: Object.freeze(([
      ['Net Cash from Operating Activities', report.netOperatingMinor], ['Net Cash from Investing Activities', report.netInvestingMinor], ['Net Cash from Financing Activities', report.netFinancingMinor],
      ['Net Change in Cash', report.netChangeInCashMinor], ['Beginning Cash', report.beginningCashMinor], ['Calculated Ending Cash', report.calculatedEndingCashMinor], ['Ending Cash', report.endingCashMinor],
      ['Restricted Cash Beginning', report.restrictedCashBeginningMinor], ['Restricted Cash Ending', report.restrictedCashEndingMinor], ['Unclassified Cash Activity', report.unclassifiedCashActivityMinor], ['Difference', report.differenceMinor],
    ] as readonly (readonly [string, bigint])[]).map(([label, amountMinor]) => Object.freeze({ label, amountMinor }))),
  });
}

function printContext(model: CashFlowPrintModel): string {
  return `${html(model.title)} · ${html(model.reportId)} · Revision ${html(model.databaseRevision)} · Generated ${html(model.generatedAt)}`;
}

function exportFailure(report: CashFlowReport): CashFlowContractError {
  return new CashFlowContractError({
    code: 'CASH_FLOW_EXPORT_FAILED',
    message: 'Cash Flow export failed. Choose another location and try again.',
    reportId: report.reportId,
    databaseRevision: report.databaseRevision,
    retryable: true,
  });
}

/** Stable filename derived only from report identity and neutralized labels. */
export function cashFlowCsvFileName(report: Pick<CashFlowReport, 'company' | 'query'>): string {
  const company = (report.company.displayName || report.company.legalName || 'company')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company';
  return `${company}-statement-of-cash-flows-${report.query.startDate}-${report.query.endDate}.csv`;
}

/** Stable XLSX filename using the same report identity as CSV. */
export function cashFlowXlsxFileName(report: Pick<CashFlowReport, 'company' | 'query'>): string {
  return cashFlowCsvFileName(report).replace(/\.csv$/i, '.xlsx');
}

/**
 * Deterministic UTF-8 Summary CSV. Amount minor units remain exact integer
 * strings; the decimal amount is a presentation companion for spreadsheets.
 */
export function cashFlowCsv(report: CashFlowReport): string {
  const lines: string[][] = [
    ['Report', 'Statement of Cash Flows'],
    ['Company legal name', report.company.legalName],
    ['Company display name', report.company.displayName],
    ['Report title', 'Statement of Cash Flows'],
    ['Start date', report.query.startDate],
    ['End date', report.query.endDate],
    ['Method', report.method],
    ['Basis', report.accountingBasis],
    ['Currency', report.currencyCode],
    ['Report ID', report.reportId],
    ['Database revision', report.databaseRevision],
    ['Generated at', report.generatedAt],
    ['Status', report.status],
    ['Disclaimer', cashFlowReportDisclaimer(report.query)],
    [],
    ['Row ID', 'Row type', 'Section', 'Treatment', 'Label', 'Full path', 'Depth', 'Amount minor', 'Amount', 'Account role', 'Account ID', 'Cash role', 'Archived', 'Review required', 'Detail key', 'Warning code', 'Warning message', 'Warning references'],
    ...report.rows.map(row => [
      row.rowId,
      row.rowType,
      row.section,
      row.treatment ?? '',
      row.label,
      row.fullPath ?? '',
      String(row.depth),
      row.amountMinor === undefined ? '' : row.amountMinor.toString(),
      row.amountMinor === undefined ? '' : decimal(row.amountMinor),
      row.accountRole ?? '',
      row.accountId ?? '',
      row.cashRole ?? '',
      String(row.archived),
      String(row.reviewRequired),
      row.detailKey ?? '',
      '',
      '',
      '',
    ]),
    [],
    ['Warnings'],
    ['Warning ID', 'Code', 'Message', 'Account role', 'Account ID', 'Business date', 'Detail key', 'References'],
    ...report.warnings.map(warning => [
      warning.warningId,
      warning.code,
      warning.message,
      warning.accountRole ?? '',
      warning.accountId ?? '',
      warning.businessDate ?? '',
      warning.detailKey ?? '',
      (warning.references ?? []).slice().sort().join(';'),
    ]),
    [],
    ['Reconciliation'],
    ['Metric', 'Amount minor', 'Amount'],
    ['Net Operating', report.netOperatingMinor.toString(), decimal(report.netOperatingMinor)],
    ['Net Investing', report.netInvestingMinor.toString(), decimal(report.netInvestingMinor)],
    ['Net Financing', report.netFinancingMinor.toString(), decimal(report.netFinancingMinor)],
    ['Net Change in Cash', report.netChangeInCashMinor.toString(), decimal(report.netChangeInCashMinor)],
    ['Beginning Cash', report.beginningCashMinor.toString(), decimal(report.beginningCashMinor)],
    ['Calculated Ending Cash', report.calculatedEndingCashMinor.toString(), decimal(report.calculatedEndingCashMinor)],
    ['Ending Cash', report.endingCashMinor.toString(), decimal(report.endingCashMinor)],
    ['Restricted Cash Beginning', report.restrictedCashBeginningMinor.toString(), decimal(report.restrictedCashBeginningMinor)],
    ['Restricted Cash Ending', report.restrictedCashEndingMinor.toString(), decimal(report.restrictedCashEndingMinor)],
    ['Unclassified Cash Activity', report.unclassifiedCashActivityMinor.toString(), decimal(report.unclassifiedCashActivityMinor)],
    ['Difference', report.differenceMinor.toString(), decimal(report.differenceMinor)],
    [],
    ['Noncash disclosures'],
    ['Disclosure ID', 'Section', 'Label', 'Amount minor', 'Amount', 'Detail key', 'Account role', 'Account ID', 'Chart account ID', 'Transaction ID', 'Transfer ID', 'Rationale'],
    ...(report.disclosures ?? []).map(disclosure => [
      disclosure.disclosureId,
      disclosure.section,
      disclosure.label,
      disclosure.amountMinor === undefined ? '' : disclosure.amountMinor.toString(),
      disclosure.amountMinor === undefined ? '' : decimal(disclosure.amountMinor),
      disclosure.detailKey ?? '',
      disclosure.accountRole ?? '',
      disclosure.accountId ?? '',
      disclosure.chartAccountId ?? '',
      disclosure.transactionId ?? '',
      disclosure.transferId ?? '',
      disclosure.rationale,
    ]),
  ];
  return `\uFEFF${lines.map(row => row.map(value => csvCell(value)).join(',')).join('\r\n')}\r\n`;
}

function csvCell(value: string): string {
  // Signed integer/decimal amount fields are safe as numeric text. Other
  // leading formula characters are neutralized before a spreadsheet sees them.
  const numeric = /^-?\d+(?:\.\d+)?$/.test(value);
  const formulaLike = /^[\t\r\n ]*[=+\-@]/.test(value);
  const safe = numeric || value === '' || !formulaLike ? value : `'${value}`;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function decimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function moneyText(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}$${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function printRowClass(row: CashFlowRow): string {
  return `${row.rowType.toLowerCase().replace(/_/g, '-')}${row.bold ? ' bold' : ''}`;
}

/** Convert an exact minor-unit amount to a numeric XLSX cell only when the
 * conversion round-trips to the same decimal value.  Spreadsheet numeric
 * cells use IEEE-754 doubles, so values outside their exact precision are
 * rejected rather than silently losing cents. */
export function cashFlowXlsxDecimalNumber(value: bigint): number {
  const numeric = Number(value) / 100;
  if (!Number.isFinite(numeric) || numeric.toFixed(2) !== decimal(value)) {
    throw new Error('Cash Flow workbook amount is not exactly representable as a numeric cell.');
  }
  return numeric;
}

type WorkbookCell = string | number | boolean;

/**
 * Build the three-sheet Cash Flow workbook.  The workbook is deliberately
 * generated only from the frozen report supplied by the caller; no repository
 * lookup or recalculation is possible at this boundary.
 */
export function cashFlowXlsx(report: CashFlowReport): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const statementRows: WorkbookCell[][] = [
    ['Report', 'Statement of Cash Flows'],
    ['Company legal name', workbookText(report.company.legalName)],
    ['Company display name', workbookText(report.company.displayName)],
    ['Report title', 'Statement of Cash Flows'],
    ['Start date', workbookText(report.query.startDate)],
    ['End date', workbookText(report.query.endDate)],
    ['Method', workbookText(report.method)],
    ['Basis', workbookText(report.accountingBasis)],
    ['Currency', workbookText(report.currencyCode)],
    ['Report ID', workbookText(report.reportId)],
    ['Database revision', workbookText(report.databaseRevision)],
    ['Generated at', workbookText(report.generatedAt)],
    ['Status', workbookText(report.status)],
    ['Disclaimer', workbookText(cashFlowReportDisclaimer(report.query))],
    [],
    ['Row ID', 'Row type', 'Section', 'Treatment', 'Label', 'Full path', 'Depth', 'Amount minor', 'Amount', 'Account role', 'Account ID', 'Cash role', 'Archived', 'Review required', 'Detail key', 'Parent row ID', 'Bold', 'Derived'],
    ...report.rows.map(row => [
      workbookText(row.rowId), workbookText(row.rowType), workbookText(row.section), workbookText(row.treatment ?? ''), workbookText(row.label), workbookText(row.fullPath ?? ''), row.depth,
      row.amountMinor === undefined ? '' : row.amountMinor.toString(), row.amountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(row.amountMinor),
      workbookText(row.accountRole ?? ''), workbookText(row.accountId ?? ''), workbookText(row.cashRole ?? ''), row.archived ? 'Yes' : 'No', row.reviewRequired ? 'Yes' : 'No', workbookText(row.detailKey ?? ''), workbookText(row.parentRowId ?? ''), row.bold ? 'Yes' : 'No', row.derived ? 'Yes' : 'No',
    ]),
    [],
    ['Warnings'],
    ['Warning ID', 'Code', 'Message', 'Account role', 'Account ID', 'Business date', 'Detail key', 'References'],
    ...report.warnings.map(warning => [workbookText(warning.warningId), workbookText(warning.code), workbookText(warning.message), workbookText(warning.accountRole ?? ''), workbookText(warning.accountId ?? ''), workbookText(warning.businessDate ?? ''), workbookText(warning.detailKey ?? ''), workbookText((warning.references ?? []).slice().sort().join(';'))]),
    [],
    ['Reconciliation'],
    ['Metric', 'Amount minor', 'Amount'],
    ['Net Operating', report.netOperatingMinor.toString(), cashFlowXlsxDecimalNumber(report.netOperatingMinor)],
    ['Net Investing', report.netInvestingMinor.toString(), cashFlowXlsxDecimalNumber(report.netInvestingMinor)],
    ['Net Financing', report.netFinancingMinor.toString(), cashFlowXlsxDecimalNumber(report.netFinancingMinor)],
    ['Net Change in Cash', report.netChangeInCashMinor.toString(), cashFlowXlsxDecimalNumber(report.netChangeInCashMinor)],
    ['Beginning Cash', report.beginningCashMinor.toString(), cashFlowXlsxDecimalNumber(report.beginningCashMinor)],
    ['Calculated Ending Cash', report.calculatedEndingCashMinor.toString(), cashFlowXlsxDecimalNumber(report.calculatedEndingCashMinor)],
    ['Ending Cash', report.endingCashMinor.toString(), cashFlowXlsxDecimalNumber(report.endingCashMinor)],
    ['Restricted Cash Beginning', report.restrictedCashBeginningMinor.toString(), cashFlowXlsxDecimalNumber(report.restrictedCashBeginningMinor)],
    ['Restricted Cash Ending', report.restrictedCashEndingMinor.toString(), cashFlowXlsxDecimalNumber(report.restrictedCashEndingMinor)],
    ['Unclassified Cash Activity', report.unclassifiedCashActivityMinor.toString(), cashFlowXlsxDecimalNumber(report.unclassifiedCashActivityMinor)],
    ['Difference', report.differenceMinor.toString(), cashFlowXlsxDecimalNumber(report.differenceMinor)],
    [],
    ['Noncash disclosures'],
    ['Disclosure ID', 'Section', 'Label', 'Amount minor', 'Amount', 'Detail key', 'Account role', 'Account ID', 'Chart account ID', 'Transaction ID', 'Transfer ID', 'Description', 'Rationale'],
    ...(report.disclosures ?? []).map(disclosure => [workbookText(disclosure.disclosureId), workbookText(disclosure.section), workbookText(disclosure.label), disclosure.amountMinor === undefined ? '' : disclosure.amountMinor.toString(), disclosure.amountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(disclosure.amountMinor), workbookText(disclosure.detailKey ?? ''), workbookText(disclosure.accountRole ?? ''), workbookText(disclosure.accountId ?? ''), workbookText(disclosure.chartAccountId ?? ''), workbookText(disclosure.transactionId ?? ''), workbookText(disclosure.transferId ?? ''), workbookText(disclosure.description ?? ''), workbookText(disclosure.rationale)]),
  ];
  const statement = XLSX.utils.aoa_to_sheet(statementRows);
  const rowHeaderIndex = 15;
  report.rows.forEach((row, index) => {
    const labelCell = statement[XLSX.utils.encode_cell({ r: rowHeaderIndex + 1 + index, c: 4 })];
    if (labelCell) labelCell.s = { font: { bold: row.bold }, alignment: { indent: row.depth } };
    const amountCell = statement[XLSX.utils.encode_cell({ r: rowHeaderIndex + 1 + index, c: 8 })];
    if (amountCell?.t === 'n') { amountCell.z = '$#,##0.00;[Red]-$#,##0.00'; amountCell.s = { font: { bold: row.bold } }; }
  });
  // Apply the same presentation-only currency format to reconciliation and
  // disclosure amount columns.  Their exact minor-unit companions remain
  // integer text, while all visible amount cells reopen as numeric values.
  for (let row = 0; row < statementRows.length; row += 1) {
    for (const column of [2, 4, 8]) {
      const cell = statement[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') cell.z = '$#,##0.00;[Red]-$#,##0.00';
    }
  }
  XLSX.utils.book_append_sheet(workbook, statement, 'Statement of Cash Flows');

  const detailRows: WorkbookCell[][] = [[
    'Record type', 'Row ID', 'Detail key', 'Contribution ID', 'Contribution type', 'Contribution minor', 'Contribution amount', 'Business date', 'Account role', 'Account ID', 'Account name', 'Chart account ID', 'Chart account path', 'Transaction ID', 'Counterparty transaction ID', 'Split ID', 'Transfer ID', 'Source batch ID', 'Payee', 'Description', 'Memo', 'Opening amount minor', 'Opening amount', 'Ending amount minor', 'Ending amount', 'Raw change minor', 'Raw change', 'Formula', 'Child row ID', 'Report ID', 'Database revision',
  ]];
  report.rows.forEach(row => {
    const contributions = row.detailKey ? (report.detailIndex[row.detailKey] ?? []) : [];
    if (!contributions.length) {
      // Structural rows have no financial detail and are omitted.  A
      // displayed amount-bearing zero row gets explicit row context, which is
      // deliberately typed separately from a source contribution.
      if (row.amountMinor === 0n) {
        const context = new Array<WorkbookCell>(31).fill('');
        context[0] = 'ROW_CONTEXT';
        context[1] = workbookText(row.rowId);
        context[2] = workbookText(row.detailKey ?? '');
        context[8] = workbookText(row.accountRole ?? '');
        context[9] = workbookText(row.accountId ?? '');
        context[27] = 'Zero-valued row context';
        context[29] = workbookText(report.reportId);
        context[30] = workbookText(report.databaseRevision);
        detailRows.push(context);
      }
      return;
    }
    contributions.forEach(contribution => detailRows.push(detailRow(row, contribution, report)));
  });
  const detail = XLSX.utils.aoa_to_sheet(detailRows);
  for (let row = 1; row < detailRows.length; row += 1) {
    for (const column of [6, 22, 24, 26]) {
      const cell = detail[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') cell.z = '$#,##0.00;[Red]-$#,##0.00';
    }
  }
  XLSX.utils.book_append_sheet(workbook, detail, 'Cash Flow Detail');

  const classifications = report.classifications.slice().sort(cashFlowClassificationOrder);
  const classificationRows: WorkbookCell[][] = [[
    'Account role', 'Account ID', 'Account path', 'Account type', 'Detail type', 'Cash role', 'Treatment', 'Status', 'Source', 'Rationale', 'Archived', 'Modified at UTC', 'Database revision',
  ], ...classifications.map(classification => [
    workbookText(classification.accountRole), workbookText(classification.accountId), workbookText(classification.accountPath), workbookText(classification.accountType), workbookText(classification.detailType), workbookText(classification.cashRole ?? ''), workbookText(classification.treatment), workbookText(classification.status), workbookText(classification.source), workbookText(classification.rationale), classification.archived ? 'Yes' : 'No', workbookText(classification.modifiedAtUtc ?? ''), workbookText(report.databaseRevision),
  ])];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(classificationRows), 'Cash Flow Classifications');

  const bytes = serializeCashFlowXlsxStyles(new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer), report, rowHeaderIndex);
  verifyCashFlowXlsx(bytes, report);
  return bytes;
}

/** SheetJS' community writer accepts style objects in memory but does not
 * serialize font/alignment records. Patch the generated OOXML package with
 * the required style records so reopening the workbook preserves hierarchy. */
function serializeCashFlowXlsxStyles(bytes: Uint8Array, report: CashFlowReport, rowHeaderIndex: number): Uint8Array {
  const cfb = XLSX.CFB.read(bytes, { type: 'array' }) as any;
  const stylesEntry = cfb.FileIndex.find((entry: any) => entry.name === 'styles.xml');
  const statementEntry = cfb.FileIndex.find((entry: any) => entry.name === 'sheet1.xml');
  if (!stylesEntry || !statementEntry) throw new Error('Cash Flow workbook style package is incomplete.');
  let styles = decodeZipText(stylesEntry.content);
  let sheet = decodeZipText(statementEntry.content);
  const maxDepth = report.rows.reduce((maximum, row) => Math.max(maximum, row.depth), 0);
  const styleIds = appendCashFlowStyleRecords(styles, maxDepth);
  styles = styleIds.xml;
  report.rows.forEach((row, index) => {
    const excelRow = rowHeaderIndex + 2 + index;
    sheet = setCellStyle(sheet, `E${excelRow}`, row.bold ? styleIds.labelBold[row.depth] : styleIds.label[row.depth]);
    if (row.amountMinor !== undefined) {
      sheet = setCellStyle(sheet, `I${excelRow}`, row.bold ? styleIds.amountBold : styleIds.amount);
    }
  });
  // Reconciliation amount cells live in column C; disclosure amounts in E.
  const statementRows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { type: 'array' }).Sheets['Statement of Cash Flows'], { header: 1, defval: '', raw: true });
  const reconciliationHeader = statementRows.findIndex(row => row[0] === 'Metric');
  if (reconciliationHeader >= 0) for (let i = 1; i <= 11; i += 1) sheet = setCellStyle(sheet, `C${reconciliationHeader + i + 1}`, styleIds.amount);
  const disclosureHeader = statementRows.findIndex(row => row[0] === 'Disclosure ID');
  if (disclosureHeader >= 0) for (let i = 1; i <= (report.disclosures ?? []).length; i += 1) sheet = setCellStyle(sheet, `E${disclosureHeader + i + 1}`, styleIds.amount);
  stylesEntry.content = encodeZipText(styles);
  statementEntry.content = encodeZipText(sheet);
  const output = XLSX.CFB.write(cfb, { type: 'array', compression: true, fileType: 'zip' });
  return new Uint8Array(output);
}

function appendCashFlowStyleRecords(xml: string, maxDepth: number): { xml: string; amount: number; amountBold: number; label: number[]; labelBold: number[] } {
  const numFmt = '<numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00;[Red]&quot;-&quot;$&quot;#,##0.00"/>';
  xml = xml.replace(/<numFmts count="(\d+)">/, (_m, count) => `<numFmts count="${Number(count) + 1}">`).replace('</numFmts>', `${numFmt}</numFmts>`);
  const fontsMatch = xml.match(/<fonts count="(\d+)">([\s\S]*?)<\/fonts>/);
  const xfsMatch = xml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!fontsMatch || !xfsMatch) throw new Error('Cash Flow workbook style records are incomplete.');
  const fontCount = Number(fontsMatch[1]);
  const boldFont = '<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>';
  xml = xml.replace(fontsMatch[0], `<fonts count="${fontCount + 1}">${fontsMatch[2]}${boldFont}</fonts>`);
  const baseXfCount = Number(xfsMatch[1]);
  const records: string[] = [];
  const add = (fontId: number, numFmtId: number, indent?: number, bold = false) => {
    const alignment = indent === undefined ? '' : `<alignment indent="${indent}"/>`;
    const attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="${bold ? '1' : '0'}"${alignment ? ' applyAlignment="1"' : ''}`;
    records.push(`<xf ${attrs}>${alignment}</xf>`);
    return baseXfCount + records.length - 1;
  };
  const label = Array.from({ length: maxDepth + 1 }, (_value, depth) => add(0, 0, depth, false));
  const labelBold = Array.from({ length: maxDepth + 1 }, (_value, depth) => add(fontCount, 0, depth, true));
  const amount = add(0, 165);
  const amountBold = add(fontCount, 165, undefined, true);
  xml = xml.replace(xfsMatch[0], `<cellXfs count="${baseXfCount + records.length}">${xfsMatch[2]}${records.join('')}</cellXfs>`);
  return { xml, amount, amountBold, label, labelBold };
}

function setCellStyle(sheetXml: string, reference: string, styleId: number): string {
  const pattern = new RegExp(`(<c\\s+[^>]*\\br="${reference}"[^>]*)(>)`);
  return sheetXml.replace(pattern, (_m, attrs, close) => /\bs="\d+"/.test(attrs)
    ? `${attrs.replace(/\bs="\d+"/, `s="${styleId}"`)}${close}`
    : `${attrs} s="${styleId}"${close}`);
}

function decodeZipText(content: Uint8Array): string {
  return new TextDecoder().decode(content);
}

function encodeZipText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function detailRow(row: CashFlowRow, contribution: CashFlowContribution, report: CashFlowReport): WorkbookCell[] {
  const values = new Array<WorkbookCell>(31).fill('');
  values[0] = 'CONTRIBUTION';
  values[1] = workbookText(row.rowId);
  values[2] = workbookText(contribution.detailKey);
  values[3] = workbookText(contribution.contributionId);
  values[4] = workbookText(contribution.contributionType);
  values[5] = contribution.contributionMinor.toString();
  values[6] = cashFlowXlsxDecimalNumber(contribution.contributionMinor);
  values[7] = workbookText(contribution.businessDate ?? '');
  values[8] = workbookText(contribution.accountRole ?? row.accountRole ?? '');
  values[9] = workbookText(contribution.accountId ?? row.accountId ?? '');
  values[10] = workbookText(contribution.accountName ?? '');
  values[11] = workbookText(contribution.chartAccountId ?? '');
  values[12] = workbookText(contribution.chartAccountPath ?? '');
  values[13] = workbookText(contribution.transactionId ?? '');
  values[14] = workbookText(contribution.counterpartyTransactionId ?? '');
  values[15] = workbookText(contribution.splitId ?? '');
  values[16] = workbookText(contribution.transferId ?? '');
  values[17] = workbookText(contribution.sourceBatchId ?? '');
  values[18] = workbookText(contribution.payee ?? '');
  values[19] = workbookText(contribution.description ?? '');
  values[20] = workbookText(contribution.memo ?? '');
  values[21] = contribution.openingAmountMinor === undefined ? '' : contribution.openingAmountMinor.toString();
  values[22] = contribution.openingAmountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.openingAmountMinor);
  values[23] = contribution.endingAmountMinor === undefined ? '' : contribution.endingAmountMinor.toString();
  values[24] = contribution.endingAmountMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.endingAmountMinor);
  values[25] = contribution.rawChangeMinor === undefined ? '' : contribution.rawChangeMinor.toString();
  values[26] = contribution.rawChangeMinor === undefined ? '' : cashFlowXlsxDecimalNumber(contribution.rawChangeMinor);
  values[27] = workbookText(contribution.formula ?? '');
  values[28] = workbookText(contribution.childRowId ?? '');
  values[29] = workbookText(report.reportId);
  values[30] = workbookText(report.databaseRevision);
  return values;
}

function workbookText(value: string): string {
  // Prevent Excel formula interpretation while preserving exact integer text
  // in dedicated minor-unit columns (which are not passed through here).
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Keep the workbook's classification sheet byte-stable even when a caller
 * supplies an equivalent report snapshot with classifications in a different
 * insertion order.  The comparison deliberately avoids locale-sensitive
 * collation and uses role/ID tie-breakers after normalized paths. */
function cashFlowClassificationOrder(
  left: CashFlowReport['classifications'][number],
  right: CashFlowReport['classifications'][number],
): number {
  const leftPath = normalizeWorkbookPath(left.accountPath);
  const rightPath = normalizeWorkbookPath(right.accountPath);
  return stableWorkbookCompare(leftPath, rightPath)
    || stableWorkbookCompare(left.accountRole, right.accountRole)
    || stableWorkbookCompare(left.accountId, right.accountId);
}

function normalizeWorkbookPath(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function stableWorkbookCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function verifyCashFlowXlsx(bytes: Uint8Array, report: CashFlowReport): void {
  const reopened = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const expectedSheets = ['Statement of Cash Flows', 'Cash Flow Detail', 'Cash Flow Classifications'];
  if (JSON.stringify(reopened.SheetNames) !== JSON.stringify(expectedSheets)) throw new Error('Cash Flow workbook verification failed: required sheets are missing or reordered.');
  const statement = reopened.Sheets['Statement of Cash Flows'];
  const statementRows = XLSX.utils.sheet_to_json<unknown[]>(statement, { header: 1, defval: '', raw: true });
  const metadata = new Map(statementRows.slice(0, 14).map(row => [String(row[0] ?? ''), String(row[1] ?? '')]));
  if (metadata.get('Report ID') !== workbookText(report.reportId) || metadata.get('Database revision') !== workbookText(report.databaseRevision) || metadata.get('Disclaimer') !== workbookText(cashFlowReportDisclaimer(report.query))) throw new Error('Cash Flow workbook verification failed: report metadata drifted.');
  const header = statementRows.findIndex(row => String(row[0] ?? '') === 'Row ID');
  if (header < 0) throw new Error('Cash Flow workbook verification failed: statement rows are missing.');
  const statementData = statementRows.slice(header + 1, header + 1 + report.rows.length);
  if (statementData.length !== report.rows.length) throw new Error('Cash Flow workbook verification failed: statement row count drifted.');
  report.rows.forEach((row, index) => {
    const exported = statementData[index];
    const expected = [
      row.rowId, row.rowType, row.section, row.treatment ?? '', row.label, row.fullPath ?? '', String(row.depth),
      row.amountMinor === undefined ? '' : row.amountMinor.toString(), undefined,
      row.accountRole ?? '', row.accountId ?? '', row.cashRole ?? '', row.archived ? 'Yes' : 'No', row.reviewRequired ? 'Yes' : 'No',
      row.detailKey ?? '', row.parentRowId ?? '', row.bold ? 'Yes' : 'No', row.derived ? 'Yes' : 'No',
    ];
    expected.forEach((value, column) => {
      if (column === 8) return;
      const expectedText = column === 7 ? String(value) : workbookText(String(value));
      if (String(exported[column] ?? '') !== expectedText) throw new Error(`Cash Flow workbook verification failed: row ${row.rowId} column ${column} drifted.`);
    });
    if (row.amountMinor !== undefined) {
      if (typeof exported[8] !== 'number') throw new Error(`Cash Flow workbook verification failed: row ${row.rowId} amount is not numeric.`);
      if (exported[8] !== cashFlowXlsxDecimalNumber(row.amountMinor)) throw new Error(`Cash Flow workbook verification failed: row ${row.rowId} amount lost precision.`);
    }
  });
  const warningHeader = statementRows.findIndex(row => row[0] === 'Warning ID');
  if (warningHeader < 0) throw new Error('Cash Flow workbook verification failed: warning columns are missing.');
  const warningRows = statementRows.slice(warningHeader + 1, warningHeader + 1 + report.warnings.length);
  if (warningRows.length !== report.warnings.length) throw new Error('Cash Flow workbook verification failed: warning count drifted.');
  report.warnings.forEach((warning, index) => {
    const exported = warningRows[index];
    const expected = [warning.warningId, warning.code, warning.message, warning.accountRole ?? '', warning.accountId ?? '', warning.businessDate ?? '', warning.detailKey ?? '', (warning.references ?? []).slice().sort().join(';')];
    expected.forEach((value, column) => {
      if (String(exported[column] ?? '') !== workbookText(String(value))) throw new Error(`Cash Flow workbook verification failed: warning ${warning.warningId} drifted.`);
    });
  });
  const reconciliationHeader = statementRows.findIndex(row => row[0] === 'Metric');
  if (reconciliationHeader < 0) throw new Error('Cash Flow workbook verification failed: reconciliation metrics are missing.');
  const reconciliation = new Map(statementRows.slice(reconciliationHeader + 1, reconciliationHeader + 1 + 11).map(row => [String(row[0] ?? ''), String(row[1] ?? '')]));
  const expectedReconciliation: Readonly<Record<string, bigint>> = {
    'Net Operating': report.netOperatingMinor, 'Net Investing': report.netInvestingMinor, 'Net Financing': report.netFinancingMinor,
    'Net Change in Cash': report.netChangeInCashMinor, 'Beginning Cash': report.beginningCashMinor, 'Calculated Ending Cash': report.calculatedEndingCashMinor,
    'Ending Cash': report.endingCashMinor, 'Restricted Cash Beginning': report.restrictedCashBeginningMinor, 'Restricted Cash Ending': report.restrictedCashEndingMinor,
    'Unclassified Cash Activity': report.unclassifiedCashActivityMinor, Difference: report.differenceMinor,
  };
  Object.entries(expectedReconciliation).forEach(([metric, amount]) => {
    if (reconciliation.get(metric) !== amount.toString()) throw new Error(`Cash Flow workbook verification failed: reconciliation metric ${metric} drifted.`);
    const row = statementRows.find(candidate => String(candidate[0] ?? '') === metric);
    if (!row || typeof row[2] !== 'number' || row[2] !== cashFlowXlsxDecimalNumber(amount)) throw new Error(`Cash Flow workbook verification failed: reconciliation metric ${metric} lost precision.`);
  });
  const disclosureHeader = statementRows.findIndex(row => row[0] === 'Disclosure ID');
  if (disclosureHeader < 0) throw new Error('Cash Flow workbook verification failed: disclosure columns are missing.');
  const disclosureRows = statementRows.slice(disclosureHeader + 1, disclosureHeader + 1 + (report.disclosures ?? []).length);
  if (disclosureRows.length !== (report.disclosures ?? []).length) throw new Error('Cash Flow workbook verification failed: disclosure rows drifted.');
  (report.disclosures ?? []).forEach((disclosure, index) => {
    if (disclosure.amountMinor !== undefined && (typeof disclosureRows[index][4] !== 'number' || disclosureRows[index][4] !== cashFlowXlsxDecimalNumber(disclosure.amountMinor))) {
      throw new Error(`Cash Flow workbook verification failed: disclosure ${disclosure.disclosureId} lost precision.`);
    }
  });
  const detailSheet = reopened.Sheets['Cash Flow Detail'];
  const detailMatrix = XLSX.utils.sheet_to_json<unknown[]>(detailSheet, { header: 1, defval: '', raw: true });
  const detailHeader = (detailMatrix[0] ?? []).map(value => String(value));
  const detailRows = detailMatrix.slice(1);
  const recordTypeIndex = detailHeader.indexOf('Record type');
  const minorIndex = detailHeader.indexOf('Contribution minor');
  const reportIndex = detailHeader.indexOf('Report ID');
  const revisionIndex = detailHeader.indexOf('Database revision');
  if (recordTypeIndex < 0 || minorIndex < 0 || reportIndex < 0 || revisionIndex < 0) throw new Error('Cash Flow workbook verification failed: detail columns are missing.');
  const sums = new Map<string, bigint>();
  const expectedContributionIds = new Map<string, number>();
  report.rows.forEach(row => {
    if (!row.detailKey) return;
    (report.detailIndex[row.detailKey] ?? []).forEach(contribution => {
      const key = `${contribution.detailKey}:${contribution.contributionId}`;
      expectedContributionIds.set(key, (expectedContributionIds.get(key) ?? 0) + 1);
    });
  });
  const exportedContributionIds = new Map<string, number>();
  detailRows.forEach(row => {
    const recordType = String(row[recordTypeIndex] ?? '');
    const rowId = String(row[1] ?? '');
    if (recordType === 'CONTRIBUTION') {
      const contributionId = String(row[3] ?? '');
      const contributionKey = `${String(row[2] ?? '')}:${contributionId}`;
      const exportedCount = exportedContributionIds.get(contributionKey) ?? 0;
      const expectedCount = expectedContributionIds.get(contributionKey) ?? 0;
      if (!contributionId || exportedCount >= expectedCount) throw new Error(`Cash Flow workbook verification failed: contribution provenance is missing or duplicated (${contributionKey || 'blank'}).`);
      exportedContributionIds.set(contributionKey, exportedCount + 1);
      const minor = String(row[minorIndex] ?? '');
      if (!minor) throw new Error('Cash Flow workbook verification failed: contribution amount is missing.');
      if (row[6] !== cashFlowXlsxDecimalNumber(BigInt(minor))) throw new Error('Cash Flow workbook verification failed: contribution amount lost precision.');
      if (rowId) sums.set(rowId, (sums.get(rowId) ?? 0n) + BigInt(minor));
    } else if (recordType !== 'ROW_CONTEXT') {
      throw new Error('Cash Flow workbook verification failed: unknown detail record type.');
    }
    if (String(row[reportIndex] ?? '') !== workbookText(report.reportId) || String(row[revisionIndex] ?? '') !== workbookText(report.databaseRevision)) throw new Error('Cash Flow workbook verification failed: detail identity drifted.');
  });
  if (expectedContributionIds.size !== exportedContributionIds.size || [...expectedContributionIds].some(([id, count]) => exportedContributionIds.get(id) !== count)) {
    const missing = [...expectedContributionIds].filter(([id, count]) => exportedContributionIds.get(id) !== count).map(([id, count]) => `${id}:${exportedContributionIds.get(id) ?? 0}/${count}`).join(',');
    throw new Error(`Cash Flow workbook verification failed: detail contribution coverage drifted (${missing}).`);
  }
  report.rows.forEach(row => { if (row.amountMinor !== undefined && (sums.get(row.rowId) ?? 0n) !== row.amountMinor) throw new Error(`Cash Flow workbook verification failed: detail does not reconcile for ${row.rowId}.`); });
  const classificationRows = XLSX.utils.sheet_to_json<unknown[]>(reopened.Sheets['Cash Flow Classifications'], { header: 1, defval: '', raw: true }).slice(1);
  const classifications = report.classifications.slice().sort(cashFlowClassificationOrder);
  if (classificationRows.length !== classifications.length) throw new Error('Cash Flow workbook verification failed: classification snapshot count drifted.');
  classifications.forEach((classification, index) => {
    const exported = classificationRows[index];
    const expected = [classification.accountRole, classification.accountId, classification.accountPath, classification.accountType, classification.detailType,
      classification.cashRole ?? '', classification.treatment, classification.status, classification.source, classification.rationale, classification.archived ? 'Yes' : 'No', classification.modifiedAtUtc ?? '', report.databaseRevision];
    expected.forEach((value, column) => { if (String(exported[column] ?? '') !== workbookText(String(value))) throw new Error(`Cash Flow workbook verification failed: classification ${classification.accountRole}/${classification.accountId} drifted.`); });
  });
  verifyCashFlowXlsxStyles(bytes, report);
}

function verifyCashFlowXlsxStyles(bytes: Uint8Array, report: CashFlowReport): void {
  const cfb = XLSX.CFB.read(bytes, { type: 'array' }) as any;
  const stylesEntry = cfb.FileIndex.find((entry: any) => entry.name === 'styles.xml');
  const statementEntry = cfb.FileIndex.find((entry: any) => entry.name === 'sheet1.xml');
  if (!stylesEntry || !statementEntry) throw new Error('Cash Flow workbook verification failed: serialized style package is missing.');
  const styles = decodeZipText(stylesEntry.content);
  const sheet = decodeZipText(statementEntry.content);
  const fontBlocks = [...styles.matchAll(/<font>([\s\S]*?)<\/font>/g)].map(match => match[1]);
  const xfSection = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  const xfs = [...xfSection.matchAll(/<xf\b[\s\S]*?(?:<\/xf>|\/>)/g)].map(match => match[0]);
  const cellStyle = (reference: string): string => {
    const cell = sheet.match(new RegExp(`<c\\s+[^>]*\\br="${reference}"[^>]*>`))?.[0];
    if (!cell) throw new Error(`Cash Flow workbook verification failed: serialized cell ${reference} is missing.`);
    return cell.match(/\bs="(\d+)"/)?.[1] ?? '';
  };
  const attr = (xml: string, name: string): string | undefined => xml.match(new RegExp(`${name}="([^"]*)"`))?.[1];
  const assertCell = (reference: string, depth: number | undefined, bold: boolean, currency: boolean) => {
    const styleIndex = Number(cellStyle(reference));
    const xf = xfs[styleIndex];
    if (!xf) throw new Error(`Cash Flow workbook verification failed: style ${styleIndex} for ${reference} is missing.`);
    const font = fontBlocks[Number(attr(xf, 'fontId') ?? 0)] ?? '';
    if (font.includes('<b') !== bold) throw new Error(`Cash Flow workbook verification failed: bold style drifted for ${reference}.`);
    if (depth !== undefined && Number(attr(xf.match(/<alignment[^>]*>/)?.[0] ?? '', 'indent') ?? 0) !== depth) throw new Error(`Cash Flow workbook verification failed: indent style drifted for ${reference}.`);
    if (currency && attr(xf, 'numFmtId') !== '165') throw new Error(`Cash Flow workbook verification failed: currency style drifted for ${reference}.`);
  };
  const rowHeader = 15;
  report.rows.forEach((row, index) => {
    const excelRow = rowHeader + 2 + index;
    assertCell(`E${excelRow}`, row.depth, row.bold, false);
    if (row.amountMinor !== undefined) assertCell(`I${excelRow}`, undefined, row.bold, true);
  });
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { type: 'array' }).Sheets['Statement of Cash Flows'], { header: 1, defval: '', raw: true });
  const reconciliationHeader = matrix.findIndex(row => row[0] === 'Metric');
  if (reconciliationHeader >= 0) for (let i = 1; i <= 11; i += 1) assertCell(`C${reconciliationHeader + i + 1}`, undefined, false, true);
  const disclosureHeader = matrix.findIndex(row => row[0] === 'Disclosure ID');
  if (disclosureHeader >= 0) for (let i = 1; i <= (report.disclosures ?? []).length; i += 1) assertCell(`E${disclosureHeader + i + 1}`, undefined, false, true);
}
