import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { CashFlowClassificationEditorDraft } from './cash-flow-classification-review.component';
import {
  CashFlowCashRole,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowClassificationReviewItem,
  CashFlowClassificationReviewReasonCode,
  CashFlowClassificationSaveImpact,
  CashFlowTreatment,
} from '../../core/domain-model/cash-flow.types';
import { CashFlowClassificationReviewComponent } from './cash-flow-classification-review.component';

type State = readonly [
  CashFlowClassificationReview | undefined, readonly CashFlowClassificationReviewItem[], CashFlowClassificationEditorDraft | undefined,
  CashFlowClassificationPreview | undefined, CashFlowClassificationSaveImpact | undefined, string, string, boolean, boolean,
  string, string, string, string, string, readonly CashFlowCashRole[], readonly CashFlowTreatment[],
  (role: 'FINANCIAL_SOURCE' | 'CHART', accountId: string) => string, (value: bigint) => string,
  (role: CashFlowCashRole) => string, (treatment: CashFlowTreatment) => string,
  (reason: CashFlowClassificationReviewReasonCode) => string, (item: CashFlowClassificationReviewItem) => string,
];

@Component({
  selector: 'app-cash-flow-classification-review-host',
  standalone: true,
  imports: [CashFlowClassificationReviewComponent],
  template: `
    <app-cash-flow-classification-review
      [review]="state[0]" [items]="state[1]" [editor]="state[2]" [preview]="state[3]" [saveImpact]="state[4]"
      [error]="state[5]" [saveMessage]="state[6]" [saveEnabled]="state[7]" [structureStable]="state[8]"
      [startDate]="state[9]" [endDate]="state[10]" [filter]="state[11]" [search]="state[12]" [selectedKey]="state[13]"
      [cashRoles]="state[14]" [treatments]="state[15]" [selectionKey]="state[16]" [money]="state[17]"
      [cashRoleLabel]="state[18]" [treatmentLabel]="state[19]" [reasonLabel]="state[20]" [reasonText]="state[21]"
      (close)="close.emit()" (refresh)="refresh.emit()" (select)="select.emit($event)" (fieldChange)="fieldChange.emit($event)"
      (startDateChange)="startDateChange.emit($event)" (endDateChange)="endDateChange.emit($event)" (filterChange)="filterChange.emit($event)"
      (searchChange)="searchChange.emit($event)" (cancel)="cancel.emit()" (save)="save.emit()" />
  `,
})
export class CashFlowClassificationReviewHostComponent {
  @Input() state: State = [undefined, [], undefined, undefined, undefined, '', '', false, true, '', '', 'REVIEW_REQUIRED', '', '', [], [], (role, id) => `${role}:${id}`, value => value.toString(), role => role, treatment => treatment, reason => reason, item => item.rationale];
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
}
