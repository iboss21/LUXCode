/** OmniRoute local AI gateway — https://github.com/diegosouzapw/OmniRoute */

export const OMNIROUTE_DEFAULT_BASE_URL = 'http://127.0.0.1:20128/v1';
export const OMNIROUTE_DASHBOARD_URL = 'http://127.0.0.1:20128/home';
export const OMNIROUTE_MCP_STREAM_URL = 'http://127.0.0.1:20128/api/mcp/stream';
export const OMNIROUTE_MCP_SSE_URL = 'http://127.0.0.1:20128/api/mcp/sse';

export const OMNIROUTE_ENV = {
  baseUrl: 'OMNIROUTE_API_BASE_URL',
  apiKey: 'OMNIROUTE_API_KEY',
  models: 'OMNIROUTE_API_MODELS',
} as const;

/** Smart routing — OmniRoute picks the best available local/cloud model */
export const OMNIROUTE_AUTO_MODEL = 'auto';

export const OMNIROUTE_FALLBACK_MODELS = [
  { name: OMNIROUTE_AUTO_MODEL, label: 'Auto (OmniRoute smart routing)', maxTokenAllowed: 128000 },
  { name: 'ollama/qwen2.5-coder:7b', label: 'Ollama · Qwen2.5 Coder 7B (fast, light VRAM)', maxTokenAllowed: 8192 },
  { name: 'ollama/qwen2.5-coder:14b', label: 'Ollama · Qwen2.5 Coder 14B (balanced)', maxTokenAllowed: 16384 },
] as const;

export function normalizeOmniRouteBaseUrl(url?: string): string {
  const raw = (url || OMNIROUTE_DEFAULT_BASE_URL).trim().replace(/\/$/, '');

  if (raw.endsWith('/v1')) {
    return raw;
  }

  return `${raw}/v1`;
}

export function resolveOmniRouteApiKey(key?: string): string {
  const trimmed = key?.trim();

  if (trimmed && trimmed.length > 0 && !trimmed.includes('your_') && !trimmed.includes('_here')) {
    return trimmed;
  }

  return 'luxcoder-local';
}
