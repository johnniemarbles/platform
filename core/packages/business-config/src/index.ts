export type BusinessConfigurationKind =
  | 'INDUSTRY'
  | 'ONTOLOGY'
  | 'TERMINOLOGY'
  | 'PERSONA'
  | 'ROLE'
  | 'RELATIONSHIP'
  | 'TEAM'
  | 'SKILL'
  | 'CERTIFICATION'
  | 'POLICY'
  | 'LIFECYCLE';

export type BusinessConfigurationScope =
  | { readonly kind: 'PLATFORM' }
  | { readonly kind: 'VERTICAL'; readonly verticalKey: string }
  | { readonly kind: 'TENANT'; readonly tenantId: string };

export interface BusinessConfigurationIdentity {
  readonly kind: BusinessConfigurationKind;
  readonly key: string;
  readonly version: number;
}

export interface BusinessConfigurationObject<
  Payload extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> extends BusinessConfigurationIdentity {
  readonly scope: BusinessConfigurationScope;
  readonly label: string;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  readonly payload: Payload;
  readonly dependencies: readonly BusinessConfigurationIdentity[];
  readonly authoredBySubjectId: string;
  readonly authoredAt: string;
}

export interface BusinessConfigurationChangeset {
  readonly changesetId: string;
  readonly scope: BusinessConfigurationScope;
  readonly expectedBaseRevision: number;
  readonly changes: readonly BusinessConfigurationObject[];
  readonly authoredBySubjectId: string;
  readonly authoredAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export function businessConfigurationIdentityKey(
  identity: BusinessConfigurationIdentity,
): string {
  return `${identity.kind}:${identity.key}@${identity.version}`;
}

export * from './changeset-validation.ts';
export * from './publication.ts';
export * from './publication-repository.ts';
export * from './publication-service.ts';
export * from './configuration-resolution.ts';
export * from './configuration-resolution-service.ts';
export * from './presentation-terminology.ts';
export * from './business-ontology.ts';
export * from './business-actors.ts';
export * from './business-competencies.ts';
export * from './business-organizations.ts';
export * from './business-lifecycle.ts';
export * from './business-policies.ts';
