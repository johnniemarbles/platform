export const COMPETENCY_EVIDENCE_TYPES = [
  'COURSE_COMPLETION',
  'ASSESSMENT_PASS',
  'PROGRAM_COMPLETION',
  'CREDENTIAL_ACTIVE',
] as const;
export type LearningCompetencyEvidenceType =
  (typeof COMPETENCY_EVIDENCE_TYPES)[number];

export const COMPETENCY_ACHIEVEMENT_STATUSES = [
  'ACTIVE',
  'LAPSED',
] as const;
export type LearningCompetencyAchievementStatus =
  (typeof COMPETENCY_ACHIEVEMENT_STATUSES)[number];

export interface LearningCompetencyEvidenceRuleDraft {
  readonly type: LearningCompetencyEvidenceType;
  readonly courseVersionId: string | null;
  readonly assessmentVersionId: string | null;
  readonly programVersionId: string | null;
  readonly certificationVersionId: string | null;
  readonly required: boolean;
}

export interface LearningCompetencyLevelDraft {
  readonly levelKey: string;
  readonly name: string;
  readonly rank: number;
  readonly evidenceRules: readonly LearningCompetencyEvidenceRuleDraft[];
}

export interface LearningCompetencyDraft {
  readonly competencyKey: string;
  readonly title: string;
  readonly description: string;
  readonly levels: readonly LearningCompetencyLevelDraft[];
}

export interface LearningCompetencyFrameworkDraft {
  readonly title: string;
  readonly description: string;
  readonly competencies: readonly LearningCompetencyDraft[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export class LearningCompetencyValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'LearningCompetencyValidationError';
    this.field = field;
    this.code = code;
  }
}

function text(
  value: unknown,
  field: string,
  max: number,
  required = true,
): string {
  if (value === undefined || value === null || value === '') {
    if (!required) return '';
    throw new LearningCompetencyValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (typeof value !== 'string') {
    throw new LearningCompetencyValidationError(field, 'INVALID_TEXT', `${field} must be text.`);
  }
  const normalized = value.trim();
  if (required && normalized === '') {
    throw new LearningCompetencyValidationError(field, 'REQUIRED', `${field} is required.`);
  }
  if (normalized.length > max) {
    throw new LearningCompetencyValidationError(field, 'TOO_LONG', `${field} is too long.`);
  }
  return normalized;
}

function key(value: unknown, field: string): string {
  const normalized = text(value, field, 120).toLowerCase();
  if (!KEY.test(normalized)) {
    throw new LearningCompetencyValidationError(field, 'INVALID_KEY', `${field} is invalid.`);
  }
  return normalized;
}

function uuid(value: unknown, field: string): string {
  const normalized = text(value, field, 100);
  if (!UUID.test(normalized)) {
    throw new LearningCompetencyValidationError(field, 'INVALID_IDENTIFIER', `${field} must be a UUID.`);
  }
  return normalized;
}

function positiveRank(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 1000) {
    throw new LearningCompetencyValidationError(field, 'INVALID_RANK', `${field} is invalid.`);
  }
  return Number(value);
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return uuid(value, field);
}

function evidenceRule(
  value: unknown,
  field: string,
): LearningCompetencyEvidenceRuleDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningCompetencyValidationError(field, 'INVALID_OBJECT', 'Evidence rule must be an object.');
  }
  const input = value as Record<string, unknown>;
  const typeRaw = input.type;
  if (
    typeof typeRaw !== 'string'
    || !(COMPETENCY_EVIDENCE_TYPES as readonly string[]).includes(typeRaw)
  ) {
    throw new LearningCompetencyValidationError(
      field + '.type',
      'INVALID_EVIDENCE_TYPE',
      'Unknown competency evidence type.',
    );
  }
  const type = typeRaw as LearningCompetencyEvidenceType;
  const courseVersionId = optionalUuid(input.courseVersionId, field + '.courseVersionId');
  const assessmentVersionId = optionalUuid(
    input.assessmentVersionId,
    field + '.assessmentVersionId',
  );
  const programVersionId = optionalUuid(input.programVersionId, field + '.programVersionId');
  const certificationVersionId = optionalUuid(
    input.certificationVersionId,
    field + '.certificationVersionId',
  );

  const targets = [
    courseVersionId,
    assessmentVersionId,
    programVersionId,
    certificationVersionId,
  ].filter((candidate) => candidate !== null);

  if (targets.length !== 1) {
    throw new LearningCompetencyValidationError(
      field,
      'EVIDENCE_TARGET_INVALID',
      'Evidence rule must pin exactly one version target.',
    );
  }

  const expected =
    type === 'COURSE_COMPLETION'
      ? courseVersionId
      : type === 'ASSESSMENT_PASS'
        ? assessmentVersionId
        : type === 'PROGRAM_COMPLETION'
          ? programVersionId
          : certificationVersionId;
  if (expected === null) {
    throw new LearningCompetencyValidationError(
      field,
      'EVIDENCE_TYPE_TARGET_MISMATCH',
      'Evidence type does not match its pinned version target.',
    );
  }

  return {
    type,
    courseVersionId,
    assessmentVersionId,
    programVersionId,
    certificationVersionId,
    required: input.required !== false,
  };
}

