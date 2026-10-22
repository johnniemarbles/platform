import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectivePublishingPolicy,
  routeApprovalTarget,
  DEFAULT_PUBLISHING_POLICY,
  type ApprovalRoutingClosure,
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

function policyRepo(policy: ContentPublishingPolicy | null): GovernancePolicyRepository {
  return { async resolveConfiguredPolicy() { return policy; } };
}

describe('routeApprovalTarget', () => {
  it('routes COUNTRY_BRAND_MANDATORY to the governance root, however far up it is', async () => {
    const closure: ApprovalRoutingClosure = {
      async governanceRoot(nodeId) {
        assert.equal(nodeId, 'unit-1');
        return 'brand-hq';
      },
      async territorialAuthority() {
        throw new Error('should not be called for this policy');
      },
    };

    const result = await routeApprovalTarget(
      policyRepo('COUNTRY_BRAND_MANDATORY'),
      closure,
      { nodeId: 'unit-1', tenantId: 'tenant-1' },
    );

    assert.deepEqual(result, { targetApproverNodeId: 'brand-hq', policyApplied: 'COUNTRY_BRAND_MANDATORY' });
  });

  it('routes STATE_MASTER_SIGN_OFF to the configured territorial authority', async () => {
    const closure: ApprovalRoutingClosure = {
      async governanceRoot() {
        throw new Error('should not be called for this policy');
      },
      async territorialAuthority(nodeId) {
        assert.equal(nodeId, 'unit-1');
        return 'state-master-ontario';
      },
    };

    const result = await routeApprovalTarget(
      policyRepo('STATE_MASTER_SIGN_OFF'),
      closure,
      { nodeId: 'unit-1', tenantId: 'tenant-1' },
    );

    assert.deepEqual(result, { targetApproverNodeId: 'state-master-ontario', policyApplied: 'STATE_MASTER_SIGN_OFF' });
  });

  it('falls back to the initiating node for STATE_MASTER_SIGN_OFF when no territorial authority is configured', async () => {
    const closure: ApprovalRoutingClosure = {
      async governanceRoot() { throw new Error('should not be called'); },
      async territorialAuthority() { return null; },
    };

    const result = await routeApprovalTarget(
      policyRepo('STATE_MASTER_SIGN_OFF'),
      closure,
      { nodeId: 'unit-1', tenantId: 'tenant-1' },
    );

    assert.deepEqual(result, { targetApproverNodeId: 'unit-1', policyApplied: 'STATE_MASTER_SIGN_OFF' });
  });

  it('routes LOCAL_ADMIN_SIGN_OFF and DIRECT_AUTONOMOUS to the initiating node itself', async () => {
    const closure: ApprovalRoutingClosure = {
      async governanceRoot() { throw new Error('should not be called'); },
      async territorialAuthority() { throw new Error('should not be called'); },
    };

    for (const policy of ['LOCAL_ADMIN_SIGN_OFF', 'DIRECT_AUTONOMOUS'] as const) {
      const result = await routeApprovalTarget(policyRepo(policy), closure, { nodeId: 'unit-1', tenantId: 'tenant-1' });
      assert.deepEqual(result, { targetApproverNodeId: 'unit-1', policyApplied: policy });
    }
  });

  it('applies the system default policy when no ancestor has one configured', async () => {
    const closure: ApprovalRoutingClosure = {
      async governanceRoot() { return 'brand-hq'; },
      async territorialAuthority() { throw new Error('should not be called'); },
    };

    const result = await routeApprovalTarget(policyRepo(null), closure, { nodeId: 'unit-1', tenantId: 'tenant-1' });

    assert.equal(result.policyApplied, DEFAULT_PUBLISHING_POLICY);
    assert.equal(result.targetApproverNodeId, 'brand-hq');
  });
});
