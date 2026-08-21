import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const readText = relativePath => readFile(path.join(repositoryRoot, relativePath), 'utf8');
const readJson = async relativePath => JSON.parse(await readText(relativePath));
const csvRowCount = async relativePath => (await readText(relativePath)).trim().split(/\r?\n/).length - 1;

const [oracle, companies, expectedResults, schemaSource] = await Promise.all([
  readJson('fixtures/balance-sheet/baseline-oracle.json'),
  readJson('fixtures/balance-sheet/company-fixtures.json'),
  readJson('sample-data/expected/expected-results.json'),
  readText('site/src/shared/schema-version.ts'),
]);

assert.equal(oracle.moneyUnit, 'INTEGER_MINOR_UNITS');
const currentSchemaVersion = Number(schemaSource.match(/CURRENT_SQLITE_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
assert.equal(oracle.schema5Baseline.databaseSchemaVersion, currentSchemaVersion, 'Baseline schema version must match the application.');

const expectedCounts = oracle.schema5Baseline.counts;
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

for (const [date, totals] of Object.entries(oracle.schema5Baseline.canonicalReports)) {
  const expected = expectedResults.balanceSheets[date];
  assert.ok(expected, `Missing canonical report ${date}.`);
  assert.deepEqual(totals, {
    totalAssetsMinor: expected.totalAssetsMinor,
    totalLiabilitiesMinor: expected.totalLiabilitiesMinor,
    totalEquityMinor: expected.totalEquityMinor,
    differenceMinor: expected.differenceMinor,
  });
  assert.equal(totals.totalAssetsMinor - totals.totalLiabilitiesMinor - totals.totalEquityMinor, totals.differenceMinor);
}

assert.equal(companies.profiles.length, 2, 'Exactly two neutral company fixtures are required for the baseline.');
for (const field of ['companyId', 'legalName', 'displayName', 'address', 'fiscalYearStartMonth', 'institutions', 'financialAccountNames']) {
  assert.notDeepEqual(companies.profiles[0][field], companies.profiles[1][field], `Company fixtures must differ in ${field}.`);
}
for (const profile of companies.profiles) {
  assert.ok(profile.legalName.trim());
  assert.ok(profile.displayName.trim());
  assert.ok(profile.address.line1.trim());
  assert.ok(profile.address.locality.trim());
  assert.ok(Number.isInteger(profile.fiscalYearStartMonth) && profile.fiscalYearStartMonth >= 1 && profile.fiscalYearStartMonth <= 12);
  assert.ok(profile.institutions.length >= 2);
  assert.ok(profile.financialAccountNames.length >= 3);
}

const requiredScenarioIds = Array.from({ length: 19 }, (_, index) => `A${index + 1}`);
assert.deepEqual(oracle.scenarios.map(scenario => scenario.id), requiredScenarioIds);

const assertMinorUnits = (value, location) => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertMinorUnits(item, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/Minor$/.test(key)) assert.ok(Number.isSafeInteger(item), `${location}.${key} must be an integer minor-unit value.`);
    else assertMinorUnits(item, `${location}.${key}`);
  }
};
assertMinorUnits(oracle, 'oracle');

for (const scenario of oracle.scenarios) {
  const totals = scenario.expectedTotals;
  for (const [field, amount] of Object.entries(totals)) {
    assert.ok(Number.isSafeInteger(amount), `${scenario.id} ${field} must be an integer minor-unit value.`);
  }
  assert.equal(
    totals.totalAssetsMinor - totals.totalLiabilitiesMinor - totals.totalEquityMinor,
    totals.differenceMinor,
    `${scenario.id} accounting equation must reconcile exactly.`,
  );
  assert.equal(scenario.expectedRows['total-assets'], totals.totalAssetsMinor);
  assert.equal(scenario.expectedRows['total-liabilities'], totals.totalLiabilitiesMinor);
  assert.equal(scenario.expectedRows['total-equity'], totals.totalEquityMinor);
  assert.equal(scenario.expectedRows.difference, totals.differenceMinor);
  assert.deepEqual(Object.keys(scenario.detailGroups).sort(), Object.keys(scenario.expectedRows).sort(), `${scenario.id} must define detail for every expected money row.`);
  for (const [rowKey, contributions] of Object.entries(scenario.detailGroups)) {
    assert.equal(new Set(contributions.map(contribution => contribution.sourceId)).size, contributions.length, `${scenario.id} ${rowKey} detail must not duplicate a contribution.`);
    const detailTotal = contributions.reduce((sum, contribution) => {
      assert.ok(contribution.sourceId, `${scenario.id} ${rowKey} contribution requires a source ID.`);
      assert.ok(Number.isSafeInteger(contribution.amountMinor), `${scenario.id} ${rowKey} contribution must use integer minor units.`);
      return sum + contribution.amountMinor;
    }, 0);
    assert.equal(detailTotal, scenario.expectedRows[rowKey], `${scenario.id} ${rowKey} detail must reconcile exactly.`);
  }
}

const a13 = oracle.scenarios.find(scenario => scenario.id === 'A13');
assert.deepEqual(a13.expectedTotals, {
  totalAssetsMinor: expectedResults.balanceSheets['2026-08-31'].totalAssetsMinor,
  totalLiabilitiesMinor: expectedResults.balanceSheets['2026-08-31'].totalLiabilitiesMinor,
  totalEquityMinor: expectedResults.balanceSheets['2026-08-31'].totalEquityMinor,
  differenceMinor: expectedResults.balanceSheets['2026-08-31'].differenceMinor,
});
assert.deepEqual(a13.outputs, ['SCREEN', 'SUMMARY_CSV', 'SUMMARY_XLSX', 'DETAIL_XLSX', 'PRINT_PREVIEW', 'PDF']);

const fixtureText = `${JSON.stringify(oracle)}\n${JSON.stringify(companies)}`.toLowerCase();
for (const forbidden of ['john walters', 'annette', 'left shoulder', 'accounting project']) {
  assert.equal(fixtureText.includes(forbidden), false, `Fixture contains private-looking text: ${forbidden}`);
}

console.log(`Balance Sheet fixture oracle passed: ${companies.profiles.length} companies, ${oracle.scenarios.length} scenarios, schema ${currentSchemaVersion}.`);
