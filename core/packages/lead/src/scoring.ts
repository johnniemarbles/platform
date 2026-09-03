export const QUALIFICATION_RESPONSES = [
  'NOT_ASSESSED',
  'MEETS',
  'PARTIALLY_MEETS',
  'DOES_NOT_MEET',
  'NOT_APPLICABLE',
] as const;
export type QualificationResponse = (typeof QUALIFICATION_RESPONSES)[number];

export interface LeadScoreComponentDefinition {
  readonly key: string;
  readonly criterionKey: string;
  readonly weight: number;
  readonly pointsPossible: number;
  readonly responsePoints: Readonly<Partial<Record<QualificationResponse, number>>>;
}

export interface LeadScoreBandThresholds {
  readonly [band: string]: number;
}

export interface LeadScoringProfileDefinition {
  readonly components: readonly LeadScoreComponentDefinition[];
  readonly bandThresholds: LeadScoreBandThresholds;
}

export interface LeadQualificationAssessmentSnapshot {
  readonly criterionKey: string;
  readonly response: QualificationResponse;
}

export interface CalculatedLeadScoreComponent {
  readonly componentKey: string;
  readonly rawValue: QualificationResponse | null;
  readonly weight: number;
  readonly pointsAwarded: number;
  readonly pointsPossible: number;
  readonly explanation: string;
}

export interface CalculatedLeadScore {
  readonly totalScore: number;
  readonly band: string;
  readonly components: readonly CalculatedLeadScoreComponent[];
}

export class LeadScoringValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LeadScoringValidationError';
    this.code = code;
  }
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LeadScoringValidationError('LEAD_SCORING_FIELD_REQUIRED', `${field} is required.`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LeadScoringValidationError('LEAD_SCORING_NUMBER_INVALID', `${field} must be finite.`);
  }
  return value;
}

function validResponse(value: unknown): value is QualificationResponse {
  return typeof value === 'string'
    && (QUALIFICATION_RESPONSES as readonly string[]).includes(value);
}

export function validateLeadScoringProfileDefinition(
  input: LeadScoringProfileDefinition,
): LeadScoringProfileDefinition {
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new LeadScoringValidationError('LEAD_SCORING_COMPONENTS_REQUIRED', 'At least one scoring component is required.');
  }

  const keys = new Set<string>();
  const components = input.components.map((component, index) => {
    const key = nonBlank(component.key, `components[${index}].key`);
    const criterionKey = nonBlank(component.criterionKey, `components[${index}].criterionKey`);
    if (keys.has(key)) {
      throw new LeadScoringValidationError('LEAD_SCORING_COMPONENT_DUPLICATE', `Duplicate component key: ${key}.`);
    }
    keys.add(key);
    const weight = finiteNumber(component.weight, `components[${index}].weight`);
    const pointsPossible = finiteNumber(component.pointsPossible, `components[${index}].pointsPossible`);
    if (weight < 0 || pointsPossible < 0) {
      throw new LeadScoringValidationError('LEAD_SCORING_COMPONENT_RANGE_INVALID', 'Weights and pointsPossible must not be negative.');
    }

    const responsePoints: Partial<Record<QualificationResponse, number>> = {};
    for (const [response, points] of Object.entries(component.responsePoints ?? {})) {
      if (!validResponse(response)) {
        throw new LeadScoringValidationError('LEAD_SCORING_RESPONSE_INVALID', `Unknown qualification response: ${response}.`);
      }
      const value = finiteNumber(points, `components[${index}].responsePoints.${response}`);
      if (value < 0 || value > pointsPossible) {
        throw new LeadScoringValidationError('LEAD_SCORING_POINTS_RANGE_INVALID', `${response} points must be between 0 and pointsPossible.`);
      }
      responsePoints[response] = value;
    }

    return { key, criterionKey, weight, pointsPossible, responsePoints };
  });

  const thresholdEntries = Object.entries(input.bandThresholds ?? {});
  if (thresholdEntries.length === 0) {
    throw new LeadScoringValidationError('LEAD_SCORING_BANDS_REQUIRED', 'At least one score band threshold is required.');
  }
  const bandThresholds: Record<string, number> = {};
  for (const [bandRaw, thresholdRaw] of thresholdEntries) {
    const band = nonBlank(bandRaw, 'band');
    const threshold = finiteNumber(thresholdRaw, `bandThresholds.${band}`);
    bandThresholds[band] = threshold;
  }

  return { components, bandThresholds };
}

export function calculateLeadScore(
  profile: LeadScoringProfileDefinition,
  assessments: readonly LeadQualificationAssessmentSnapshot[],
): CalculatedLeadScore {
  const validated = validateLeadScoringProfileDefinition(profile);
  const latest = new Map<string, QualificationResponse>();
  for (const assessment of assessments) {
    const criterionKey = nonBlank(assessment.criterionKey, 'assessment.criterionKey');
    if (!validResponse(assessment.response)) {
      throw new LeadScoringValidationError('LEAD_SCORING_RESPONSE_INVALID', `Unknown qualification response: ${assessment.response}.`);
    }
    latest.set(criterionKey, assessment.response);
  }

  const components = validated.components.map((component) => {
    const response = latest.get(component.criterionKey) ?? null;
    const basePoints = response === null ? 0 : (component.responsePoints[response] ?? 0);
    const pointsAwarded = basePoints * component.weight;
    const weightedPossible = component.pointsPossible * component.weight;
    return {
      componentKey: component.key,
      rawValue: response,
      weight: component.weight,
      pointsAwarded,
      pointsPossible: weightedPossible,
      explanation: response === null
        ? `No assessment exists for criterion ${component.criterionKey}.`
        : `Criterion ${component.criterionKey} is ${response}; ${basePoints} base points × ${component.weight} weight.`,
    };
  });

  const totalScore = components.reduce((sum, component) => sum + component.pointsAwarded, 0);
  const sortedBands = Object.entries(validated.bandThresholds)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const matched = sortedBands.find(([, threshold]) => totalScore >= threshold);
  if (!matched) {
    throw new LeadScoringValidationError(
      'LEAD_SCORING_BAND_UNRESOLVED',
      `No band threshold covers calculated score ${totalScore}.`,
    );
  }

  return { totalScore, band: matched[0], components };
}
