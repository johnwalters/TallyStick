import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertReleaseMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Release metadata must be an object.');
  const { releaseVersion, buildNumber } = value;
  if (typeof releaseVersion !== 'string' || !SEMVER.test(releaseVersion)) throw new Error('releaseVersion must use numeric major.minor.patch form, for example 0.4.0.');
  if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) throw new Error('buildNumber must be a positive integer.');
  return { releaseVersion, buildNumber };
}

export function readReleaseMetadata(metadataPath) {
  try { return assertReleaseMetadata(JSON.parse(readFileSync(metadataPath, 'utf8'))); }
  catch (error) { throw new Error(`Unable to read release metadata at ${metadataPath}: ${error instanceof Error ? error.message : 'unknown error'}`); }
}

export function writeReleaseMetadata(metadataPath, metadata) {
  writeAtomically(metadataPath, `${JSON.stringify(assertReleaseMetadata(metadata), null, 2)}\n`);
}

export function incrementBuild(metadata) {
  const verified = assertReleaseMetadata(metadata);
  if (verified.buildNumber === Number.MAX_SAFE_INTEGER) throw new Error('buildNumber cannot be incremented further.');
  return { ...verified, buildNumber: verified.buildNumber + 1 };
}

export function assertReleaseIncrease(currentVersion, requestedVersion) {
  if (typeof requestedVersion !== 'string' || !SEMVER.test(requestedVersion)) throw new Error('Release version must use numeric major.minor.patch form, for example 0.4.1.');
  const current = currentVersion.split('.').map(Number);
  const requested = requestedVersion.split('.').map(Number);
  for (let index = 0; index < current.length; index += 1) {
    if (requested[index] > current[index]) return requestedVersion;
    if (requested[index] < current[index]) break;
  }
  throw new Error(`Release version ${requestedVersion} must be greater than the current ${currentVersion}.`);
}

export function writeAppBuildModule(modulePath, metadata) {
  const verified = assertReleaseMetadata(metadata);
  writeAtomically(modulePath, `// Generated from release-metadata.json by scripts/prepare-desktop-build.mjs.\n// It is tracked so browser development and tests always have build metadata.\nexport const APP_RELEASE_VERSION = '${verified.releaseVersion}';\nexport const APP_BUILD_NUMBER = ${verified.buildNumber};\n`);
}

export function withReleaseMetadataLock(lockPath, work) {
  let descriptor;
  try { descriptor = openSync(lockPath, 'wx'); }
  catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') throw new Error('A desktop package build is already preparing release metadata. Wait for it to finish and retry.');
    throw error;
  }
  try { return work(); }
  finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(lockPath); } catch { /* preserve the original result */ }
  }
}

function writeAtomically(targetPath, contents) {
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* preserve the original write failure */ }
    throw error;
  }
}
