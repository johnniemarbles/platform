import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadRegistry } from '../src/registry.ts';
import { validateManifest, validateStrict } from '../src/validate.ts';
import type { AppManifest, ModuleRegistry } from '../src/types.ts';

const platformRoot = resolve(import.meta.dirname, '../../../..');

const mockRegistry: ModuleRegistry = {
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
          description: 'Scheduling staff permissions',
          permissions: [
            { key: 'bookings.create', since: '0.1.0', autoGrant: true },
            { key: 'bookings.read', since: '0.1.0', autoGrant: true },
          ],
        },
      },
    },
    crm: {
      status: 'library',
      package: '@platform-core/lead',
      contractVersion: '0.1.0',
      summary: 'CRM library',
      permissions: [],
      routes: [],
      migrations: [],
      uiKit: null,
      bundles: {},
    },
    'crm-advanced': {
      status: 'planned',
      package: '@platform-core/crm',
      contractVersion: '0.0.0',
      summary: 'Planned CRM',
      permissions: [],
      routes: [],
      migrations: [],
      uiKit: null,
      bundles: {},
    },
  },
};

const baseValidManifest: AppManifest = {
  manifestVersion: 1,
  appId: 'app_test',
  slug: 'test-app',
  displayName: 'Test App',
  modules: [{ id: 'scheduling', version: '^0.1.0' }],
  entities: [
    {
      name: 'itemPreference',
      cardinality: 'one-per-person',
      fields: {
        prefCode: { type: 'text', maxLength: 50, enum: ['A', 'B'] },
        score: { type: 'integer', min: 1, max: 10 },
      },
    },
  ],
  identityClients: {
    dev: [{ provider: 'dev', poolId: 'dev', clientId: 'test-client' }],
  },
};

test('valid manifest passes validation with no errors or warnings', () => {
  const problems = validateManifest(baseValidManifest, mockRegistry);
  assert.equal(problems.length, 0);
});

test('rule 1: unknown module produces error', () => {
  const manifest: AppManifest = {
    ...baseValidManifest,
    modules: [{ id: 'non-existent', version: '1.0.0' }],
  };
  const problems = validateManifest(manifest, mockRegistry);
  const err = problems.find((p) => p.level === 'error' && p.message === 'unknown module');
  assert.ok(err, 'Expected unknown module error');
  assert.equal(err.path, 'modules[0].id');
});

test('rule 2: planned module produces error; library produces warning', () => {
  const manifestPlanned: AppManifest = {
    ...baseValidManifest,
    modules: [{ id: 'crm-advanced', version: '^0.0.0' }],
  };
  const problemsPlanned = validateManifest(manifestPlanned, mockRegistry);
  const plannedErr = problemsPlanned.find((p) => p.level === 'error' && p.message === 'module not available yet');
  assert.ok(plannedErr, 'Expected module not available yet error');

  const manifestLib: AppManifest = {
    ...baseValidManifest,
    modules: [{ id: 'crm', version: '^0.1.0' }],
  };
  const problemsLib = validateManifest(manifestLib, mockRegistry);
  const libWarn = problemsLib.find((p) => p.level === 'warning' && p.message.includes('no HTTP routes yet'));
  assert.ok(libWarn, 'Expected library warning');
});

test('rule 3: contract version drift produces error', () => {
  const manifest: AppManifest = {
    ...baseValidManifest,
    modules: [{ id: 'scheduling', version: '^0.2.0' }],
  };
  const problems = validateManifest(manifest, mockRegistry);
  const err = problems.find((p) => p.level === 'error' && p.message === 'contract version drift');
  assert.ok(err, 'Expected contract version drift error');
});

test('rule 4: duplicate entity name and table name length check', () => {
  const manifestDup: AppManifest = {
    ...baseValidManifest,
    entities: [
      { name: 'item', cardinality: 'many', fields: {} },
      { name: 'item', cardinality: 'many', fields: {} },
    ],
  };
  const problemsDup = validateManifest(manifestDup, mockRegistry);
  assert.ok(problemsDup.some((p) => p.message.includes("duplicate entity name 'item'")));

  const veryLongName = 'a'.repeat(60);
  const manifestLong: AppManifest = {
    ...baseValidManifest,
    entities: [{ name: veryLongName, cardinality: 'many', fields: {} }],
  };
  const problemsLong = validateManifest(manifestLong, mockRegistry);
  assert.ok(problemsLong.some((p) => p.message.includes('exceeds 63 characters')));
});

