import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

async function run(label, command, args) {
  process.stdout.write(`\n[Cash Flow release proof] ${label}\n`);
  const child = spawn(command, args, { cwd: siteRoot, env: process.env, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0, `${label} failed.`);
}

async function verifyPrivacy() {
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repositoryRoot });
  const textFiles = stdout.split(/\r?\n/).filter(Boolean).filter(file => /^(fixtures\/cash-flow|site\/src\/test-fixtures\/cash-flow|site\/src\/app\/(?:core|features)\/.*cash-flow|docs\/Statement of Cash Flows|README\.md)/.test(file) && /\.(?:md|json|csv|ts|html|txt)$/i.test(file));
  const forbidden = ['john walters', 'annette', 'left shoulder', '/users/john', '/volumes/external ssd', 'bofa checking', 'amex card', 'chase cc'];
  for (const file of textFiles) {
    const text = (await readFile(path.join(repositoryRoot, file), 'utf8')).toLowerCase();
    for (const term of forbidden) assert.equal(text.includes(term), false, `Release privacy scan found ${JSON.stringify(term)} in ${file}.`);
    assert.equal(/\b\d{3}-\d{2}-\d{4}\b/.test(text), false, `Release privacy scan found a tax-identifier-shaped value in ${file}.`);
  }
  process.stdout.write(`[Cash Flow release proof] privacy scan passed (${textFiles.length} tracked public/source files).\n`);
}

async function verifyReleaseInputs() {
  const canonicalPath = path.join(repositoryRoot, 'fixtures/cash-flow/baseline-oracle.json');
  const browserPath = path.join(repositoryRoot, 'site/src/test-fixtures/cash-flow/baseline-oracle.json');
  const [canonicalBytes, browserBytes] = await Promise.all([readFile(canonicalPath), readFile(browserPath)]);
  assert.deepEqual(browserBytes, canonicalBytes, 'The browser Cash Flow oracle must be byte-identical to the canonical oracle.');
  const oracle = JSON.parse(canonicalBytes.toString('utf8'));
  assert.deepEqual(oracle.scenarios.map(scenario => scenario.id), Array.from({ length: 20 }, (_value, index) => `A${index + 1}`), 'The release oracle must contain A1 through A20 in order.');
  const a18 = oracle.scenarios.find(scenario => scenario.id === 'A18');
  assert.deepEqual(a18.outputs, ['SCREEN', 'SUMMARY_CSV', 'STATEMENT_XLSX', 'DETAIL_XLSX', 'CLASSIFICATIONS_XLSX', 'PRINT_PREVIEW', 'PDF']);
  const { stdout, stderr } = await execFileAsync('git', ['diff', '--check'], { cwd: repositoryRoot });
  assert.equal(`${stdout}${stderr}`, '', 'The release diff contains whitespace errors.');
  process.stdout.write('[Cash Flow release proof] A1-A20 manifest, oracle identity, and diff checks passed.\n');
}

async function verifyNativePdf() {
  const pdfPath = path.join(tmpdir(), 'tallystick-cash-flow-preview-smoke.pdf');
  const bytes = await readFile(pdfPath);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF', 'The isolated Electron smoke artifact is not a PDF.');
  assert.ok(bytes.byteLength > 1024, 'The isolated Electron smoke PDF is unexpectedly empty.');
  process.stdout.write(`[Cash Flow release proof] native PDF passed (${bytes.byteLength} bytes at ${pdfPath}).\n`);
}

await verifyReleaseInputs();
await verifyPrivacy();
await run('full browser/unit and regression suite', 'npm', ['run', 'test:ci']);
await run('application TypeScript contract', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.app.json', '--noEmit']);
await run('specification TypeScript contract', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.spec.json', '--noEmit']);
await run('desktop TypeScript contract', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.desktop.json', '--noEmit']);
await run('production build', 'npm', ['run', 'build']);
await run('desktop host, backup/restore, and print-command suite', 'npm', ['run', 'test:desktop-host']);
await run('isolated Electron smoke with native PDF proof', 'npm', ['run', 'desktop:smoke']);
await verifyNativePdf();
console.log('Cash Flow release proof passed: A1-A20, integer/determinism/performance/no-mutation browser coverage, privacy, full regression, TypeScript, build, desktop host/backup-restore, and isolated Electron PDF smoke.');
