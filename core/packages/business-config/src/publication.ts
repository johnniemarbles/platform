import type {
  BusinessConfigurationChangeset,
  BusinessConfigurationObject,
  BusinessConfigurationScope,
} from './index.ts';

export interface BusinessConfigurationPublishRequest {
  readonly changeset: BusinessConfigurationChangeset;
  readonly publishedBySubjectId: string;
  readonly publishedAt: string;
}

export interface BusinessConfigurationPublication {
  readonly changesetId: string;
  readonly scope: BusinessConfigurationScope;
  readonly baseRevision: number;
  readonly revision: number;
  readonly objects: readonly BusinessConfigurationObject[];
  readonly publishedBySubjectId: string;
  readonly publishedAt: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface BusinessConfigurationPublishReviewDecision {
  readonly allowed: boolean;
  readonly code: string;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
}

export interface BusinessConfigurationPublishReviewer {
  review(
    changeset: BusinessConfigurationChangeset,
  ): Promise<BusinessConfigurationPublishReviewDecision>;
}

export type BusinessConfigurationPublishResult =
  | {
      readonly status: 'PUBLISHED' | 'ALREADY_PUBLISHED';
      readonly publication: BusinessConfigurationPublication;
    }
  | {
      readonly status: 'DENIED';
      readonly code: string;
      readonly reason: string;
      readonly evidenceRefs: readonly string[];
    }
  | {
      readonly status: 'CONFLICT';
      readonly currentRevision: number;
    };

export interface BusinessConfigurationPublishService {
  publish(
    request: BusinessConfigurationPublishRequest,
  ): Promise<BusinessConfigurationPublishResult>;
}
