import React, { useState, useEffect, useCallback } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { ProviderInfo } from '~/types/model';
import Cookies from 'js-cookie';
import { isPlausibleApiKey, normalizeApiKey } from '~/utils/apiKeyValidation';

interface APIKeyManagerProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
}

// cache which stores whether the provider's API key is set via environment variable
const providerEnvKeyStatusCache: Record<string, boolean> = {};

/** Server .env.local variable names (must match provider config.apiTokenKey) */
const PROVIDER_ENV_KEY_NAMES: Record<string, string> = {
  HuggingFace: 'HuggingFace_API_KEY',
  OpenAI: 'OPENAI_API_KEY',
  Anthropic: 'ANTHROPIC_API_KEY',
  Google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  Groq: 'GROQ_API_KEY',
  OpenRouter: 'OPEN_ROUTER_API_KEY',
};

const apiKeyMemoizeCache: { [k: string]: Record<string, string> } = {};

export function getApiKeysFromCookies() {
  const storedApiKeys = Cookies.get('apiKeys');
  let parsedKeys: Record<string, string> = {};

  if (storedApiKeys) {
    parsedKeys = apiKeyMemoizeCache[storedApiKeys];

    if (!parsedKeys) {
      parsedKeys = apiKeyMemoizeCache[storedApiKeys] = JSON.parse(storedApiKeys);
    }
  }

  return parsedKeys;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ provider, apiKey, setApiKey }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [isEnvKeySet, setIsEnvKeySet] = useState(false);

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  const checkEnvApiKey = useCallback(async () => {
    // Check cache first
    if (providerEnvKeyStatusCache[provider.name] !== undefined) {
      setIsEnvKeySet(providerEnvKeyStatusCache[provider.name]);
      return;
    }

    try {
      const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(provider.name)}`);
      const data = await response.json();
      const isSet = (data as { isSet: boolean }).isSet;

      // Cache the result
      providerEnvKeyStatusCache[provider.name] = isSet;
      setIsEnvKeySet(isSet);
    } catch (error) {
      console.error('Failed to check environment API key:', error);
      setIsEnvKeySet(false);
    }
  }, [provider.name]);

  useEffect(() => {
    checkEnvApiKey();
  }, [checkEnvApiKey]);

  const handleSave = () => {
    const trimmed = normalizeApiKey(tempKey) || '';

    if (provider.name === 'HuggingFace' && trimmed && !isPlausibleApiKey(trimmed, 'HuggingFace')) {
      window.alert(
        'Hugging Face token must start with hf_ and be a real token from huggingface.co/settings/tokens.\n\nCreate a Fine-grained token with "Make calls to Inference Providers" enabled.',
      );
      return;
    }

    setApiKey(trimmed);
    setTempKey(trimmed);

    const currentKeys = getApiKeysFromCookies();
    const newKeys = { ...currentKeys, [provider.name]: trimmed };
    Cookies.set('apiKeys', JSON.stringify(newKeys));

    providerEnvKeyStatusCache[provider.name] = isPlausibleApiKey(trimmed, provider.name);
    setIsEnvKeySet(isPlausibleApiKey(trimmed, provider.name));

    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between py-3 px-1">
      <div className="flex items-center gap-2 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-bolt-elements-textSecondary">{provider?.name} API Key:</span>
          {!isEditing && (
            <div className="flex items-center gap-2">
              {apiKey ? (
                isPlausibleApiKey(apiKey, provider.name) ? (
                  <>
                    <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                    <span className="text-xs text-green-500">Set via UI</span>
                  </>
                ) : (
                  <>
                    <div className="i-ph:warning-circle-fill text-amber-500 w-4 h-4" />
                    <span className="text-xs text-amber-500">Invalid key — click Change API Key</span>
                  </>
                )
              ) : isEnvKeySet ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-green-500">Set via environment variable</span>
                </>
              ) : (
                <>
                  <div className="i-ph:x-circle-fill text-red-500 w-4 h-4" />
                  <span className="text-xs text-red-500">
                    Not set — click <strong className="font-semibold">Set API Key</strong> on the right, or add{' '}
                    <code className="text-[10px] bg-bolt-elements-background-depth-3 px-1 rounded">
                      {PROVIDER_ENV_KEY_NAMES[provider.name] || `${provider.name}_API_KEY`}
                    </code>{' '}
                    to <code className="text-[10px]">.env.local</code>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={tempKey}
              placeholder="Enter API Key"
              onChange={(e) => setTempKey(e.target.value)}
              className="w-[300px] px-3 py-1.5 text-sm rounded border border-bolt-elements-borderColor 
                        bg-bolt-elements-prompt-background text-bolt-elements-textPrimary 
                        focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            <IconButton
              onClick={handleSave}
              title="Save API Key"
              className="bg-green-500/10 hover:bg-green-500/20 text-green-500"
            >
              <div className="i-ph:check w-4 h-4" />
            </IconButton>
            <IconButton
              onClick={() => setIsEditing(false)}
              title="Cancel"
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500"
            >
              <div className="i-ph:x w-4 h-4" />
            </IconButton>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              title="Set or change API key"
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-400 border border-blue-500/30 transition-colors"
            >
              {apiKey ? 'Change API Key' : 'Set API Key'}
            </button>
            {provider?.getApiKeyLink && !apiKey && (
              <button
                type="button"
                onClick={() => window.open(provider?.getApiKeyLink)}
                title="Open provider token page"
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-600 dark:text-purple-400 border border-purple-500/30 transition-colors whitespace-nowrap"
              >
                {provider?.labelForGetApiKey || 'Get API Key'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
