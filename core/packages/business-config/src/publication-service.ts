import type {
  BusinessConfigurationChangeset,
  BusinessConfigurationObject,
} from './index.ts';
import type {
  BusinessConfigurationPublication,
  BusinessConfigurationPublishRequest,
  BusinessConfigurationPublishResult,
  BusinessConfigurationPublishReviewer,
  BusinessConfigurationPublishService,
} from './publication.ts';
import type { BusinessConfigurationPublicationRepository } from './publication-repository.ts';
import { validateBusinessConfigurationChangeset } from './changeset-validation.ts';

export class RepositoryBusinessConfigurationPublishService
  implements BusinessConfigurationPublishService {
  readonly #reviewer: BusinessConfigurationPublishReviewer;
  readonly #repository: BusinessConfigurationPublicationRepository;

  constructor(input: {
    readonly reviewer: BusinessConfigurationPublishReviewer;
    readonly repository: BusinessConfigurationPublicationRepository;
  }) {
    this.#reviewer = input.reviewer;
    this.#repository = input.repository;
  }

  async publish(
    request: BusinessConfigurationPublishRequest,
  ): Promise<BusinessConfigurationPublishResult> {
    if (request.publishedBySubjectId.trim() === '') {
      return denied(
        'CONFIG_PUBLISH_ACTOR_REQUIRED',
        'Publishing actor is required.',
        request.changeset.evidenceRefs,
      );
    }
    if (!Number.isFinite(Date.parse(request.publishedAt))) {
      return denied(
        'CONFIG_PUBLISH_AT_INVALID',
        'publishedAt must be a valid instant.',
        request.changeset.evidenceRefs,
      );
    }

    const candidate = publication(request, []);
    const existing = await this.#repository.findPublication({
      scope: request.changeset.scope,
      changesetId: request.changeset.changesetId,
    });
    if (existing !== null) {
      return samePublication(existing, candidate)
        ? { status: 'ALREADY_PUBLISHED', publication: existing }
        : denied(
            'CONFIG_CHANGESET_CONFLICT',
            'Changeset identity already has different immutable publication content.',
            request.changeset.evidenceRefs,
          );
    }

    const available = await this.#repository.listAvailableIdentities(
      request.changeset.scope,
    );
    const validation = validateBusinessConfigurationChangeset(
      request.changeset,
      available,
    );
    if (!validation.valid) {
      const first = validation.issues[0]!;
      return denied(first.code, first.message, request.changeset.evidenceRefs);
    }

    const review = await this.#reviewer.review(request.changeset);
    if (!review.allowed) {
      return denied(review.code, review.reason, [
        ...request.changeset.evidenceRefs,
        ...review.evidenceRefs,
      ]);
    }

    const committed = await this.#repository.publish(
      publication(request, review.evidenceRefs),
    );
    switch (committed.status) {
      case 'COMMITTED':
        return { status: 'PUBLISHED', publication: committed.publication };
      case 'ALREADY_COMMITTED':
        return {
          status: 'ALREADY_PUBLISHED',
          publication: committed.publication,
        };
      case 'CHANGESET_CONFLICT':
        return denied(
          'CONFIG_CHANGESET_CONFLICT',
          'Changeset identity already has different immutable publication content.',
          request.changeset.evidenceRefs,
        );
      case 'REVISION_CONFLICT':
        return { status: 'CONFLICT', currentRevision: committed.currentRevision };
    }
  }
}

function publication(
  request: BusinessConfigurationPublishRequest,
  reviewEvidenceRefs: readonly string[],
): BusinessConfigurationPublication {
  return {
    changesetId: request.changeset.changesetId,
    scope: request.changeset.scope,
    baseRevision: request.changeset.expectedBaseRevision,
    revision: request.changeset.expectedBaseRevision + 1,
    objects: request.changeset.changes.map(publishedObject),
    publishedBySubjectId: request.publishedBySubjectId,
    publishedAt: request.publishedAt,
    reason: request.changeset.reason,
    evidenceRefs: [
      ...new Set([
        ...request.changeset.evidenceRefs,
        ...reviewEvidenceRefs,
      ]),
    ],
  };
}

function publishedObject(
  object: BusinessConfigurationObject,
): BusinessConfigurationObject {
  return {
    ...object,
    state: 'PUBLISHED',
    dependencies: object.dependencies.map((dependency) => ({ ...dependency })),
  };
}

function samePublication(
  left: BusinessConfigurationPublication,
  right: BusinessConfigurationPublication,
): boolean {
  return (
    JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
    && right.evidenceRefs.every((entry) => left.evidenceRefs.includes(entry))
  );
}

function canonical(
  value: BusinessConfigurationPublication,
): Record<string, unknown> {
  const { evidenceRefs: _evidenceRefs, ...content } = value;
  return {
    ...content,
    publishedAt: new Date(value.publishedAt).toISOString(),
  };
}

function denied(
  code: string,
  reason: string,
  evidenceRefs: readonly string[],
): BusinessConfigurationPublishResult {
  return { status: 'DENIED', code, reason, evidenceRefs: [...evidenceRefs] };
}
