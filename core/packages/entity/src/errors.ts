export type EntityErrorCode =
  | 'NODE_NOT_FOUND'
  | 'NODE_TYPE_IMMUTABLE'
  | 'NODE_DISSOLVED'
  | 'RELATIONSHIP_CARDINALITY_VIOLATION'
  | 'RELATIONSHIP_SELF_LOOP'
  | 'RELATIONSHIP_LEGACY_CREATE_REJECTED'
  | 'OWNERSHIP_OVERAGE'
  | 'OWNERSHIP_PERIOD_OVERLAP'
  | 'LEGAL_ENTITY_ALREADY_ACTIVE'
  | 'LOCATION_UNIT_ALREADY_EXISTS'
  | 'LOCATION_TRANSITION_ILLEGAL'
  | 'BRAND_HQ_ALREADY_EXISTS';

export class EntityError extends Error {
  readonly code: EntityErrorCode;
  constructor(code: EntityErrorCode, message: string) {
    super(message);
    this.name = 'EntityError';
    this.code = code;
  }
}
