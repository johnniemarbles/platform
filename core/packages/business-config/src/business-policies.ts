/**
 * Business policies are declarative governance statements. They contain no
 * executable expressions, secrets, credentials, or authorization grants.
 */
export interface BusinessPolicyCatalogue {
  readonly policies: readonly BusinessPolicy[];
}

export type BusinessPolicyDisposition =
  | 'ADVISORY'
  | 'MANDATORY'
  | 'PROHIBITED';

export interface BusinessPolicy {
  readonly policyKey: string;
  readonly label: string;
  readonly statement: string;
  readonly disposition: BusinessPolicyDisposition;
  readonly appliesToConceptKeys: readonly string[];
}

export type BusinessPolicyValidationCode =
  | 'BUSINESS_POLICY_REQUIRED'
  | 'BUSINESS_POLICY_KEY_INVALID'
  | 'BUSINESS_POLICY_KEY_DUPLICATE'
  | 'BUSINESS_POLICY_TEXT_REQUIRED'
  | 'BUSINESS_POLICY_TARGET_REQUIRED'
  | 'BUSINESS_POLICY_TARGET_DUPLICATE'
  | 'BUSINESS_POLICY_TARGET_UNKNOWN';

export interface BusinessPolicyValidationIssue {
  readonly code: BusinessPolicyValidationCode;
  readonly path: string;
}

export type BusinessPolicyValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly BusinessPolicyValidationIssue[];
    };

const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export function validateBusinessPolicyCatalogue(
  catalogue: BusinessPolicyCatalogue,
  knownConceptKeys: ReadonlySet<string>,
): BusinessPolicyValidationResult {
  const issues: BusinessPolicyValidationIssue[] = [];
  if (catalogue.policies.length === 0) {
    issues.push({ code: 'BUSINESS_POLICY_REQUIRED', path: 'policies' });
  }

  const policyKeys = new Set<string>();
  catalogue.policies.forEach((policy, index) => {
    const path = `policies[${index}]`;
    if (!CANONICAL_KEY.test(policy.policyKey)) {
      issues.push({
        code: 'BUSINESS_POLICY_KEY_INVALID',
        path: `${path}.policyKey`,
      });
    } else if (policyKeys.has(policy.policyKey)) {
      issues.push({
        code: 'BUSINESS_POLICY_KEY_DUPLICATE',
        path: `${path}.policyKey`,
      });
    }
    policyKeys.add(policy.policyKey);

    if (policy.label.trim() === '') {
      issues.push({
        code: 'BUSINESS_POLICY_TEXT_REQUIRED',
        path: `${path}.label`,
      });
    }
    if (policy.statement.trim() === '') {
      issues.push({
        code: 'BUSINESS_POLICY_TEXT_REQUIRED',
        path: `${path}.statement`,
      });
    }
    if (policy.appliesToConceptKeys.length === 0) {
      issues.push({
        code: 'BUSINESS_POLICY_TARGET_REQUIRED',
        path: `${path}.appliesToConceptKeys`,
      });
    }

    const targets = new Set<string>();
    policy.appliesToConceptKeys.forEach((conceptKey, conceptIndex) => {
      const targetPath =
        `${path}.appliesToConceptKeys[${conceptIndex}]`;
      if (targets.has(conceptKey)) {
        issues.push({
          code: 'BUSINESS_POLICY_TARGET_DUPLICATE',
          path: targetPath,
        });
      }
      if (!knownConceptKeys.has(conceptKey)) {
        issues.push({
          code: 'BUSINESS_POLICY_TARGET_UNKNOWN',
          path: targetPath,
        });
      }
      targets.add(conceptKey);
    });
  });

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}
