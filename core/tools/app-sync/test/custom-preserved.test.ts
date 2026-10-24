import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, appendFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncGenerator } from '../src/generator/generator.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');
const fixtureManifest = resolve(import.meta.dirname, 'fixtures/demo/platform.app.json');

test('custom sections preserved and new alter migration created on field addition', () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'custom-test-'));
  const tempPlatform = resolve(tempDir, 'platform');
  const tempApp = resolve(tempDir, 'demo-app');

  try {
    cpSync(resolve(rootDir, 'core/registry'), resolve(tempPlatform, 'core/registry'), { recursive: true });
    cpSync(resolve(rootDir, 'core/apps/platform-api'), resolve(tempPlatform, 'core/apps/platform-api'), { recursive: true });

    // Initial sync
    syncGenerator({
      manifestPath: fixtureManifest,
      appDir: tempApp,
      platformRoot: tempPlatform,
    });

    // Append custom code below CUSTOM marker in route file
    const routeFile = resolve(tempPlatform, 'core/app-packs/demo/src/routes/serviceMenuItem.ts');
    const customLine = '\n// USER CUSTOM CODE: hello world\nexport const customValue = 123;\n';
    appendFileSync(routeFile, customLine);

    // Modify manifest: add a new optional field
    const manifest = JSON.parse(readFileSync(fixtureManifest, 'utf8'));
    manifest.entities[0].fields.category = { type: 'text', maxLength: 50 };
    const updatedManifestPath = resolve(tempDir, 'platform.app.json');
    writeFileSync(updatedManifestPath, JSON.stringify(manifest, null, 2));

    // Re-sync
    syncGenerator({
      manifestPath: updatedManifestPath,
      appDir: tempApp,
      platformRoot: tempPlatform,
    });

    // Assert custom line is preserved
    const updatedRouteContent = readFileSync(routeFile, 'utf8');
    assert.ok(updatedRouteContent.includes('// USER CUSTOM CODE: hello world'));
    assert.ok(updatedRouteContent.includes('export const customValue = 123;'));

    // Assert 0001 migration is intact
    assert.ok(existsSync(resolve(tempPlatform, 'core/app-packs/demo/migrations/0001_create_app_demo_service_menu_item.sql')));

    // Assert new 0002 migration was created
    const alterMigration = resolve(tempPlatform, 'core/app-packs/demo/migrations/0002_alter_app_demo_service_menu_item_add_category.sql');
    assert.ok(existsSync(alterMigration), 'Expected 0002 alter migration to exist');
    const alterContent = readFileSync(alterMigration, 'utf8');
    assert.ok(alterContent.includes('ADD COLUMN category'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
