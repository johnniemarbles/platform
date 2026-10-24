import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { syncGenerator } from '../src/generator/generator.ts';
import { setupHarness } from '../../../apps/platform-api/test/helpers/harness.ts';

const rootDir = resolve(import.meta.dirname, '../../../..');
const fixtureManifest = resolve(import.meta.dirname, 'fixtures/demo/platform.app.json');

test('generated demo pack runs through test harness and passes all 5 tests', async () => {
  const tempApp = mkdtempSync(resolve(tmpdir(), 'demo-app-'));
  const demoPackDir = resolve(rootDir, 'core/app-packs/demo');
  const pkgPath = resolve(rootDir, 'core/apps/platform-api/package.json');
  const appPacksPath = resolve(rootDir, 'core/apps/platform-api/src/app-packs.ts');
  const initialPkg = readFileSync(pkgPath, 'utf8');
  const initialAppPacks = readFileSync(appPacksPath, 'utf8');

  try {
    syncGenerator({
      manifestPath: fixtureManifest,
      appDir: tempApp,
      platformRoot: rootDir,
    });

    const harness = await setupHarness('demo', demoPackDir);

    // 1. Viewer cannot create
    const viewer = await harness.asRole('viewer');
    const listRes = await viewer.request('GET', '/v1/apps/demo/service-menu-items');
    assert.equal(listRes.status, 200);

    const createViewerRes = await viewer.request('POST', '/v1/apps/demo/service-menu-items', {
      name: 'Quick Trim',
      durationMinutes: 15,
    });
    assert.equal(createViewerRes.status, 403);
    assert.equal(createViewerRes.body.code, 'TOKEN_SCOPE_MISMATCH');

    // 2. Owner create -> get -> patch -> archive round trip
    const owner = await harness.asRole('owner');
    const createRes = await owner.request('POST', '/v1/apps/demo/service-menu-items', {
      name: 'Full Styling',
      durationMinutes: 45,
      priceMinor: 5000,
      tags: ['hair', 'styling'],
    });
    assert.equal(createRes.status, 200);
    const id = createRes.body.result.id;
    assert.ok(id);

    const getRes = await owner.request('GET', `/v1/apps/demo/service-menu-items/${id}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.result.name, 'Full Styling');

    const patchRes = await owner.request('PATCH', `/v1/apps/demo/service-menu-items/${id}`, {
      durationMinutes: 60,
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.result.durationMinutes, 60);

    const delRes = await owner.request('DELETE', `/v1/apps/demo/service-menu-items/${id}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.result.archived, true);

    const afterGet = await owner.request('GET', `/v1/apps/demo/service-menu-items/${id}`);
    assert.equal(afterGet.status, 200);
    assert.equal(afterGet.body.result.status, 'ARCHIVED');

    // 3. Validation failure returns 400 refusal
    const badRes = await owner.request('POST', '/v1/apps/demo/service-menu-items', {
      durationMinutes: 30,
    });
    assert.equal(badRes.status, 400);
    assert.equal(badRes.body.code, 'REFUSED');

    // 4. Cross-tenant isolation
    const tenantA = await harness.asTenant('tenant-a', 'owner');
    const tenantB = await harness.asTenant('tenant-b', 'owner');

    const itemA = await tenantA.request('POST', '/v1/apps/demo/service-menu-items', {
      name: 'Tenant A Service',
      durationMinutes: 30,
    });
    assert.equal(itemA.status, 200);
    const idA = itemA.body.result.id;

    const readB = await tenantB.request('GET', `/v1/apps/demo/service-menu-items/${idA}`);
    assert.equal(readB.status, 404);

    // 5. Cross-app isolation
    const otherApp = await harness.asOtherApp('other-app');
    const otherRes = await otherApp.request('GET', '/v1/apps/demo/service-menu-items');
    assert.equal(otherRes.status, 404);

    await harness.close();
  } finally {
    writeFileSync(pkgPath, initialPkg);
    writeFileSync(appPacksPath, initialAppPacks);
    rmSync(tempApp, { recursive: true, force: true });
    rmSync(demoPackDir, { recursive: true, force: true });
  }
});
