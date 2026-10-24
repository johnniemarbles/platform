import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  BusinessConfigurationChangeset,
  BusinessConfigurationPublication,
  BusinessConfigurationPublicationRepository,
  BusinessConfigurationPublishReviewer,
} from '../src/index.ts';
import { RepositoryBusinessConfigurationPublishService } from '../src/index.ts';

const changeset: BusinessConfigurationChangeset = {
  changesetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  scope: { kind: 'VERTICAL', verticalKey: 'dental' },
  expectedBaseRevision: 3,
  changes: [{
    kind: 'ONTOLOGY',
    key: 'dental-directory',
    version: 1,
    scope: { kind: 'VERTICAL', verticalKey: 'dental' },
    label: 'Dental directory',
    state: 'DRAFT',
    payload: { entityTypes: ['Practice'] },
    dependencies: [{ kind: 'TERMINOLOGY', key: 'customer-labels', version: 1 }],
    authoredBySubjectId: 'author-1',
    authoredAt: '2026-08-25T14:00:00.000Z',
  }],
  authoredBySubjectId: 'author-1',
  authoredAt: '2026-08-25T14:00:00.000Z',
  reason: 'Publish directory configuration.',
  evidenceRefs: ['change-ticket:1'],
};

const request = {
  changeset,
  publishedBySubjectId: 'publisher-1',
  publishedAt: '2026-08-25T14:30:00.000Z',
};

class Reviewer implements BusinessConfigurationPublishReviewer {
  decision = {
    allowed: true,
    code: 'REVIEW_APPROVED',
    reason: 'Policy and impact review passed.',
    evidenceRefs: ['impact-preview:1'],
  };
  async review() { return this.decision; }
}

class Repository implements BusinessConfigurationPublicationRepository {
  existing: BusinessConfigurationPublication | null = null;
  recorded: BusinessConfigurationPublication | null = null;
  mode: 'COMMITTED' | 'ALREADY_COMMITTED' | 'CHANGESET_CONFLICT' | 'REVISION_CONFLICT' =
    'COMMITTED';

  async listAvailableIdentities() {
    return [{ kind: 'TERMINOLOGY' as const, key: 'customer-labels', version: 1 }];
  }
  async findPublication() { return this.existing; }
  async publish(value: BusinessConfigurationPublication) {
    this.recorded = value;
    switch (this.mode) {
      case 'COMMITTED':
        return { status: 'COMMITTED' as const, publication: value };
      case 'ALREADY_COMMITTED':
        return { status: 'ALREADY_COMMITTED' as const, publication: value };
      case 'CHANGESET_CONFLICT':
        return {
          status: 'CHANGESET_CONFLICT' as const,
          existing: { ...value, reason: 'Different.' },
        };
      case 'REVISION_CONFLICT':
        return { status: 'REVISION_CONFLICT' as const, currentRevision: 4 };
    }
  }
}

function service(input: { reviewer?: Reviewer; repository?: Repository } = {}) {
  return new RepositoryBusinessConfigurationPublishService({
    reviewer: input.reviewer ?? new Reviewer(),
    repository: input.repository ?? new Repository(),
  });
}

test('publishes reviewed changes atomically at the next revision', async () => {
  const repository = new Repository();
  const result = await service({ repository }).publish(request);

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(repository.recorded?.baseRevision, 3);
  assert.equal(repository.recorded?.revision, 4);
  assert.equal(repository.recorded?.objects[0]?.state, 'PUBLISHED');
  assert.deepEqual(repository.recorded?.evidenceRefs, [
    'change-ticket:1',
    'impact-preview:1',
  ]);
});

test('denies missing dependencies before policy and impact review', async () => {
  const repository = new Repository();
  repository.listAvailableIdentities = async () => [];
  const reviewer = new Reviewer();
  let reviews = 0;
  reviewer.review = async () => {
    reviews += 1;
    return reviewer.decision;
  };

  const result = await service({ repository, reviewer }).publish(request);

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'CONFIG_DEPENDENCY_MISSING');
  assert.equal(reviews, 0);
  assert.equal(repository.recorded, null);
});

test('requires policy and impact approval before repository publication', async () => {
  const reviewer = new Reviewer();
  reviewer.decision = {
    allowed: false,
    code: 'CONFIG_IMPACT_REJECTED',
    reason: 'Breaking impact is not approved.',
    evidenceRefs: ['impact-preview:blocked'],
  };
  const repository = new Repository();

  const result = await service({ reviewer, repository }).publish(request);

  assert.equal(result.status, 'DENIED');
  assert.equal(result.code, 'CONFIG_IMPACT_REJECTED');
  assert.equal(repository.recorded, null);
});

test('recognizes exact retries without repeating review or publication', async () => {
  const repository = new Repository();
  await service({ repository }).publish(request);
  repository.existing = repository.recorded;

  const result = await service({ repository }).publish(request);

  assert.equal(result.status, 'ALREADY_PUBLISHED');
});

test('maps optimistic revision conflicts', async () => {
  const repository = new Repository();
  repository.mode = 'REVISION_CONFLICT';

  assert.deepEqual(await service({ repository }).publish(request), {
    status: 'CONFLICT',
    currentRevision: 4,
  });
});
