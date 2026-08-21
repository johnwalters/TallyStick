import { Inject, Injectable } from '@angular/core';
import { ACCOUNTING_APPLICATION, AccountingApplication } from '../../core/application-interface/accounting.application';

/**
 * Contract-only replacement UI harness. It intentionally depends on the
 * stable application interface and nothing from the existing component tree.
 */
@Injectable()
export class AlternateUiHarness {
  constructor(@Inject(ACCOUNTING_APPLICATION) private readonly application: AccountingApplication) {}

  runReviewSnapshot(startDate: string, endDate: string): {
    accountCount: number;
    pendingCount: number;
    netProfitMinor: bigint;
    exceptionCount: number;
  } {
    return {
      accountCount: this.application.listAccounts().length,
      pendingCount: this.application.listTransactions({ states: ['PENDING'], pageSize: 500 }).total,
      netProfitMinor: this.application.getProfitLoss(startDate, endDate, 'YEAR').netProfitMinor,
      exceptionCount: this.application.getExceptions(startDate, endDate).length,
    };
  }
}
