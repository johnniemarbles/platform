/**
 * Personas and business-role profiles describe operating responsibilities.
 * They never grant capabilities; authorization remains in the rights system.
 */
export interface BusinessActorCatalogue {
  readonly personas: readonly BusinessPersona[];
  readonly roles: readonly BusinessRoleProfile[];
}

export interface BusinessPersona {
  readonly personaKey: string;
  readonly label: string;
  readonly description: string;
}

export interface BusinessRoleProfile {
  readonly roleKey: string;
  readonly label: string;
  readonly personaKeys: readonly string[];
}

export type BusinessActorValidationCode =
  | 'BUSINESS_PERSONA_REQUIRED'
  | 'BUSINESS_PERSONA_KEY_INVALID'
  | 'BUSINESS_PERSONA_KEY_DUPLICATE'
  | 'BUSINESS_PERSONA_TEXT_REQUIRED'
  | 'BUSINESS_ROLE_KEY_INVALID'
  | 'BUSINESS_ROLE_KEY_DUPLICATE'
  | 'BUSINESS_ROLE_LABEL_REQUIRED'
  | 'BUSINESS_ROLE_PERSONA_REQUIRED'
  | 'BUSINESS_ROLE_PERSONA_DUPLICATE'
  | 'BUSINESS_ROLE_PERSONA_UNKNOWN';

export interface BusinessActorValidationIssue {
  readonly code: BusinessActorValidationCode;
  readonly path: string;
}

export type BusinessActorValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly BusinessActorValidationIssue[] };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateBusinessActorCatalogue(
  catalogue: BusinessActorCatalogue,
): BusinessActorValidationResult {
  const issues: BusinessActorValidationIssue[] = [];
  if (catalogue.personas.length === 0) {
    issues.push({ code: 'BUSINESS_PERSONA_REQUIRED', path: 'personas' });
  }

  const personaKeys = new Set<string>();
  catalogue.personas.forEach((persona, index) => {
    const path = `personas[${index}]`;
    if (!CANONICAL_KEY.test(persona.personaKey)) {
      issues.push({
        code: 'BUSINESS_PERSONA_KEY_INVALID',
        path: `${path}.personaKey`,
      });
    } else if (personaKeys.has(persona.personaKey)) {
      issues.push({
        code: 'BUSINESS_PERSONA_KEY_DUPLICATE',
        path: `${path}.personaKey`,
      });
    }
    personaKeys.add(persona.personaKey);
    if (persona.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_PERSONA_TEXT_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (persona.description.trim() === '') {
      issues.push({
        code: 'BUSINESS_PERSONA_TEXT_REQUIRED',
        path: `${path}.description`,
      });
    }
  });

  const roleKeys = new Set<string>();
  catalogue.roles.forEach((role, index) => {
    const path = `roles[${index}]`;
    if (!CANONICAL_KEY.test(role.roleKey)) {
      issues.push({
        code: 'BUSINESS_ROLE_KEY_INVALID',
        path: `${path}.roleKey`,
      });
    } else if (roleKeys.has(role.roleKey)) {
      issues.push({
        code: 'BUSINESS_ROLE_KEY_DUPLICATE',
        path: `${path}.roleKey`,
      });
    }
    roleKeys.add(role.roleKey);

    if (role.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_ROLE_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (role.personaKeys.length === 0) {
      issues.push({
        code: 'BUSINESS_ROLE_PERSONA_REQUIRED',
        path: `${path}.personaKeys`,
      });
    }

    const rolePersonas = new Set<string>();
    role.personaKeys.forEach((personaKey, personaIndex) => {
      const personaPath = `${path}.personaKeys[${personaIndex}]`;
      if (rolePersonas.has(personaKey)) {
        issues.push({
          code: 'BUSINESS_ROLE_PERSONA_DUPLICATE',
          path: personaPath,
        });
      }
      if (!personaKeys.has(personaKey)) {
        issues.push({
          code: 'BUSINESS_ROLE_PERSONA_UNKNOWN',
          path: personaPath,
        });
      }
      rolePersonas.add(personaKey);
    });
  });

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}
