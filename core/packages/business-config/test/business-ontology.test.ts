import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateBusinessOntology,
  type BusinessOntology,
} from '../src/index.ts';

const ontology: BusinessOntology = {
  nodes: [
    { conceptKey: 'person', label: 'Person' },
    { conceptKey: 'customer', label: 'Customer' },
    { conceptKey: 'appointment', label: 'Appointment' },
  ],
  relations: [
    { kind: 'IS_A', fromConceptKey: 'customer', toConceptKey: 'person' },
    {
      kind: 'RELATED_TO',
      fromConceptKey: 'customer',
      toConceptKey: 'appointment',
    },
  ],
};

test('validates neutral concept nodes and typed relationships', () => {
  assert.deepEqual(
    validateBusinessOntology(ontology),
    { valid: true, issues: [] },
  );
});

test('rejects unknown endpoints, duplicate edges, and self references', () => {
  const result = validateBusinessOntology({
    nodes: [{ conceptKey: 'person', label: 'Person' }],
    relations: [
      { kind: 'RELATED_TO', fromConceptKey: 'person', toConceptKey: 'missing' },
      { kind: 'IS_A', fromConceptKey: 'person', toConceptKey: 'person' },
      { kind: 'IS_A', fromConceptKey: 'person', toConceptKey: 'person' },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'ONTOLOGY_RELATION_ENDPOINT_UNKNOWN',
      'ONTOLOGY_RELATION_SELF_REFERENCE',
      'ONTOLOGY_RELATION_DUPLICATE',
    ]),
  );
});

test('rejects cycles across hierarchical relationship kinds', () => {
  const result = validateBusinessOntology({
    nodes: [
      { conceptKey: 'a', label: 'A' },
      { conceptKey: 'b', label: 'B' },
      { conceptKey: 'c', label: 'C' },
    ],
    relations: [
      { kind: 'IS_A', fromConceptKey: 'a', toConceptKey: 'b' },
      { kind: 'PART_OF', fromConceptKey: 'b', toConceptKey: 'c' },
      { kind: 'IS_A', fromConceptKey: 'c', toConceptKey: 'a' },
    ],
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.equal(
    result.issues.some((issue) => issue.code === 'ONTOLOGY_HIERARCHY_CYCLE'),
    true,
  );
});

test('allows non-hierarchical relationships to be reciprocal', () => {
  assert.deepEqual(
    validateBusinessOntology({
      nodes: [
        { conceptKey: 'customer', label: 'Customer' },
        { conceptKey: 'appointment', label: 'Appointment' },
      ],
      relations: [
        {
          kind: 'RELATED_TO',
          fromConceptKey: 'customer',
          toConceptKey: 'appointment',
        },
        {
          kind: 'RELATED_TO',
          fromConceptKey: 'appointment',
          toConceptKey: 'customer',
        },
      ],
    }),
    { valid: true, issues: [] },
  );
});
