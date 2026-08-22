import { Injectable } from '@angular/core';
import { BalanceSheetExportResult, BalanceSheetPrintPreviewResult, BalanceSheetReport, ExportBalanceSheetCommand } from '../domain-model/balance-sheet.types';
import * as XLSX from 'xlsx';

interface ReportFileBridge { save(suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML'): Promise<'SAVED' | 'CANCELLED'>; }
interface ReportPreviewBridge { open(title: string, html: string): Promise<string>; }

@Injectable({ providedIn: 'root' })
export class BalanceSheetOutputService {
  async export(command: ExportBalanceSheetCommand): Promise<BalanceSheetExportResult> {
    const suggestedFileName = `balance-sheet-${command.report.query.asOfDate}.${command.format.toLowerCase()}`;
    const bytes = command.format === 'CSV' ? new TextEncoder().encode(balanceSheetCsv(command.report)) : balanceSheetXlsx(command.report);
    const bridge = (globalThis as { localAccounting?: { reportFiles?: ReportFileBridge } }).localAccounting?.reportFiles;
    if (!bridge) return { format: command.format, status: 'CANCELLED', suggestedFileName };
    return { format: command.format, status: await bridge.save(suggestedFileName, bytes, command.format), suggestedFileName };
  }

  async openPrintPreview(report: BalanceSheetReport): Promise<BalanceSheetPrintPreviewResult> {
    const bridge = (globalThis as { localAccounting?: { reportPreview?: ReportPreviewBridge } }).localAccounting?.reportPreview;
    if (!bridge) return { status: 'CANCELLED' };
    return { status: 'OPENED', previewId: await bridge.open(`${report.company.displayName} — Balance Sheet`, balanceSheetPrintHtml(report)) };
  }
}

export function balanceSheetXlsx(report: BalanceSheetReport): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const summary: Array<Array<string | number>> = [
    ['Balance Sheet'], ['Company', report.company.displayName], ['Legal name', report.company.legalName], ['As of', report.query.asOfDate], ['Basis', report.accountingBasis], ['Currency', report.currencyCode], [],
    ['Label', 'Row ID', 'Row type', 'Section', 'Account type', 'Account role', 'Account ID', 'Depth', 'Archived', 'Unclassified', 'Derived', 'Amount'],
    ...report.rows.map(row => [row.label, row.rowId, row.rowType, row.section, row.accountType ?? '', row.accountRole ?? '', row.accountId ?? '', row.depth, row.archived ? 'Yes' : 'No', row.unclassified ? 'Yes' : 'No', row.derived ? 'Yes' : 'No', row.amountMinor === undefined ? '' : Number(row.amountMinor) / 100]),
    [], ['Warnings'], ...report.warnings.map(warning => [warning.code, warning.message, warning.accountId ?? '', warning.businessDate ?? '']),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  report.rows.forEach((row, index) => {
    const label = summarySheet[XLSX.utils.encode_cell({ r: index + 8, c: 0 })];
    const amount = summarySheet[XLSX.utils.encode_cell({ r: index + 8, c: 11 })];
    if (label) label.s = { font: { bold: row.bold }, alignment: { indent: row.depth } };
    if (amount?.t === 'n') { amount.z = '$#,##0.00;[Red]-$#,##0.00'; amount.s = { font: { bold: row.bold } }; }
  });
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Balance Sheet');
  const detailRows: Array<Array<string | number>> = [['Row ID', 'Detail key', 'Contribution ID', 'Kind', 'Business date', 'Description', 'Financial account ID', 'Chart account ID', 'Transaction ID', 'Stored amount', 'Contribution amount']];
  report.rows.filter(row => row.detailKey).forEach(row => (report.detailIndex[row.detailKey!] ?? []).forEach(item => detailRows.push([row.rowId, row.detailKey!, item.contributionId, item.kind, item.businessDate, item.description, item.financialAccountId ?? '', item.chartAccountId ?? '', item.transactionId ?? '', item.storedAmountMinor === undefined ? '' : Number(item.storedAmountMinor) / 100, Number(item.contributionMinor) / 100])));
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
  for (let row = 1; row < detailRows.length; row += 1) for (const column of [9, 10]) { const cell = detailSheet[XLSX.utils.encode_cell({ r: row, c: column })]; if (cell?.t === 'n') cell.z = '$#,##0.00;[Red]-$#,##0.00'; }
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Balance Sheet Detail');
  const bytes = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer);
  const reopened = XLSX.read(bytes, { type: 'array' });
  if (!reopened.Sheets['Balance Sheet'] || !reopened.Sheets['Balance Sheet Detail']) throw new Error('Balance Sheet workbook verification failed: required sheets are missing.');
  const firstMoney = reopened.Sheets['Balance Sheet'][XLSX.utils.encode_cell({ r: 8, c: 11 })];
  if (report.rows[0]?.amountMinor !== undefined && firstMoney?.t !== 'n') throw new Error('Balance Sheet workbook verification failed: money cells are not numeric.');
  return bytes;
}

export function balanceSheetPrintHtml(report: BalanceSheetReport): string {
  const rows = report.rows.map(row => `<tr class="${row.bold ? 'bold ' : ''}${row.rowType.toLowerCase()}"><td style="padding-left:${12 + row.depth * 18}px">${html(row.label)}${row.archived ? ' <small>Archived</small>' : ''}${row.unclassified ? ' <small>Unclassified</small>' : ''}</td><td>${row.amountMinor === undefined ? '' : html(moneyText(row.amountMinor))}</td></tr>`).join('');
  const warnings = report.warnings.length ? `<section><h2>Review required</h2>${report.warnings.map(warning => `<p>${html(warning.message)}</p>`).join('')}</section>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${html(report.company.displayName)} — Balance Sheet</title><style>@page{margin:16mm}body{font:14px Arial,sans-serif;color:#182b27}header{border-bottom:1px solid #899891;margin-bottom:18px}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse}thead{display:table-header-group}th,td{padding:7px 10px;border-bottom:1px solid #d8dedb;text-align:left}th:last-child,td:last-child{text-align:right;font-variant-numeric:tabular-nums}.bold{font-weight:700}.group_header{background:#f4f7f4}.subtotal,.total,.difference{break-inside:avoid}.difference{border-top:2px solid #53645d}small{color:#78452f}section{break-inside:avoid;margin-top:20px}</style></head><body><header><h1>${html(report.company.displayName)}</h1><h2>Balance Sheet</h2><p>As of ${html(report.query.asOfDate)} · ${html(report.accountingBasis)} basis · ${html(report.currencyCode)}</p></header>${warnings}<table><thead><tr><th>Account</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function balanceSheetCsv(report: BalanceSheetReport): string {
  const lines: string[][] = [
    ['Report', 'Balance Sheet'], ['Company', report.company.displayName], ['Legal name', report.company.legalName],
    ['As of', report.query.asOfDate], ['Basis', report.accountingBasis], ['Currency', report.currencyCode], ['Report ID', report.reportId], ['Database revision', report.databaseRevision], [],
    ['Row ID', 'Row type', 'Section', 'Account type', 'Account role', 'Account ID', 'Depth', 'Label', 'Full path', 'Archived', 'Unclassified', 'Derived', 'Bold', 'Amount'],
    ...report.rows.map(row => [row.rowId, row.rowType, row.section, row.accountType ?? '', row.accountRole ?? '', row.accountId ?? '', String(row.depth), row.label, row.fullPath ?? '', String(row.archived), String(row.unclassified), String(row.derived), String(row.bold), row.amountMinor === undefined ? '' : decimal(row.amountMinor)]),
    [], ['Warnings'], ['Code', 'Message', 'Account ID', 'Business date'],
    ...report.warnings.map(warning => [warning.code, warning.message, warning.accountId ?? '', warning.businessDate ?? '']),
    [], ['Final totals'], ['Total Assets', decimal(report.totalAssetsMinor)], ['Total Liabilities', decimal(report.totalLiabilitiesMinor)], ['Total Equity', decimal(report.totalEquityMinor)], ['Total Liabilities and Equity', decimal(report.totalLiabilitiesAndEquityMinor)], ['Difference', decimal(report.differenceMinor)],
  ];
  return `\uFEFF${lines.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function decimal(value: bigint): string { const sign = value < 0n ? '-' : ''; const abs = value < 0n ? -value : value; return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`; }
function csvCell(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; }
function moneyText(value: bigint): string { const sign = value < 0n ? '-' : ''; const abs = value < 0n ? -value : value; return `${sign}$${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`; }
function html(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
