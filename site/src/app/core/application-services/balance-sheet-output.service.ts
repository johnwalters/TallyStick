import { Injectable } from '@angular/core';
import { BalanceSheetExportResult, BalanceSheetReport, ExportBalanceSheetCommand } from '../domain-model/balance-sheet.types';

interface ReportFileBridge { save(suggestedFileName: string, bytes: Uint8Array, fileType: 'CSV' | 'XLSX' | 'HTML'): Promise<'SAVED' | 'CANCELLED'>; }

@Injectable({ providedIn: 'root' })
export class BalanceSheetOutputService {
  async export(command: ExportBalanceSheetCommand): Promise<BalanceSheetExportResult> {
    if (command.format !== 'CSV') throw new Error(`Balance Sheet ${command.format} export is not implemented yet.`);
    const suggestedFileName = `balance-sheet-${command.report.query.asOfDate}.csv`;
    const bytes = new TextEncoder().encode(balanceSheetCsv(command.report));
    const bridge = (globalThis as { localAccounting?: { reportFiles?: ReportFileBridge } }).localAccounting?.reportFiles;
    if (!bridge) return { format: 'CSV', status: 'CANCELLED', suggestedFileName };
    return { format: 'CSV', status: await bridge.save(suggestedFileName, bytes, 'CSV'), suggestedFileName };
  }
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
