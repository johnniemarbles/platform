import type {
  BusinessConfigurationIdentity,
  BusinessConfigurationScope,
} from './index.ts';
import type { BusinessConfigurationPublication } from './publication.ts';

export type BusinessConfigurationPublicationCommitResult =
  | {
      readonly status: 'COMMITTED' | 'ALREADY_COMMITTED';
      readonly publication: BusinessConfigurationPublication;
    }
  | {
      readonly status: 'CHANGESET_CONFLICT';
      readonly existing: BusinessConfigurationPublication;
    }
  | {
      readonly status: 'REVISION_CONFLICT';
      readonly currentRevision: number;
    };

/** Atomic persistence boundary for one validated configuration changeset. */
export interface BusinessConfigurationPublicationRepository {
  listAvailableIdentities(
    scope: BusinessConfigurationScope,
  ): Promise<readonly BusinessConfigurationIdentity[]>;

  findPublication(input: {
    readonly scope: BusinessConfigurationScope;
    readonly changesetId: string;
  }): Promise<BusinessConfigurationPublication | null>;

  publish(
    publication: BusinessConfigurationPublication,
  ): Promise<BusinessConfigurationPublicationCommitResult>;
}
