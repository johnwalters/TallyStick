import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/app/', import.meta.url));
const desktopRoot = fileURLToPath(new URL('../src/desktop-host/', import.meta.url));
const indexPath = fileURLToPath(new URL('../src/index.html', import.meta.url));
const appConfigPath = fileURLToPath(new URL('../src/app/app.config.ts', import.meta.url));
const desktopMainPath = fileURLToPath(new URL('../src/desktop-host/main.ts', import.meta.url));

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const violations = [];
for (const file of await filesUnder(root)) {
  const source = await readFile(file, 'utf8');
  const relativePath = relative(root, file);
  if (relativePath.startsWith('ui/') || relativePath === 'app.component.ts') {
    if (/from ['"].*repository|from ['"].*sqlite|from ['"].*import-services|from ['"].*desktop-host/.test(source)) violations.push(`UI bypass: ${relativePath}`);
  }
}
for (const file of await filesUnder(desktopRoot)) {
  const source = await readFile(file, 'utf8');
  if (/from ['"].*src\/app|from ['"].*application-services|from ['"].*import-services|from ['"].*domain-model/.test(source)) violations.push(`Desktop host imports application logic: ${relative(desktopRoot, file)}`);
}

const indexSource = await readFile(indexPath, 'utf8');
if (!/<base\s+href=["']\.\/index\.html["']/.test(indexSource)) {
  violations.push('Desktop renderer requires <base href="./index.html"> for file:// assets and reload-safe routing.');
}

const appConfigSource = await readFile(appConfigPath, 'utf8');
if (!appConfigSource.includes('withHashLocation()')) {
  violations.push('Desktop-compatible Angular routing requires withHashLocation() so file:// reloads return to index.html.');
}

const desktopMainSource = await readFile(desktopMainPath, 'utf8');
const desktopMainCode = desktopMainSource.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
if (desktopMainCode.includes('process.cwd()')) {
  violations.push('Desktop host resource paths must not depend on process.cwd().');
}
if (!desktopMainSource.includes("event.returnValue = { ok: true }") || !desktopMainSource.includes("event.returnValue = { ok: false")) {
  violations.push('Synchronous SQLite writes must always return a success or error response to the renderer.');
}
if (!desktopMainSource.includes('databaseStore.persistAndReplace')) {
  violations.push('Successful renderer SQLite writes must also replace the Electron host image so reload cannot restore stale state.');
}
if (!desktopMainSource.includes('app.disableHardwareAcceleration()')) {
  violations.push('Desktop host must use software rendering to avoid blank macOS compositor frames.');
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log('Application and desktop dependency boundaries passed.');
