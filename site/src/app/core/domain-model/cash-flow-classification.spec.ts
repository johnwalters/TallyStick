import {
  CASH_FLOW_ACCOUNT_TYPE_CATALOG,
  CASH_FLOW_ACCOUNT_TYPES,
  CASH_FLOW_CASH_ROLES,
  CASH_FLOW_CLASSIFICATION_SOURCES,
  CASH_FLOW_CLASSIFICATION_STATUSES,
  CASH_FLOW_TREATMENTS,
  classifyCashFlowAccount,
  getCashFlowPermittedTreatments,
  getDefaultCashFlowClassification,
  reclassifyCashFlowAccount,
  seedDefaultCashFlowClassification,
  validateAndPreserveExistingCashFlowClassification,
  validateCashFlowClassification,
} from './cash-flow-classification';

describe('Cash Flow classification core', () => {
  it('defines exhaustive roles, treatments, statuses, sources, and account-type coverage', () => {
    expect(CASH_FLOW_CASH_ROLES).toEqual(['CASH', 'CASH_EQUIVALENT', 'RESTRICTED_CASH', 'NOT_CASH', 'REVIEW_REQUIRED']);
    expect(CASH_FLOW_TREATMENTS).toEqual([
      'CASH_BALANCE',
      'OPERATING_REVENUE_EXPENSE',
      'OPERATING_ASSET',
      'OPERATING_LIABILITY',
      'NONCASH_PNL_ADJUSTMENT',
      'INVESTING',
      'FINANCING',
      'NONCASH_DISCLOSURE',
      'EXCLUDED',
      'REVIEW_REQUIRED',
    ]);
    expect(CASH_FLOW_CLASSIFICATION_STATUSES).toEqual(['CONFIRMED', 'REVIEW_REQUIRED']);
    expect(CASH_FLOW_CLASSIFICATION_SOURCES).toEqual(['DEFAULT', 'MIGRATED', 'USER']);
    expect(new Set(CASH_FLOW_ACCOUNT_TYPES).size).toBe(15);
  });

  it('defaults cash roles and treatments from structural financial-account metadata', () => {
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking' })).toEqual({
      ok: true,
      value: {
        cashRole: 'CASH',
        treatment: 'CASH_BALANCE',
        status: 'CONFIRMED',
        source: 'DEFAULT',
        rationale: 'Bank detail structurally identifies unrestricted cash.',
      },
    });
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Savings' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'CASH_EQUIVALENT', treatment: 'CASH_BALANCE', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Money Market' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'REVIEW_REQUIRED', treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Trust account' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'RESTRICTED_CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'CREDIT_CARD', detailType: 'Credit Card' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'NOT_CASH', treatment: 'OPERATING_LIABILITY', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'OTHER_CURRENT_ASSET', detailType: 'Clearing account' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'NOT_CASH', treatment: 'OPERATING_ASSET', status: 'CONFIRMED' }),
    }));
  });

  it('defaults Chart classifications without assigning a financial cash role', () => {
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'ACCOUNTS_RECEIVABLE', detailType: 'Accounts receivable' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'OPERATING_ASSET', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'OTHER_CURRENT_ASSET', detailType: 'Inventory' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'OPERATING_ASSET', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'FIXED_ASSET', detailType: 'Machinery and equipment' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'INVESTING', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'OTHER_ASSET', detailType: 'Security deposits' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'INVESTING', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'LONG_TERM_LIABILITY', detailType: 'Notes payable' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'FINANCING', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'EQUITY', detailType: 'Retained earnings' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'EXCLUDED', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'EQUITY', detailType: 'Owner draw' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'FINANCING', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'OTHER_EXPENSE', detailType: 'Depreciation' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'NONCASH_PNL_ADJUSTMENT', status: 'CONFIRMED' }),
    }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Interest paid' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED' }),
    }));
  });

  it('covers every standard structural default without using display names', () => {
    const cases = [
      ['FINANCIAL_SOURCE', 'BANK', 'Cash on hand', 'CASH', 'CASH_BALANCE', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'BANK', 'Checking', 'CASH', 'CASH_BALANCE', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'BANK', 'Savings', 'CASH_EQUIVALENT', 'CASH_BALANCE', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'BANK', 'Money Market', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['FINANCIAL_SOURCE', 'BANK', 'Rents Held in Trust', 'RESTRICTED_CASH', 'CASH_BALANCE', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'BANK', 'Trust account', 'RESTRICTED_CASH', 'CASH_BALANCE', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'CREDIT_CARD', 'Credit Card', 'NOT_CASH', 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'OTHER_CURRENT_ASSET', 'Inventory', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['FINANCIAL_SOURCE', 'OTHER_CURRENT_ASSET', 'Prepaid expenses', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['FINANCIAL_SOURCE', 'OTHER_CURRENT_ASSET', 'Marketplace clearing', 'NOT_CASH', 'OPERATING_ASSET', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'OTHER_CURRENT_ASSET', 'Clearing account', 'NOT_CASH', 'OPERATING_ASSET', 'CONFIRMED'],
      ['FINANCIAL_SOURCE', 'OTHER_CURRENT_ASSET', 'Other current assets', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['CHART', 'ACCOUNTS_RECEIVABLE', 'Accounts receivable', undefined, 'OPERATING_ASSET', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_ASSET', 'Inventory', undefined, 'OPERATING_ASSET', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_ASSET', 'Prepaid expenses', undefined, 'OPERATING_ASSET', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_ASSET', 'Marketplace clearing', undefined, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['CHART', 'OTHER_CURRENT_ASSET', 'Clearing account', undefined, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['CHART', 'OTHER_CURRENT_ASSET', 'Other current assets', undefined, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['CHART', 'FIXED_ASSET', 'Furniture and fixtures', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'FIXED_ASSET', 'Machinery and equipment', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'FIXED_ASSET', 'Vehicles', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'FIXED_ASSET', 'Other fixed assets', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'OTHER_ASSET', 'Goodwill', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'OTHER_ASSET', 'Security deposits', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'OTHER_ASSET', 'Other long-term assets', undefined, 'INVESTING', 'CONFIRMED'],
      ['CHART', 'CREDIT_CARD', 'Credit Card', undefined, 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['CHART', 'ACCOUNTS_PAYABLE', 'Accounts payable', undefined, 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_LIABILITY', 'Loan payable', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_LIABILITY', 'Payroll liabilities', undefined, 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_LIABILITY', 'Sales tax payable', undefined, 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['CHART', 'OTHER_CURRENT_LIABILITY', 'Other current liabilities', undefined, 'OPERATING_LIABILITY', 'CONFIRMED'],
      ['CHART', 'LONG_TERM_LIABILITY', 'Shareholder notes payable', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'LONG_TERM_LIABILITY', 'Notes payable', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'LONG_TERM_LIABILITY', 'Other long-term liabilities', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'EQUITY', 'Owner equity', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'EQUITY', 'Owner draw', undefined, 'FINANCING', 'CONFIRMED'],
      ['CHART', 'EQUITY', 'Retained earnings', undefined, 'EXCLUDED', 'CONFIRMED'],
      ['CHART', 'INCOME', 'Sales of product income', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'INCOME', 'Service income', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'INCOME', 'Other primary income', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'OTHER_INCOME', 'Interest earned', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'OTHER_INCOME', 'Other investment income', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'OTHER_INCOME', 'Other miscellaneous income', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'COGS', 'Cost of labor', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'COGS', 'Shipping, freight and delivery', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'COGS', 'Supplies and materials', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'COGS', 'Other costs of goods sold', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Advertising', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Bank charges', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Insurance', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Interest paid', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Office expenses', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'EXPENSE', 'Other business expenses', undefined, 'OPERATING_REVENUE_EXPENSE', 'CONFIRMED'],
      ['CHART', 'OTHER_EXPENSE', 'Depreciation', undefined, 'NONCASH_PNL_ADJUSTMENT', 'CONFIRMED'],
      ['CHART', 'OTHER_EXPENSE', 'Penalties and settlements', undefined, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
      ['CHART', 'OTHER_EXPENSE', 'Other miscellaneous expense', undefined, 'REVIEW_REQUIRED', 'REVIEW_REQUIRED'],
    ] as const;

    for (const [accountRole, accountType, detailType, cashRole, treatment, status] of cases) {
      const result = getDefaultCashFlowClassification({ accountRole, accountType, detailType });
      expect(result.ok).withContext(`${accountRole} ${accountType} ${detailType}`).toBeTrue();
      if (!result.ok) continue;
      expect(result.value.cashRole).toBe(cashRole);
      expect(result.value.treatment).toBe(treatment);
      expect(result.value.status).toBe(status);
    }
  });

  it('evaluates every standard detail for financial-source structures', () => {
    for (const definition of CASH_FLOW_ACCOUNT_TYPE_CATALOG) {
      for (const detail of definition.detailTypes) {
        const result = getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: definition.accountType, detailType: detail.value });
        expect(result).withContext(`FINANCIAL_SOURCE ${definition.accountType} ${detail.value}`).toEqual(jasmine.objectContaining({ ok: true }));
        if (!result.ok) continue;

        const expected = definition.accountType === 'BANK' && ['Cash on hand', 'Checking'].includes(detail.value)
          ? { cashRole: 'CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED' }
          : definition.accountType === 'BANK' && detail.value === 'Savings'
            ? { cashRole: 'CASH_EQUIVALENT', treatment: 'CASH_BALANCE', status: 'CONFIRMED' }
            : definition.accountType === 'BANK' && ['Rents Held in Trust', 'Trust account'].includes(detail.value)
              ? { cashRole: 'RESTRICTED_CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED' }
              : definition.accountType === 'CREDIT_CARD'
                ? { cashRole: 'NOT_CASH', treatment: 'OPERATING_LIABILITY', status: 'CONFIRMED' }
                : definition.accountType === 'OTHER_CURRENT_ASSET' && ['Marketplace clearing', 'Clearing account'].includes(detail.value)
                  ? { cashRole: 'NOT_CASH', treatment: 'OPERATING_ASSET', status: 'CONFIRMED' }
                  : { cashRole: 'REVIEW_REQUIRED', treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' };
        expect(result.value).toEqual(jasmine.objectContaining(expected));
      }
    }
  });

  it('forces custom or ambiguous structures to review without using account names', () => {
    const first = classifyCashFlowAccount({ accountRole: 'CHART', accountType: 'OTHER_CURRENT_ASSET', detailType: 'Imported custom detail' });
    const second = classifyCashFlowAccount({ accountRole: 'CHART', accountType: 'OTHER_CURRENT_ASSET', detailType: 'Different neutral label' });
    expect(first).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ classification: jasmine.objectContaining({ treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }) }) }));
    expect(second).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ classification: jasmine.objectContaining({ treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }) }) }));
    expect(getDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Custom source detail' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ cashRole: 'REVIEW_REQUIRED', treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }),
    }));
  });

  it('routes a custom detail to review for every account type and account role', () => {
    for (const definition of CASH_FLOW_ACCOUNT_TYPE_CATALOG) {
      const chart = classifyCashFlowAccount({ accountRole: 'CHART', accountType: definition.accountType, detailType: `Custom ${definition.accountType}` });
      expect(chart).withContext(`CHART ${definition.accountType}`).toEqual(jasmine.objectContaining({
        ok: true,
        value: jasmine.objectContaining({ classification: jasmine.objectContaining({ treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }) }),
      }));

      const financial = classifyCashFlowAccount({ accountRole: 'FINANCIAL_SOURCE', accountType: definition.accountType, detailType: `Custom ${definition.accountType}` });
      expect(financial).withContext(`FINANCIAL_SOURCE ${definition.accountType}`).toEqual(jasmine.objectContaining({
        ok: true,
        value: jasmine.objectContaining({ classification: jasmine.objectContaining({ cashRole: 'REVIEW_REQUIRED', treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED' }) }),
      }));
    }
  });

  it('preserves an existing classification and its provenance when seeding or classifying an account', () => {
    const existing = {
      cashRole: 'NOT_CASH' as const,
      treatment: 'FINANCING' as const,
      status: 'CONFIRMED' as const,
      source: 'MIGRATED' as const,
      rationale: '  Imported loan classification.  ',
      modifiedAtUtc: '2026-08-25T00:00:00Z',
    };

    const seeded = getDefaultCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking', existingClassification: existing,
    });
    expect(seeded).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({
        cashRole: 'NOT_CASH', treatment: 'FINANCING', status: 'CONFIRMED', source: 'MIGRATED',
        rationale: 'Imported loan classification.', modifiedAtUtc: '2026-08-25T00:00:00Z',
      }),
    }));

    const classified = classifyCashFlowAccount({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking', existingClassification: existing,
    });
    expect(classified).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ classification: jasmine.objectContaining({ source: 'MIGRATED', treatment: 'FINANCING', rationale: 'Imported loan classification.' }) }),
    }));

    expect(validateAndPreserveExistingCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking', existingClassification: existing,
    })).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ classification: jasmine.objectContaining({ source: 'MIGRATED' }) }) }));
    expect(seedDefaultCashFlowClassification({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking' })).toEqual(jasmine.objectContaining({
      ok: true, value: jasmine.objectContaining({ cashRole: 'CASH', treatment: 'CASH_BALANCE', source: 'DEFAULT' }),
    }));
    expect(reclassifyCashFlowAccount({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking' })).toEqual(jasmine.objectContaining({
      ok: true, value: jasmine.objectContaining({ classification: jasmine.objectContaining({ cashRole: 'CASH', treatment: 'CASH_BALANCE', source: 'DEFAULT' }) }),
    }));
  });

  it('exposes structural treatment sets without silently falling back to Operating', () => {
    expect(getCashFlowPermittedTreatments({ accountRole: 'CHART', accountType: 'FIXED_ASSET', detailType: 'Vehicles' })).toEqual({ ok: true, value: ['INVESTING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'] });
    expect(getCashFlowPermittedTreatments({ accountRole: 'CHART', accountType: 'LONG_TERM_LIABILITY', detailType: 'Notes payable' })).toEqual({ ok: true, value: ['FINANCING', 'NONCASH_DISCLOSURE', 'EXCLUDED', 'REVIEW_REQUIRED'] });
    expect(getCashFlowPermittedTreatments({ accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising' })).toEqual({ ok: true, value: ['OPERATING_REVENUE_EXPENSE', 'NONCASH_PNL_ADJUSTMENT', 'INVESTING', 'FINANCING', 'EXCLUDED', 'REVIEW_REQUIRED'] });
    expect(getCashFlowPermittedTreatments({ accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking' })).toEqual({ ok: true, value: ['CASH_BALANCE', 'INVESTING', 'FINANCING', 'EXCLUDED', 'REVIEW_REQUIRED'] });
  });

  it('validates role, treatment, and review-status compatibility', () => {
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'CASH', treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'USER', rationale: 'User confirmed the cash role.' },
    })).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ accountType: 'BANK', accountRole: 'FINANCIAL_SOURCE', permittedTreatments: ['CASH_BALANCE'] }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Interest paid',
      classification: { cashRole: 'NOT_CASH', treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'USER', rationale: 'A Chart account cannot be a financial cash role.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'ACCOUNT_ROLE_PROHIBITED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'CASH', treatment: 'OPERATING_ASSET', status: 'CONFIRMED', source: 'USER', rationale: 'Invalid cash treatment.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CASH_ROLE_TREATMENT_MISMATCH' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'REVIEW_REQUIRED', treatment: 'REVIEW_REQUIRED', status: 'CONFIRMED', source: 'MIGRATED', rationale: 'Needs review.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CLASSIFICATION_STATUS_REQUIRED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'FIXED_ASSET', detailType: 'Vehicles',
      classification: { treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'USER', rationale: 'Invalid fixed-asset treatment.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'TREATMENT_NOT_ALLOWED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'OPERATING_REVENUE_EXPENSE', status: 'REVIEW_REQUIRED', source: 'USER', rationale: 'User flagged this otherwise compatible mapping for review.' },
    })).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ classification: jasmine.objectContaining({ status: 'REVIEW_REQUIRED' }) }) }));
    const migrated = validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'OTHER_CURRENT_ASSET', detailType: 'Imported custom detail',
      classification: {
        treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', source: 'MIGRATED',
        rationale: 'Imported classification retained for review.', modifiedAtUtc: '2026-08-25T00:00:00Z',
      },
    });
    expect(migrated).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({
        classification: jasmine.objectContaining({ source: 'MIGRATED', modifiedAtUtc: '2026-08-25T00:00:00Z' }),
      }),
    }));
  });

  it('rejects unknown types and malformed classifications with typed failures', () => {
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'ENTITY', detailType: 'Legacy detail' })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'UNKNOWN_ACCOUNT_TYPE' }) }));
    expect(getDefaultCashFlowClassification({ accountRole: 'CHART', accountType: 'EXPENSE', detailType: '   ' })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'DETAIL_TYPE_REQUIRED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'NOT_A_TREATMENT' as never, status: 'CONFIRMED', source: 'USER', rationale: 'Malformed.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'TREATMENT_NOT_ALLOWED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'REVIEW_REQUIRED', status: 'CONFIRMED', source: 'USER', rationale: 'Review treatment must be marked for review.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CLASSIFICATION_STATUS_REQUIRED' }) }));

    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { treatment: 'OPERATING_LIABILITY', status: 'CONFIRMED', source: 'USER', rationale: 'Missing cash role.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'ACCOUNT_ROLE_REQUIRED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'UNKNOWN' as never, treatment: 'REVIEW_REQUIRED', status: 'REVIEW_REQUIRED', source: 'USER', rationale: 'Unknown cash role.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CASH_ROLE_NOT_SUPPORTED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'INVALID' as never, rationale: 'Invalid source.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CLASSIFICATION_SOURCE_INVALID' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'OPERATING_REVENUE_EXPENSE', status: 'INVALID' as never, source: 'USER', rationale: 'Invalid status.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CLASSIFICATION_STATUS_REQUIRED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'CHART', accountType: 'EXPENSE', detailType: 'Advertising',
      classification: { treatment: 'OPERATING_REVENUE_EXPENSE', status: 'CONFIRMED', source: 'USER', rationale: '   ' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CLASSIFICATION_RATIONALE_REQUIRED' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'RESTRICTED_CASH', treatment: 'FINANCING', status: 'CONFIRMED', source: 'USER', rationale: 'Restricted mismatch.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CASH_ROLE_TREATMENT_MISMATCH' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'FINANCIAL_SOURCE', accountType: 'BANK', detailType: 'Checking',
      classification: { cashRole: 'REVIEW_REQUIRED', treatment: 'FINANCING', status: 'REVIEW_REQUIRED', source: 'USER', rationale: 'Review-role mismatch.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'CASH_ROLE_TREATMENT_MISMATCH' }) }));
    expect(validateCashFlowClassification({
      accountRole: 'WRONG_ROLE' as never, accountType: 'BANK', detailType: 'Checking',
      classification: { treatment: 'CASH_BALANCE', status: 'CONFIRMED', source: 'USER', rationale: 'Invalid account role.' },
    })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'ACCOUNT_ROLE_REQUIRED' }) }));
  });
});
