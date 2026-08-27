import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const resolvePath = location => path.isAbsolute(location) ? location : path.join(repositoryRoot, location);
const readText = location => readFile(resolvePath(location), 'utf8');
const readJson = async location => JSON.parse(await readText(location));
const csvRowCount = async relativePath => (await readText(relativePath)).trim().split(/\r?\n/).length - 1;

const oraclePath = process.env.CASH_FLOW_ORACLE_PATH ?? 'fixtures/cash-flow/baseline-oracle.json';
const publicOraclePath = process.env.CASH_FLOW_PUBLIC_ORACLE_PATH ?? 'site/src/test-fixtures/cash-flow/baseline-oracle.json';
const [oracle, companies, expectedResults, schemaSource, recoverySuite, publicOracleText, oracleText] = await Promise.all([
  readJson(oraclePath),
  readJson('fixtures/cash-flow/company-fixtures.json'),
  readJson('sample-data/expected/expected-results.json'),
  readText('site/src/shared/schema-version.ts'),
  readText('site/src/desktop-host/database-lifecycle.node-test.ts'),
  readText(publicOraclePath),
  readText(oraclePath),
]);

// The browser acceptance harness consumes the same canonical machine-readable
// oracle through the public test asset. Require byte-for-byte synchronization so
// a stale browser fixture cannot let production expectations drift from the
// independent baseline-oracle.json.
assert.equal(publicOracleText, oracleText, 'The browser acceptance oracle asset is stale; synchronize it with fixtures/cash-flow/baseline-oracle.json.');

assert.equal(oracle.moneyUnit, 'INTEGER_MINOR_UNITS');
assert.equal(oracle.method, 'INDIRECT');

const currentSchemaVersion = Number(schemaSource.match(/CURRENT_SQLITE_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
assert.equal(oracle.databaseBaseline.databaseSchemaVersion, 6, 'The Cash Flow migration baseline must record schema 6 exactly.');
assert.equal(currentSchemaVersion, oracle.databaseBaseline.databaseSchemaVersion + 1, 'The application schema must advance the Cash Flow oracle baseline by one migration.');

const expectedCounts = oracle.databaseBaseline.counts;
assert.deepEqual(expectedCounts, {
  company: 1,
  financialAccount: await csvRowCount('sample-data/ledger/financial-accounts.csv'),
  chartAccount: await csvRowCount('sample-data/chart/chart-of-accounts.csv'),
  transactionRecord: await csvRowCount('sample-data/ledger/transactions.csv'),
  postingSplit: await csvRowCount('sample-data/ledger/posting-splits.csv'),
  transferMatch: await csvRowCount('sample-data/ledger/transfer-matches.csv'),
});
assert.equal(expectedCounts.financialAccount, expectedResults.counts.financialAccounts);
assert.equal(expectedCounts.chartAccount, expectedResults.counts.chartAccounts);
assert.equal(expectedCounts.transactionRecord, expectedResults.counts.transactions);
assert.equal(expectedCounts.postingSplit, expectedResults.counts.postingSplits);
assert.equal(expectedCounts.transferMatch, expectedResults.counts.transferMatches);

for (const [date, totals] of Object.entries(oracle.databaseBaseline.canonicalReports)) {
  const expected = expectedResults.balanceSheets[date];
  assert.ok(expected, `Missing canonical Balance Sheet ${date}.`);
  assert.deepEqual(totals, {
    totalAssetsMinor: expected.totalAssetsMinor,
    totalLiabilitiesMinor: expected.totalLiabilitiesMinor,
    totalEquityMinor: expected.totalEquityMinor,
    differenceMinor: expected.differenceMinor,
  });
}

const recoveryProof = oracle.databaseBaseline.backupRestoreProof;
assert.ok(recoverySuite.includes(`test('${recoveryProof.test}'`), 'The named backup/restore proof must remain in the desktop-host suite.');
for (const requiredAssertion of ['selectedBefore', 'safetyBackupPath', 'currentDatabasePath', 'restored-company']) {
  assert.ok(recoverySuite.includes(requiredAssertion), `Backup/restore proof is missing ${requiredAssertion}.`);
}

assert.equal(companies.profiles.length, 2, 'Exactly two neutral Cash Flow company fixtures are required.');
for (const field of ['companyId', 'legalName', 'displayName', 'address', 'fiscalYearStartMonth', 'institutions', 'financialAccounts', 'chartAccountNames']) {
  assert.notDeepEqual(companies.profiles[0][field], companies.profiles[1][field], `Company fixtures must differ in ${field}.`);
}
assert.ok(companies.profiles.some(profile => profile.fiscalYearStartMonth !== 1), 'A non-calendar fiscal-year fixture is required.');
for (const profile of companies.profiles) {
  assert.ok(profile.legalName.trim());
  assert.ok(profile.address.line1.trim());
  assert.ok(Number.isInteger(profile.fiscalYearStartMonth) && profile.fiscalYearStartMonth >= 1 && profile.fiscalYearStartMonth <= 12);
  assert.ok(profile.institutions.length >= 2);
  assert.ok(profile.financialAccounts.length >= 3);
  assert.equal(new Set(profile.financialAccounts.map(account => account.id)).size, profile.financialAccounts.length);
  assert.ok(profile.financialAccounts.some(account => account.cashRole === 'CASH'));
}

const assertMinorUnits = (value, location) => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertMinorUnits(item, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/Minor$/.test(key)) assert.ok(Number.isSafeInteger(item), `${location}.${key} must be an integer minor-unit value.`);
    else assertMinorUnits(item, `${location}.${key}`);
  }
};
assertMinorUnits(oracle, 'oracle');

