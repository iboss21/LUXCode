import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { OMNIROUTE_DEFAULT_BASE_URL, normalizeOmniRouteBaseUrl, resolveOmniRouteApiKey } from '~/lib/omniroute/config';

export type DiscoveredProvider = {
  name: string;
  online: boolean;
  baseUrl: string;
  modelCount: number;
  models: ModelInfo[];
  error?: string;
};

export type LocalAiDiscoveryResult = {
  providers: DiscoveredProvider[];
  allModels: ModelInfo[];
  onlineProviderNames: string[];
  recommended: { provider: string; model: string } | null;
};

const PROBE_TARGETS = [
  {
    name: 'OmniRoute',
    envBaseUrlKey: 'OMNIROUTE_API_BASE_URL',
    defaultBaseUrl: OMNIROUTE_DEFAULT_BASE_URL,
    envApiKeyKey: 'OMNIROUTE_API_KEY',
    probePath: '/models',
    auth: true,
  },
  {
    name: 'Ollama',
    envBaseUrlKey: 'OLLAMA_API_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    probePath: '/api/tags',
    auth: false,
  },
  {
    name: 'LMStudio',
    envBaseUrlKey: 'LMSTUDIO_API_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:1234',
    probePath: '/v1/models',
    auth: false,
  },
] as const;

function resolveBaseUrl(env: Record<string, string | undefined>, key: string, fallback: string): string {
  const raw = env[key]?.trim() || fallback;
  return raw.replace(/\/$/, '');
}

function resolveApiKey(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw && !raw.includes('your_') && !raw.includes('_here') ? raw : undefined;
}

async function probeOllama(baseUrl: string): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };

  return (data.models ?? []).map((m) => ({
    name: m.name,
    label: m.details?.parameter_size ? `${m.name} (${m.details.parameter_size})` : m.name,
    provider: 'Ollama',
    maxTokenAllowed: 8192,
  }));
}

async function probeLmStudio(baseUrl: string): Promise<ModelInfo[]> {
  const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(4000) });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data?: Array<{ id: string }> };

  return (data.data ?? []).map((m) => ({
    name: m.id,
    label: m.id,
    provider: 'LMStudio',
    maxTokenAllowed: 8192,
  }));
}

async function probeOmniRoute(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const normalized = normalizeOmniRouteBaseUrl(baseUrl);
  const response = await fetch(`${normalized}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { data?: Array<{ id: string }> };

  return (data.data ?? []).map((m) => ({
    name: m.id,
    label: m.id === 'auto' ? 'Auto (OmniRoute smart routing)' : m.id,
    provider: 'OmniRoute',
    maxTokenAllowed: 128000,
  }));
}

export async function discoverLocalAi(
  serverEnv: Record<string, string | undefined> = {},
): Promise<LocalAiDiscoveryResult> {
  const llmManager = LLMManager.getInstance(serverEnv as Record<string, string>);
  const providers: DiscoveredProvider[] = [];

  for (const target of PROBE_TARGETS) {
    const baseUrl =
      target.name === 'OmniRoute'
        ? normalizeOmniRouteBaseUrl(resolveBaseUrl(serverEnv, target.envBaseUrlKey, target.defaultBaseUrl))
        : resolveBaseUrl(serverEnv, target.envBaseUrlKey, target.defaultBaseUrl);

    let online = false;
    let models: ModelInfo[] = [];
    let error: string | undefined;

    try {
      if (target.name === 'Ollama') {
        models = await probeOllama(baseUrl);
      } else if (target.name === 'LMStudio') {
        models = await probeLmStudio(baseUrl);
      } else if (target.name === 'OmniRoute') {
        const apiKey = resolveOmniRouteApiKey(resolveApiKey(serverEnv, target.envApiKeyKey));
        models = await probeOmniRoute(baseUrl, apiKey);
      }

      online = models.length > 0 || target.name === 'OmniRoute';

      if (target.name === 'OmniRoute' && models.length === 0) {
        const provider = llmManager.getProvider('OmniRoute');
        models = provider?.staticModels?.map((m) => ({ ...m, provider: 'OmniRoute' })) ?? [];
        online = true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unreachable';

      if (target.name === 'OmniRoute') {
        const provider = llmManager.getProvider('OmniRoute');
        models = provider?.staticModels?.map((m) => ({ ...m, provider: 'OmniRoute' })) ?? [];

        try {
          const apiKey = resolveOmniRouteApiKey(resolveApiKey(serverEnv, target.envApiKeyKey));
          await fetch(`${baseUrl}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(2000),
          });
          online = true;
        } catch {
          online = false;
        }
      }
    }

    providers.push({
      name: target.name,
      online,
      baseUrl,
      modelCount: models.length,
      models,
      error: online ? undefined : error,
    });
  }

  const onlineProviderNames = providers.filter((p) => p.online).map((p) => p.name);
  const allModels = providers.flatMap((p) => (p.online ? p.models : []));

  let recommended: LocalAiDiscoveryResult['recommended'] = null;

  const omniroute = providers.find((p) => p.name === 'OmniRoute' && p.online);

  if (omniroute && omniroute.models.length > 0) {
    const auto = omniroute.models.find((m) => m.name === 'auto');
    recommended = { provider: 'OmniRoute', model: auto?.name ?? omniroute.models[0].name };
  } else {
    const ollama = providers.find((p) => p.name === 'Ollama' && p.online && p.models.length > 0);

    if (ollama) {
      const preferred =
        ollama.models.find((m) => m.name.includes('qwen2.5-coder:7b')) ??
        ollama.models.find((m) => m.name.includes('qwen2.5-coder:14b')) ??
        ollama.models[0];
      recommended = { provider: 'Ollama', model: preferred.name };
    } else {
      const any = providers.find((p) => p.online && p.models.length > 0);

      if (any) {
        recommended = { provider: any.name, model: any.models[0].name };
      }
    }
  }

  return { providers, allModels, onlineProviderNames, recommended };
}
