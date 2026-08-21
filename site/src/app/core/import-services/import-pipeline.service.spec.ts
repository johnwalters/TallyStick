import { ImportPipelineService } from './import-pipeline.service';
import * as XLSX from 'xlsx';
import { BOFA_SUMMARY_PREAMBLE_CSV } from './test-fixtures/bofa-summary-preamble.fixture';

describe('ImportPipelineService', () => {
  const service = new ImportPipelineService();

  it('normalizes CSV rows and preserves row-level outcomes', () => {
    const preview = service.parse({
      fileName: 'checking.csv',
      content: 'Date,Description,Amount\n2026-01-02,Office Depot,-12.50\nnot-a-date,Invalid,5.00',
      kind: 'CSV',
      destinationAccountId: 'bofa',
    }, 'BofA');
    expect(preview.batch.acceptedCount).toBe(1);
    expect(preview.batch.rejectedCount).toBe(1);
    expect(preview.rows[0].transaction?.amount.minorUnits).toBe(-1250n);
    expect(preview.rows[1].code).toBe('INVALID_DATE');
  });

  it('removes a BofA-style CSV summary preamble and preserves original file row numbers', () => {
    const preview = service.parse({
      fileName: 'bofa-summary-preamble.csv',
      content: BOFA_SUMMARY_PREAMBLE_CSV,
      kind: 'CSV',
      destinationAccountId: 'bofa',
    }, 'BofA');

    expect(preview.batch.acceptedCount).toBe(2);
    expect(preview.batch.rejectedCount).toBe(1);
    expect(preview.rows.map(row => row.rowNumber)).toEqual([8, 9, 10]);
    expect(preview.rows[0].code).toBe('MISSING_AMOUNT');
    expect(preview.rows[1].transaction?.description).toBe('Office Supplies');
    expect(preview.rows[1].transaction?.sourceRowNumber).toBe(9);
    expect(preview.rows[2].transaction?.amount.minorUnits).toBe(12500n);
    expect(preview.rows[2].transaction?.sourceRowNumber).toBe(10);
  });

  it('rejects an exact-zero Amazon row while accepting the rest of the batch', () => {
    const preview = service.parse({
      fileName: 'amazon.csv',
      content: 'Date,Description,Amount\n2026-01-02,Commission,0\n2026-01-03,FBAStorageFee,-3.20',
      kind: 'AMAZON',
      destinationAccountId: 'amazon',
    }, 'Amazon');
    expect(preview.batch.rejectedCount).toBe(1);
    expect(preview.batch.skippedCount).toBe(0);
    expect(preview.batch.acceptedCount).toBe(1);
    expect(preview.rows[0].status).toBe('REJECTED');
    expect(preview.rows[0].code).toBe('ZERO_AMOUNT');
    expect(preview.rows[1].transaction?.amount.minorUnits).toBe(-320n);
  });

  it('rejects zero amounts consistently for CSV, Excel, and QBO/OFX sources', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { Date: '2026-02-01', Description: 'Zero Excel row', Amount: 0 },
      { Date: '2026-02-02', Description: 'Valid Excel row', Amount: -4.25 },
    ]), 'Transactions');
    const previews = [
      service.parse({ fileName: 'checking.csv', content: 'Date,Description,Amount\n2026-02-01,Zero CSV row,0\n2026-02-02,Valid CSV row,-1.25', kind: 'CSV', destinationAccountId: 'bofa' }, 'BofA'),
      service.parse({ fileName: 'checking.xlsx', content: XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer, kind: 'EXCEL', destinationAccountId: 'bofa' }, 'BofA'),
      service.parse({ fileName: 'checking.qbo', content: '<STMTTRN><DTPOSTED>20260201</DTPOSTED><TRNAMT>0.00</TRNAMT><NAME>Zero QBO row</NAME><FITID>1</FITID></STMTTRN><STMTTRN><DTPOSTED>20260202</DTPOSTED><TRNAMT>-2.50</TRNAMT><NAME>Valid QBO row</NAME><FITID>2</FITID></STMTTRN>', kind: 'QBO_OFX', destinationAccountId: 'bofa' }, 'BofA'),
    ];
    previews.forEach(preview => {
      expect(preview.batch.acceptedCount).toBe(1);
      expect(preview.batch.rejectedCount).toBe(1);
      expect(preview.batch.skippedCount).toBe(0);
      expect(preview.rows.find(row => row.code === 'ZERO_AMOUNT')?.status).toBe('REJECTED');
    });
  });

  it('applies the shared normalized candidate contract to Excel, QBO, OFX, and QFX', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Date: '2026-02-01', Description: 'Excel fixture', Amount: -4.25 }]), 'Transactions');
    const excel = service.parse({ fileName: 'checking.xlsx', content: XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer, kind: 'EXCEL', destinationAccountId: 'bofa' }, 'BofA');
    const qbo = service.parse({ fileName: 'checking.qbo', content: '<STMTTRN><DTPOSTED>20260202</DTPOSTED><TRNAMT>-5.75</TRNAMT><NAME>QBO fixture</NAME><FITID>1</FITID></STMTTRN>', kind: 'QBO_OFX', destinationAccountId: 'bofa' }, 'BofA');
    const qfx = service.parse({ fileName: 'checking.qfx', content: '<STMTTRN><DTPOSTED>20260203</DTPOSTED><TRNAMT>-6.75</TRNAMT><NAME>QFX fixture</NAME><FITID>2</FITID></STMTTRN>', kind: 'QBO_OFX', destinationAccountId: 'bofa' }, 'BofA');
    const qfxMidnight = service.parse({ fileName: 'midnight.qfx', content: '<STMTTRN><DTPOSTED>2026013000000000[-7MST]</DTPOSTED><TRNAMT>-7.75</TRNAMT><NAME>Midnight QFX fixture</NAME><FITID>3</FITID></STMTTRN>', kind: 'QBO_OFX', destinationAccountId: 'bofa' }, 'BofA');
    expect(excel.batch.acceptedCount).toBe(1);
    expect(excel.rows[0].transaction?.postingDate).toMatch(/^2026-02/);
    expect(excel.rows[0].transaction?.amount.currency).toBe('USD');
    expect(excel.rows[0].transaction?.sourceRowNumber).toBe(2);
    expect(qbo.batch.acceptedCount).toBe(1);
    expect(qbo.rows[0].transaction?.postingDate).toMatch(/^2026-02/);
    expect(qbo.rows[0].transaction?.amount.currency).toBe('USD');
    expect(qbo.rows[0].transaction?.sourceRowNumber).toBe(1);
    expect(qfx.batch.acceptedCount).toBe(1);
    expect(qfx.rows[0].transaction?.description).toBe('QFX fixture');
    expect(qfxMidnight.batch.acceptedCount).toBe(1);
    expect(qfxMidnight.rows[0].transaction?.postingDate).toBe('2026-01-30');
  });

  it('returns visible dispositions for empty and structurally invalid sources', () => {
    const empty = service.parse({ fileName: 'empty.csv', content: '', kind: 'CSV', destinationAccountId: 'bofa' }, 'BofA');
    const missingHeader = service.parse({ fileName: 'unmapped.csv', content: 'Name,Notes\nOffice,Missing amount', kind: 'CSV', destinationAccountId: 'bofa' }, 'BofA');
    expect(empty.rows[0].code).toBe('EMPTY_FILE');
    expect(missingHeader.rows[0].code).toBe('MISSING_HEADER');
    expect(empty.batch.rejectedCount).toBe(1);
    expect(missingHeader.batch.rejectedCount).toBe(1);
  });

  it('uses debit and credit columns with explicit sign semantics', () => {
    const preview = service.parse({ fileName: 'debits.csv', content: 'Posting Date,Description,Debit,Credit\n2026-02-01,Outflow,12.50,\n2026-02-02,Inflow,,8.00', kind: 'CSV', destinationAccountId: 'bofa' }, 'BofA');
    expect(preview.batch.acceptedCount).toBe(2);
    expect(preview.rows[0].transaction?.amount.minorUnits).toBe(-1250n);
    expect(preview.rows[1].transaction?.amount.minorUnits).toBe(800n);
  });
});
