import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication, ExceptionItem, ProfitLossReport, ReconciliationReport, ReportDetailRow, ReportDrilldownQuery, ScheduleCReadyReport } from '../../core/application-interface/accounting.application';

@Injectable({ providedIn: 'root' })
export class ReportFacade {
  readonly profitLoss = signal<ProfitLossReport | undefined>(undefined);
  readonly report = signal<ScheduleCReadyReport | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly detail = signal<ReportDetailRow[]>([]);
  readonly exceptions = signal<ExceptionItem[]>([]);
  readonly reconciliation = signal<ReconciliationReport | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  loadProfitLoss(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds: string[] = []): void {
    this.run(() => this.profitLoss.set(this.application.getProfitLoss(startDate, endDate, grouping, excludedChartAccountIds)));
  }

  loadScheduleCReady(startDate: string, endDate: string, grouping: 'MONTH' | 'YEAR', excludedChartAccountIds: string[] = []): void {
    try {
      this.error.set(undefined);
      this.report.set(this.application.getScheduleCReadyReport(startDate, endDate, grouping, excludedChartAccountIds));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to calculate report.');
    }
  }

  loadDetail(startDate: string, endDate: string, chartAccountId?: string, excludedChartAccountIds: string[] = []): void { this.run(() => this.detail.set(this.application.getReportDetail(startDate, endDate, chartAccountId, excludedChartAccountIds))); }
  loadDrilldown(query: ReportDrilldownQuery): void { this.run(() => this.detail.set(this.application.getProfitLossDrilldown(query))); }
  loadExceptions(startDate: string, endDate: string): void { this.run(() => this.exceptions.set(this.application.getExceptions(startDate, endDate))); }
  loadReconciliation(accountId: string, startDate: string, endDate: string, endingBalance?: bigint): void { this.run(() => this.reconciliation.set(this.application.getReconciliation(accountId, startDate, endDate, endingBalance))); }

  private run(work: () => void): void {
    try { this.error.set(undefined); work(); } catch (error) { this.error.set(error instanceof Error ? error.message : 'Unable to calculate report.'); }
  }
}
