import { Injectable } from '@angular/core';
import { cashFlowReportDisclaimer, CashFlowContractError, CashFlowExportFormat, CashFlowExportResult, CashFlowReport } from '../domain-model/cash-flow.types';

interface ReportFileBridge {
  save(suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML', reportTitle?: 'Balance Sheet' | 'Statement of Cash Flows'): Promise<'SAVED' | 'CANCELLED'>;
}

/**
 * Builds Cash Flow output from the already-frozen report value. This service
 * deliberately has no repository dependency: output cannot recalculate,
 * reclassify, or observe a second snapshot.
 */
@Injectable({ providedIn: 'root' })
export class CashFlowOutputService {
  async export(report: CashFlowReport, format: CashFlowExportFormat): Promise<CashFlowExportResult> {
    if (format !== 'CSV') {
      throw new CashFlowContractError({
        code: 'CASH_FLOW_NOT_IMPLEMENTED',
        message: 'XLSX Cash Flow output is implemented by a later output slice.',
        reportId: report.reportId,
        databaseRevision: report.databaseRevision,
        retryable: false,
      });
    }

    const suggestedFileName = cashFlowCsvFileName(report);
    const content = cashFlowCsv(report);
    const bytes = new TextEncoder().encode(content);
    const bridge = (globalThis as { localAccounting?: { reportFiles?: ReportFileBridge } }).localAccounting?.reportFiles;
    if (!bridge) {
      return Object.freeze({
        format: 'CSV' as const,
        status: 'DOWNLOAD_READY' as const,
        rowCount: report.rows.length,
        content,
        suggestedFileName,
      });
    }
    let status: 'SAVED' | 'CANCELLED';
    try {
      status = await bridge.save(suggestedFileName, bytes, 'CSV', 'Statement of Cash Flows');
    } catch (_error) {
      // Host failures can contain private filesystem paths or native details;
      // expose only the stable public contract message to the renderer.
      throw new CashFlowContractError({
        code: 'CASH_FLOW_EXPORT_FAILED',
        message: 'Cash Flow CSV export failed. Choose another location and try again.',
        reportId: report.reportId,
        databaseRevision: report.databaseRevision,
        retryable: true,
      });
    }
    if (status === 'CANCELLED') {
      return Object.freeze({
        format: 'CSV' as const,
        status: 'CANCELLED' as const,
        rowCount: report.rows.length,
      });
    }
    return Object.freeze({
      format: 'CSV' as const,
      path: suggestedFileName,
      suggestedFileName,
      completedAtUtc: new Date().toISOString(),
      rowCount: report.rows.length,
      content,
      status: 'SAVED' as const,
    });
  }
}

/** Stable filename derived only from report identity and neutralized labels. */
export function cashFlowCsvFileName(report: Pick<CashFlowReport, 'company' | 'query'>): string {
  const company = (report.company.displayName || report.company.legalName || 'company')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'company';
  return `${company}-statement-of-cash-flows-${report.query.startDate}-${report.query.endDate}.csv`;
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
