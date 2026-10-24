/**
 * Presentation terminology changes display text only. Canonical concept keys,
 * authorization roles, permissions, and persisted identities remain unchanged.
 */
export interface PresentationTerminologyCatalogue {
  readonly defaultLocale: string;
  readonly concepts: readonly PresentationTerminologyConcept[];
}

export interface PresentationTerminologyConcept {
  readonly conceptKey: string;
  readonly labels: readonly PresentationTerminologyLabel[];
  readonly aliases?: readonly string[];
}

export interface PresentationTerminologyLabel {
  readonly locale: string;
  readonly singular: string;
  readonly plural: string;
}

export type TerminologyValidationCode =
  | 'TERMINOLOGY_DEFAULT_LOCALE_REQUIRED'
  | 'TERMINOLOGY_CONCEPT_REQUIRED'
  | 'TERMINOLOGY_CONCEPT_KEY_INVALID'
  | 'TERMINOLOGY_CONCEPT_KEY_DUPLICATE'
  | 'TERMINOLOGY_LABEL_REQUIRED'
  | 'TERMINOLOGY_LOCALE_INVALID'
  | 'TERMINOLOGY_LOCALE_DUPLICATE'
  | 'TERMINOLOGY_DEFAULT_LOCALE_LABEL_REQUIRED'
  | 'TERMINOLOGY_LABEL_TEXT_REQUIRED'
  | 'TERMINOLOGY_ALIAS_INVALID'
  | 'TERMINOLOGY_ALIAS_DUPLICATE';

export interface TerminologyValidationIssue {
  readonly code: TerminologyValidationCode;
  readonly path: string;
}

export type TerminologyValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly TerminologyValidationIssue[] };

export interface ResolvedPresentationTerm {
  /** Stable identity used by application logic and authorization. */
  readonly conceptKey: string;
  /** Locale actually selected after default-locale fallback. */
  readonly locale: string;
  readonly text: string;
}

const CONCEPT_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function validatePresentationTerminology(
  catalogue: PresentationTerminologyCatalogue,
): TerminologyValidationResult {
  const issues: TerminologyValidationIssue[] = [];
  const defaultLocale = catalogue.defaultLocale.trim();

  if (!LOCALE.test(defaultLocale)) {
    issues.push({
      code: 'TERMINOLOGY_DEFAULT_LOCALE_REQUIRED',
      path: 'defaultLocale',
    });
  }
  if (catalogue.concepts.length === 0) {
    issues.push({ code: 'TERMINOLOGY_CONCEPT_REQUIRED', path: 'concepts' });
  }

  const conceptKeys = new Set<string>();
  catalogue.concepts.forEach((concept, conceptIndex) => {
    const conceptPath = `concepts[${conceptIndex}]`;
    if (!CONCEPT_KEY.test(concept.conceptKey)) {
      issues.push({
        code: 'TERMINOLOGY_CONCEPT_KEY_INVALID',
        path: `${conceptPath}.conceptKey`,
      });
    } else if (conceptKeys.has(concept.conceptKey)) {
      issues.push({
        code: 'TERMINOLOGY_CONCEPT_KEY_DUPLICATE',
        path: `${conceptPath}.conceptKey`,
      });
    }
    conceptKeys.add(concept.conceptKey);

    if (concept.labels.length === 0) {
      issues.push({
        code: 'TERMINOLOGY_LABEL_REQUIRED',
        path: `${conceptPath}.labels`,
      });
    }

    const locales = new Set<string>();
    concept.labels.forEach((label, labelIndex) => {
      const labelPath = `${conceptPath}.labels[${labelIndex}]`;
      const locale = normalizedLocale(label.locale);
      if (!LOCALE.test(label.locale.trim())) {
        issues.push({
          code: 'TERMINOLOGY_LOCALE_INVALID',
          path: `${labelPath}.locale`,
        });
      } else if (locales.has(locale)) {
        issues.push({
          code: 'TERMINOLOGY_LOCALE_DUPLICATE',
          path: `${labelPath}.locale`,
        });
      }
      locales.add(locale);

      if (label.singular.trim() === '') {
        issues.push({
          code: 'TERMINOLOGY_LABEL_TEXT_REQUIRED',
          path: `${labelPath}.singular`,
        });
      }
      if (label.plural.trim() === '') {
        issues.push({
          code: 'TERMINOLOGY_LABEL_TEXT_REQUIRED',
          path: `${labelPath}.plural`,
        });
      }
    });

    if (LOCALE.test(defaultLocale) && !locales.has(normalizedLocale(defaultLocale))) {
      issues.push({
        code: 'TERMINOLOGY_DEFAULT_LOCALE_LABEL_REQUIRED',
        path: `${conceptPath}.labels`,
      });
    }

    const aliases = new Set<string>();
    (concept.aliases ?? []).forEach((alias, aliasIndex) => {
      const normalized = alias.trim().toLocaleLowerCase();
      const path = `${conceptPath}.aliases[${aliasIndex}]`;
      if (normalized === '') {
        issues.push({ code: 'TERMINOLOGY_ALIAS_INVALID', path });
      } else if (aliases.has(normalized)) {
        issues.push({ code: 'TERMINOLOGY_ALIAS_DUPLICATE', path });
      }
      aliases.add(normalized);
    });
  });

  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

export function resolvePresentationTerm(
  catalogue: PresentationTerminologyCatalogue,
  conceptKey: string,
  requestedLocale: string,
  quantity: 'SINGULAR' | 'PLURAL',
): ResolvedPresentationTerm | null {
  const concept = catalogue.concepts.find(
    (candidate) => candidate.conceptKey === conceptKey,
  );
  if (concept === undefined) return null;

  const requested = normalizedLocale(requestedLocale);
  const fallback = normalizedLocale(catalogue.defaultLocale);
  const label = concept.labels.find(
    (candidate) => normalizedLocale(candidate.locale) === requested,
  ) ?? concept.labels.find(
    (candidate) => normalizedLocale(candidate.locale) === fallback,
  );
  if (label === undefined) return null;

  return {
    conceptKey,
    locale: label.locale,
    text: quantity === 'SINGULAR' ? label.singular : label.plural,
  };
}

function normalizedLocale(locale: string): string {
  return locale.trim().toLocaleLowerCase();
}
