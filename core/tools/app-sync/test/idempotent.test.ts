import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncGenerator } from '../src/generator/generator.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');
const fixtureManifest = resolve(import.meta.dirname, 'fixtures/demo/platform.app.json');

test('generator sync is idempotent (second run creates 0 and updates 0 files)', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'idempotent-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    const firstRun = syncGenerator({
      manifestPath: fixtureManifest,
      appDir: tempApp,
      platformRoot: tempPlatform,
    });
    assert.ok(firstRun.created.length > 0);

    const secondRun = syncGenerator({
      manifestPath: fixtureManifest,
      appDir: tempApp,
      platformRoot: tempPlatform,
    });
    assert.equal(secondRun.created.length, 0);
    assert.equal(secondRun.updated.length, 0);
    assert.ok(secondRun.skipped.length > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
