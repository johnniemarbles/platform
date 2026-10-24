import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModuleChanges, type ModuleRegistry } from './check-module-change.ts';

const baseMockRegistry: ModuleRegistry = {
  registryVersion: 1,
  modules: {
    scheduling: {
      status: 'available',
      package: '@platform-core/scheduling',
      contractVersion: '0.1.0',
      summary: 'Appointment scheduling',
      permissions: ['bookings.create', 'bookings.read'],
      routes: ['POST /v1/bookings', 'GET /v1/bookings'],
      migrations: ['0012_platform_bookings.sql'],
      uiKit: null,
      bundles: {
        staff: {
          description: 'Scheduling staff',
          permissions: [
            { key: 'bookings.create', since: '0.1.0', autoGrant: true },
            { key: 'bookings.read', since: '0.1.0', autoGrant: true },
          ],
        },
      },
      sdkPackage: '@platform-sdk/scheduling',
      versions: [{ major: 1, status: 'current', sunset: null }],
    },
  },
};

const baseChangelog = `
# Scheduling Module Changelog

## 0.1.0 — 2026-10-24
### Added
- Initial appointment scheduling engine.
`;

test('rule 1: module files modified without contractVersion bump -> error', () => {
  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry: baseMockRegistry,
    changedFiles: ['core/packages/scheduling/src/index.ts'],
    changelogs: { scheduling: baseChangelog },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('contractVersion was not bumped')));
});

test('rule 1: module files modified with contractVersion bump but missing changelog -> error', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0',
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: ['core/packages/scheduling/src/index.ts'],
    changelogs: { scheduling: baseChangelog }, // changelog only has 0.1.0
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('changelog missing section for version 0.2.0')));
});

test('rule 1: refactor exemption trailer allows file modifications without bump', () => {
  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry: baseMockRegistry,
    changedFiles: ['core/packages/scheduling/src/index.ts'],
    changelogs: { scheduling: baseChangelog },
    commitMessages: ['refactor(scheduling): clean up internal code\n\nModule-Change: none (internal refactor)'],
  });

  assert.equal(result.ok, true);
  assert.ok(result.refactorSummary?.includes('internal refactor'));
});

test('rule 2: breaking removals without major bump -> error', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0', // minor bump instead of major!
        routes: ['GET /v1/bookings'], // removed POST /v1/bookings
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: ['core/apps/platform-api/src/modules/scheduling/v1/routes.ts'],
    changelogs: {
      scheduling: `## 0.2.0 — 2026-10-24\n### Removed\n- Removed POST route\n${baseChangelog}`,
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('breaking removals') && e.includes('major version was not bumped')));
});

test('rule 2: breaking removals WITH major bump -> pass', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '1.0.0', // major bump!
        routes: ['GET /v1/bookings'],
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: ['core/apps/platform-api/src/modules/scheduling/v1/routes.ts'],
    changelogs: {
      scheduling: `## 1.0.0 — 2026-10-24\n### Removed\n- Removed POST route\n${baseChangelog}`,
    },
    sdkPackages: {
      scheduling: { version: '1.0.0' },
    },
  });

  assert.equal(result.ok, true);
});

test('rule 3: existing bundle key since or autoGrant change -> error', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0',
        bundles: {
          staff: {
            description: 'Scheduling staff',
            permissions: [
              { key: 'bookings.create', since: '0.1.0', autoGrant: false }, // changed autoGrant from true to false!
              { key: 'bookings.read', since: '0.1.0', autoGrant: true },
            ],
          },
        },
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: [],
    changelogs: { scheduling: baseChangelog },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("changed 'autoGrant' from true to false")));
});

test('rule 3: new key with sensitive segment and autoGrant=true -> error', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0',
        permissions: ['bookings.create', 'bookings.read', 'bookings.delete'],
        bundles: {
          staff: {
            description: 'Scheduling staff',
            permissions: [
              { key: 'bookings.create', since: '0.1.0', autoGrant: true },
              { key: 'bookings.read', since: '0.1.0', autoGrant: true },
              { key: 'bookings.delete', since: '0.2.0', autoGrant: true }, // sensitive segment 'delete' with autoGrant: true!
            ],
          },
        },
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: [],
    changelogs: { scheduling: baseChangelog },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("has sensitive segment 'delete' and must have autoGrant: false")));
});

test('rule 4: SDK package version mismatch -> error', () => {
  const headRegistry: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0',
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseMockRegistry,
    headRegistry,
    changedFiles: ['core/packages/scheduling/src/index.ts'],
    changelogs: {
      scheduling: `## 0.2.0 — 2026-10-24\n### Added\n- Update\n${baseChangelog}`,
    },
    sdkPackages: {
      scheduling: { version: '0.1.0' }, // still 0.1.0 instead of 0.2.0!
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('does not match contractVersion 0.2.0 major.minor')));
});

test('rule 5: deprecated version removed without approval and before sunset -> error', () => {
  const baseRegistryWithDep: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        versions: [{ major: 1, status: 'deprecated', sunset: '2026-12-31' }],
      },
    },
  };

  const headRegistryNoVersions: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        versions: [], // completely removed!
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseRegistryWithDep,
    headRegistry: headRegistryNoVersions,
    changedFiles: [],
    changelogs: { scheduling: baseChangelog },
    currentDate: '2026-10-24',
    commitMessages: ['chore: remove deprecated v1'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('without sunset date passed') || e.includes('Sunset-Approved-By: Sanjeev')));
});

test('rule 5: deprecated version removed after sunset with approval -> pass', () => {
  const baseRegistryWithDep: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        versions: [{ major: 1, status: 'deprecated', sunset: '2026-10-01' }],
      },
    },
  };

  const headRegistryNoVersions: ModuleRegistry = {
    ...baseMockRegistry,
    modules: {
      ...baseMockRegistry.modules,
      scheduling: {
        ...baseMockRegistry.modules['scheduling']!,
        versions: [],
      },
    },
  };

  const result = checkModuleChanges({
    baseRegistry: baseRegistryWithDep,
    headRegistry: headRegistryNoVersions,
    changedFiles: [],
    changelogs: { scheduling: baseChangelog },
    currentDate: '2026-10-24',
    commitMessages: ['chore: remove deprecated v1\n\nSunset-Approved-By: Sanjeev'],
  });

  assert.equal(result.ok, true);
});
