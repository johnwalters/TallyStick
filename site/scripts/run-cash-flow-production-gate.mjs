import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const ngCli = path.join(siteRoot, 'node_modules/@angular/cli/bin/ng.js');
const acceptanceInclude = process.env.CASH_FLOW_ACCEPTANCE_INCLUDE ?? '**/cash-flow-report.service.spec.ts';
const expectedTestCount = Number(process.env.CASH_FLOW_EXPECTED_TEST_COUNT ?? 36);
const args = [
  ngCli,
  'test',
  '--watch=false',
  '--browsers=ChromeHeadless',
  `--include=${acceptanceInclude}`,
];

const output = [];
const child = spawn(process.execPath, args, {
  cwd: siteRoot,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', chunk => {
  const text = chunk.toString();
  output.push(text);
  process.stdout.write(text);
});
child.stderr.on('data', chunk => {
  const text = chunk.toString();
  output.push(text);
  process.stderr.write(text);
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
assert.equal(exitCode, 0, 'The production Cash Flow acceptance harness failed.');

const result = output.join('').match(/TOTAL:\s+(\d+)\s+SUCCESS/);
assert.ok(result, 'The production Cash Flow acceptance harness did not report a passing TOTAL.');
assert.equal(Number(result[1]), expectedTestCount, 'The production Cash Flow acceptance harness test count changed; required acceptance coverage may be disabled or removed.');

console.log(`Cash Flow production acceptance gate passed: ${result[1]} service tests executed against the canonical baseline oracle.`);
