import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cumulativeRequiredRuleCount,
  validateLearningCompetencyFrameworkDraft,
} from '../src/competency.ts';

test('framework validates ordered levels with exact pinned evidence', () => {
  const draft = validateLearningCompetencyFrameworkDraft({
    title: 'Privacy Competency',
    competencies: [{
      competencyKey: 'privacy.practice',
      title: 'Privacy Practice',
      levels: [
        {
          levelKey: 'aware',
          name: 'Aware',
          rank: 1,
          evidenceRules: [{
            type: 'COURSE_COMPLETION',
            courseVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            required: true,
          }],
        },
        {
          levelKey: 'practitioner',
          name: 'Practitioner',
          rank: 2,
          evidenceRules: [{
            type: 'ASSESSMENT_PASS',
            assessmentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            required: true,
          }],
        },
      ],
    }],
  });
  assert.equal(draft.competencies[0]?.levels[0]?.levelKey, 'aware');
  assert.equal(draft.competencies[0]?.levels[1]?.rank, 2);
  assert.equal(
    cumulativeRequiredRuleCount(draft.competencies[0]?.levels ?? [], 2),
    2,
  );
});

test('evidence type must match exactly one pinned version target', () => {
  assert.throws(() => validateLearningCompetencyFrameworkDraft({
    title: 'Invalid',
    competencies: [{
      competencyKey: 'bad',
      title: 'Bad',
      levels: [{
        levelKey: 'one',
        name: 'One',
        rank: 1,
        evidenceRules: [{
          type: 'COURSE_COMPLETION',
          assessmentVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }],
      }],
    }],
  }), /does not match/);
});

test('every level requires required evidence and unique rank/key', () => {
  assert.throws(() => validateLearningCompetencyFrameworkDraft({
    title: 'Invalid',
    competencies: [{
      competencyKey: 'duplicate',
      title: 'Duplicate',
      levels: [{
        levelKey: 'one',
        name: 'One',
        rank: 1,
        evidenceRules: [{
          type: 'PROGRAM_COMPLETION',
          programVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          required: false,
        }],
      }],
    }],
  }), /required evidence/i);
});
