import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectivePublishingPolicy,
  DEFAULT_PUBLISHING_POLICY,
  type ContentPublishingPolicy,
  type GovernancePolicyRepository,
} from '../src/governance-policy.ts';

describe('resolveEffectivePublishingPolicy', () => {
  it('returns the repository-configured policy when one exists', async () => {
    const repo: GovernancePolicyRepository = {
      async resolveConfiguredPolicy(): Promise<ContentPublishingPolicy | null> {
        return 'LOCAL_ADMIN_SIGN_OFF';
      },
    };

    const policy = await resolveEffectivePublishingPolicy(repo, {
      nodeId: 'node-1',
      tenantId: 'tenant-1',
    });

    assert.equal(policy, 'LOCAL_ADMIN_SIGN_OFF');
  });

  it('falls back to the system default when no ancestor has one configured', async () => {
    const repo: GovernancePolicyRepository = {
      async resolveConfiguredPolicy(): Promise<ContentPublishingPolicy | null> {
        return null;
      },
    };

    const policy = await resolveEffectivePublishingPolicy(repo, {
      nodeId: 'node-1',
      tenantId: 'tenant-1',
    });

    assert.equal(policy, DEFAULT_PUBLISHING_POLICY);
    assert.equal(policy, 'COUNTRY_BRAND_MANDATORY');
  });

  it('passes nodeId and tenantId through to the repository unchanged', async () => {
    const seen: Array<{ nodeId: string; tenantId: string }> = [];
    const repo: GovernancePolicyRepository = {
      async resolveConfiguredPolicy(nodeId, tenantId) {
        seen.push({ nodeId, tenantId });
        return null;
      },
    };

    await resolveEffectivePublishingPolicy(repo, { nodeId: 'node-42', tenantId: 'tenant-9' });

    assert.deepEqual(seen, [{ nodeId: 'node-42', tenantId: 'tenant-9' }]);
  });
});
