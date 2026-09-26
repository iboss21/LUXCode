import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import {
  REGES_DASHBOARD_URL,
  REGES_DEFAULT_MODEL,
  REGES_ENV,
  REGES_FALLBACK_MODELS,
  normalizeRegesBaseUrl,
  regesModelLabel,
  regesRequestHeaders,
  resolveRegesApiKey,
} from '~/lib/reges/config';
import { logger } from '~/utils/logger';

interface RegesModelsResponse {
  data: Array<{ id: string; context_length?: number; free?: boolean }>;
}

/** Reges harness gateway (OpenAI-compatible) - the default provider when it is reachable. */
export default class RegesProvider extends BaseProvider {
  name = 'Reges';
  getApiKeyLink = REGES_DASHBOARD_URL;
  labelForGetApiKey = 'Open Reges';
  icon = 'i-ph:eye';

  config = {
    baseUrlKey: REGES_ENV.baseUrl,
    apiTokenKey: REGES_ENV.apiKey,
    modelsKey: REGES_ENV.models,
    baseUrl: normalizeRegesBaseUrl(),
  };

  staticModels: ModelInfo[] = REGES_FALLBACK_MODELS.map((m) => ({ ...m, provider: 'Reges' }));

  private _resolveConfig(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ) {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv,
      defaultBaseUrlKey: REGES_ENV.baseUrl,
      defaultApiTokenKey: REGES_ENV.apiKey,
    });

    return {
      baseUrl: normalizeRegesBaseUrl(baseUrl || this.config.baseUrl),
      apiKey: resolveRegesApiKey(apiKey),
      mode: serverEnv[REGES_ENV.mode] || (typeof process !== 'undefined' ? process.env?.[REGES_ENV.mode] : undefined),
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
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: this.createTimeoutSignal(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const res = (await response.json()) as RegesModelsResponse;
      const models: ModelInfo[] = res.data.map((m) => ({
        name: m.id,
        label: m.free ? `${regesModelLabel(m.id)} (free)` : regesModelLabel(m.id),
        provider: this.name,
        maxTokenAllowed: Math.min(m.context_length || 128000, 200000),
      }));

      if (!models.some((m) => m.name === REGES_DEFAULT_MODEL)) {
        models.unshift({ ...this.staticModels[0] });
      }

      return models;
    } catch (error) {
      logger.info(`${this.name}: gateway unreachable, using the offline model list`, error);
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
    const { baseUrl, apiKey, mode } = this._resolveConfig(apiKeys, providerSettings?.[this.name], envRecord);

    const openai = createOpenAI({
      baseURL: baseUrl,
      apiKey,
      headers: regesRequestHeaders(mode),
    });

    return openai(model || REGES_DEFAULT_MODEL);
  }
}
