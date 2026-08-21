import { Injectable } from '@angular/core';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { ImportSourceInput as SourceInput } from '../application-interface/accounting.application';
import { ImportBatch, ImportPreview, ImportRowDisposition, money, newId } from '../domain-model/accounting.types';

export interface ParsedImport {
  batch: ImportBatch;
  rows: ImportRowDisposition[];
}

interface PreprocessedCsv {
  tableText: string;
  headerRowNumber: number;
}

@Injectable()
export class ImportPipelineService {
  parse(source: SourceInput, destinationName: string): ImportPreview {
    const rows = source.kind === 'CSV' || source.kind === 'AMAZON'
      ? this.parseCsv(source)
      : source.kind === 'EXCEL'
        ? this.parseExcel(source)
        : this.parseQboOfx(source);
    const acceptedRows = rows.filter(row => row.status === 'ACCEPTED');
    const acceptedMinor = acceptedRows.reduce((sum, row) => sum + (row.transaction?.amount.minorUnits ?? 0n), 0n);
    const batch: ImportBatch = {
      id: newId(),
      destinationAccountId: source.destinationAccountId,
      sourceKind: source.kind,
      sourceName: source.fileName,
      sourceHash: this.hash(source.content),
      mappingVersion: 'default-v2',
      acceptedCount: acceptedRows.length,
      rejectedCount: rows.filter(row => row.status === 'REJECTED').length,
      skippedCount: rows.filter(row => row.status === 'SKIPPED').length,
      warningCount: rows.filter(row => row.status === 'WARNING').length,
      totalAcceptedAmount: money(acceptedMinor),
    };
    return { batch, rows, previewToken: newId() };
  }

  private parseCsv(source: SourceInput): ImportRowDisposition[] {
    const text = this.asText(source.content);
    if (!text.trim()) return [{ rowNumber: 1, status: 'REJECTED', code: 'EMPTY_FILE', message: 'The source file is empty.' }];
    const preprocessed = this.preprocessCsv(text);
    if (!preprocessed) {
      return [{ rowNumber: 1, status: 'REJECTED', code: 'MISSING_HEADER', message: 'A date and signed amount (or debit/credit) header are required.' }];
    }
    const parsed = Papa.parse<Record<string, string>>(preprocessed.tableText, { header: true, skipEmptyLines: true });
    const fields = (parsed.meta.fields ?? []).map(field => field.replace(/^\uFEFF/, '').toUpperCase().trim());
    if (!fields.some(field => ['DATE', 'POSTING DATE', 'DTPOSTED'].includes(field)) || !fields.some(field => ['AMOUNT', 'SIGNED AMOUNT', 'TRNAMT', 'DEBIT', 'WITHDRAWAL', 'CREDIT', 'DEPOSIT'].includes(field))) {
      return [{ rowNumber: 1, status: 'REJECTED', code: 'MISSING_HEADER', message: 'A date and signed amount (or debit/credit) header are required.' }];
    }
    const errors = parsed.errors.map(error => ({ rowNumber: preprocessed.headerRowNumber + (error.row ?? 0) + 1, status: 'REJECTED' as const, code: 'CSV_PARSE_ERROR', message: error.message }));
    const rows = parsed.data.map((row, index) => this.normalizeRow(row, preprocessed.headerRowNumber + index + 1, source));
    return [...errors, ...rows];
  }

