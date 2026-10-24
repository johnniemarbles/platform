import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { check, type ArchitectureConfig, type SdkGroup } from './check.ts';

const SDKS = ['stripe', 'razorpay', 'twilio', 'openai', '@anthropic-ai/', '@aws-sdk/client-ses*', '@sendgrid/'];
const IDENTITY = ['@clerk/', '@aws-sdk/client-cognito-identity-provider'];
const providers = (allowedPaths: string[] = []): SdkGroup => ({ name: 'provider', packages: SDKS, allowedPaths });
const identity = (allowedPaths: string[] = []): SdkGroup => ({ name: 'identity', packages: IDENTITY, allowedPaths });

function repo(files: Record<string, string | object>): string {
  const root = mkdtempSync(join(tmpdir(), 'arch-check-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

const pkg = (name: string, deps: Record<string, string> = {}) => ({
  name,
  scripts: { typecheck: 'tsc --noEmit', test: 'node --test' },
  dependencies: deps,
});

const monorepoConfig: ArchitectureConfig = {
  zones: [
    {
      name: 'hub',
      pathPrefix: 'hub/',
      mayDependOnZones: ['hub'],
      sdkGroupsAllowed: ['provider'],
    },
    {
      name: 'core-foundation',
      pathPrefix: 'core/packages/',
      packages: ['@platform-core/iam', '@platform-core/tenancy'],
      mayDependOnZones: ['core-foundation'],
      allowedCrossZonePackages: ['@platform-hub/contracts'],
    },
    {
      name: 'core-modules',
      pathPrefix: 'core/packages/',
      packagesNotIn: 'core-foundation',
      mayDependOnZones: ['core-foundation'],
      allowedCrossZonePackages: ['@platform-hub/contracts'],
    },
    {
      name: 'core-app-packs',
      pathPrefix: 'core/app-packs/',
      mayDependOnZones: ['core-foundation', 'core-modules'],
      allowedCrossZonePackages: ['@platform-hub/contracts'],
      forbidDependingOnSameZone: true,
    },
    {
      name: 'core-apps',
      pathPrefix: 'core/apps/',
      mayDependOnZones: ['core-foundation', 'core-modules', 'core-app-packs'],
      allowedCrossZonePackages: ['@platform-hub/contracts'],
    },
    {
      name: 'core-ui',
      pathPrefix: 'core/ui/',
      mayDependOnZones: ['core-ui', 'core-sdk'],
    },
    {
      name: 'core-sdk',
      pathPrefix: 'core/sdk/',
      mayDependOnZones: ['core-sdk'],
    },
  ],
  sdkGroups: [
    providers(),
    identity(['core/packages/iam']),
  ],
  forbiddenPackages: ['@spoke/'],
  permissionChecks: true,
  turboRequired: true,
};

const rules = (root: string, cfg: ArchitectureConfig) => check(root, cfg).map((v) => `${v.rule}:${v.file}`);

test('module -> module dependency fails (Plan rule 2)', () => {
  const root = repo({
    'turbo.json': {},
    'core/packages/crm/package.json': pkg('@platform-core/crm'),
    'core/packages/scheduling/package.json': pkg('@platform-core/scheduling', { '@platform-core/crm': 'workspace:*' }),
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['workspace-deps:core/packages/scheduling/package.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('app-pack -> app-pack fails (forbidDependingOnSameZone)', () => {
  const root = repo({
    'turbo.json': {},
    'core/app-packs/dentex/package.json': pkg('@platform-app-packs/dentex'),
    'core/app-packs/tress/package.json': pkg('@platform-app-packs/tress', { '@platform-app-packs/dentex': 'workspace:*' }),
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['workspace-deps:core/app-packs/tress/package.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core-apps -> @platform-hub/provider-registry fails', () => {
  const root = repo({
    'turbo.json': {},
    'hub/packages/provider-registry/package.json': pkg('@platform-hub/provider-registry'),
    'core/apps/platform-api/package.json': pkg('@platform-core/platform-api', { '@platform-hub/provider-registry': 'workspace:*' }),
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['workspace-deps:core/apps/platform-api/package.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core-apps -> @platform-hub/contracts passes', () => {
  const root = repo({
    'turbo.json': {},
    'hub/packages/contracts/package.json': pkg('@platform-hub/contracts'),
    'core/apps/platform-api/package.json': pkg('@platform-core/platform-api', { '@platform-hub/contracts': 'workspace:*' }),
  });
  try {
    assert.deepEqual(check(root, monorepoConfig), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider SDK in core/ fails and in hub/ passes', () => {
  const root = repo({
    'turbo.json': {},
    'hub/packages/adapters/package.json': pkg('@platform-hub/adapters', { stripe: '^17.0.0' }),
    'hub/packages/adapters/src/index.ts': `import Stripe from 'stripe';\n`,
    'core/packages/crm/package.json': pkg('@platform-core/crm', { stripe: '^17.0.0' }),
    'core/packages/crm/src/index.ts': `import Stripe from 'stripe';\n`,
  });
  try {
    const found = rules(root, monorepoConfig).sort();
    assert.deepEqual(found, [
      'provider-sdk:core/packages/crm/package.json',
      'provider-sdk:core/packages/crm/src/index.ts',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fetch() in core/ui fails', () => {
  const root = repo({
    'turbo.json': {},
    'core/ui/components/package.json': pkg('@platform-ui/components'),
    'core/ui/components/src/Button.tsx': `export function Button() { fetch('/api/test'); return null; }\n`,
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['ui-purity:core/ui/components/src/Button.tsx']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a package outside every zone fails', () => {
  const root = repo({
    'turbo.json': {},
    'unknown/package/package.json': pkg('unknown-pkg'),
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['zone:unknown/package/package.json']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relative import escaping core/ into hub/ fails', () => {
  const root = repo({
    'turbo.json': {},
    'core/packages/iam/package.json': pkg('@platform-core/iam'),
    'hub/packages/contracts/package.json': pkg('@platform-hub/contracts'),
    'core/packages/iam/src/index.ts': `import { x } from '../../../../hub/packages/contracts/src/index.ts';\n`,
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['workspace-deps:core/packages/iam/src/index.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('role-name and user-ID checks are flagged; permission checks and tests are not', () => {
  const root = repo({
    'turbo.json': {},
    'core/packages/crm/package.json': pkg('@platform-core/crm'),
    'core/packages/crm/src/a.ts': [
      `if (user.role === 'admin') {}`,
      `if ('owner' === member.role) {}`,
      `if (auth.hasRole('manager')) {}`,
      `if (roles.includes('staff')) {}`,
      `if (userId === 'usr_9f8e7d6c') {}`,
      `if (can(ctx, 'crm.deal.read')) {}`,
      `// arch-check: allow-role-name (display label only)`,
      `const label = role === 'owner' ? 'Owner' : 'Member';`,
    ].join('\n'),
    'core/packages/crm/test/a.test.ts': `assert(user.role === 'admin');\n`,
  });
  try {
    const lines = check(root, monorepoConfig).filter((v) => v.rule === 'permission-check').map((v) => v.line);
    assert.deepEqual(lines, [1, 2, 3, 4, 5]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('core-ui may import types only from core-sdk; runtime import fails', () => {
  const root = repo({
    'turbo.json': {},
    'core/ui/components/package.json': pkg('@platform-ui/components', { '@platform-sdk/scheduling': 'workspace:*' }),
    'core/sdk/scheduling/package.json': pkg('@platform-sdk/scheduling'),
    'core/ui/components/src/TypeOnly.tsx': `import type { Booking } from '@platform-sdk/scheduling'; export type B = Booking;\n`,
    'core/ui/components/src/Runtime.tsx': `import { schedulingClient } from '@platform-sdk/scheduling'; export const c = schedulingClient;\n`,
  });
  try {
    assert.deepEqual(rules(root, monorepoConfig), ['ui-purity:core/ui/components/src/Runtime.tsx']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
