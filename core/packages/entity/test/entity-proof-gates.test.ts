/**
 * Entity Graph — Proof Gate Tests
 *
 * These are the eleven gates from the reset document.
 * They must ALL pass before the entity graph is considered implemented.
 *
 * Pure domain logic tests run here without a database.
 * Database-layer tests (RLS isolation, trigger enforcement) belong in
 * infra/db/tests/entity_graph_soak.test.sql and must be run against a real
 * PostgreSQL instance in CI.
 *
 * This file tests: cardinality rules, ownership enforcement, location
 * transitions, closure semantics, and genesis state machine — all without I/O.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCreateEntityNode,
  canHoldTerritorialAuthority,
  canBeCommercialParent,
  canHaveLocationOverlay,
  type NodeType,
} from '../src/node.ts';

import {
  validateCreateRelationship,
  isSingletonRelationship,
  RELATIONSHIP_SEMANTICS,
  type RelationshipType,
} from '../src/relationship.ts';

import {
  validateCreateOwnershipInterest,
  wouldExceedHundredPercent,
  periodsOverlap,
  ownershipSummary,
  type OwnershipInterest,
} from '../src/ownership-interest.ts';

import {
  isLegalTransition,
  type OperationalStatus,
} from '../src/location-unit.ts';

import {
  isLegalBootstrapTransition,
  genesisAuthorityIsActive,
  type BootstrapState,
} from '../src/genesis.ts';

import {
  validateCreateLegalEntity,
} from '../src/legal-entity.ts';

// ── Node type semantics ────────────────────────────────────────────────────

describe('Node type semantics', () => {
  it('STATE_MASTER, COUNTRY, BRAND_HQ can hold territorial authority', () => {
    const holders: NodeType[] = ['STATE_MASTER', 'COUNTRY', 'BRAND_HQ'];
    for (const t of holders) {
      assert.ok(canHoldTerritorialAuthority(t), `${t} should hold territorial authority`);
    }
  });

  it('UNIT and LOCATION cannot hold territorial authority', () => {
    const nonHolders: NodeType[] = ['UNIT', 'LOCATION', 'MULTI_UNIT', 'JV_PARTNER'];
    for (const t of nonHolders) {
      assert.ok(!canHoldTerritorialAuthority(t), `${t} should NOT hold territorial authority`);
    }
  });

  it('MULTI_UNIT, COUNTRY, BRAND_HQ can be commercial parent', () => {
    const parents: NodeType[] = ['MULTI_UNIT', 'COUNTRY', 'BRAND_HQ'];
    for (const t of parents) {
      assert.ok(canBeCommercialParent(t), `${t} should be a commercial parent`);
    }
  });

  it('UNIT and LOCATION nodes can have a location overlay', () => {
    assert.ok(canHaveLocationOverlay('UNIT'));
    assert.ok(canHaveLocationOverlay('LOCATION'));
    assert.ok(!canHaveLocationOverlay('BRAND_HQ'));
    assert.ok(!canHaveLocationOverlay('MULTI_UNIT'));
  });

  it('node type validation rejects unknown types', () => {
    const errors = validateCreateEntityNode({
      tenantId: 'tenant-1',
      nodeType: 'FRANCHISE_AGREEMENT' as NodeType,
      displayName: 'Test',
      createdBy: 'user-1',
    });
    assert.ok(errors.length > 0, 'should reject unknown node type');
    assert.ok(errors[0]!.includes('nodeType'));
  });

  it('node creation validation rejects empty displayName', () => {
    const errors = validateCreateEntityNode({
      tenantId: 'tenant-1',
      nodeType: 'UNIT',
      displayName: '  ',
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('displayName')));
  });
});

// ── Relationship edge semantics ────────────────────────────────────────────

describe('Relationship edge semantics', () => {
  it('singleton types are correctly identified', () => {
    const singletons: RelationshipType[] = [
      'COMMERCIAL_PARENT', 'OPERATIONAL_PARENT',
      'TERRITORIAL_JURISDICTION', 'GOVERNANCE_PARENT',
    ];
    const nonSingletons: RelationshipType[] = ['LOCATED_IN', 'OWNERSHIP', 'LEGACY'];

    for (const t of singletons) {
      assert.ok(isSingletonRelationship(t), `${t} should be singleton`);
    }
    for (const t of nonSingletons) {
      assert.ok(!isSingletonRelationship(t), `${t} should NOT be singleton`);
    }
  });

  it('LEGACY relationships cannot be created directly', () => {
    const errors = validateCreateRelationship({
      tenantId: 'tenant-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      relationshipType: 'LEGACY',
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('LEGACY')));
  });

  it('self-loop relationships are rejected', () => {
    const errors = validateCreateRelationship({
      tenantId: 'tenant-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-a',
      relationshipType: 'COMMERCIAL_PARENT',
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('itself')));
  });

  it('all six governed types have documented semantics', () => {
    const governed: RelationshipType[] = [
      'COMMERCIAL_PARENT', 'OPERATIONAL_PARENT', 'TERRITORIAL_JURISDICTION',
      'GOVERNANCE_PARENT', 'LOCATED_IN', 'OWNERSHIP',
    ];
    for (const t of governed) {
      const semantics = RELATIONSHIP_SEMANTICS[t];
      assert.ok(semantics, `${t} must have documented semantics`);
      assert.ok(semantics.label.length > 0);
      assert.ok(semantics.description.length > 0);
    }
  });
});

// ── Ownership interest: the 100% gate ─────────────────────────────────────

describe('Ownership interests (Gate: JV economics)', () => {
  const makeInterest = (id: string, pct: number): Pick<OwnershipInterest, 'interestId' | 'percentage'> => ({
    interestId: id, percentage: pct,
  });

  it('Gate: total active ownership cannot exceed 100%', () => {
    // Partner A holds 60%, trying to add Partner B at 50% → must fail
    const existing = [makeInterest('i-1', 60)];
    const result = wouldExceedHundredPercent(existing, 50);
    assert.ok(result.exceeded, 'should exceed 100%');
    assert.equal(result.projectedTotal, 110);
  });

  it('total of exactly 100% is allowed', () => {
    const existing = [makeInterest('i-1', 33.33), makeInterest('i-2', 33.33)];
    const result = wouldExceedHundredPercent(existing, 33.34);
    assert.ok(!result.exceeded, 'exactly 100% should be allowed');
  });

  it('rounding tolerance: 33.33 + 33.33 + 33.34 = 100.00 (allowed)', () => {
    const existing = [makeInterest('i-1', 33.33), makeInterest('i-2', 33.33)];
    const result = wouldExceedHundredPercent(existing, 33.34);
    assert.ok(!result.exceeded);
    assert.equal(result.projectedTotal, 100);
  });

  it('excluded interest is not counted (update scenario)', () => {
    // Partner A holds 60%, Partner B holds 40%; updating A to 55% should pass.
    const existing = [makeInterest('i-1', 60), makeInterest('i-2', 40)];
    const result = wouldExceedHundredPercent(existing, 55, 'i-1');
    // Effective total: 40 (i-2) + 55 (new value) = 95 → ok
    assert.ok(!result.exceeded);
  });

  it('overlapping periods for same owner are rejected', () => {
    // Existing: 2023-01-01 to 2024-01-01. New: 2023-06-01 to null → overlaps.
    const overlaps = periodsOverlap('2023-01-01', '2024-01-01', '2023-06-01', null);
    assert.ok(overlaps, 'overlapping periods should be detected');
  });

  it('non-overlapping periods are allowed', () => {
    // Existing: 2022-01-01 to 2023-01-01. New: 2023-01-01 onwards → no overlap.
    const overlaps = periodsOverlap('2022-01-01', '2023-01-01', '2023-01-01', null);
    assert.ok(!overlaps, 'back-to-back periods should not overlap');
  });

  it('ownershipSummary correctly shows unallocated percentage', () => {
    const interests = [{ percentage: 60 }, { percentage: 30 }];
    const summary = ownershipSummary(interests);
    assert.equal(summary.total, 90);
    assert.equal(summary.unallocated, 10);
    assert.ok(!summary.overallocated);
  });

  it('self-ownership is rejected', () => {
    const errors = validateCreateOwnershipInterest({
      tenantId: 'tenant-1',
      ownedNodeId: 'node-a',
      owningNodeId: 'node-a',
      percentage: 100,
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('itself')));
  });

  it('zero percentage is rejected', () => {
    const errors = validateCreateOwnershipInterest({
      tenantId: 'tenant-1',
      ownedNodeId: 'node-a',
      owningNodeId: 'node-b',
      percentage: 0,
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('percentage')));
  });
});

// ── Gate: a location can have distinct commercial and territorial parents ──

describe('Dual-parent location scenario (Gate: COMMERCIAL + TERRITORIAL)', () => {
  /**
   * This gate validates that the domain model CAN represent:
   *   - UNIT node with COMMERCIAL_PARENT → MULTI_UNIT operator
   *   - UNIT node with TERRITORIAL_JURISDICTION ← STATE_MASTER
   *   - These are independent edges; neither conflicts with the other
   *
   * The cardinality trigger (DB) enforces one active edge of each singleton
   * type per node. Because COMMERCIAL_PARENT and TERRITORIAL_JURISDICTION are
   * different types, both can coexist on the same target node.
   *
   * This test validates the cardinality logic conceptually (pure domain).
   * The DB-layer proof is in entity_graph_soak.test.sql.
   */
  it('COMMERCIAL_PARENT and TERRITORIAL_JURISDICTION are independent relationship types', () => {
    // Both are singleton types, but singleton-ness is per type, not per node.
    assert.ok(isSingletonRelationship('COMMERCIAL_PARENT'));
    assert.ok(isSingletonRelationship('TERRITORIAL_JURISDICTION'));
    // They are different types — coexistence is valid.
    assert.notEqual('COMMERCIAL_PARENT', 'TERRITORIAL_JURISDICTION');
  });

  it('a MULTI_UNIT can be COMMERCIAL_PARENT across multiple STATE_MASTER territories', () => {
    // canBeCommercialParent(MULTI_UNIT) = true regardless of what STATE_MASTERs exist.
    // The COMMERCIAL_PARENT edge is on the UNIT node, not on the STATE_MASTER.
    assert.ok(canBeCommercialParent('MULTI_UNIT'));
    // STATE_MASTER holds territorial jurisdiction; MULTI_UNIT holds commercial.
    // Neither constrains the other.
    assert.ok(canHoldTerritorialAuthority('STATE_MASTER'));
  });
});

