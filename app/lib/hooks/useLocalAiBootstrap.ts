import { useEffect, useRef } from 'react';
import Cookies from 'js-cookie';
import { OMNIROUTE_AUTO_MODEL } from '~/lib/omniroute/config';
import { getStoredLocalAiProfile, LOCAL_AI_PROFILES } from '~/lib/local-ai/profile';
import { updateProviderSettings } from '~/lib/stores/settings';
import { useMCPStore } from '~/lib/stores/mcp';
import type { ProviderInfo } from '~/types/model';
import { PROVIDER_LIST } from '~/utils/constants';

const PROVIDER_COOKIE = 'selectedProvider';
const MODEL_COOKIE = 'selectedModel';
const BOOTSTRAP_KEY = 'luxcoder_local_ai_bootstrapped';

interface OmniRouteStatus {
  running: boolean;
  modelCount?: number;
}

/**
 * Cursor-style bootstrap: prefer OmniRoute gateway, then direct Ollama.
 * Skips if user already picked a provider/model.
 */
export function useLocalAiBootstrap(
  setProvider?: (provider: ProviderInfo) => void,
  setModel?: (model: string) => void,
) {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !setProvider || !setModel) {
      return;
    }

    ran.current = true;

    const savedProvider = Cookies.get(PROVIDER_COOKIE);
    const savedModel = Cookies.get(MODEL_COOKIE);

    if (savedProvider && savedModel) {
      return;
    }

    if (sessionStorage.getItem(BOOTSTRAP_KEY) === '1') {
      return;
    }

    void (async () => {
      const profile = getStoredLocalAiProfile();
      const profileConfig = LOCAL_AI_PROFILES[profile];

      let omniroute: OmniRouteStatus = { running: false };

      try {
        const res = await fetch('/api/omniroute-status');
        omniroute = (await res.json()) as OmniRouteStatus;
      } catch {
        /* offline */
      }

      const omnirouteProvider = PROVIDER_LIST.find((p) => p.name === 'OmniRoute');
      const ollamaProvider = PROVIDER_LIST.find((p) => p.name === 'Ollama');

      if (omniroute.running && omnirouteProvider) {
        updateProviderSettings('OmniRoute', { enabled: true });
        setProvider(omnirouteProvider as ProviderInfo);
        setModel(OMNIROUTE_AUTO_MODEL);
        Cookies.set(PROVIDER_COOKIE, 'OmniRoute', { expires: 365 });
        Cookies.set(MODEL_COOKIE, OMNIROUTE_AUTO_MODEL, { expires: 365 });

        try {
          await useMCPStore.getState().applyPreset('omniroute');
        } catch {
          /* optional */
        }

        sessionStorage.setItem(BOOTSTRAP_KEY, '1');

        return;
      }

      if (ollamaProvider) {
        updateProviderSettings('Ollama', { enabled: true });
        setProvider(ollamaProvider as ProviderInfo);
        setModel(profileConfig.defaultOllamaModel);
        Cookies.set(PROVIDER_COOKIE, 'Ollama', { expires: 365 });
        Cookies.set(MODEL_COOKIE, profileConfig.defaultOllamaModel, { expires: 365 });
        sessionStorage.setItem(BOOTSTRAP_KEY, '1');
      }
    })();
  }, [setProvider, setModel]);
}
