import type { IProviderSetting } from '~/types/model';
import { BaseProvider } from './base-provider';
import type { ModelInfo, ProviderInfo } from './types';
import * as providers from './registry';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LLMManager');
export class LLMManager {
  private static _instance: LLMManager;
  private _providers: Map<string, BaseProvider> = new Map();
  private _modelList: ModelInfo[] = [];
  private _env: Record<string, string> = {};

  private constructor(_env: Record<string, string>) {
    this._registerProvidersFromDirectory();
    this._env = _env;
  }

  static getInstance(env: Record<string, string> = {}): LLMManager {
    if (!LLMManager._instance) {
      LLMManager._instance = new LLMManager(env);
    } else if (Object.keys(env).length > 0) {
      // Update env on subsequent calls so Cloudflare Workers get fresh bindings
      LLMManager._instance._env = env;
    }

    return LLMManager._instance;
  }
  get env() {
    return this._env;
  }

  private async _registerProvidersFromDirectory() {
    try {
      /*
       * Dynamically import all files from the providers directory
       * const providerModules = import.meta.glob('./providers/*.ts', { eager: true });
       */

      // Look for exported classes that extend BaseProvider
      for (const exportedItem of Object.values(providers)) {
        if (typeof exportedItem === 'function' && exportedItem.prototype instanceof BaseProvider) {
          const provider = new exportedItem();

          try {
            this.registerProvider(provider);
          } catch (error: any) {
            logger.warn('Failed To Register Provider: ', provider.name, 'error:', error.message);
          }
        }
      }
    } catch (error) {
      logger.error('Error registering providers:', error);
    }
  }

  registerProvider(provider: BaseProvider) {
    if (this._providers.has(provider.name)) {
      logger.warn(`Provider ${provider.name} is already registered. Skipping.`);
      return;
    }

    logger.info('Registering Provider: ', provider.name);
    this._providers.set(provider.name, provider);
    this._modelList = [...this._modelList, ...provider.staticModels];
  }

  getProvider(name: string): BaseProvider | undefined {
    return this._providers.get(name);
  }

  getAllProviders(): BaseProvider[] {
    return Array.from(this._providers.values());
  }

  getModelList(): ModelInfo[] {
    return this._modelList;
  }

