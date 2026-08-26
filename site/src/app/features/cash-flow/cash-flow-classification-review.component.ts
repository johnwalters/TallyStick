import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_TREATMENTS,
  CashFlowCashRole,
  CashFlowClassification,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowClassificationReviewItem,
  CashFlowClassificationReviewReasonCode,
  CashFlowClassificationSaveImpact,
  CashFlowTreatment,
} from '../../core/domain-model/cash-flow.types';

export interface CashFlowClassificationEditorDraft {
  accountRole: 'FINANCIAL_SOURCE' | 'CHART';
  accountId: string;
  accountPath: string;
  accountType: string;
  detailType: string;
  archived: boolean;
  cashRole?: CashFlowCashRole;
  treatment: CashFlowTreatment;
  rationale: string;
  expectedModifiedAtUtc?: string;
  periodActivityMinor: bigint;
  reportImpactMinor: bigint;
  currentClassification?: CashFlowClassification;
  suggestedClassification?: CashFlowClassification;
  reviewReasons: readonly CashFlowClassificationReviewReasonCode[];
}

@Component({
  selector: 'app-cash-flow-classification-review',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="cash-flow-review-backdrop" (click)="close.emit()">
      <aside #panel class="cash-flow-review-panel" role="dialog" aria-modal="true" aria-labelledby="cash-flow-review-title" tabindex="-1" (keydown)="handleKeydown($event)" (click)="$event.stopPropagation()">
        <header class="cash-flow-review-header"><div><p class="eyebrow">CASH FLOW SETUP</p><h2 id="cash-flow-review-title">Review classifications</h2><p>Resolve cash roles and treatments before generating a Statement of Cash Flows. Changes are saved by stable account ID and audited.</p></div><button type="button" class="cash-flow-review-close" aria-label="Close Cash Flow classification review" (click)="close.emit()">×</button></header>
        <div class="cash-flow-review-body">
          <div class="cash-flow-review-filters"><label><span>From</span><input type="date" [ngModel]="startDate" (ngModelChange)="startDateChange.emit($event)" /></label><label><span>Through</span><input type="date" [ngModel]="endDate" (ngModelChange)="endDateChange.emit($event)" /></label><label><span>Show</span><select [ngModel]="filter" (ngModelChange)="filterChange.emit($event)"><option value="REVIEW_REQUIRED">Review required</option><option value="ALL">All review items</option><option value="CASH">Cash accounts</option><option value="OPERATING">Operating</option><option value="INVESTING">Investing</option><option value="FINANCING">Financing</option><option value="NONCASH">Noncash / excluded</option></select></label><label class="cash-flow-review-search"><span>Search</span><input [ngModel]="search" (ngModelChange)="searchChange.emit($event)" placeholder="Account, type, detail, or rationale" /></label></div>
          @if (error) { <p class="cash-flow-classification-error" role="alert">{{ error }} <button type="button" class="quiet-button" (click)="refresh.emit()">Reload review</button></p> }
          @if (review; as currentReview) {
            <div class="cash-flow-review-summary" role="status"><span><strong>{{ currentReview.blockingCount }}</strong> blocking</span><span><strong>{{ currentReview.warningCount }}</strong> warnings</span><span>{{ items.length }} shown</span><span>Period {{ currentReview.query.startDate }} through {{ currentReview.query.endDate }}</span></div>
            <div class="cash-flow-review-layout">
              <section class="cash-flow-review-list" aria-label="Cash Flow accounts requiring review">
                @for (item of items; track item.accountRole + ':' + item.accountId) {
                  <button type="button" class="cash-flow-review-item" [class.selected]="selectedKey === selectionKey(item.accountRole, item.accountId)" [attr.aria-pressed]="selectedKey === selectionKey(item.accountRole, item.accountId)" (click)="select.emit(item)"><span class="cash-flow-review-item-heading"><strong>{{ item.accountPath }}</strong>@if (item.archived) { <em>Archived</em> }</span><span class="cash-flow-review-item-meta">{{ item.accountRole === 'FINANCIAL_SOURCE' ? 'Source account' : 'Chart account' }} · {{ item.accountType }} · {{ item.detailType }}</span><span class="cash-flow-review-item-classification">{{ item.cashRole ? cashRoleLabel(item.cashRole) + ' · ' : '' }}{{ treatmentLabel(item.treatment) }} · {{ item.status === 'REVIEW_REQUIRED' ? 'Review required' : item.source }}</span><small>{{ money(item.periodActivityMinor) }} period activity · {{ money(item.reportImpactMinor) }} report impact · {{ reasonText(item) }}</small></button>
                } @empty { <div class="cash-flow-review-empty"><strong>No classification items match this view.</strong><p>Try All review items or adjust the period and search.</p></div> }
              </section>
              <section class="cash-flow-review-editor" aria-label="Selected Cash Flow classification">
                @if (editor; as draft) {
                  <div class="cash-flow-review-editor-heading"><div><p class="eyebrow">SELECTED ACCOUNT</p><h3>{{ draft.accountPath }}</h3><p>{{ draft.accountType }} · {{ draft.detailType }} · {{ draft.accountRole === 'FINANCIAL_SOURCE' ? 'Source account' : 'Chart account' }}</p></div>@if (draft.archived) { <span class="classification-archived-badge">Archived</span> }</div>
                  @if (draft.reviewReasons.length) { <div class="classification-reasons" role="status"><strong>Why this needs attention</strong><ul>@for (reason of draft.reviewReasons; track reason) { <li>{{ reasonLabel(reason) }}</li> }</ul></div> }
                  @if (draft.archived) { <p class="cash-flow-classification-note" role="status">This archived account is read-only. Restore it before changing its Cash Flow classification.</p> }
                  @if (draft.currentClassification) { <div class="classification-current"><strong>Current value</strong><span>{{ draft.currentClassification.cashRole ? cashRoleLabel(draft.currentClassification.cashRole) + ' · ' : '' }}{{ treatmentLabel(draft.currentClassification.treatment) }}</span><small>{{ draft.currentClassification.source }} · {{ draft.currentClassification.rationale }}</small></div> }
                  @if (draft.suggestedClassification) { <div class="classification-suggestion"><strong>Structural suggestion</strong><span>{{ draft.suggestedClassification.cashRole ? cashRoleLabel(draft.suggestedClassification.cashRole) + ' · ' : '' }}{{ treatmentLabel(draft.suggestedClassification.treatment) }}</span><small>{{ draft.suggestedClassification.rationale }}</small></div> }
                  <div class="classification-impact"><strong>Current period effect</strong><span>{{ money(draft.periodActivityMinor) }} activity · {{ money(draft.reportImpactMinor) }} report impact</span><small>Preview changes placement only; it does not write until you save.</small></div>
                  <fieldset class="cash-flow-editor-fields" [disabled]="draft.archived || !structureStable">
                    @if (draft.accountRole === 'FINANCIAL_SOURCE') { <label><span>Cash role</span><select [ngModel]="draft.cashRole" (ngModelChange)="fieldChange.emit({ cashRole: $event })">@for (role of cashRoles; track role) { <option [value]="role">{{ cashRoleLabel(role) }}</option> }</select></label> }
                    <label><span>Cash Flow treatment</span><select [ngModel]="draft.treatment" (ngModelChange)="fieldChange.emit({ treatment: $event })">@for (treatment of treatments; track treatment) { <option [value]="treatment">{{ treatmentLabel(treatment) }}</option> }</select></label>
                    <label><span>Rationale <small>Required</small></span><textarea rows="4" [ngModel]="draft.rationale" (ngModelChange)="fieldChange.emit({ rationale: $event })" placeholder="Explain why this treatment reflects the business activity"></textarea></label>
                  </fieldset>
                  @if (!structureStable) { <p class="cash-flow-classification-note" role="status">The account structure has unsaved changes. Save the account first, then classify it.</p> }
                  @if (preview; as proposed) { <div class="classification-preview" [class.invalid]="!proposed.valid" role="status"><strong>{{ proposed.valid ? 'Proposed placement' : 'Cannot save this combination' }}</strong><span>{{ proposed.statementLabel }}</span><small>{{ proposed.rationale }}</small>@if (!proposed.valid) { <ul>@for (failure of proposed.failures; track failure.code) { <li>{{ failure.message }}</li> }</ul> }</div> }
                  @if (saveMessage) { <p class="cash-flow-classification-success" role="status">{{ saveMessage }}</p> }
                  @if (saveImpact; as impact) { <div class="classification-impact classification-impact-saved" role="status"><strong>Saved report impact</strong><span>{{ money(impact.reportImpactMinor) }} across {{ impact.affectedSections.join(', ') }}</span><small>Cash Flow report data was refreshed at revision {{ impact.databaseRevision }}</small></div> }
                  <div class="cash-flow-classification-actions"><button type="button" class="quiet-button" (click)="cancel.emit()">Cancel</button><button type="button" class="primary-button" [disabled]="!saveEnabled" (click)="save.emit()">Save classification</button></div>
                } @else { <div class="cash-flow-review-empty"><strong>Select an account to review.</strong><p>Current values, structural suggestions, activity, and report impact appear here.</p></div> }
              </section>
            </div>
          }
        </div>
      </aside>
    </div>
  `,
})
export class CashFlowClassificationReviewComponent implements AfterViewInit {
  @ViewChild('panel') private panel?: ElementRef<HTMLElement>;
  @Input() review?: CashFlowClassificationReview;
  @Input() items: readonly CashFlowClassificationReviewItem[] = [];
  @Input() editor?: CashFlowClassificationEditorDraft;
  @Input() preview?: CashFlowClassificationPreview;
  @Input() saveImpact?: CashFlowClassificationSaveImpact;
  @Input() error = '';
  @Input() saveMessage = '';
  @Input() saveEnabled = false;
  @Input() structureStable = true;
  @Input() startDate = '';
  @Input() endDate = '';
  @Input() filter = 'REVIEW_REQUIRED';
  @Input() search = '';
  @Input() selectedKey = '';
  @Input() cashRoles: readonly CashFlowCashRole[] = CASH_FLOW_CASH_ROLES;
  @Input() treatments: readonly CashFlowTreatment[] = CASH_FLOW_TREATMENTS;
  @Input() selectionKey: (role: 'FINANCIAL_SOURCE' | 'CHART', accountId: string) => string = (role, id) => `${role}:${id}`;
  @Input() money: (value: bigint) => string = value => value.toString();
  @Input() cashRoleLabel: (role: CashFlowCashRole) => string = role => role;
  @Input() treatmentLabel: (treatment: CashFlowTreatment) => string = treatment => treatment;
  @Input() reasonLabel: (reason: CashFlowClassificationReviewReasonCode) => string = reason => reason;
  @Input() reasonText: (item: CashFlowClassificationReviewItem) => string = item => item.rationale;
  @Output() readonly close = new EventEmitter<void>();
  @Output() readonly refresh = new EventEmitter<void>();
  @Output() readonly select = new EventEmitter<CashFlowClassificationReviewItem>();
  @Output() readonly fieldChange = new EventEmitter<Partial<CashFlowClassificationEditorDraft>>();
  @Output() readonly startDateChange = new EventEmitter<string>();
  @Output() readonly endDateChange = new EventEmitter<string>();
  @Output() readonly filterChange = new EventEmitter<string>();
  @Output() readonly searchChange = new EventEmitter<string>();
  @Output() readonly cancel = new EventEmitter<void>();
  @Output() readonly save = new EventEmitter<void>();

  ngAfterViewInit(): void {
    this.panel?.nativeElement.focus();
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = this.panel?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter(element => element.offsetParent !== null && !element.matches(':disabled'));
    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