const requiredScenarioIds = Array.from({ length: 20 }, (_, index) => `A${index + 1}`);
assert.deepEqual(oracle.scenarios.map(scenario => scenario.id), requiredScenarioIds);

const requiredTotals = [
  'netProfitMinor',
  'noncashAdjustmentsMinor',
  'operatingAssetAdjustmentsMinor',
  'operatingLiabilityAdjustmentsMinor',
  'netOperatingMinor',
  'netInvestingMinor',
  'netFinancingMinor',
  'netChangeInCashMinor',
  'beginningCashMinor',
  'calculatedEndingCashMinor',
  'endingCashMinor',
  'differenceMinor',
  'restrictedCashBeginningMinor',
  'restrictedCashEndingMinor',
  'unclassifiedCashActivityMinor',
];
assert.equal(new Set(oracle.semanticRows.map(row => row.rowId)).size, oracle.semanticRows.length, 'Semantic report row IDs must be unique.');
assert.deepEqual(oracle.semanticRows.map(row => row.totalField), requiredTotals, 'Every fixed semantic report row must map to one exact oracle total.');
for (const row of oracle.semanticRows) {
  assert.ok(row.detailBasis.trim(), `${row.rowId} requires an explicit detail basis.`);
}

const sumComposition = entries => entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
const companyIds = new Set(companies.profiles.map(profile => profile.companyId));
const representedYears = new Set();

