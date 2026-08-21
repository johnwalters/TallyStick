import { Injectable, inject } from '@angular/core';
import { newId } from '../domain-model/accounting.types';
import {
  BalanceSheetContractError,
  CompanyAddressInput,
  CompanyProfile,
  RevealCompanyTaxIdentifierResult,
  UpdateCompanyProfileCommand,
} from '../domain-model/balance-sheet.types';
import { ACCOUNTING_REPOSITORY, AccountingRepository, TaxIdentifierPersistence } from '../repository-gateways/accounting.repository';

@Injectable({ providedIn: 'root' })
export class CompanyProfileService {
  private readonly repository = inject(ACCOUNTING_REPOSITORY) as AccountingRepository;

  getCompanyProfile(): CompanyProfile {
    const profile = this.repository.getCompanyProfile();
    if (!profile) this.fail('COMPANY_PROFILE_NOT_FOUND', 'Company Settings have not been initialized.');
    return structuredClone(profile);
  }

  updateCompanyProfile(command: UpdateCompanyProfileCommand): CompanyProfile {
    const current = this.getCompanyProfile();
    if (command.expectedModifiedAt !== current.modifiedAt) {
      this.fail('COMPANY_PROFILE_STALE', 'Company Settings changed after this edit began. Reload and try again.', 'expectedModifiedAt', true);
    }
    const normalized = this.normalize(command, current);
    const taxIdentifier = this.taxIdentifierPersistence(command.taxIdentifier);
    const currentTaxIdentifier = this.repository.revealCompanyTaxIdentifier();
    const effectiveTaxIdentifier = taxIdentifier.mode === 'PRESERVE'
      ? currentTaxIdentifier
      : taxIdentifier.mode === 'SET' ? taxIdentifier.value : undefined;
    const updated: CompanyProfile = {
      ...normalized,
      maskedTaxIdentifier: this.maskTaxIdentifier(effectiveTaxIdentifier),
      createdAt: current.createdAt,
      modifiedAt: this.nextTimestamp(current.modifiedAt),
    };

    return this.repository.transaction(() => {
      const latest = this.repository.getCompanyProfile();
      if (!latest || latest.modifiedAt !== command.expectedModifiedAt) {
        this.fail('COMPANY_PROFILE_STALE', 'Company Settings changed after this edit began. Reload and try again.', 'expectedModifiedAt', true);
      }
      this.repository.company = {
        ...this.repository.company,
        name: updated.legalName,
        currency: updated.currencyCode,
        fiscalYearStartMonth: updated.fiscalYearStartMonth,
        accountingBasis: updated.accountingBasis,
        activeTaxYear: updated.activeTaxYear,
      };
      this.repository.saveCompanyProfile(updated, taxIdentifier);
      this.repository.audit.push({
        id: newId(),
        timestampUtc: updated.modifiedAt,
        operation: 'UPDATE_COMPANY_PROFILE',
        entityType: 'CompanyProfile',
        entityId: updated.companyId,
        before: this.auditValue(current, Boolean(currentTaxIdentifier), false),
        after: this.auditValue(updated, Boolean(effectiveTaxIdentifier), command.taxIdentifier !== undefined),
        reason: 'Update Company Settings.',
      });
      return this.getCompanyProfile();
    });
  }

  revealCompanyTaxIdentifier(): RevealCompanyTaxIdentifierResult {
    const profile = this.getCompanyProfile();
    try {
      return { companyId: profile.companyId, taxIdentifier: this.repository.revealCompanyTaxIdentifier() };
    } catch {
      this.fail('COMPANY_TAX_IDENTIFIER_REVEAL_FAILED', 'The tax identifier could not be revealed.');
    }
  }

