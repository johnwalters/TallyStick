import { Inject, Injectable, signal } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';
import {
  BalanceSheetDetail,
  BalanceSheetExportResult,
  BalanceSheetPrintPreviewResult,
  BalanceSheetQuery,
  BalanceSheetReport,
  CompanyProfile,
  ExportBalanceSheetCommand,
  GetAccountTypeCatalogResult,
  GetBalanceSheetDetailCommand,
  OpenBalanceSheetPrintPreviewCommand,
  PreviewAccountPlacementCommand,
  PreviewAccountPlacementResult,
  RevealCompanyTaxIdentifierResult,
  UpdateCompanyProfileCommand,
} from '../../core/domain-model/balance-sheet.types';

@Injectable({ providedIn: 'root' })
export class BalanceSheetFacade {
  readonly company = signal<CompanyProfile | undefined>(undefined);
  readonly accountTypeCatalog = signal<GetAccountTypeCatalogResult>([]);
  readonly placementPreview = signal<PreviewAccountPlacementResult | undefined>(undefined);
  readonly report = signal<BalanceSheetReport | undefined>(undefined);
  readonly detail = signal<BalanceSheetDetail | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal<string | undefined>(undefined);

  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  loadCompanyProfile(): void {
    this.run(() => this.company.set(this.application.getCompanyProfile()));
  }

  updateCompanyProfile(command: UpdateCompanyProfileCommand): void {
    this.run(() => this.company.set(this.application.updateCompanyProfile(command)));
  }

  revealCompanyTaxIdentifier(): RevealCompanyTaxIdentifierResult | undefined {
    return this.runWithResult(() => this.application.revealCompanyTaxIdentifier());
  }

  loadAccountTypeCatalog(): void {
    this.run(() => this.accountTypeCatalog.set(this.application.getAccountTypeCatalog()));
  }

  previewPlacement(command: PreviewAccountPlacementCommand): void {
    this.placementPreview.set(undefined);
    this.run(() => this.placementPreview.set(this.application.previewAccountPlacement(command)));
  }

  loadReport(query: BalanceSheetQuery): void {
    this.report.set(undefined);
    this.detail.set(undefined);
    this.run(() => this.report.set(this.application.getBalanceSheet(query)));
  }

  loadDetail(command: GetBalanceSheetDetailCommand): void {
    this.detail.set(undefined);
    this.run(() => this.detail.set(this.application.getBalanceSheetDetail(command)));
  }

  async export(command: ExportBalanceSheetCommand): Promise<BalanceSheetExportResult | undefined> {
    return this.runAsync(() => this.application.exportBalanceSheet(command));
  }

  async openPrintPreview(command: OpenBalanceSheetPrintPreviewCommand): Promise<BalanceSheetPrintPreviewResult | undefined> {
    return this.runAsync(() => this.application.openBalanceSheetPrintPreview(command));
  }

  private run(work: () => void): void {
    try {
      this.error.set(undefined);
      work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to complete the Balance Sheet request.');
    }
  }

  private runWithResult<T>(work: () => T): T | undefined {
    try {
      this.error.set(undefined);
      return work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to complete the Balance Sheet request.');
      return undefined;
    }
  }

  private async runAsync<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      this.busy.set(true);
      this.error.set(undefined);
      return await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Unable to complete the Balance Sheet request.');
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }
}