for (const scenario of oracle.scenarios) {
  assert.ok(companyIds.has(scenario.companyId), `${scenario.id} references an unknown neutral company.`);
  assert.match(scenario.period.startDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(scenario.period.endDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(scenario.period.startDate <= scenario.period.endDate, `${scenario.id} period is invalid.`);
  representedYears.add(scenario.period.startDate.slice(0, 4));
  representedYears.add(scenario.period.endDate.slice(0, 4));

  const totals = scenario.expectedTotals;
  assert.deepEqual(Object.keys(totals), requiredTotals, `${scenario.id} must define every exact report total in canonical order.`);
  const semanticRowExpectations = Object.fromEntries(oracle.semanticRows.map(row => [row.rowId, totals[row.totalField]]));
  assert.equal(Object.keys(semanticRowExpectations).length, requiredTotals.length, `${scenario.id} must cover every fixed report row.`);
  assert.equal(
    totals.netOperatingMinor,
    totals.netProfitMinor + totals.noncashAdjustmentsMinor + totals.operatingAssetAdjustmentsMinor + totals.operatingLiabilityAdjustmentsMinor,
    `${scenario.id} indirect Operating formula must reconcile.`,
  );
  assert.equal(
    totals.netChangeInCashMinor,
    totals.netOperatingMinor + totals.netInvestingMinor + totals.netFinancingMinor,
    `${scenario.id} section totals must reconcile to Net Change.`,
  );
  assert.equal(
    totals.calculatedEndingCashMinor,
    totals.beginningCashMinor + totals.netChangeInCashMinor,
    `${scenario.id} calculated Ending Cash formula must reconcile.`,
  );
  assert.equal(
    totals.differenceMinor,
    totals.calculatedEndingCashMinor - totals.endingCashMinor,
    `${scenario.id} Difference formula must reconcile.`,
  );

  for (const [snapshotName, snapshot] of Object.entries({ opening: scenario.balanceSheets.opening, ending: scenario.balanceSheets.ending })) {
    assert.equal(
      snapshot.totalAssetsMinor - snapshot.totalLiabilitiesMinor - snapshot.totalEquityMinor,
      snapshot.differenceMinor,
      `${scenario.id} ${snapshotName} Balance Sheet must reconcile.`,
    );
  }
  assert.equal(sumComposition(scenario.cashComposition.opening), totals.beginningCashMinor, `${scenario.id} Beginning Cash composition must reconcile.`);
  assert.equal(sumComposition(scenario.cashComposition.ending), totals.endingCashMinor, `${scenario.id} Ending Cash composition must reconcile.`);
  assert.equal(sumComposition(scenario.cashComposition.restrictedOpening), totals.restrictedCashBeginningMinor, `${scenario.id} restricted opening composition must reconcile.`);
  assert.equal(sumComposition(scenario.cashComposition.restrictedEnding), totals.restrictedCashEndingMinor, `${scenario.id} restricted ending composition must reconcile.`);

  assert.deepEqual(Object.keys(scenario.detailGroups).sort(), Object.keys(scenario.expectedRows).sort(), `${scenario.id} must define exact detail for every expected row.`);
  for (const [rowKey, contributions] of Object.entries(scenario.detailGroups)) {
    assert.equal(new Set(contributions.map(contribution => contribution.sourceId)).size, contributions.length, `${scenario.id} ${rowKey} detail must not duplicate a contribution.`);
    const detailTotal = contributions.reduce((sum, contribution) => {
      assert.ok(contribution.sourceId, `${scenario.id} ${rowKey} contribution requires a stable source ID.`);
      return sum + contribution.amountMinor;
    }, 0);
    assert.equal(detailTotal, scenario.expectedRows[rowKey], `${scenario.id} ${rowKey} detail must reconcile exactly.`);
  }

  if (scenario.expectedStatus === 'COMPLETE') {
    assert.equal(totals.differenceMinor, 0, `${scenario.id} Complete status requires zero Difference.`);
    assert.equal(totals.unclassifiedCashActivityMinor, 0, `${scenario.id} Complete status requires zero unclassified activity.`);
    assert.deepEqual(scenario.expectedWarnings, [], `${scenario.id} Complete fixture cannot retain a warning.`);
  } else {
    assert.equal(scenario.expectedStatus, 'REVIEW_REQUIRED');
    assert.ok(scenario.expectedWarnings.length > 0, `${scenario.id} Review-required status needs a warning.`);
  }
}

assert.deepEqual([...representedYears].sort(), ['2025', '2026'], 'The oracle must span the deterministic 2025 and 2026 fixture years.');

const scenario = id => oracle.scenarios.find(candidate => candidate.id === id);
assert.equal(scenario('A3').checkpoints[0].netOperatingMinor, 0, 'The credit-card charge must be offset before payment.');
assert.equal(scenario('A4').checkpoints[0].operatingAssetAdjustmentsMinor, -20000, 'Uncollected A/R must reduce Operating cash flow.');
assert.deepEqual(scenario('A12').expectedWarnings, ['RESTRICTED_CASH_PRESENT', 'UNCLASSIFIED_CASH_ACTIVITY', 'CASH_FLOW_DIFFERENCE_NONZERO']);
assert.equal(scenario('A13').expectedTotals.differenceMinor, -25000);
assert.equal(scenario('A14').expectedTotals.unclassifiedCashActivityMinor, -3000);

const fiscalCompany = companies.profiles.find(profile => profile.companyId === scenario('A16').companyId);
assert.equal(fiscalCompany.fiscalYearStartMonth, 7);
assert.deepEqual(scenario('A16').period, { preset: 'FISCAL_YEAR', startDate: '2025-07-01', endDate: '2026-06-30' });
assert.deepEqual(scenario('A18').outputs, ['SCREEN', 'SUMMARY_CSV', 'STATEMENT_XLSX', 'DETAIL_XLSX', 'CLASSIFICATIONS_XLSX', 'PRINT_PREVIEW', 'PDF']);
assert.equal(scenario('A19').renameExpectation.amountsUnchanged, true);
assert.ok(scenario('A19').renameExpectation.rowId.includes(scenario('A19').renameExpectation.stableAccountId));

const migration = scenario('A20').migrationExpectations;
assert.equal(new Set(migration.map(item => item.id)).size, migration.length);
assert.ok(migration.some(item => item.cashRole === 'CASH' && item.treatment === 'CASH_BALANCE'));
assert.ok(migration.some(item => item.cashRole === 'CASH_EQUIVALENT'));
assert.ok(migration.some(item => item.cashRole === 'RESTRICTED_CASH'));
assert.ok(migration.some(item => item.treatment === 'NONCASH_PNL_ADJUSTMENT'));
assert.ok(migration.some(item => item.status === 'REVIEW_REQUIRED'));
for (const pair of scenario('A20').nameIndependencePairs) {
  const left = migration.find(item => item.id === pair.leftId);
  assert.ok(left);
  assert.equal(left.accountRole, pair.rightStructure.accountRole);
  assert.equal(left.accountType, pair.rightStructure.accountType);
  assert.equal(left.detailType, pair.rightStructure.detailType);
  assert.ok(pair.rightName && !JSON.stringify(pair.rightStructure).includes(pair.rightName));
}

const fixtureText = `${JSON.stringify(oracle)}\n${JSON.stringify(companies)}`.toLowerCase();
for (const forbidden of ['john walters', 'annette', 'left shoulder', 'accounting project', 'bofa checking', 'amex card', 'chase cc']) {
  assert.equal(fixtureText.includes(forbidden), false, `Cash Flow fixture contains private-looking text: ${forbidden}`);
}

console.log(`Cash Flow fixture oracle passed: ${companies.profiles.length} companies, ${oracle.scenarios.length} scenarios, schema-${currentSchemaVersion} baseline, 2025-2026 coverage; browser production acceptance gate follows.`);