  private normalize(command: UpdateCompanyProfileCommand, current: CompanyProfile): Omit<CompanyProfile, 'createdAt' | 'modifiedAt' | 'maskedTaxIdentifier'> {
    const legalName = command.legalName.trim();
    if (!legalName) this.fail('COMPANY_PROFILE_INVALID', 'Legal name is required.', 'legalName');
    const displayName = command.displayName?.trim() || legalName;
    const currencyCode = command.currencyCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currencyCode)) this.fail('COMPANY_PROFILE_INVALID', 'Currency must be a three-letter ISO code.', 'currencyCode');
    if (!Number.isInteger(command.fiscalYearStartMonth) || command.fiscalYearStartMonth < 1 || command.fiscalYearStartMonth > 12) {
      this.fail('COMPANY_PROFILE_INVALID', 'Fiscal-year start month must be from 1 through 12.', 'fiscalYearStartMonth');
    }
    if (!['CASH', 'ACCRUAL', 'MODIFIED_CASH'].includes(command.accountingBasis)) {
      this.fail('COMPANY_PROFILE_INVALID', 'Accounting basis is not supported.', 'accountingBasis');
    }
    if (!Number.isInteger(command.activeTaxYear) || command.activeTaxYear < 1000 || command.activeTaxYear > 9999) {
      this.fail('COMPANY_PROFILE_INVALID', 'Active tax year must contain four digits.', 'activeTaxYear');
    }
    const email = this.optional(command.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) this.fail('COMPANY_PROFILE_INVALID', 'Email address is not valid.', 'email');
    const website = this.optional(command.website);
    if (website) {
      try {
        const url = new URL(website);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
      } catch {
        this.fail('COMPANY_PROFILE_INVALID', 'Website must be a valid HTTP or HTTPS URL.', 'website');
      }
    }
    const address = this.address(command.address);
    if (address?.countryCode && !/^[A-Z]{2}$/.test(address.countryCode)) {
      this.fail('COMPANY_PROFILE_INVALID', 'Country code must be a two-letter ISO code.', 'address.countryCode');
    }
    if (typeof command.taxIdentifier === 'string') {
      const taxIdentifier = command.taxIdentifier.trim();
      const alphanumericLength = taxIdentifier.replace(/[^A-Za-z0-9]/g, '').length;
      if (taxIdentifier && (!/^[A-Za-z0-9][A-Za-z0-9 .-]{2,31}$/.test(taxIdentifier) || alphanumericLength < 4)) {
        this.fail('COMPANY_PROFILE_INVALID', 'Tax identifier format is not valid.', 'taxIdentifier');
      }
    }

    return {
      companyId: current.companyId,
      legalName,
      displayName,
      doingBusinessAs: this.optional(command.doingBusinessAs),
      entityType: this.optional(command.entityType),
      address,
      phone: this.optional(command.phone),
      email,
      website,
      currencyCode,
      fiscalYearStartMonth: command.fiscalYearStartMonth,
      accountingBasis: command.accountingBasis,
      activeTaxYear: command.activeTaxYear,
    };
  }

  private address(input?: CompanyAddressInput): CompanyAddressInput | undefined {
    if (!input) return undefined;
    const address = {
      line1: this.optional(input.line1),
      line2: this.optional(input.line2),
      locality: this.optional(input.locality),
      region: this.optional(input.region),
      postalCode: this.optional(input.postalCode),
      countryCode: this.optional(input.countryCode)?.toUpperCase(),
    };
    return Object.values(address).some(Boolean) ? address : undefined;
  }

  private optional(value?: string): string | undefined {
    return value?.trim() || undefined;
  }

  private taxIdentifierPersistence(value: string | null | undefined): TaxIdentifierPersistence {
    if (value === undefined) return { mode: 'PRESERVE' };
    const normalized = value?.trim();
    return normalized ? { mode: 'SET', value: normalized } : { mode: 'CLEAR' };
  }

  private maskTaxIdentifier(value?: string): string | undefined {
    if (!value) return undefined;
    const visible = value.replace(/\W/g, '').slice(-4);
    return visible ? `•••• ${visible}` : '••••';
  }

  private nextTimestamp(previous: string): string {
    const now = Date.now();
    const prior = Date.parse(previous);
    return new Date(Number.isFinite(prior) && now <= prior ? prior + 1 : now).toISOString();
  }

  private auditValue(profile: CompanyProfile, taxIdentifierPresent: boolean, taxIdentifierChanged: boolean): unknown {
    return { profile: structuredClone(profile), taxIdentifierPresent, taxIdentifierChanged };
  }

  private fail(
    code: 'COMPANY_PROFILE_NOT_FOUND' | 'COMPANY_PROFILE_INVALID' | 'COMPANY_PROFILE_STALE' | 'COMPANY_TAX_IDENTIFIER_REVEAL_FAILED',
    message: string,
    field?: string,
    retryable = false,
  ): never {
    throw new BalanceSheetContractError({ code, message, field, retryable });
  }
}