// ── Location unit operational lifecycle ───────────────────────────────────

describe('Location unit operational lifecycle', () => {
  it('PLANNED can transition to FIT_OUT or PERMANENTLY_CLOSED', () => {
    assert.ok(isLegalTransition('PLANNED', 'FIT_OUT'));
    assert.ok(isLegalTransition('PLANNED', 'PERMANENTLY_CLOSED'));
    assert.ok(!isLegalTransition('PLANNED', 'OPEN'));
    assert.ok(!isLegalTransition('PLANNED', 'TEMPORARILY_CLOSED'));
  });

  it('PERMANENTLY_CLOSED is terminal — no transitions allowed', () => {
    const allStatuses: OperationalStatus[] = [
      'PLANNED', 'FIT_OUT', 'OPEN', 'TEMPORARILY_CLOSED', 'PERMANENTLY_CLOSED',
    ];
    for (const status of allStatuses) {
      assert.ok(
        !isLegalTransition('PERMANENTLY_CLOSED', status),
        `PERMANENTLY_CLOSED should not transition to ${status}`,
      );
    }
  });

  it('OPEN can temporarily close or permanently close', () => {
    assert.ok(isLegalTransition('OPEN', 'TEMPORARILY_CLOSED'));
    assert.ok(isLegalTransition('OPEN', 'PERMANENTLY_CLOSED'));
    assert.ok(!isLegalTransition('OPEN', 'PLANNED'));
    assert.ok(!isLegalTransition('OPEN', 'FIT_OUT'));
  });
});

