/**
 * A business ontology describes domain concepts and relationships. It is not an
 * authorization graph: relation kinds cannot grant roles, rights, or access.
 */
export interface BusinessOntology {
  readonly nodes: readonly BusinessOntologyNode[];
  readonly relations: readonly BusinessOntologyRelation[];
}

export interface BusinessOntologyNode {
  readonly conceptKey: string;
  readonly label: string;
}

export type BusinessOntologyRelationKind =
  | 'IS_A'
  | 'PART_OF'
  | 'RELATED_TO';

export interface BusinessOntologyRelation {
  readonly kind: BusinessOntologyRelationKind;
  readonly fromConceptKey: string;
  readonly toConceptKey: string;
}

export type OntologyValidationCode =
  | 'ONTOLOGY_NODE_REQUIRED'
  | 'ONTOLOGY_NODE_KEY_INVALID'
  | 'ONTOLOGY_NODE_KEY_DUPLICATE'
  | 'ONTOLOGY_NODE_LABEL_REQUIRED'
  | 'ONTOLOGY_RELATION_ENDPOINT_UNKNOWN'
  | 'ONTOLOGY_RELATION_SELF_REFERENCE'
  | 'ONTOLOGY_RELATION_DUPLICATE'
  | 'ONTOLOGY_HIERARCHY_CYCLE';

export interface OntologyValidationIssue {
  readonly code: OntologyValidationCode;
  readonly path: string;
}

export type OntologyValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly OntologyValidationIssue[] };

const CONCEPT_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const HIERARCHICAL_RELATIONS: ReadonlySet<BusinessOntologyRelationKind> =
  new Set(['IS_A', 'PART_OF']);

export function validateBusinessOntology(
  ontology: BusinessOntology,
): OntologyValidationResult {
  const issues: OntologyValidationIssue[] = [];
  if (ontology.nodes.length === 0) {
    issues.push({ code: 'ONTOLOGY_NODE_REQUIRED', path: 'nodes' });
  }

  const nodes = new Set<string>();
  ontology.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!CONCEPT_KEY.test(node.conceptKey)) {
      issues.push({
        code: 'ONTOLOGY_NODE_KEY_INVALID',
        path: `${path}.conceptKey`,
      });
    } else if (nodes.has(node.conceptKey)) {
      issues.push({
        code: 'ONTOLOGY_NODE_KEY_DUPLICATE',
        path: `${path}.conceptKey`,
      });
    }
    nodes.add(node.conceptKey);
    if (node.label.trim() === '') {
      issues.push({
        code: 'ONTOLOGY_NODE_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
  });

  const relationKeys = new Set<string>();
  const hierarchy = new Map<string, string[]>();
  ontology.relations.forEach((relation, index) => {
    const path = `relations[${index}]`;
    const relationKey =
      `${relation.kind}:${relation.fromConceptKey}:${relation.toConceptKey}`;

    if (
      !nodes.has(relation.fromConceptKey)
      || !nodes.has(relation.toConceptKey)
    ) {
      issues.push({ code: 'ONTOLOGY_RELATION_ENDPOINT_UNKNOWN', path });
    }
    if (relation.fromConceptKey === relation.toConceptKey) {
      issues.push({ code: 'ONTOLOGY_RELATION_SELF_REFERENCE', path });
    }
    if (relationKeys.has(relationKey)) {
      issues.push({ code: 'ONTOLOGY_RELATION_DUPLICATE', path });
    }
    relationKeys.add(relationKey);

    if (
      HIERARCHICAL_RELATIONS.has(relation.kind)
      && relation.fromConceptKey !== relation.toConceptKey
      && nodes.has(relation.fromConceptKey)
      && nodes.has(relation.toConceptKey)
    ) {
      const adjacent = hierarchy.get(relation.fromConceptKey) ?? [];
      adjacent.push(relation.toConceptKey);
      hierarchy.set(relation.fromConceptKey, adjacent);
    }
  });

  if (containsCycle(nodes, hierarchy)) {
    issues.push({ code: 'ONTOLOGY_HIERARCHY_CYCLE', path: 'relations' });
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

function containsCycle(
  nodes: ReadonlySet<string>,
  graph: ReadonlyMap<string, readonly string[]>,
): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const adjacent of graph.get(node) ?? []) {
      if (visit(adjacent)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of nodes) {
    if (visit(node)) return true;
  }
  return false;
}
