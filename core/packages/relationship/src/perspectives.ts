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

/**
 * Projects one authoritative edge set into the perspective needed by a
 * decision. An edge may declare allowed perspectives in attributes.perspectives;
 * absent metadata is intentionally visible in every projection for backwards
 * compatibility. The resolver never creates or mutates relationships.
 */
export function projectRelationships(
  relationships: readonly EntityRelationship[],
  perspective: RelationshipPerspective,
): PerspectiveProjection {
  const projected = relationships.filter((relationship) => {
    const values = relationship.attributes.perspectives;
    if (!Array.isArray(values) || values.length === 0) return true;
    return values.includes(perspective);
  });
  return { perspective, relationships: projected };
}

export function projectAllPerspectives(
  relationships: readonly EntityRelationship[],
): readonly PerspectiveProjection[] {
  return RELATIONSHIP_PERSPECTIVES.map((perspective) =>
    projectRelationships(relationships, perspective),
  );
}
