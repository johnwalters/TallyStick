import {
  ACCOUNTING_ACCOUNT_TYPES,
  ACCOUNT_TYPE_CATALOG,
  ACCOUNT_TYPE_GROUPS,
  AccountingAccountType,
  classifyAccount,
  defaultImportCapability,
  getAccountPlacement,
  getReportingGroup,
  validateAccountUse,
  validateDetailType,
  validateImportCapability,
  validateOpeningBalance,
  validateParent,
  validatePlacementCompatibility,
} from './account-taxonomy';

describe('account taxonomy', () => {
  it('defines every accounting account type exactly once in reporting-group order', () => {
    expect(ACCOUNT_TYPE_CATALOG.map(item => item.accountType)).toEqual([...ACCOUNTING_ACCOUNT_TYPES]);
    expect(new Set(ACCOUNT_TYPE_CATALOG.map(item => item.accountType)).size).toBe(15);
    expect(ACCOUNT_TYPE_GROUPS.map(group => group.reportingGroup)).toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
  });

  it('contains the complete standard detail-type catalog', () => {
    const expected: Record<AccountingAccountType, readonly string[]> = {
      BANK: ['Cash on hand', 'Checking', 'Money Market', 'Rents Held in Trust', 'Savings', 'Trust account'],
      ACCOUNTS_RECEIVABLE: ['Accounts receivable'],
      OTHER_CURRENT_ASSET: ['Inventory', 'Prepaid expenses', 'Marketplace clearing', 'Clearing account', 'Other current assets'],
      FIXED_ASSET: ['Furniture and fixtures', 'Machinery and equipment', 'Vehicles', 'Other fixed assets'],
      OTHER_ASSET: ['Goodwill', 'Security deposits', 'Other long-term assets'],
      CREDIT_CARD: ['Credit Card'],
      ACCOUNTS_PAYABLE: ['Accounts payable'],
      OTHER_CURRENT_LIABILITY: ['Loan payable', 'Payroll liabilities', 'Sales tax payable', 'Other current liabilities'],
      LONG_TERM_LIABILITY: ['Notes payable', 'Shareholder notes payable', 'Other long-term liabilities'],
      EQUITY: ['Owner equity', 'Owner draw', 'Retained earnings'],
      INCOME: ['Sales of product income', 'Service income', 'Other primary income'],
      OTHER_INCOME: ['Interest earned', 'Other investment income', 'Other miscellaneous income'],
      COGS: ['Cost of labor', 'Shipping, freight and delivery', 'Supplies and materials', 'Other costs of goods sold'],
      EXPENSE: ['Advertising', 'Bank charges', 'Insurance', 'Interest paid', 'Office expenses', 'Other business expenses'],
      OTHER_EXPENSE: ['Depreciation', 'Penalties and settlements', 'Other miscellaneous expense'],
    };
    for (const definition of ACCOUNT_TYPE_CATALOG) {
      expect(definition.detailTypes.map(detail => detail.value)).withContext(definition.accountType).toEqual(expected[definition.accountType]);
      expect(definition.detailTypes.every(detail => detail.standard && detail.selectableForNewAccounts)).toBeTrue();
    }
  });

  it('maps every type exhaustively and returns a typed failure for an unknown type', () => {
    const expectedGroups = ['ASSET', 'ASSET', 'ASSET', 'ASSET', 'ASSET', 'LIABILITY', 'LIABILITY', 'LIABILITY', 'LIABILITY', 'EQUITY', 'INCOME', 'INCOME', 'EXPENSE', 'EXPENSE', 'EXPENSE',] as const;
    expect(ACCOUNTING_ACCOUNT_TYPES.map(type => {
      const result = getReportingGroup(type);
      return result.ok ? result.value : 'FAILED';
    })).toEqual(expectedGroups);
    expect(getReportingGroup('ENTITY')).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'UNKNOWN_ACCOUNT_TYPE' }) }));
  });

  it('assigns natural balances, statement placement, parents, and opening-balance support to every catalog entry', () => {
    for (const definition of ACCOUNT_TYPE_CATALOG) {
      const isDebit = definition.reportingGroup === 'ASSET' || definition.reportingGroup === 'EXPENSE';
      expect(definition.naturalBalance).withContext(definition.accountType).toBe(isDebit ? 'DEBIT' : 'CREDIT');
      expect(definition.validParentAccountTypes.length).withContext(definition.accountType).toBeGreaterThan(0);
      expect(definition.validParentAccountTypes.every(parentType => {
        const parent = ACCOUNT_TYPE_CATALOG.find(item => item.accountType === parentType)!;
        return parent.reportingGroup === definition.reportingGroup;
      })).toBeTrue();
      if (['ASSET', 'LIABILITY', 'EQUITY'].includes(definition.reportingGroup)) {
        expect(definition.balanceSheetSection).withContext(definition.accountType).toBeDefined();
        expect(definition.placementBehavior).toBe('BALANCE_SHEET_LINE');
        expect(definition.openingBalanceAllowed).toBeTrue();
      } else {
        expect(definition.balanceSheetSection).withContext(definition.accountType).toBeUndefined();
        expect(definition.placementBehavior).toBe('CURRENT_EARNINGS');
        expect(definition.openingBalanceAllowed).toBeFalse();
      }
    }
  });

  it('accepts compatible standard details, preserves existing custom metadata, and rejects new custom or blank details', () => {
    expect(validateDetailType('BANK', 'Checking')).toEqual(jasmine.objectContaining({ ok: true, value: jasmine.objectContaining({ classificationStatus: 'CONFIRMED' }) }));
    expect(validateDetailType('BANK', 'Imported legacy cash type', true)).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({
        classificationStatus: 'CONFIRMED',
        detailType: jasmine.objectContaining({ standard: false, selectableForNewAccounts: false, value: 'Imported legacy cash type' }),
      }),
    }));
    expect(validateDetailType('BANK', 'Imported legacy cash type')).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'DETAIL_TYPE_MISMATCH' }) }));
    expect(validateDetailType('BANK', '  ')).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'DETAIL_TYPE_REQUIRED' }) }));
    expect(validateDetailType('BANK', 'Credit Card')).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'DETAIL_TYPE_MISMATCH' }) }));
    expect(classifyAccount({ accountType: 'OTHER_CURRENT_ASSET', detailType: 'Clearing account', existingAccount: true, classificationStatus: 'REVIEW_REQUIRED' })).toEqual(jasmine.objectContaining({
      ok: true,
      value: jasmine.objectContaining({ classificationStatus: 'REVIEW_REQUIRED', detailType: jasmine.objectContaining({ value: 'Clearing account' }) }),
    }));
  });

  it('validates parent existence, active state, reporting group, and cycles', () => {
    const accounts = [
      { id: 'asset-parent', accountType: 'BANK', active: true },
      { id: 'liability-parent', accountType: 'CREDIT_CARD', active: true },
      { id: 'archived-parent', accountType: 'OTHER_ASSET', active: false },
      { id: 'child', accountType: 'OTHER_CURRENT_ASSET', parentId: 'asset-parent', active: true },
    ];
    expect(validateParent({ accountId: 'new', accountType: 'OTHER_ASSET', parentId: 'asset-parent', accounts }).ok).toBeTrue();
    expect(validateParent({ accountId: 'new', accountType: 'OTHER_ASSET', parentId: 'missing', accounts })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'PARENT_NOT_FOUND' }) }));
    expect(validateParent({ accountId: 'new', accountType: 'OTHER_ASSET', parentId: 'archived-parent', accounts })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'PARENT_INACTIVE' }) }));
    expect(validateParent({ accountId: 'new', accountType: 'OTHER_ASSET', parentId: 'liability-parent', accounts })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'PARENT_REPORTING_GROUP_MISMATCH' }) }));
    expect(validateParent({ accountId: 'asset-parent', accountType: 'BANK', parentId: 'child', accounts })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'PARENT_CYCLE' }) }));
  });

  it('limits financial-source use to Asset and Liability types and prevents role conversion', () => {
    expect(validateAccountUse({ accountType: 'BANK', requestedRole: 'FINANCIAL_SOURCE' }).ok).toBeTrue();
    expect(validateAccountUse({ accountType: 'INCOME', requestedRole: 'CHART' }).ok).toBeTrue();
    expect(validateAccountUse({ accountType: 'EQUITY', requestedRole: 'FINANCIAL_SOURCE' })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'ACCOUNT_ROLE_TYPE_MISMATCH' }) }));
    expect(validateAccountUse({ accountType: 'BANK', requestedRole: 'CHART', currentRole: 'FINANCIAL_SOURCE' })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'ACCOUNT_ROLE_CHANGE_UNSUPPORTED' }) }));
  });

  it('provides and validates import capabilities independently from account role and reporting placement', () => {
    expect(defaultImportCapability('BANK')).toEqual({ ok: true, value: { enabled: true, supportedSourceKinds: ['CSV', 'EXCEL', 'QBO_OFX'] } });
    expect(defaultImportCapability('OTHER_CURRENT_ASSET')).toEqual({ ok: true, value: { enabled: false, supportedSourceKinds: [] } });
    expect(validateImportCapability({ accountType: 'OTHER_CURRENT_ASSET', detailType: 'Marketplace clearing', role: 'FINANCIAL_SOURCE', capability: { enabled: true, supportedSourceKinds: ['AMAZON'] } }).ok).toBeTrue();
    expect(validateImportCapability({ accountType: 'OTHER_CURRENT_ASSET', detailType: 'Inventory', role: 'FINANCIAL_SOURCE', capability: { enabled: true, supportedSourceKinds: ['AMAZON'] } })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'IMPORT_NOT_SUPPORTED' }) }));
    expect(validateImportCapability({ accountType: 'BANK', detailType: 'Checking', role: 'CHART', capability: { enabled: true, supportedSourceKinds: ['CSV'] } })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'IMPORT_NOT_SUPPORTED' }) }));
    expect(validateImportCapability({ accountType: 'BANK', detailType: 'Checking', role: 'FINANCIAL_SOURCE', capability: { enabled: false, supportedSourceKinds: ['CSV'] } })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'IMPORT_DISABLED_WITH_SOURCES' }) }));
    expect(validateImportCapability({ accountType: 'BANK', detailType: 'Checking', role: 'FINANCIAL_SOURCE', capability: { enabled: true, supportedSourceKinds: [] } })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'IMPORT_SOURCE_KINDS_REQUIRED' }) }));
    expect(validateImportCapability({ accountType: 'BANK', detailType: 'Checking', role: 'FINANCIAL_SOURCE', capability: { enabled: true, supportedSourceKinds: ['AMAZON'] } })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'IMPORT_SOURCE_KIND_NOT_SUPPORTED' }) }));
  });

  it('enforces mutually exclusive opening-balance modes', () => {
    expect(validateOpeningBalance({ accountType: 'BANK', role: 'FINANCIAL_SOURCE', openingBalanceSource: 'DERIVED_EQUITY', storedOpeningBalanceMinor: 10_00n }).ok).toBeTrue();
    expect(validateOpeningBalance({ accountType: 'BANK', role: 'FINANCIAL_SOURCE', openingBalanceSource: 'LEDGER_ACTIVITY', storedOpeningBalanceMinor: 0n }).ok).toBeTrue();
    expect(validateOpeningBalance({ accountType: 'BANK', role: 'FINANCIAL_SOURCE', openingBalanceSource: 'LEDGER_ACTIVITY', storedOpeningBalanceMinor: 1n })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'OPENING_BALANCE_MODE_CONFLICT' }) }));
    expect(validateOpeningBalance({ accountType: 'INCOME', role: 'CHART', openingBalanceSource: 'DERIVED_EQUITY', storedOpeningBalanceMinor: 0n })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'OPENING_BALANCE_NOT_ALLOWED' }) }));
  });

  it('validates Balance Sheet and Current Earnings placements without fallback', () => {
    expect(getAccountPlacement('OTHER_CURRENT_LIABILITY')).toEqual({ ok: true, value: { reportingGroup: 'LIABILITY', section: 'LIABILITIES', behavior: 'BALANCE_SHEET_LINE' } });
    expect(getAccountPlacement('COGS')).toEqual({ ok: true, value: { reportingGroup: 'EXPENSE', section: undefined, behavior: 'CURRENT_EARNINGS' } });
    expect(validatePlacementCompatibility('INCOME', { reportingGroup: 'INCOME', behavior: 'CURRENT_EARNINGS' }).ok).toBeTrue();
    expect(validatePlacementCompatibility('INCOME', { reportingGroup: 'INCOME', section: 'ASSETS', behavior: 'BALANCE_SHEET_LINE' })).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'PLACEMENT_MISMATCH' }) }));
    expect(getAccountPlacement('ENTITY')).toEqual(jasmine.objectContaining({ ok: false, error: jasmine.objectContaining({ code: 'UNKNOWN_ACCOUNT_TYPE' }) }));
  });
});
