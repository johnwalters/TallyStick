import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import {
  CashFlowClassificationCatalog,
  CashFlowClassificationExportResult,
  CashFlowClassificationImportCommitResult,
  CashFlowClassificationImportPreview,
  CashFlowClassificationPreview,
  CashFlowClassificationReview,
  CashFlowContractError,
  CashFlowDetail,
  CashFlowExportResult,
  CashFlowFailure,
  CashFlowQuery,
  CashFlowQueryInput,
  CashFlowReport,
  CommitCashFlowClassificationImportCommand,
  ExportCashFlowClassificationsCommand,
  ExportCashFlowCommand,
  GetCashFlowDetailCommand,
  OpenCashFlowPrintPreviewCommand,
  PreviewCashFlowClassificationCommand,
  PreviewCashFlowClassificationImportCommand,
  SaveCashFlowClassificationCommand,
  CashFlowPrintPreviewResult,
} from '../../core/domain-model/cash-flow.types';
import { CompanyProfile } from '../../core/domain-model/balance-sheet.types';

@Injectable({ providedIn: 'root' })
export class CashFlowFacade {
  readonly company = signal<CompanyProfile | undefined>(undefined);
  readonly catalog = signal<CashFlowClassificationCatalog | undefined>(undefined);
  readonly classificationPreview = signal<CashFlowClassificationPreview | undefined>(undefined);
  readonly classificationReview = signal<CashFlowClassificationReview | undefined>(undefined);
  readonly importPreview = signal<CashFlowClassificationImportPreview | undefined>(undefined);
  readonly importCommit = signal<CashFlowClassificationImportCommitResult | undefined>(undefined);
  readonly report = signal<CashFlowReport | undefined>(undefined);
  readonly detail = signal<CashFlowDetail | undefined>(undefined);
  readonly lastClassificationExport = signal<CashFlowClassificationExportResult | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);
  /** Typed boundary failure retained for UI decisions such as stale versus export errors. */
  readonly failure = signal<CashFlowFailure | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  loadCompanyProfile(): void {
    this.run(() => this.company.set(this.application.getCompanyProfile()));
  }

  loadCatalog(): void {
    this.run(() => this.catalog.set(this.application.getCashFlowClassificationCatalog()));
  }

  previewClassification(command: PreviewCashFlowClassificationCommand): void {
    this.classificationPreview.set(undefined);
    this.run(() => this.classificationPreview.set(this.application.previewCashFlowClassification(command)));
  }

  saveClassification(command: SaveCashFlowClassificationCommand): void {
    this.classificationReview.set(undefined);
    this.run(() => this.classificationReview.set(this.application.saveCashFlowClassification(command)));
  }

  loadClassificationReview(query: CashFlowQuery): void {
    this.classificationReview.set(undefined);
    this.run(() => this.classificationReview.set(this.application.getCashFlowClassificationReview(query)));
  }

  previewClassificationImport(command: PreviewCashFlowClassificationImportCommand): void {
    this.importPreview.set(undefined);
    this.importCommit.set(undefined);
    this.run(() => this.importPreview.set(this.application.previewCashFlowClassificationImport(command)));
  }

  commitClassificationImport(command: CommitCashFlowClassificationImportCommand): void {
    this.importCommit.set(undefined);
    this.run(() => this.importCommit.set(this.application.commitCashFlowClassificationImport(command)));
  }

  exportClassifications(command: ExportCashFlowClassificationsCommand): CashFlowClassificationExportResult | undefined {
    return this.runWithResult(() => {
      const result = this.application.exportCashFlowClassifications(command);
      this.lastClassificationExport.set(result);
      return result;
    });
  }

  loadReport(query: CashFlowQueryInput): void {
    this.report.set(undefined);
    this.detail.set(undefined);
    this.run(() => this.report.set(this.application.getCashFlowReport(query)));
  }

  loadDetail(command: GetCashFlowDetailCommand): void {
    this.detail.set(undefined);
    this.run(() => this.detail.set(this.application.getCashFlowDetail(command)));
  }

  async export(command: ExportCashFlowCommand): Promise<CashFlowExportResult | undefined> {
    return this.runAsync(() => this.application.exportCashFlow(command));
  }

  async openPrintPreview(command: OpenCashFlowPrintPreviewCommand): Promise<CashFlowPrintPreviewResult | undefined> {
    return this.runAsync(() => this.application.openCashFlowPrintPreview(command));
  }

  private run(work: () => void): void {
    try {
      this.clearError();
      work();
    } catch (error) {
      this.captureError(error);
    }
  }

  private runWithResult<T>(work: () => T): T | undefined {
    try {
      this.clearError();
      return work();
    } catch (error) {
      this.captureError(error);
      return undefined;
    }
  }

  private async runAsync<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      this.busy.set(true);
      this.clearError();
      return await work();
    } catch (error) {
      this.captureError(error);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private clearError(): void {
    this.error.set(undefined);
    this.failure.set(undefined);
  }

  private captureError(error: unknown): void {
    if (error instanceof CashFlowContractError) {
      this.failure.set(error.failure);
      this.error.set(error.failure.message);
      return;
    }
    this.failure.set(undefined);
    this.error.set(error instanceof Error ? error.message : 'Unable to complete the Statement of Cash Flows request.');
  }
}