export function validateLearningCompetencyFrameworkDraft(
  value: unknown,
): LearningCompetencyFrameworkDraft {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningCompetencyValidationError(
      'framework',
      'INVALID_OBJECT',
      'Competency framework must be an object.',
    );
  }
  const input = value as Record<string, unknown>;
  const competenciesRaw = input.competencies;
  if (!Array.isArray(competenciesRaw)) {
    throw new LearningCompetencyValidationError(
      'competencies',
      'INVALID_LIST',
      'competencies must be an array.',
    );
  }

  const competencies = competenciesRaw.map((raw, competencyIndex): LearningCompetencyDraft => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LearningCompetencyValidationError(
        `competencies[${competencyIndex}]`,
        'INVALID_OBJECT',
        'Competency must be an object.',
      );
    }
    const competency = raw as Record<string, unknown>;
    const levelsRaw = competency.levels;
    if (!Array.isArray(levelsRaw)) {
      throw new LearningCompetencyValidationError(
        `competencies[${competencyIndex}].levels`,
        'INVALID_LIST',
        'levels must be an array.',
      );
    }

    const levels = levelsRaw.map((rawLevel, levelIndex): LearningCompetencyLevelDraft => {
      if (rawLevel === null || typeof rawLevel !== 'object' || Array.isArray(rawLevel)) {
        throw new LearningCompetencyValidationError(
          `competencies[${competencyIndex}].levels[${levelIndex}]`,
          'INVALID_OBJECT',
          'Level must be an object.',
        );
      }
      const level = rawLevel as Record<string, unknown>;
      const evidenceRaw = level.evidenceRules;
      if (!Array.isArray(evidenceRaw)) {
        throw new LearningCompetencyValidationError(
          `competencies[${competencyIndex}].levels[${levelIndex}].evidenceRules`,
          'INVALID_LIST',
          'evidenceRules must be an array.',
        );
      }
      const rules = evidenceRaw.map((rule, ruleIndex) =>
        evidenceRule(
          rule,
          `competencies[${competencyIndex}].levels[${levelIndex}].evidenceRules[${ruleIndex}]`,
        ),
      );
      if (rules.length === 0 || !rules.some((rule) => rule.required)) {
        throw new LearningCompetencyValidationError(
          `competencies[${competencyIndex}].levels[${levelIndex}].evidenceRules`,
          'REQUIRED_EVIDENCE_MISSING',
          'Each proficiency level requires at least one required evidence rule.',
        );
      }

      const signatures = rules.map((rule) =>
        [
          rule.type,
          rule.courseVersionId,
          rule.assessmentVersionId,
          rule.programVersionId,
          rule.certificationVersionId,
        ].join(':'),
      );
      if (new Set(signatures).size !== signatures.length) {
        throw new LearningCompetencyValidationError(
          `competencies[${competencyIndex}].levels[${levelIndex}].evidenceRules`,
          'DUPLICATE_EVIDENCE_RULE',
          'Evidence rules must be unique within a level.',
        );
      }

      return {
        levelKey: key(
          level.levelKey,
          `competencies[${competencyIndex}].levels[${levelIndex}].levelKey`,
        ),
        name: text(
          level.name,
          `competencies[${competencyIndex}].levels[${levelIndex}].name`,
          200,
        ),
        rank: positiveRank(
          level.rank,
          `competencies[${competencyIndex}].levels[${levelIndex}].rank`,
        ),
        evidenceRules: rules,
      };
    });

    if (levels.length === 0) {
      throw new LearningCompetencyValidationError(
        `competencies[${competencyIndex}].levels`,
        'LEVEL_REQUIRED',
        'Competency requires at least one proficiency level.',
      );
    }
    if (new Set(levels.map((level) => level.rank)).size !== levels.length) {
      throw new LearningCompetencyValidationError(
        `competencies[${competencyIndex}].levels`,
        'DUPLICATE_LEVEL_RANK',
        'Proficiency level ranks must be unique.',
      );
    }
    if (new Set(levels.map((level) => level.levelKey)).size !== levels.length) {
      throw new LearningCompetencyValidationError(
        `competencies[${competencyIndex}].levels`,
        'DUPLICATE_LEVEL_KEY',
        'Proficiency level keys must be unique.',
      );
    }

    return {
      competencyKey: key(
        competency.competencyKey,
        `competencies[${competencyIndex}].competencyKey`,
      ),
      title: text(
        competency.title,
        `competencies[${competencyIndex}].title`,
        300,
      ),
      description: text(
        competency.description,
        `competencies[${competencyIndex}].description`,
        10000,
        false,
      ),
      levels: [...levels].sort((a, b) => a.rank - b.rank),
    };
  });

  if (competencies.length === 0) {
    throw new LearningCompetencyValidationError(
      'competencies',
      'COMPETENCY_REQUIRED',
      'Framework requires at least one competency.',
    );
  }
  if (
    new Set(competencies.map((competency) => competency.competencyKey)).size
    !== competencies.length
  ) {
    throw new LearningCompetencyValidationError(
      'competencies',
      'DUPLICATE_COMPETENCY_KEY',
      'Competency keys must be unique.',
    );
  }

  return {
    title: text(input.title, 'title', 300),
    description: text(input.description, 'description', 20000, false),
    competencies,
  };
}

export function cumulativeRequiredRuleCount(
  levels: readonly LearningCompetencyLevelDraft[],
  targetRank: number,
): number {
  return levels
    .filter((level) => level.rank <= targetRank)
    .flatMap((level) => level.evidenceRules)
    .filter((rule) => rule.required)
    .length;
}
