import { useCallback, useEffect, useRef, useState } from 'react';
import Cookies from 'js-cookie';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { syncProviderSettingsCookie } from '~/lib/local-ai/cookies';
import type { LocalAiDiscoveryResult } from '~/lib/local-ai/discovery';
import { providersStore, updateProviderSettings } from '~/lib/stores/settings';
import type { ProviderInfo } from '~/types/model';
import { PROVIDER_LIST } from '~/utils/constants';

export function useLocalAiDiscovery(options?: {
  onModels?: (models: ModelInfo[]) => void;
  setProvider?: (provider: ProviderInfo) => void;
  setModel?: (model: string) => void;
  autoSelect?: boolean;
}) {
  const [discovery, setDiscovery] = useState<LocalAiDiscoveryResult | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const ran = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const applyDiscovery = useCallback(async (force = false) => {
    setIsDiscovering(true);

    try {
      const res = await fetch('/api/discover-local-ai');
      const result = (await res.json()) as LocalAiDiscoveryResult;
      setDiscovery(result);

      const currentSettings = providersStore.get();
      let settingsChanged = false;
      const nextSettings = { ...currentSettings };

      for (const p of result.providers) {
        if (!p.online) {
          continue;
        }

        const existing = nextSettings[p.name] || { settings: {} };

        const desiredBase = p.baseUrl || (p.name === 'OmniRoute' ? 'http://127.0.0.1:20128/v1' : undefined);

        const newSettings: any = {
          ...existing.settings,
          enabled: true,
        };

        if (desiredBase) {
          newSettings.baseUrl = desiredBase;
        }

        // For OmniRoute, auto-fill a convenient local key if none is set
        if (p.name === 'OmniRoute') {
          const currentKey = (existing.settings as any)?.apiKey || (existing as any)?.apiKey;

          if (!currentKey || currentKey.includes('your_') || currentKey.includes('_here')) {
            newSettings.apiKey = 'luxcoder-local';
          }
        }

        const needsUpdate =
          !existing.settings?.enabled ||
          (desiredBase && existing.settings?.baseUrl !== desiredBase) ||
          (p.name === 'OmniRoute' && newSettings.apiKey && newSettings.apiKey !== (existing.settings as any)?.apiKey);

        if (needsUpdate) {
          nextSettings[p.name] = {
            ...existing,
            settings: newSettings,
          };
          settingsChanged = true;
        }
      }

      if (settingsChanged) {
        providersStore.set(nextSettings);
        localStorage.setItem('provider_settings', JSON.stringify(nextSettings));
        syncProviderSettingsCookie();
      }

      optionsRef.current?.onModels?.(result.allModels);

      const savedProvider = Cookies.get('selectedProvider');
      const savedModel = Cookies.get('selectedModel');
      const shouldAutoSelect =
        optionsRef.current?.autoSelect !== false &&
        result.recommended &&
        optionsRef.current?.setProvider &&
        optionsRef.current?.setModel &&
        ((!savedProvider && !savedModel) || force);

      if (shouldAutoSelect && result.recommended) {
        const providerInfo = PROVIDER_LIST.find((p) => p.name === result.recommended!.provider);
        const opts = optionsRef.current;

        const desiredProviderName = result.recommended.provider;
        const desiredModel = desiredProviderName === 'OmniRoute' ? 'auto' : result.recommended.model;

        // Only call if different from what cookies currently say (handlers also guard, this avoids unnecessary work)
        const currentP = Cookies.get('selectedProvider');
        const currentM = Cookies.get('selectedModel');

        if (providerInfo && opts?.setProvider && opts?.setModel) {
          if (currentP !== desiredProviderName) {
            opts.setProvider(providerInfo as ProviderInfo);
          }

          if (currentM !== desiredModel) {
            opts.setModel(desiredModel);
          }

          if (currentP !== desiredProviderName || currentM !== desiredModel) {
            Cookies.set('selectedProvider', desiredProviderName, { expires: 365 });
            Cookies.set('selectedModel', desiredModel, { expires: 365 });
          }
        }
      } else if (!Cookies.get('selectedProvider') && !Cookies.get('selectedModel')) {
        // Hard fallback: if OmniRoute is online right now, force it + model=auto on first run
        const omniOnline = result.providers.some((p) => p.name === 'OmniRoute' && p.online);
        const omniProvider = PROVIDER_LIST.find((p) => p.name === 'OmniRoute');
        const setP = optionsRef.current?.setProvider;
        const setM = optionsRef.current?.setModel;

        if (omniOnline && omniProvider && setP && setM) {
          // Handlers are now name-guarded; still avoid the call if cookies got set by a concurrent path
          if (!Cookies.get('selectedProvider')) {
            setP(omniProvider as ProviderInfo);
          }

          if (!Cookies.get('selectedModel')) {
            setM('auto');
          }

          Cookies.set('selectedProvider', 'OmniRoute', { expires: 365 });
          Cookies.set('selectedModel', 'auto', { expires: 365 });
        }
      }

      return result;
    } finally {
      setIsDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (ran.current) {
      return;
    }

    ran.current = true;
    void applyDiscovery();
  }, [applyDiscovery]);

  const selectModel = useCallback((providerName: string, modelName: string) => {
    updateProviderSettings(providerName, { enabled: true });
    syncProviderSettingsCookie();

    const providerInfo = PROVIDER_LIST.find((p) => p.name === providerName);

    if (providerInfo && optionsRef.current?.setProvider) {
      optionsRef.current.setProvider(providerInfo as ProviderInfo);
    }

    optionsRef.current?.setModel?.(modelName);
    Cookies.set('selectedProvider', providerName, { expires: 365 });
    Cookies.set('selectedModel', modelName, { expires: 365 });
  }, []);

  return {
    discovery,
    isDiscovering,
    rediscover: () => applyDiscovery(true),
    selectModel,
    onlineProviders: discovery?.onlineProviderNames ?? [],
    allModels: discovery?.allModels ?? [],
  };
}
