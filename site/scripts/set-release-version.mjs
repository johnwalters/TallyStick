import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseIncrease, readReleaseMetadata, writeAppBuildModule, writeReleaseMetadata } from './release-metadata.mjs';

const requestedVersion = process.argv[2];
if (!requestedVersion || process.argv.length !== 3) throw new Error('Usage: npm run release:set-version -- 0.4.1');
const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadataPath = path.join(siteDirectory, 'release-metadata.json');
const appBuildModulePath = path.join(siteDirectory, 'src', 'shared', 'app-build.ts');
const current = readReleaseMetadata(metadataPath);
const next = { ...current, releaseVersion: assertReleaseIncrease(current.releaseVersion, requestedVersion) };
writeReleaseMetadata(metadataPath, next);
writeAppBuildModule(appBuildModulePath, next);
console.log(`Set TallyStick release version to v${next.releaseVersion}; next package build will be ${next.buildNumber + 1}.`);