  async updateModelList(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): Promise<ModelInfo[]> {
    const { apiKeys, providerSettings, serverEnv } = options;

    let enabledProviders = Array.from(this._providers.values()).map((p) => p.name);

    if (providerSettings && Object.keys(providerSettings).length > 0) {
      enabledProviders = enabledProviders.filter((p) => providerSettings[p].enabled);
    }

    const LOCAL_PROVIDERS = new Set(['OmniRoute', 'Ollama', 'LMStudio']);

    /*
     * Only attempt dynamic models for:
     * - Local providers (they handle "not running" gracefully and return [])
     * - Cloud providers that have at least one form of api key present
     */
    const providersToFetchDynamic = Array.from(this._providers.values()).filter((provider) => {
      if (!enabledProviders.includes(provider.name)) {
        return false;
      }

      if (!provider.getDynamicModels) {
        return false;
      }

      if (LOCAL_PROVIDERS.has(provider.name)) {
        return true;
      }

      // Cloud: require a key somewhere (apiKeys, providerSettings, or serverEnv for its token key)
      const tokenKey = (provider as any).config?.apiTokenKey || '';
      const hasKey =
        !!apiKeys?.[provider.name] ||
        !!(providerSettings?.[provider.name] as any)?.[tokenKey] ||
        !!(serverEnv && tokenKey && serverEnv[tokenKey]);

      return hasKey;
    }) as Array<BaseProvider & Required<Pick<ProviderInfo, 'getDynamicModels'>>>;

    // Get dynamic models from the filtered set
    const dynamicModels = await Promise.all(
      providersToFetchDynamic.map(async (provider) => {
        const cachedModels = provider.getModelsFromCache(options);

        if (cachedModels) {
          return cachedModels;
        }

        const dynamicModels = await provider
          .getDynamicModels(apiKeys, providerSettings?.[provider.name], serverEnv)
          .then((models) => {
            logger.debug(`Caching ${models.length} dynamic models for ${provider.name}`);
            provider.storeDynamicModels(options, models);

            return models;
          })
          .catch((err) => {
            // Expected for providers without keys or temporarily unreachable — keep quiet in local-only usage
            logger.debug(`Error getting dynamic models ${provider.name} :`, err);
            return [];
          });

        return dynamicModels;
      }),
    );
    const staticModels = Array.from(this._providers.values()).flatMap((p) => p.staticModels || []);
    const dynamicModelsFlat = dynamicModels.flat();
    const dynamicModelKeys = dynamicModelsFlat.map((d) => `${d.name}-${d.provider}`);
    const filteredStaticModels = staticModels.filter((m) => !dynamicModelKeys.includes(`${m.name}-${m.provider}`));

    // Combine static and dynamic models
    const modelList = [...dynamicModelsFlat, ...filteredStaticModels];
    modelList.sort((a, b) => a.name.localeCompare(b.name));
    this._modelList = modelList;

    return modelList;
  }
  getStaticModelList() {
    return [...this._providers.values()].flatMap((p) => p.staticModels || []);
  }
  async getModelListFromProvider(
    providerArg: BaseProvider,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
  ): Promise<ModelInfo[]> {
    const provider = this._providers.get(providerArg.name);

    if (!provider) {
      throw new Error(`Provider ${providerArg.name} not found`);
    }

    const staticModels = provider.staticModels || [];

    if (!provider.getDynamicModels) {
      return staticModels;
    }

    const { apiKeys, providerSettings, serverEnv } = options;

    const LOCAL_PROVIDERS = new Set(['OmniRoute', 'Ollama', 'LMStudio']);

    const cachedModels = provider.getModelsFromCache({
      apiKeys,
      providerSettings,
      serverEnv,
    });

    if (cachedModels) {
      logger.debug(`Found ${cachedModels.length} cached models for ${provider.name}`);
      return [...cachedModels, ...staticModels];
    }

    // For non-local providers, if no credential is present in this call, don't attempt (prevents spam for cloud keys in local setups)
    const tokenKey = (provider as any).config?.apiTokenKey || '';
    const isLocal = LOCAL_PROVIDERS.has(provider.name);
    const hasKeyForThisCall =
      isLocal ||
      !!apiKeys?.[provider.name] ||
      !!(providerSettings?.[provider.name] as any)?.[tokenKey] ||
      !!(serverEnv && tokenKey && serverEnv[tokenKey]);

    if (!hasKeyForThisCall) {
      return staticModels;
    }

    logger.debug(`Getting dynamic models for ${provider.name}`);

    const dynamicModels = await provider
      .getDynamicModels?.(apiKeys, providerSettings?.[provider.name], serverEnv)
      .then((models) => {
        logger.debug(`Got ${models.length} dynamic models for ${provider.name}`);
        provider.storeDynamicModels(options, models);

        return models;
      })
      .catch((err) => {
        logger.debug(`Error getting dynamic models ${provider.name} :`, err);
        return [];
      });
    const dynamicModelsName = dynamicModels.map((d) => d.name);
    const filteredStaticList = staticModels.filter((m) => !dynamicModelsName.includes(m.name));
    const modelList = [...dynamicModels, ...filteredStaticList];
    modelList.sort((a, b) => a.name.localeCompare(b.name));

    return modelList;
  }
  getStaticModelListFromProvider(providerArg: BaseProvider) {
    const provider = this._providers.get(providerArg.name);

    if (!provider) {
      throw new Error(`Provider ${providerArg.name} not found`);
    }

    return [...(provider.staticModels || [])];
  }

  getDefaultProvider(): BaseProvider {
    const preferred = ['OmniRoute', 'Ollama', 'LMStudio'];

    for (const name of preferred) {
      const provider = this._providers.get(name);

      if (provider) {
        return provider;
      }
    }

    const firstProvider = this._providers.values().next().value;

    if (!firstProvider) {
      throw new Error('No providers registered');
    }

    return firstProvider;
  }
}
