import { AfterViewChecked, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CashFlowContribution,
  CashFlowDetail,
  CashFlowReport,
  CashFlowRow,
  CashFlowWarning,
  CashFlowTransactionCategoryCorrection,
  cashFlowReportDisclaimer,
} from '../../core/domain-model/cash-flow.types';
import { formatMoney, money } from '../../core/domain-model/accounting.types';

export type CashFlowPeriodPreset = 'CURRENT_MONTH' | 'PREVIOUS_MONTH' | 'CURRENT_QUARTER' | 'YEAR_TO_DATE' | 'FISCAL_YEAR' | 'PREVIOUS_FISCAL_YEAR' | 'CUSTOM';

@Component({
  selector: 'app-cash-flow-workspace',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './cash-flow-workspace.component.html',
  styleUrl: './cash-flow-workspace.component.scss',
})
export class CashFlowWorkspaceComponent implements OnChanges, AfterViewChecked {
  @Input() report?: CashFlowReport;
  @Input() detail?: CashFlowDetail;
  @Input() detailRow?: CashFlowRow;
  @Input() companyDisplayName = '';
  @Input() accountingBasis = '';
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() periodPreset: CashFlowPeriodPreset = 'FISCAL_YEAR';
  @Input() includeZeroRows = false;
  @Input() loading = false;
  @Input() stale = false;
  @Input() staleMessage = '';
  @Input() dateError = '';
  @Input() error?: string;
  @Input() transactionCategoryCorrection?: CashFlowTransactionCategoryCorrection;
  @Input() expandedRowIds: ReadonlySet<string> = new Set<string>();
  @Input() detailRationale = '';

  @Output() readonly periodPresetChange = new EventEmitter<CashFlowPeriodPreset>();
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

  @ViewChild('detailPanel') private detailPanel?: ElementRef<HTMLElement>;
  private focusDetailPanel = false;
  private restoreDetailFocus = false;
  private detailReturnFocus?: HTMLElement;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['detail'] && this.detail) this.focusDetailPanel = true;
    if (changes['detail'] && !this.detail && changes['detail'].previousValue) this.restoreDetailFocus = true;
  }

  ngAfterViewChecked(): void {
    if (this.focusDetailPanel) {
      this.focusDetailPanel = false;
      queueMicrotask(() => this.detailPanel?.nativeElement.focus());
    }
    if (this.restoreDetailFocus) {
      this.restoreDetailFocus = false;
      const opener = this.detailReturnFocus;
      this.detailReturnFocus = undefined;
      queueMicrotask(() => opener?.isConnected && opener.focus());
    }
  }

  money(value = 0n): string { return formatMoney(money(value)); }
  statusLabel(): string {
    if (this.stale) return 'Stale — refresh required';
    return this.report?.status === 'REVIEW_REQUIRED' ? 'Review required' : 'Complete';
  }
  disclaimer(): string {
    return cashFlowReportDisclaimer(this.report?.query ?? { startDate: this.startDate, endDate: this.endDate });
  }
  warningHeading(): string { return this.report?.status === 'REVIEW_REQUIRED' ? 'Review required' : 'Warnings and disclosures'; }
  differenceNonzero(): boolean { return (this.report?.differenceMinor ?? 0n) !== 0n; }
  noCashConfigured(): boolean { return this.report?.warnings.some(warning => warning.code === 'NO_CASH_ACCOUNTS_CONFIGURED') ?? false; }
  warningActionable(warning: CashFlowWarning): boolean { return Boolean(warning.accountRole && warning.accountId); }
  rowHasChildren(row: CashFlowRow): boolean { return this.report?.rows.some(candidate => candidate.parentRowId === row.rowId) ?? false; }
  rowExpanded(row: CashFlowRow): boolean { return this.expandedRowIds.has(row.rowId); }
  rowVisible(row: CashFlowRow): boolean {
    if (!this.report) return false;
    const byId = new Map(this.report.rows.map(candidate => [candidate.rowId, candidate]));
    let parentId = row.parentRowId;
    const seen = new Set<string>();
    while (parentId) {
      if (seen.has(parentId) || !this.expandedRowIds.has(parentId)) return false;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentRowId;
    }
    return true;
  }
  rowClass(row: CashFlowRow): string { return `cash-flow-row-${row.rowType.toLowerCase().replace(/_/g, '-')}`; }
  rowAriaLabel(row: CashFlowRow): string { return `${row.label}, ${this.money(row.amountMinor ?? 0n)}, ${this.startDate} through ${this.endDate}. Open detail`; }
  detailSum(detail: CashFlowDetail): bigint { return detail.contributions.reduce((sum, item) => sum + item.contributionMinor, 0n); }
  detailFormula(detail: CashFlowDetail): string {
    const formulas = [...new Set(detail.contributions.map(item => item.formula).filter((formula): formula is string => Boolean(formula)))];
    if (formulas.length) return formulas.join(' · ');
    if (this.detailRow?.rowType === 'ACCOUNT_ACTIVITY') return 'Signed recorded activity for the selected account and period';
    if (this.detailRow?.rowType === 'CASH_BALANCE') return 'Beginning cash plus section-derived Net Change';
    if (this.detailRow?.rowType === 'DIFFERENCE') return 'Balance Sheet ending cash minus calculated ending cash';
    return 'Derived statement value from the immutable report';
  }
  contributionSignRule(item: CashFlowContribution): string {
    if (item.formula) return item.formula;
    if (item.rawChangeMinor !== undefined) return 'Working-capital sign rule applied to the raw Balance Sheet change';
    if (item.contributionType === 'NONCASH_REVERSAL') return 'Reverse the original P/L contribution';
    return 'Signed contribution as presented in the report';
  }
  contributionMeta(item: CashFlowContribution): string {
    return [
      item.accountRole && item.accountId ? `${item.accountRole} ${item.accountId}` : '',
      item.accountName,
      item.chartAccountPath,
      item.transactionId ? `Transaction ${item.transactionId}` : '',
      item.splitId ? `Split ${item.splitId}` : '',
      item.transferId ? `Transfer ${item.transferId}` : '',
      item.counterpartyTransactionId ? `Counterparty ${item.counterpartyTransactionId}` : '',
      item.sourceBatchId ? `Source ${item.sourceBatchId}` : '',
      item.payee ? `Payee ${item.payee}` : '',
      item.memo ? `Memo ${item.memo}` : '',
    ].filter(Boolean).join(' · ') || 'Derived statement value';
  }
  openRowDetail(row: CashFlowRow, event: Event): void {
    if (this.stale || !row.detailKey) return;
    this.detailReturnFocus = event.currentTarget as HTMLElement;
    this.openDetail.emit({ row, event });
  }
  closeRowDetail(): void { this.closeDetail.emit(); }
  detailKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.closeRowDetail(); return; }
    if (event.key !== 'Tab') return;
    const panel = event.currentTarget as HTMLElement;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter(item => !item.matches(':disabled'));
    if (!focusable.length) { event.preventDefault(); panel.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}