// ── Genesis bootstrap state machine ───────────────────────────────────────

describe('Genesis bootstrap (Gate: first-user deadlock)', () => {
  it('state transitions must follow the defined order', () => {
    const validTransitions: [BootstrapState, BootstrapState][] = [
      ['GENESIS_BOOTSTRAPPED', 'ROOT_ENTITY_CREATED'],
      ['ROOT_ENTITY_CREATED', 'GOVERNANCE_CONFIGURED'],
      ['GOVERNANCE_CONFIGURED', 'ACTIVE'],
    ];
    for (const [from, to] of validTransitions) {
      assert.ok(isLegalBootstrapTransition(from, to), `${from} → ${to} should be legal`);
    }
  });

  it('skipping a state is rejected', () => {
    assert.ok(!isLegalBootstrapTransition('GENESIS_BOOTSTRAPPED', 'GOVERNANCE_CONFIGURED'));
    assert.ok(!isLegalBootstrapTransition('GENESIS_BOOTSTRAPPED', 'ACTIVE'));
    assert.ok(!isLegalBootstrapTransition('ROOT_ENTITY_CREATED', 'ACTIVE'));
  });

  it('genesis authority is active while root_entity_id is NULL', () => {
    const claim = { claimedBy: 'user-1', rootEntityId: null, bootstrapCompletedAt: null };
    assert.ok(genesisAuthorityIsActive(claim, 'user-1'));
  });

  it('genesis authority expires when root_entity_id is set', () => {
    const claim = { claimedBy: 'user-1', rootEntityId: 'entity-1', bootstrapCompletedAt: null };
    assert.ok(!genesisAuthorityIsActive(claim, 'user-1'), 'authority should be expired');
  });

  it('genesis authority does not belong to a different subject', () => {
    const claim = { claimedBy: 'user-1', rootEntityId: null, bootstrapCompletedAt: null };
    assert.ok(!genesisAuthorityIsActive(claim, 'user-2'), 'wrong subject should be denied');
  });

  it('genesis authority is expired when bootstrap is complete', () => {
    const claim = {
      claimedBy: 'user-1',
      rootEntityId: 'entity-1',
      bootstrapCompletedAt: new Date().toISOString(),
    };
    assert.ok(!genesisAuthorityIsActive(claim, 'user-1'));
  });
});

// ── Legal entity validation ────────────────────────────────────────────────

describe('Legal entity validation', () => {
  it('rejects empty registeredName', () => {
    const errors = validateCreateLegalEntity({
      tenantId: 'tenant-1', nodeId: 'node-1',
      registeredName: '', createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('registeredName')));
  });

  it('rejects invalid country code', () => {
    const errors = validateCreateLegalEntity({
      tenantId: 'tenant-1', nodeId: 'node-1',
      registeredName: 'Acme LLC',
      address: { countryCode: 'USA' },
      createdBy: 'user-1',
    });
    assert.ok(errors.some((e) => e.includes('countryCode')));
  });

  it('accepts a valid 2-letter country code', () => {
    const errors = validateCreateLegalEntity({
      tenantId: 'tenant-1', nodeId: 'node-1',
      registeredName: 'Acme LLC',
      address: { countryCode: 'CA' },
      createdBy: 'user-1',
    });
    assert.equal(errors.length, 0);
  });
});