test('rule 5: field validation for enum, maxLength, min, max', () => {
  const manifest: AppManifest = {
    ...baseValidManifest,
    entities: [
      {
        name: 'invalidFields',
        cardinality: 'many',
        fields: {
          badEnum: { type: 'integer', enum: ['1', '2'] },
          badMaxLength: { type: 'boolean', maxLength: 10 },
          badMin: { type: 'text', min: 0 },
          badMax: { type: 'timestamptz', max: 100 },
        },
      },
    ],
  };
  const problems = validateManifest(manifest, mockRegistry);
  assert.ok(problems.some((p) => p.path.includes('badEnum') && p.message.includes('enum only allowed on \'text\'')));
  assert.ok(problems.some((p) => p.path.includes('badMaxLength') && p.message.includes('maxLength only allowed on \'text\'')));
  assert.ok(problems.some((p) => p.path.includes('badMin') && p.message.includes('min only allowed')));
  assert.ok(problems.some((p) => p.path.includes('badMax') && p.message.includes('max only allowed')));
});

test('rule 6: entity name matching module concept produces warning', () => {
  const manifest: AppManifest = {
    ...baseValidManifest,
    entities: [
      { name: 'booking', cardinality: 'many', fields: {} },
    ],
  };
  const problems = validateManifest(manifest, mockRegistry);
  const warn = problems.find((p) => p.level === 'warning' && p.message.includes('this looks like module data'));
  assert.ok(warn, 'Expected reserved module concept warning');
});

test('rule 7: empty identityClients produces error', () => {
  const manifestEmpty: AppManifest = {
    ...baseValidManifest,
    identityClients: {},
  };
  const problems = validateManifest(manifestEmpty, mockRegistry);
  assert.ok(problems.some((p) => p.path === 'identityClients' && p.level === 'error'));
});

test('loadRegistry successfully parses and validates core/registry/modules.json', () => {
  const registry = loadRegistry(platformRoot);
  assert.equal(registry.registryVersion, 1);
  assert.ok(registry.modules['scheduling']);
  assert.ok(registry.modules['crm']);
  assert.ok(registry.modules['gtm']);
  assert.ok(registry.modules['learning']);
  assert.ok(registry.modules['communication']);
});

test('validateStrict: module deprecated with sunset within 60 days produces error', () => {
  const regWithSunset: ModuleRegistry = {
    ...mockRegistry,
    modules: {
      ...mockRegistry.modules,
      scheduling: {
        ...mockRegistry.modules['scheduling']!,
        versions: [{ major: 0, status: 'deprecated', sunset: '2026-11-01' }],
      },
    },
  };
  const problems = validateStrict({
    manifest: baseValidManifest,
    registry: regWithSunset,
    appDir: '/tmp/fake-app',
    platformDir: platformRoot,
    now: new Date('2026-10-24'),
  });
  assert.ok(problems.some((p) => p.level === 'error' && p.message.includes('within 60 days')));
});

test('validateStrict: registry ahead by minor produces warning with changelog notes', () => {
  const regAhead: ModuleRegistry = {
    ...mockRegistry,
    modules: {
      ...mockRegistry.modules,
      scheduling: {
        ...mockRegistry.modules['scheduling']!,
        contractVersion: '0.2.0',
      },
    },
  };
  const problems = validateStrict({
    manifest: {
      ...baseValidManifest,
      modules: [{ id: 'scheduling', version: '^0.1.0' }],
    },
    registry: regAhead,
    appDir: '/tmp/fake-app',
    platformDir: platformRoot,
    now: new Date('2026-10-24'),
  });
  assert.ok(problems.some((p) => p.level === 'warning' && p.message.includes('registry is ahead')));
});

