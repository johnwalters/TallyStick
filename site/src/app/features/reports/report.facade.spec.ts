import { TestBed } from '@angular/core/testing';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import { ReportFacade } from './report.facade';

describe('ReportFacade', () => {
  let facade: ReportFacade;
  let application: jasmine.SpyObj<AccountingApplication>;

  beforeEach(() => {
    application = jasmine.createSpyObj<AccountingApplication>('AccountingApplication', ['getProfitLoss', 'getScheduleCReadyReport', 'getReportDetail', 'getProfitLossDrilldown', 'getExceptions', 'getReconciliation']);
    application.getProfitLoss.and.returnValue({ startDate: '2026-01-01', endDate: '2026-12-31', grouping: 'YEAR', periods: ['2026'], sections: [], netProfitMinor: 0n, reconciliationDifferenceMinor: 0n });
    application.getScheduleCReadyReport.and.returnValue({ startDate: '2026-01-01', endDate: '2026-12-31', grouping: 'YEAR', periods: ['2026'], sections: [], netProfitMinor: 0n, reconciliationDifferenceMinor: 0n, taxYear: 2026, includeFederalIncomeTax: false, includeStateLocalIncomeTax: true, removedFederalMinor: 0n, removedStateLocalMinor: 0n, removedTotalMinor: 0n });
    application.getReportDetail.and.returnValue([]);
    application.getProfitLossDrilldown.and.returnValue([]);
    application.getExceptions.and.returnValue([]);
    TestBed.configureTestingModule({ providers: [ReportFacade, { provide: ACCOUNTING_APPLICATION, useValue: application }] });
    facade = TestBed.inject(ReportFacade);
  });

  it('loads summary and detail through the stable application interface', () => {
    facade.loadProfitLoss('2026-01-01', '2026-12-31', 'YEAR', ['expense-1']);
    facade.loadScheduleCReady('2026-01-01', '2026-12-31', 'YEAR', ['expense-1']);
    facade.loadDetail('2026-01-01', '2026-12-31', 'expense-1', ['expense-2']);

    expect(application.getProfitLoss).toHaveBeenCalledWith('2026-01-01', '2026-12-31', 'YEAR', ['expense-1']);
    expect(application.getScheduleCReadyReport).toHaveBeenCalledWith('2026-01-01', '2026-12-31', 'YEAR', ['expense-1']);
    expect(application.getReportDetail).toHaveBeenCalledWith('2026-01-01', '2026-12-31', 'expense-1', ['expense-2']);
    expect(facade.profitLoss()?.grouping).toBe('YEAR');
    expect(facade.error()).toBeUndefined();
  });

  it('loads selection-aware detail through the stable application interface', () => {
    const query = { startDate: '2026-01-01', endDate: '2026-12-31', grouping: 'MONTH' as const, period: '2026-01', sectionKey: 'NET_PROFIT' as const, search: 'storage' };
    facade.loadDrilldown(query);
    expect(application.getProfitLossDrilldown).toHaveBeenCalledWith(query);
    expect(facade.error()).toBeUndefined();
  });
});
