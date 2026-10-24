import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSingleCardinality,
  validateRelationshipDefinition,
  validateRelationshipTarget,
} from '../src/index.ts';

test('relationship definitions are vertical-neutral and normalize vocabulary', () => {
  const definition = validateRelationshipDefinition({
    key: ' driver ',
    label: ' Assigned driver ',
    sourceEntityType: ' shipment ',
    targetEntityTypes: [' worker ', 'worker'],
    cardinality: 'ZERO_OR_ONE',
  });

  assert.deepEqual(definition, {
    key: 'driver',
    label: 'Assigned driver',
    sourceEntityType: 'shipment',
    targetEntityTypes: ['worker'],
    cardinality: 'ZERO_OR_ONE',
  });
  assert.equal(isSingleCardinality(definition.cardinality), true);
});

test('relationship target types are constrained by the definition', () => {
  const definition = {
    key: 'broker',
    label: 'Broker',
    sourceEntityType: 'property',
    targetEntityTypes: ['party.person'],
    cardinality: 'ZERO_OR_MORE',
  } as const;

  assert.deepEqual(
    validateRelationshipTarget(definition, {
      entityType: 'party.person',
      entityId: 'person-1',
    }),
    { entityType: 'party.person', entityId: 'person-1' },
  );

  assert.throws(
    () => validateRelationshipTarget(definition, {
      entityType: 'iam.subject',
      entityId: 'subject-1',
    }),
    /not an allowed target/,
  );
});
