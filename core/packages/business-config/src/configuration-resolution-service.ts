import type {
  ConfigurationResolutionContext,
  ConfigurationResolutionResult,
  ConfigurationSettingDefinition,
  ConfigurationValueCandidate,
} from './configuration-resolution.ts';
import { resolveScopedConfigurationValue } from './configuration-resolution.ts';

export interface ConfigurationSettingDefinitionRepository {
  findDefinition(
    settingKey: string,
  ): Promise<ConfigurationSettingDefinition | null>;
}

export interface ConfigurationValueCandidateRepository {
  listCandidates(input: {
    readonly settingKey: string;
    readonly context: ConfigurationResolutionContext;
    readonly effectiveAt: string;
  }): Promise<readonly ConfigurationValueCandidate[]>;
}

export interface EffectiveConfigurationRequest {
  readonly settingKey: string;
  readonly context: ConfigurationResolutionContext;
  readonly effectiveAt: string;
}

export type EffectiveConfigurationResult =
  | ConfigurationResolutionResult
  | {
      readonly status: 'DENIED';
      readonly settingKey: string;
      readonly code: 'CONFIGURATION_DEFINITION_NOT_FOUND';
      readonly reason: string;
      readonly trace: readonly [];
    };

export interface EffectiveConfigurationService {
  resolve(
    request: EffectiveConfigurationRequest,
  ): Promise<EffectiveConfigurationResult>;
}

/** Single application boundary for all effective configuration reads. */
export class RepositoryEffectiveConfigurationService
  implements EffectiveConfigurationService {
  readonly #definitions: ConfigurationSettingDefinitionRepository;
  readonly #values: ConfigurationValueCandidateRepository;

  constructor(input: {
    readonly definitions: ConfigurationSettingDefinitionRepository;
    readonly values: ConfigurationValueCandidateRepository;
  }) {
    this.#definitions = input.definitions;
    this.#values = input.values;
  }

  async resolve(
    request: EffectiveConfigurationRequest,
  ): Promise<EffectiveConfigurationResult> {
    const definition = await this.#definitions.findDefinition(request.settingKey);
    if (definition === null) {
      return {
        status: 'DENIED',
        settingKey: request.settingKey,
        code: 'CONFIGURATION_DEFINITION_NOT_FOUND',
        reason: `Configuration definition ${request.settingKey} was not found.`,
        trace: [],
      };
    }

    const candidates = await this.#values.listCandidates({
      settingKey: request.settingKey,
      context: request.context,
      effectiveAt: request.effectiveAt,
    });
    return resolveScopedConfigurationValue(
      definition,
      candidates,
      request.context,
      request.effectiveAt,
    );
  }
}
