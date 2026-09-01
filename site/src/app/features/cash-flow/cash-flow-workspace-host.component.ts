import { AfterViewInit, ChangeDetectorRef, Component, ComponentRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild, ViewContainerRef } from '@angular/core';
import { CashFlowClassificationReview, CashFlowDetail, CashFlowReport, CashFlowRow, CashFlowWarning, CashFlowTransactionCategoryCorrection } from '../../core/domain-model/cash-flow.types';
import type { CashFlowPeriodPreset, CashFlowWorkspaceComponent } from './cash-flow-workspace.component';

export type CashFlowWorkspaceState = readonly [
  CashFlowReport | undefined, CashFlowDetail | undefined, CashFlowRow | undefined,
  string, string, string, string, CashFlowPeriodPreset, boolean, boolean, boolean,
  string, string, string | undefined, CashFlowTransactionCategoryCorrection | undefined, ReadonlySet<string>, string,
  CashFlowClassificationReview | undefined, number, number,
];

@Component({
  selector: 'app-cash-flow-workspace-host',
  standalone: true,
  template: '<ng-template #workspaceHost></ng-template>',
})
export class CashFlowWorkspaceHostComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() state: CashFlowWorkspaceState = [undefined, undefined, undefined, '', '', '', '', 'FISCAL_YEAR', false, false, false, '', '', undefined, undefined, new Set<string>(), '', undefined, 2026, 1];

  @Output() readonly periodRangeChange = new EventEmitter<{ preset: CashFlowPeriodPreset; startDate: string; endDate: string }>();
  @Output() readonly startDateChange = new EventEmitter<string>();
  @Output() readonly endDateChange = new EventEmitter<string>();
  @Output() readonly datesChanged = new EventEmitter<void>();
  @Output() readonly includeZeroRowsChange = new EventEmitter<boolean>();
  @Output() readonly refresh = new EventEmitter<void>();
  @Output() readonly reviewClassifications = new EventEmitter<Event>();
  @Output() readonly export = new EventEmitter<'CSV' | 'XLSX'>();
  @Output() readonly print = new EventEmitter<void>();
  @Output() readonly toggleRow = new EventEmitter<CashFlowRow>();
  @Output() readonly openDetail = new EventEmitter<{ row: CashFlowRow; event: Event }>();
  @Output() readonly closeDetail = new EventEmitter<void>();
  @Output() readonly reviewWarning = new EventEmitter<{ warning: CashFlowWarning; event: Event }>();
  @Output() readonly correctTransactionCategory = new EventEmitter<CashFlowTransactionCategoryCorrection>();

  @ViewChild('workspaceHost', { read: ViewContainerRef, static: true }) private workspaceHost?: ViewContainerRef;
  private workspaceRef?: ComponentRef<CashFlowWorkspaceComponent>;
  private destroyed = false;

  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  ngAfterViewInit(): void { void this.loadWorkspace(); }
  ngOnChanges(_changes: SimpleChanges): void { this.syncInputs(); }
  ngOnDestroy(): void { this.destroyed = true; this.workspaceRef?.destroy(); }

  private async loadWorkspace(): Promise<void> {
    const { CashFlowWorkspaceComponent } = await import('./cash-flow-workspace.component');
    if (this.destroyed || !this.workspaceHost) return;
    this.workspaceRef = this.workspaceHost.createComponent(CashFlowWorkspaceComponent);
    const instance = this.workspaceRef.instance;
    instance.periodPresetChange.subscribe(value => {
      const range = this.periodRange(value);
      if (range) this.periodRangeChange.emit({ preset: value, ...range });
    });
    instance.startDateChange.subscribe(value => this.startDateChange.emit(value));
    instance.endDateChange.subscribe(value => this.endDateChange.emit(value));
    instance.monthRangeChange.subscribe(range => this.periodRangeChange.emit({ preset: 'CUSTOM', ...range }));
    instance.datesChanged.subscribe(() => this.datesChanged.emit());
    instance.includeZeroRowsChange.subscribe(value => this.includeZeroRowsChange.emit(value));
    instance.refresh.subscribe(() => this.refresh.emit());
    instance.reviewClassifications.subscribe(event => this.reviewClassifications.emit(event));
    instance.export.subscribe(value => this.export.emit(value));
    instance.print.subscribe(() => this.print.emit());
    instance.toggleRow.subscribe(row => this.toggleRow.emit(row));
    instance.openDetail.subscribe(value => this.openDetail.emit(value));
    instance.closeDetail.subscribe(() => this.closeDetail.emit());
    instance.reviewWarning.subscribe(value => this.reviewWarning.emit(value));
    instance.correctTransactionCategory.subscribe(value => this.correctTransactionCategory.emit(value));
    this.syncInputs();
    this.changeDetector.detectChanges();
  }

  private syncInputs(): void {
    if (!this.workspaceRef) return;
    const state = this.state;
    this.workspaceRef.setInput('report', state[0]);
    this.workspaceRef.setInput('detail', state[1]);
    this.workspaceRef.setInput('detailRow', state[2]);
    this.workspaceRef.setInput('companyDisplayName', state[3]);
    this.workspaceRef.setInput('accountingBasis', state[4]);
    this.workspaceRef.setInput('startDate', state[5]);
    this.workspaceRef.setInput('endDate', state[6]);
    this.workspaceRef.setInput('periodPreset', state[7]);
    this.workspaceRef.setInput('includeZeroRows', state[8]);
    this.workspaceRef.setInput('loading', state[9]);
    this.workspaceRef.setInput('stale', state[10]);
    this.workspaceRef.setInput('staleMessage', state[11]);
    this.workspaceRef.setInput('dateError', state[12]);
    this.workspaceRef.setInput('error', state[13]);
    this.workspaceRef.setInput('transactionCategoryCorrection', state[14]);
    this.workspaceRef.setInput('expandedRowIds', state[15]);
    this.workspaceRef.setInput('detailRationale', state[16] || this.detailRationale());
    this.workspaceRef.changeDetectorRef.detectChanges();
  }

  private periodRange(preset: CashFlowPeriodPreset): { startDate: string; endDate: string } | undefined {
    const now = new Date();
    const year = this.state[18];
    const fiscalStart = Math.min(12, Math.max(1, this.state[19] || 1));
    const month = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const date = (y: number, m: number, d: number): string => {
      const value = new Date(Date.UTC(y, m - 1, d));
      return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    };
    const monthStart = (y: number, m: number) => date(y, m, 1);
    const monthEnd = (y: number, m: number) => date(y, m + 1, 0);
    switch (preset) {
      case 'CURRENT_MONTH': return { startDate: monthStart(currentYear, month), endDate: monthEnd(currentYear, month) };
      case 'PREVIOUS_MONTH': return { startDate: monthStart(currentYear, month - 1), endDate: monthEnd(currentYear, month - 1) };
      case 'CURRENT_QUARTER': { const start = Math.floor((month - 1) / 3) * 3 + 1; return { startDate: monthStart(currentYear, start), endDate: monthEnd(currentYear, start + 2) }; }
      case 'YEAR_TO_DATE': return { startDate: `${currentYear}-01-01`, endDate: date(currentYear, month, now.getDate()) };
      case 'PREVIOUS_FISCAL_YEAR': { const endYear = year - 1; const startYear = fiscalStart === 1 ? year - 1 : year - 2; return { startDate: `${startYear}-${String(fiscalStart).padStart(2, '0')}-01`, endDate: date(endYear, fiscalStart === 1 ? 13 : fiscalStart, 0) }; }
      case 'FISCAL_YEAR': { const startYear = fiscalStart === 1 ? year : year - 1; return { startDate: `${startYear}-${String(fiscalStart).padStart(2, '0')}-01`, endDate: date(year, fiscalStart === 1 ? 13 : fiscalStart, 0) }; }
      case 'CUSTOM': return undefined;
    }
  }

  detailRationale(): string {
    const row = this.state[2];
    if (!row?.accountRole || !row.accountId) return 'Derived from the immutable report calculation; no single account classification applies.';
    const item = this.state[17]?.accounts.find(candidate => candidate.accountRole === row.accountRole && candidate.accountId === row.accountId);
    return item?.currentClassification?.rationale ?? item?.suggestedClassification?.rationale ?? item?.rationale ?? 'No classification rationale is available in the current review snapshot.';
  }
}