  private preprocessCsv(text: string): PreprocessedCsv | undefined {
    const parsedRows = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false }).data;
    const headerIndex = parsedRows.findIndex(row => this.isTransactionHeaderRow(row));
    if (headerIndex < 0) return undefined;
    return {
      tableText: Papa.unparse(parsedRows.slice(headerIndex)),
      headerRowNumber: headerIndex + 1,
    };
  }

  private isTransactionHeaderRow(row: string[]): boolean {
    const fields = row.map(field => String(field ?? '').replace(/^\uFEFF/, '').toUpperCase().trim());
    const hasDate = fields.some(field => ['DATE', 'POSTING DATE', 'DTPOSTED'].includes(field));
    const hasAmount = fields.some(field => ['AMOUNT', 'SIGNED AMOUNT', 'TRNAMT', 'DEBIT', 'WITHDRAWAL', 'CREDIT', 'DEPOSIT'].includes(field));
    return hasDate && hasAmount;
  }

  private parseExcel(source: SourceInput): ImportRowDisposition[] {
    const workbook = XLSX.read(typeof source.content === 'string' ? source.content : new Uint8Array(source.content), { type: typeof source.content === 'string' ? 'string' : 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return [{ rowNumber: 1, status: 'REJECTED', code: 'EMPTY_FILE', message: 'The workbook has no usable sheets.' }];
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(firstSheet, { defval: '' });
    if (!rows.length) return [{ rowNumber: 1, status: 'REJECTED', code: 'EMPTY_FILE', message: 'The workbook has no transaction rows.' }];
    return rows.map((row, index) => this.normalizeRow(row as Record<string, string>, index + 2, source));
  }

  private parseQboOfx(source: SourceInput): ImportRowDisposition[] {
    const text = this.asText(source.content);
    const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)].map(match => match[1]);
    if (!blocks.length) {
      return [{ rowNumber: 1, status: 'REJECTED', code: 'QBO_NO_TRANSACTIONS', message: 'No transaction blocks were found.' }];
    }
    return blocks.map((block, index) => {
      const row: Record<string, string> = {
        DATE: this.tag(block, 'DTPOSTED'),
        AMOUNT: this.tag(block, 'TRNAMT'),
        DESCRIPTION: this.tag(block, 'NAME') || this.tag(block, 'MEMO'),
        REFERENCE: this.tag(block, 'FITID'),
      };
      return this.normalizeRow(row, index + 1, source);
    });
  }

  private normalizeRow(row: Record<string, string | number>, rowNumber: number, source: SourceInput): ImportRowDisposition {
    const normalized = new Map(Object.entries(row).map(([key, value]) => [key.replace(/^\uFEFF/, '').toUpperCase().trim(), String(value).trim()]));
    const dateText = normalized.get('DATE') || normalized.get('POSTING DATE') || normalized.get('DTPOSTED') || '';
    const amountText = normalized.get('AMOUNT') || normalized.get('SIGNED AMOUNT') || normalized.get('TRNAMT') || '';
    const debit = normalized.get('DEBIT') || normalized.get('WITHDRAWAL') || '';
    const credit = normalized.get('CREDIT') || normalized.get('DEPOSIT') || '';
    if (!amountText && !debit && !credit) return { rowNumber, status: 'REJECTED', code: 'MISSING_AMOUNT', message: 'A signed amount or debit/credit value is required.' };
    if (!amountText && debit && credit) return { rowNumber, status: 'REJECTED', code: 'AMBIGUOUS_SIGN', message: 'Debit and credit cannot both be populated.' };
    const amount = amountText ? Number(amountText.replace(/[$,]/g, '')) : (credit ? Number(credit) : -Number(debit));
    const date = this.normalizeDate(dateText);
    const description = normalized.get('DESCRIPTION') || normalized.get('NAME') || normalized.get('MEMO') || '';
    if (!date) return { rowNumber, status: 'REJECTED', code: 'INVALID_DATE', message: `Invalid posting date: ${dateText}` };
    if (!Number.isFinite(amount)) return { rowNumber, status: 'REJECTED', code: 'INVALID_AMOUNT', message: `Invalid amount: ${amountText}` };
    if (!description && source.kind !== 'AMAZON') return { rowNumber, status: 'REJECTED', code: 'MISSING_DESCRIPTION', message: 'Description is required.' };
    const minorUnits = BigInt(Math.round(amount * 100));
    if (minorUnits === 0n) return { rowNumber, status: 'REJECTED', code: 'ZERO_AMOUNT', message: 'Transactions with a zero normalized amount cannot be imported.' };
    return {
      rowNumber,
      status: 'ACCEPTED',
      transaction: {
        accountId: source.destinationAccountId,
        postingDate: date,
        amount: money(minorUnits),
        rawDescription: description,
        description,
        rawPayee: normalized.get('PAYEE') || normalized.get('NAME'),
        payee: normalized.get('PAYEE') || normalized.get('NAME'),
        memo: normalized.get('MEMO'),
        reference: normalized.get('REFERENCE') || normalized.get('FITID'),
        sourceBatchId: undefined,
        sourceRowNumber: rowNumber,
        categorizationSource: 'NONE',
      },
    };
  }

  private normalizeDate(value: string): string | undefined {
    const trimmed = value.replace(/\D00:00:00.*/, '').trim();
    if (!trimmed) return undefined;
    const excelSerial = Number(trimmed);
    if (Number.isInteger(excelSerial) && excelSerial > 20_000 && excelSerial < 100_000) {
      const serialDate = new Date(Date.UTC(1899, 11, 30) + excelSerial * 86_400_000);
      return serialDate.toISOString().slice(0, 10);
    }
    // QBO/OFX/QFX dates may append a midnight time and a bracketed time zone,
    // for example `2026013000000000[-7MST]`. The first eight digits are the
    // calendar date; the trailing time-zone information does not alter it.
    const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:\d{0,8}(?:\.\d+)?(?:\[[^\]]+\])?)?$/);
    if (compact) {
      const [year, month, day] = compact.slice(1).map(Number);
      const calendarDate = new Date(Date.UTC(year, month - 1, day));
      if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return undefined;
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
    const date = new Date(trimmed);
    if (Number.isNaN(date.valueOf())) return undefined;
    return date.toISOString().slice(0, 10);
  }

  private tag(text: string, tag: string): string {
    return text.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<]+)`, 'i'))?.[1]?.trim() ?? '';
  }

  private asText(content: string | ArrayBuffer): string {
    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  }

  private hash(content: string | ArrayBuffer): string {
    const text = this.asText(content);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
  }
}
