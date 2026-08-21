import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import { ACCOUNT_TYPE_GROUPS } from '../../core/domain-model/account-taxonomy';
import {
  BalanceSheetReport,
  CompanyProfile,
  accountBalanceSheetRowId,
  balanceSheetDetailKey,
  balanceSheetReportId,
  databaseRevision,
} from '../../core/domain-model/balance-sheet.types';
import { BalanceSheetFacade } from './balance-sheet.facade';

describe('BalanceSheetFacade', () => {
  let facade: BalanceSheetFacade;
  let application: jasmine.SpyObj<AccountingApplication>;
  let report: BalanceSheetReport;

  beforeEach(() => {
    application = jasmine.createSpyObj<AccountingApplication>('AccountingApplication', [
      'getCompanyProfile',
      'updateCompanyProfile',
      'revealCompanyTaxIdentifier',
      'getAccountTypeCatalog',
      'previewAccountPlacement',
      'getBalanceSheet',
      'getBalanceSheetDetail',
      'exportBalanceSheet',
      'openBalanceSheetPrintPreview',
    ]);
    report = reportFixture();
    application.getCompanyProfile.and.returnValue(companyFixture());
    application.getAccountTypeCatalog.and.returnValue(ACCOUNT_TYPE_GROUPS);
    application.previewAccountPlacement.and.returnValue({
      reportingGroup: 'ASSET',
      section: 'ASSETS',
      fullPath: 'Assets > Bank > New account',
      asOfDate: '2026-12-31',
      currentBalanceMinor: 0n,
      behavior: 'BALANCE_SHEET_LINE',
      warnings: [],
    });
    application.getBalanceSheet.and.returnValue(report);
    application.getBalanceSheetDetail.and.returnValue({
      reportId: report.reportId,
      databaseRevision: report.databaseRevision,
      rowId: report.rows[0].rowId,
      detailKey: report.rows[0].detailKey!,
      amountMinor: 0n,
      contributions: [],
    });
    application.exportBalanceSheet.and.resolveTo({ format: 'CSV', status: 'SAVED', suggestedFileName: 'balance-sheet.csv' });
    application.openBalanceSheetPrintPreview.and.resolveTo({ status: 'OPENED', previewId: 'preview-1' });
    TestBed.configureTestingModule({ providers: [BalanceSheetFacade, { provide: ACCOUNTING_APPLICATION, useValue: application }] });
    facade = TestBed.inject(BalanceSheetFacade);
  });

  it('exposes company, catalog, placement, report, and detail through the application boundary', () => {
    const placementCommand = { accountType: 'BANK' as const, asOfDate: '2026-12-31' };
    const detailCommand = { reportId: report.reportId, databaseRevision: report.databaseRevision, detailKey: report.rows[0].detailKey! };

    facade.loadCompanyProfile();
    facade.loadAccountTypeCatalog();
    facade.previewPlacement(placementCommand);
    facade.loadReport(report.query);
    facade.loadDetail(detailCommand);

    expect(application.previewAccountPlacement).toHaveBeenCalledWith(placementCommand);
    expect(application.getBalanceSheet).toHaveBeenCalledWith(report.query);
    expect(application.getBalanceSheetDetail).toHaveBeenCalledWith(detailCommand);
    expect(facade.company()?.displayName).toBe('Northstar Workshop');
    expect(facade.accountTypeCatalog().length).toBe(5);
    expect(facade.placementPreview()?.behavior).toBe('BALANCE_SHEET_LINE');
    expect(facade.report()?.reportId).toBe(report.reportId);
    expect(facade.detail()?.detailKey).toBe(detailCommand.detailKey);
    expect(facade.error()).toBeUndefined();
  });

  it('returns revealed tax data only to the explicit caller and does not store it in facade state', () => {
    application.revealCompanyTaxIdentifier.and.returnValue({ companyId: 'company-1', taxIdentifier: '12-3456789' });
    facade.loadCompanyProfile();

    expect(facade.revealCompanyTaxIdentifier()?.taxIdentifier).toBe('12-3456789');
    expect(facade.company()?.maskedTaxIdentifier).toBe('**-***6789');
    expect(JSON.stringify({ company: facade.company(), report: facade.report() })).not.toContain('12-3456789');
  });

  it('routes export and print requests without exposing native or filesystem types', async () => {
    const exportCommand = { report, format: 'CSV' as const };
    const printCommand = { report };

    expect((await facade.export(exportCommand))?.status).toBe('SAVED');
    expect((await facade.openPrintPreview(printCommand))?.status).toBe('OPENED');
    expect(application.exportBalanceSheet).toHaveBeenCalledWith(exportCommand);
    expect(application.openBalanceSheetPrintPreview).toHaveBeenCalledWith(printCommand);
    expect(facade.busy()).toBeFalse();
  });

  it('clears a stale report and exposes an actionable boundary error', () => {
    facade.loadReport(report.query);
    expect(facade.report()).toBeDefined();
    application.getBalanceSheet.and.throwError('The report revision is stale.');

    facade.loadReport(report.query);

    expect(facade.report()).toBeUndefined();
    expect(facade.detail()).toBeUndefined();
    expect(facade.error()).toBe('The report revision is stale.');
  });
});

function companyFixture(): CompanyProfile {
  return {
    companyId: 'company-1',
    legalName: 'Northstar Workshop LLC',
    displayName: 'Northstar Workshop',
    maskedTaxIdentifier: '**-***6789',
    currencyCode: 'USD',
    fiscalYearStartMonth: 1,
    accountingBasis: 'CASH',
    activeTaxYear: 2026,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-08-21T20:00:00.000Z',
  };
}

function reportFixture(): BalanceSheetReport {
  const query = { asOfDate: '2026-12-31', includeZeroBalanceAccounts: false };
  const revision = databaseRevision('revision-1');
  const rowId = accountBalanceSheetRowId('FINANCIAL_SOURCE', 'checking-1');
  const detailKey = balanceSheetDetailKey(rowId);
  return {
    reportId: balanceSheetReportId(revision, query),
    databaseRevision: revision,
    generatedAt: '2026-08-21T20:00:00.000Z',
    query,
    company: { companyId: 'company-1', legalName: 'Northstar Workshop LLC', displayName: 'Northstar Workshop', addressLines: [], contactLines: [] },
    currencyCode: 'USD',
    accountingBasis: 'CASH',
    fiscalPeriod: { startDate: '2026-01-01', endDate: '2026-12-31' },
    rows: [{ rowId, rowType: 'ACCOUNT', section: 'ASSETS', label: 'Operating Checking', depth: 2, amountMinor: 0n, detailKey, bold: false, derived: false, archived: false, unclassified: false }],
    totalAssetsMinor: 0n,
    totalLiabilitiesMinor: 0n,
    totalEquityMinor: 0n,
    totalLiabilitiesAndEquityMinor: 0n,
    differenceMinor: 0n,
    warnings: [],
    detailIndex: { [detailKey]: [] },
  };
}
