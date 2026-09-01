import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { incrementBuild, readReleaseMetadata, withReleaseMetadataLock, writeAppBuildModule, writeReleaseMetadata } from './release-metadata.mjs';

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadataPath = path.join(siteDirectory, 'release-metadata.json');
const appBuildModulePath = path.join(siteDirectory, 'src', 'shared', 'app-build.ts');
const lockPath = path.join(siteDirectory, '.release-metadata.lock');
const metadata = withReleaseMetadataLock(lockPath, () => {
  const next = incrementBuild(readReleaseMetadata(metadataPath));
  writeReleaseMetadata(metadataPath, next);
  writeAppBuildModule(appBuildModulePath, next);
  return next;
});
console.log(`Packaging TallyStick v${metadata.releaseVersion}.${String(metadata.buildNumber).padStart(4, '0')}`);
