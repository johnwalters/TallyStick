import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReleaseIncrease, assertReleaseMetadata, incrementBuild } from './release-metadata.mjs';

test('validates release metadata and increments only the build number', () => {
  const current = assertReleaseMetadata({ releaseVersion: '0.4.0', buildNumber: 41 });
  assert.deepEqual(incrementBuild(current), { releaseVersion: '0.4.0', buildNumber: 42 });
  assert.throws(() => assertReleaseMetadata({ releaseVersion: '0.4', buildNumber: 1 }), /major\.minor\.patch/);
  assert.throws(() => assertReleaseMetadata({ releaseVersion: '0.4.0', buildNumber: 0 }), /positive integer/);
});

test('accepts only forward numeric release versions', () => {
  assert.equal(assertReleaseIncrease('0.4.0', '0.4.1'), '0.4.1');
  assert.equal(assertReleaseIncrease('0.4.9', '0.5.0'), '0.5.0');
  assert.throws(() => assertReleaseIncrease('0.4.0', '0.4.0'), /must be greater/);
  assert.throws(() => assertReleaseIncrease('0.4.0', '0.3.9'), /must be greater/);
});
