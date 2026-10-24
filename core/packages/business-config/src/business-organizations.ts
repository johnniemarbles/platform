/**
 * Teams and relationships model operating structure only. Membership and
 * relationships do not imply any authorization capability.
 */
export interface BusinessOrganizationCatalogue {
  readonly teams: readonly BusinessTeam[];
  readonly relationships: readonly BusinessRoleRelationship[];
}

export interface BusinessTeam {
  readonly teamKey: string;
  readonly label: string;
  readonly roleKeys: readonly string[];
}

export type BusinessRoleRelationshipKind =
  | 'REPORTS_TO'
  | 'COLLABORATES_WITH'
  | 'SERVES';

export interface BusinessRoleRelationship {
  readonly relationshipKey: string;
  readonly label: string;
  readonly kind: BusinessRoleRelationshipKind;
  readonly fromRoleKey: string;
  readonly toRoleKey: string;
}

export type BusinessOrganizationValidationCode =
  | 'BUSINESS_TEAM_KEY_INVALID'
  | 'BUSINESS_TEAM_KEY_DUPLICATE'
  | 'BUSINESS_TEAM_LABEL_REQUIRED'
  | 'BUSINESS_TEAM_ROLE_REQUIRED'
  | 'BUSINESS_TEAM_ROLE_DUPLICATE'
  | 'BUSINESS_ROLE_REFERENCE_UNKNOWN'
  | 'BUSINESS_RELATIONSHIP_KEY_INVALID'
  | 'BUSINESS_RELATIONSHIP_KEY_DUPLICATE'
  | 'BUSINESS_RELATIONSHIP_LABEL_REQUIRED'
  | 'BUSINESS_RELATIONSHIP_SELF_REFERENCE'
  | 'BUSINESS_REPORTING_CYCLE';

export interface BusinessOrganizationValidationIssue {
  readonly code: BusinessOrganizationValidationCode;
  readonly path: string;
}

export type BusinessOrganizationValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly BusinessOrganizationValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateBusinessOrganizationCatalogue(
  catalogue: BusinessOrganizationCatalogue,
  knownRoleKeys: ReadonlySet<string>,
): BusinessOrganizationValidationResult {
  const issues: BusinessOrganizationValidationIssue[] = [];
  const teamKeys = new Set<string>();

  catalogue.teams.forEach((team, index) => {
    const path = `teams[${index}]`;
    if (!CANONICAL_KEY.test(team.teamKey)) {
      issues.push({
        code: 'BUSINESS_TEAM_KEY_INVALID',
        path: `${path}.teamKey`,
      });
    } else if (teamKeys.has(team.teamKey)) {
      issues.push({
        code: 'BUSINESS_TEAM_KEY_DUPLICATE',
        path: `${path}.teamKey`,
      });
    }
    teamKeys.add(team.teamKey);

    if (team.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_TEAM_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (team.roleKeys.length === 0) {
      issues.push({
        code: 'BUSINESS_TEAM_ROLE_REQUIRED',
        path: `${path}.roleKeys`,
      });
    }

    const teamRoles = new Set<string>();
    team.roleKeys.forEach((roleKey, roleIndex) => {
      const rolePath = `${path}.roleKeys[${roleIndex}]`;
      if (teamRoles.has(roleKey)) {
        issues.push({
          code: 'BUSINESS_TEAM_ROLE_DUPLICATE',
          path: rolePath,
        });
      }
      if (!knownRoleKeys.has(roleKey)) {
        issues.push({
          code: 'BUSINESS_ROLE_REFERENCE_UNKNOWN',
          path: rolePath,
        });
      }
      teamRoles.add(roleKey);
    });
  });

  const relationshipKeys = new Set<string>();
  const reporting = new Map<string, string[]>();
  catalogue.relationships.forEach((relationship, index) => {
    const path = `relationships[${index}]`;
    if (!CANONICAL_KEY.test(relationship.relationshipKey)) {
      issues.push({
        code: 'BUSINESS_RELATIONSHIP_KEY_INVALID',
        path: `${path}.relationshipKey`,
      });
    } else if (relationshipKeys.has(relationship.relationshipKey)) {
      issues.push({
        code: 'BUSINESS_RELATIONSHIP_KEY_DUPLICATE',
        path: `${path}.relationshipKey`,
      });
    }
    relationshipKeys.add(relationship.relationshipKey);

    if (relationship.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_RELATIONSHIP_LABEL_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (relationship.fromRoleKey === relationship.toRoleKey) {
      issues.push({
        code: 'BUSINESS_RELATIONSHIP_SELF_REFERENCE',
        path,
      });
    }
    for (const [endpoint, roleKey] of [
      ['fromRoleKey', relationship.fromRoleKey],
      ['toRoleKey', relationship.toRoleKey],
    ] as const) {
      if (!knownRoleKeys.has(roleKey)) {
        issues.push({
          code: 'BUSINESS_ROLE_REFERENCE_UNKNOWN',
          path: `${path}.${endpoint}`,
        });
      }
    }

    if (
      relationship.kind === 'REPORTS_TO'
      && relationship.fromRoleKey !== relationship.toRoleKey
      && knownRoleKeys.has(relationship.fromRoleKey)
      && knownRoleKeys.has(relationship.toRoleKey)
    ) {
      const managers = reporting.get(relationship.fromRoleKey) ?? [];
      managers.push(relationship.toRoleKey);
      reporting.set(relationship.fromRoleKey, managers);
    }
  });

  if (containsCycle(knownRoleKeys, reporting)) {
    issues.push({
      code: 'BUSINESS_REPORTING_CYCLE',
      path: 'relationships',
    });
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
