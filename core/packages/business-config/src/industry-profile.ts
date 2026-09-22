import type { BusinessConfigurationKind } from './index.ts';

export type IndustryComponentKind = Exclude<
  BusinessConfigurationKind,
  'INDUSTRY'
>;

export interface IndustryProfile {
  readonly industryKey: string;
  readonly label: string;
  readonly components: readonly IndustryProfileComponent[];
}

export interface IndustryProfileComponent {
  readonly kind: IndustryComponentKind;
  readonly key: string;
  readonly version: number;
}

export type IndustryProfileValidationCode =
  | 'INDUSTRY_KEY_INVALID'
  | 'INDUSTRY_LABEL_REQUIRED'
  | 'INDUSTRY_COMPONENT_REQUIRED'
  | 'INDUSTRY_COMPONENT_KEY_INVALID'
  | 'INDUSTRY_COMPONENT_VERSION_INVALID'
  | 'INDUSTRY_COMPONENT_DUPLICATE'
  | 'INDUSTRY_FOUNDATION_REQUIRED';

export interface IndustryProfileValidationIssue {
  readonly code: IndustryProfileValidationCode;
  readonly path: string;
}

export type IndustryProfileValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly IndustryProfileValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateIndustryProfile(
  profile: IndustryProfile,
): IndustryProfileValidationResult {
  const issues: IndustryProfileValidationIssue[] = [];
  if (!CANONICAL_KEY.test(profile.industryKey)) {
    issues.push({ code: 'INDUSTRY_KEY_INVALID', path: 'industryKey' });
  }
  if (profile.label.trim() === '') {
    issues.push({ code: 'INDUSTRY_LABEL_REQUIRED', path: 'label' });
  }
  if (profile.components.length === 0) {
    issues.push({ code: 'INDUSTRY_COMPONENT_REQUIRED', path: 'components' });
  }

  const identities = new Set<string>();
  const kinds = new Set<IndustryComponentKind>();
  profile.components.forEach((component, index) => {
    const path = `components[${index}]`;
    if (!CANONICAL_KEY.test(component.key)) {
      issues.push({
        code: 'INDUSTRY_COMPONENT_KEY_INVALID',
        path: `${path}.key`,
      });
    }
    if (!Number.isInteger(component.version) || component.version <= 0) {
      issues.push({
        code: 'INDUSTRY_COMPONENT_VERSION_INVALID',
        path: `${path}.version`,
      });
    }

    const identity = `${component.kind}:${component.key}@${component.version}`;
    if (identities.has(identity)) {
      issues.push({
        code: 'INDUSTRY_COMPONENT_DUPLICATE',
        path,
      });
    }
    identities.add(identity);
    kinds.add(component.kind);
  });

  for (const required of ['ONTOLOGY', 'TERMINOLOGY'] as const) {
    if (!kinds.has(required)) {
      issues.push({
        code: 'INDUSTRY_FOUNDATION_REQUIRED',
        path: 'components',
      });
    }
  }

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}
