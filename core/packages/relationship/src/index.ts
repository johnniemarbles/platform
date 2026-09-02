/**
 * @platform-core/relationship — horizontal business-relationship primitives.
 *
 * Relationships are authoritative domain edges. Workflow participants are
 * projections of these edges when a process needs an actor; the workflow
 * assignment table is never the source of truth for the business relation.
 */

export const RELATIONSHIP_CARDINALITIES = [
  'ONE',
  'ZERO_OR_ONE',
  'ONE_OR_MORE',
  'ZERO_OR_MORE',
] as const;
export type RelationshipCardinality = (typeof RELATIONSHIP_CARDINALITIES)[number];

export const RELATIONSHIP_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_PROVENANCE_SOURCES = [
  'USER',
  'SYSTEM',
  'PACK',
  'IMPORT',
  'INTEGRATION',
] as const;
export type RelationshipProvenanceSource =
  (typeof RELATIONSHIP_PROVENANCE_SOURCES)[number];

export interface EntityReference {
  readonly entityType: string;
  readonly entityId: string;
}

export interface RelationshipDefinition {
  readonly key: string;
  readonly label: string;
  readonly sourceEntityType: string;
  readonly targetEntityTypes: readonly string[];
  readonly cardinality: RelationshipCardinality;
}

export interface EntityRelationship {
  readonly relationshipId: string;
  readonly tenantId: string;
  readonly source: EntityReference;
  readonly relationshipKey: string;
  readonly target: EntityReference;
  readonly status: RelationshipStatus;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly provenanceSource: RelationshipProvenanceSource;
  readonly createdBySubjectId: string;
  readonly updatedBySubjectId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class RelationshipValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RelationshipValidationError';
    this.code = code;
  }
}

function nonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new RelationshipValidationError(
      'RELATIONSHIP_FIELD_REQUIRED',
      `${field} must not be blank.`,
    );
  }
  return normalized;
}

export function validateRelationshipDefinition(
  definition: RelationshipDefinition,
): RelationshipDefinition {
  const key = nonBlank(definition.key, 'key');
  const label = nonBlank(definition.label, 'label');
  const sourceEntityType = nonBlank(definition.sourceEntityType, 'sourceEntityType');
  if (!RELATIONSHIP_CARDINALITIES.includes(definition.cardinality)) {
    throw new RelationshipValidationError(
      'RELATIONSHIP_CARDINALITY_INVALID',
      'Unknown relationship cardinality.',
    );
  }

  const targetEntityTypes = [...new Set(
    definition.targetEntityTypes.map((value) => nonBlank(value, 'targetEntityType')),
  )];
  if (targetEntityTypes.length === 0) {
    throw new RelationshipValidationError(
      'RELATIONSHIP_TARGET_TYPE_REQUIRED',
      'At least one target entity type is required.',
    );
  }

  return {
    key,
    label,
    sourceEntityType,
    targetEntityTypes,
    cardinality: definition.cardinality,
  };
}

export function validateRelationshipTarget(
  definition: RelationshipDefinition,
  target: EntityReference,
): EntityReference {
  const normalized = validateRelationshipDefinition(definition);
  const entityType = nonBlank(target.entityType, 'target.entityType');
  const entityId = nonBlank(target.entityId, 'target.entityId');

  if (!normalized.targetEntityTypes.includes(entityType)) {
    throw new RelationshipValidationError(
      'RELATIONSHIP_TARGET_TYPE_NOT_ALLOWED',
      `${entityType} is not an allowed target for relationship ${normalized.key}.`,
    );
  }

  return { entityType, entityId };
}

export function isSingleCardinality(
  cardinality: RelationshipCardinality,
): boolean {
  return cardinality === 'ONE' || cardinality === 'ZERO_OR_ONE';
}

export * from './perspectives.ts';
