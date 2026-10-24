import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncGenerator } from '../src/generator/generator.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');
const fixtureManifest = resolve(import.meta.dirname, 'fixtures/demo/platform.app.json');
const goldenDir = resolve(import.meta.dirname, 'golden');

test('generator output matches golden files byte for byte', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'golden-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    // Copy minimal platform root structure
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    syncGenerator({
      manifestPath: fixtureManifest,
      appDir: tempApp,
      platformRoot: tempPlatform,
    });

    const checks = [
      {
        actual: resolve(tempPlatform, 'core/app-packs/demo/migrations/0001_create_app_demo_service_menu_item.sql'),
        golden: resolve(goldenDir, 'core/app-packs/demo/migrations/0001_create_app_demo_service_menu_item.sql'),
      },
      {
        actual: resolve(tempPlatform, 'core/app-packs/demo/src/routes/serviceMenuItem.ts'),
        golden: resolve(goldenDir, 'core/app-packs/demo/src/routes/serviceMenuItem.ts'),
      },
      {
        actual: resolve(tempPlatform, 'core/app-packs/demo/test/serviceMenuItem.test.ts'),
        golden: resolve(goldenDir, 'core/app-packs/demo/test/serviceMenuItem.test.ts'),
      },
      {
        actual: resolve(tempApp, 'apps/web/src/platform/generated/serviceMenuItem.ts'),
        golden: resolve(goldenDir, 'app/apps/web/src/platform/generated/serviceMenuItem.ts'),
      },
      {
        actual: resolve(tempApp, 'apps/web/src/platform/generated/index.ts'),
        golden: resolve(goldenDir, 'app/apps/web/src/platform/generated/index.ts'),
      },
    ];

    for (const { actual, golden } of checks) {
      const actualContent = readFileSync(actual, 'utf8');
      const goldenContent = readFileSync(golden, 'utf8');
      assert.equal(actualContent, goldenContent, `Mismatch in ${actual}`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
