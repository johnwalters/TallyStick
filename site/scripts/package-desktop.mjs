import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(siteDirectory, 'release');
const iconSource = path.join(siteDirectory, 'TallyStick1.png');
const iconWorkDirectory = mkdtempSync(path.join(tmpdir(), 'tallystick-icon-'));
const iconsetDirectory = path.join(iconWorkDirectory, 'TallyStick.iconset');
const iconPath = path.join(iconWorkDirectory, 'TallyStick.icns');

mkdirSync(iconsetDirectory);
for (const [fileName, size] of [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]) {
  const conversion = spawnSync('sips', ['-z', String(size), String(size), iconSource, '--out', path.join(iconsetDirectory, fileName)], { stdio: 'ignore' });
  if (conversion.status !== 0) throw new Error(`Unable to create ${fileName} from ${iconSource}.`);
}
const iconCompilation = spawnSync('iconutil', ['-c', 'icns', iconsetDirectory, '-o', iconPath], { stdio: 'inherit' });
if (iconCompilation.status !== 0) throw new Error(`Unable to create the macOS icon from ${iconSource}.`);

const appPaths = await packager({
  dir: siteDirectory,
  name: 'TallyStick',
  platform: 'darwin',
  arch: process.arch,
  out: outputDirectory,
  overwrite: true,
  prune: true,
  appBundleId: 'io.tallystick.desktop',
  appCategoryType: 'public.app-category.finance',
  icon: iconPath,
  ignore: [
    /^\/\.angular(?:\/|$)/,
    /^\/coverage(?:\/|$)/,
    /^\/release(?:\/|$)/,
    /^\/src(?:\/|$)/,
  ],
});

for (const appDirectory of appPaths) {
  const appBundle = path.join(appDirectory, 'TallyStick.app');
  const signing = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appBundle], { stdio: 'inherit' });
  if (signing.status !== 0) throw new Error(`Unable to apply the local macOS signature to ${appBundle}.`);
}

console.log(`Packaged TallyStick: ${appPaths.join(', ')}`);
rmSync(iconWorkDirectory, { recursive: true, force: true });
