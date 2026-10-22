import type { EntityRelationship } from './index.ts';

export const RELATIONSHIP_PERSPECTIVES = [
  'GOVERNANCE',
  'OWNERSHIP_LEGAL',
  'COMMERCIAL',
  'TERRITORY_JURISDICTION',
  'OPERATIONAL',
] as const;
export type RelationshipPerspective = (typeof RELATIONSHIP_PERSPECTIVES)[number];

export interface PerspectiveProjection {
  readonly perspective: RelationshipPerspective;
  readonly relationships: readonly EntityRelationship[];
}

export function isRelationshipPerspective(
  value: unknown,
): value is RelationshipPerspective {
  return typeof value === 'string'
    && (RELATIONSHIP_PERSPECTIVES as readonly string[]).includes(value);
}

/**
 * Projects authoritative relationship edges into one decision perspective.
 *
 * Unclassified legacy edges are excluded by default. Callers may opt into
 * them only for migration/diagnostic surfaces; governed decisions must use
 * the default fail-closed behavior.
 */
export function projectRelationships(
  relationships: readonly EntityRelationship[],
  perspective: RelationshipPerspective,
  options: { readonly includeUnclassified?: boolean } = {},
): PerspectiveProjection {
  const projected = relationships.filter((relationship) =>
    relationship.perspective === perspective
    || (options.includeUnclassified === true && relationship.perspective === null),
  );
  return { perspective, relationships: projected };
}

export function projectAllPerspectives(
  relationships: readonly EntityRelationship[],
): readonly PerspectiveProjection[] {
  return RELATIONSHIP_PERSPECTIVES.map((perspective) =>
    projectRelationships(relationships, perspective),
  );
}
