export interface BusinessCompetencyCatalogue {
  readonly skills: readonly BusinessSkill[];
  readonly certifications: readonly BusinessCertification[];
}

export interface BusinessSkill {
  readonly skillKey: string;
  readonly label: string;
  readonly description: string;
}

export interface BusinessCertification {
  readonly certificationKey: string;
  readonly label: string;
  /** Optional renewal window. Absence means the definition does not expire. */
  readonly validityDays?: number;
}

export type BusinessCompetencyValidationCode =
  | 'BUSINESS_COMPETENCY_REQUIRED'
  | 'BUSINESS_SKILL_KEY_INVALID'
  | 'BUSINESS_SKILL_KEY_DUPLICATE'
  | 'BUSINESS_SKILL_TEXT_REQUIRED'
  | 'BUSINESS_CERTIFICATION_KEY_INVALID'
  | 'BUSINESS_CERTIFICATION_KEY_DUPLICATE'
  | 'BUSINESS_CERTIFICATION_LABEL_REQUIRED'
  | 'BUSINESS_CERTIFICATION_VALIDITY_INVALID';

export interface BusinessCompetencyValidationIssue {
  readonly code: BusinessCompetencyValidationCode;
  readonly path: string;
}

export type BusinessCompetencyValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly BusinessCompetencyValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateBusinessCompetencyCatalogue(
  catalogue: BusinessCompetencyCatalogue,
): BusinessCompetencyValidationResult {
  const issues: BusinessCompetencyValidationIssue[] = [];
  if (catalogue.skills.length === 0 && catalogue.certifications.length === 0) {
    issues.push({
      code: 'BUSINESS_COMPETENCY_REQUIRED',
      path: 'skills',
    });
  }

  const skillKeys = new Set<string>();
  catalogue.skills.forEach((skill, index) => {
    const path = `skills[${index}]`;
    if (!CANONICAL_KEY.test(skill.skillKey)) {
      issues.push({
        code: 'BUSINESS_SKILL_KEY_INVALID',
        path: `${path}.skillKey`,
      });
    } else if (skillKeys.has(skill.skillKey)) {
      issues.push({
        code: 'BUSINESS_SKILL_KEY_DUPLICATE',
        path: `${path}.skillKey`,
      });
    }
    skillKeys.add(skill.skillKey);
    if (skill.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_SKILL_TEXT_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (skill.description.trim() === '') {
      issues.push({
        code: 'BUSINESS_SKILL_TEXT_REQUIRED',
        path: `${path}.description`,
      });
    }
  });

  const certificationKeys = new Set<string>();
  catalogue.certifications.forEach((certification, index) => {
    const path = `certifications[${index}]`;
    if (!CANONICAL_KEY.test(certification.certificationKey)) {
      issues.push({
        code: 'BUSINESS_CERTIFICATION_KEY_INVALID',
        path: `${path}.certificationKey`,
      });
    } else if (certificationKeys.has(certification.certificationKey)) {
      issues.push({
        code: 'BUSINESS_CERTIFICATION_KEY_DUPLICATE',
        path: `${path}.certificationKey`,
      });
    }
    certificationKeys.add(certification.certificationKey);
    if (certification.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_CERTIFICATION_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (
      certification.validityDays !== undefined
      && (
        !Number.isInteger(certification.validityDays)
        || certification.validityDays <= 0
      )
    ) {
      issues.push({
        code: 'BUSINESS_CERTIFICATION_VALIDITY_INVALID',
        path: `${path}.validityDays`,
      });
    }
  });

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}
