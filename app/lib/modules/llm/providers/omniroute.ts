import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import {
  OMNIROUTE_AUTO_MODEL,
  OMNIROUTE_ENV,
  OMNIROUTE_FALLBACK_MODELS,
  normalizeOmniRouteBaseUrl,
  resolveOmniRouteApiKey,
} from '~/lib/omniroute/config';
import { logger } from '~/utils/logger';

interface OpenAIModelsResponse {
  data: Array<{ id: string }>;
}

export default class OmniRouteProvider extends BaseProvider {
  name = 'OmniRoute';
  getApiKeyLink = 'http://127.0.0.1:20128';
  labelForGetApiKey = 'Open OmniRoute Dashboard';
  icon = 'i-ph:path';

  config = {
    baseUrlKey: OMNIROUTE_ENV.baseUrl,
    apiTokenKey: OMNIROUTE_ENV.apiKey,
    modelsKey: OMNIROUTE_ENV.models,
    baseUrl: normalizeOmniRouteBaseUrl(),
  };

  staticModels: ModelInfo[] = OMNIROUTE_FALLBACK_MODELS.map((m) => ({
    ...m,
    provider: 'OmniRoute',
  }));

  private _resolveConfig(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ) {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: OMNIROUTE_ENV.baseUrl,
      defaultApiTokenKey: OMNIROUTE_ENV.apiKey,
    });

    return {
      baseUrl: normalizeOmniRouteBaseUrl(baseUrl || this.config.baseUrl),
      apiKey: resolveOmniRouteApiKey(apiKey),
    };
  }

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this._resolveConfig(apiKeys, settings, serverEnv);

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = (await response.json()) as OpenAIModelsResponse;
      const dynamic = res.data.map((model) => ({
        name: model.id,
        label: model.id === OMNIROUTE_AUTO_MODEL ? 'Auto (OmniRoute smart routing)' : model.id,
        provider: this.name,
        maxTokenAllowed: 128000,
      }));

      const hasAuto = dynamic.some((m) => m.name === OMNIROUTE_AUTO_MODEL);

      if (!hasAuto) {
        dynamic.unshift({
          name: OMNIROUTE_AUTO_MODEL,
          label: 'Auto (OmniRoute smart routing)',
          provider: this.name,
          maxTokenAllowed: 128000,
        });
      }

      return dynamic;
    } catch (error) {
      logger.info(`${this.name}: Could not reach gateway — using offline model list`, error);

      const modelsEnv =
        serverEnv[OMNIROUTE_ENV.models] || (settings as Record<string, string | undefined>)?.[OMNIROUTE_ENV.models];

      if (modelsEnv) {
        return this.staticModels;
      }

      return this.staticModels;
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;
    const envRecord = this.convertEnvToRecord(serverEnv);
    const { baseUrl, apiKey } = this._resolveConfig(apiKeys, providerSettings?.[this.name], envRecord);

    return getOpenAILikeModel(baseUrl, apiKey, model);
  }
}
