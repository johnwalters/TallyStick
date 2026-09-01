import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseMetadata = JSON.parse(readFileSync(path.join(siteDirectory, 'release-metadata.json'), 'utf8'));
if (typeof releaseMetadata.releaseVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(releaseMetadata.releaseVersion)
  || !Number.isSafeInteger(releaseMetadata.buildNumber) || releaseMetadata.buildNumber < 1) {
  throw new Error('Invalid release-metadata.json. Run the release metadata validation before packaging.');
}
const outputDirectory = path.join(siteDirectory, 'release');
const iconSource = path.join(siteDirectory, 'TallyStick1.png');
const iconWorkDirectory = mkdtempSync(path.join(tmpdir(), 'tallystick-icon-'));
const iconPath = path.join(iconWorkDirectory, 'TallyStick.icns');
const iconComposerPath = path.join(iconWorkDirectory, 'TallyStick.icon');

const iconChunks = [];
for (const [chunkType, size] of [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
]) {
  const pngPath = path.join(iconWorkDirectory, `${size}.png`);
  const conversion = spawnSync('sips', ['-z', String(size), String(size), iconSource, '--out', pngPath], { stdio: 'ignore' });
  if (conversion.status !== 0) throw new Error(`Unable to create the ${size}px icon from ${iconSource}.`);
  const png = readFileSync(pngPath);
  const chunk = Buffer.allocUnsafe(png.length + 8);
  chunk.write(chunkType, 0, 4, 'ascii');
  chunk.writeUInt32BE(chunk.length, 4);
  png.copy(chunk, 8);
  iconChunks.push(chunk);
}
const iconHeader = Buffer.allocUnsafe(8);
iconHeader.write('icns', 0, 4, 'ascii');
iconHeader.writeUInt32BE(8 + iconChunks.reduce((total, chunk) => total + chunk.length, 0), 4);
writeFileSync(iconPath, Buffer.concat([iconHeader, ...iconChunks]));

// Electron Packager on macOS 26+ supports Icon Composer's `.icon` bundle in
// addition to the legacy `.icns` resource. Supply both formats so the package
// has a native icon on current macOS and does not emit a missing-format warning.
const iconAssetsDirectory = path.join(iconComposerPath, 'Assets');
mkdirSync(iconAssetsDirectory, { recursive: true });
copyFileSync(path.join(iconWorkDirectory, '1024.png'), path.join(iconAssetsDirectory, 'TallyStick.png'));
writeFileSync(path.join(iconComposerPath, 'icon.json'), `${JSON.stringify({
  groups: [{
    layers: [{
      'image-name': 'TallyStick.png',
      name: 'TallyStick',
    }],
  }],
  'supported-platforms': {
    squares: 'shared',
  },
}, null, 2)}\n`);

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
  appVersion: releaseMetadata.releaseVersion,
  buildVersion: String(releaseMetadata.buildNumber),
  extendInfo: {
    CFBundleShortVersionString: releaseMetadata.releaseVersion,
    CFBundleVersion: String(releaseMetadata.buildNumber),
  },
  icon: [iconPath, iconComposerPath],
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

console.log(`Packaged TallyStick v${releaseMetadata.releaseVersion}.${String(releaseMetadata.buildNumber).padStart(4, '0')}: ${appPaths.join(', ')}`);
rmSync(iconWorkDirectory, { recursive: true, force: true });
