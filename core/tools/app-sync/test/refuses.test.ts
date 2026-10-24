import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncGenerator } from '../src/generator/generator.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');
const fixtureManifest = resolve(import.meta.dirname, 'fixtures/demo/platform.app.json');

test('generator refuses: removed field -> error', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'refuse-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    // Initial sync
    syncGenerator({ manifestPath: fixtureManifest, appDir: tempApp, platformRoot: tempPlatform });

    // Remove field priceMinor
    const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
    delete manifest.entities[0].fields.priceMinor;
    const updatedManifestPath = resolve(tempDir, 'platform.app.json');
    writeFileSync(updatedManifestPath, JSON.stringify(manifest, null, 2));

    assert.throws(
      () => syncGenerator({ manifestPath: updatedManifestPath, appDir: tempApp, platformRoot: tempPlatform }),
      /removed field 'priceMinor'/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generator refuses: retyped field -> error', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'refuse-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    syncGenerator({ manifestPath: fixtureManifest, appDir: tempApp, platformRoot: tempPlatform });

    // Change durationMinutes from integer to text
    const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
    manifest.entities[0].fields.durationMinutes = { type: 'text' };
    const updatedManifestPath = resolve(tempDir, 'platform.app.json');
    writeFileSync(updatedManifestPath, JSON.stringify(manifest, null, 2));

    assert.throws(
      () => syncGenerator({ manifestPath: updatedManifestPath, appDir: tempApp, platformRoot: tempPlatform }),
      /retyped field 'durationMinutes'/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generator refuses: new required field without default -> error', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'refuse-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    syncGenerator({ manifestPath: fixtureManifest, appDir: tempApp, platformRoot: tempPlatform });

    // Add new required field
    const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
    manifest.entities[0].fields.sku = { type: 'text', required: true };
    const updatedManifestPath = resolve(tempDir, 'platform.app.json');
    writeFileSync(updatedManifestPath, JSON.stringify(manifest, null, 2));

    assert.throws(
      () => syncGenerator({ manifestPath: updatedManifestPath, appDir: tempApp, platformRoot: tempPlatform }),
      /new required field 'sku'.*must have a default/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('generator refuses: unknown module -> error from validate', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'refuse-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
    manifest.modules = [{ id: 'nonexistent-mod', version: '^0.1.0' }];
    const updatedManifestPath = resolve(tempDir, 'platform.app.json');
    writeFileSync(updatedManifestPath, JSON.stringify(manifest, null, 2));

    assert.throws(
      () => syncGenerator({ manifestPath: updatedManifestPath, appDir: tempApp, platformRoot: tempPlatform }),
      /unknown module/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
