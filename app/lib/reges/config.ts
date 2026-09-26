/**
 * Reges harness gateway (RegesCore-Ai) - an OpenAI-compatible endpoint on the Reges machine.
 *
 * Docs: RegesCore-Ai docs/HARNESS.md. On the Reges machine any API key works (loopback);
 * from another machine use an rg_ token as the key.
 */

export const REGES_DEFAULT_BASE_URL = 'http://127.0.0.1:3000/v1';
export const REGES_MCP_URL = 'http://127.0.0.1:3000/mcp';
export const REGES_DASHBOARD_URL = 'http://127.0.0.1:3000';

export const REGES_ENV = {
  baseUrl: 'REGES_API_BASE_URL',
  apiKey: 'REGES_API_KEY',
  models: 'REGES_API_MODELS',

  /** Harness mode for luxCoder requests: "plain" (default) or "harness" (Reges tools + reasoning). */
  mode: 'REGES_MODE',
} as const;

/** Cost-aware routing: local when free and idle, else the cheapest capable cloud model. */
export const REGES_DEFAULT_MODEL = 'reges/auto-cheap';

export const REGES_FALLBACK_MODELS = [
  { name: 'reges/auto-cheap', label: 'Reges · Auto (cheapest capable)', maxTokenAllowed: 128000 },
  { name: 'reges/auto-balanced', label: 'Reges · Auto (balanced)', maxTokenAllowed: 128000 },
  { name: 'reges/auto-best', label: 'Reges · Auto (best)', maxTokenAllowed: 128000 },
  { name: 'reges', label: 'Reges · Default route', maxTokenAllowed: 128000 },
] as const;

const MODEL_LABELS: Record<string, string> = Object.fromEntries(REGES_FALLBACK_MODELS.map((m) => [m.name, m.label]));

export function regesModelLabel(id: string): string {
  if (MODEL_LABELS[id]) {
    return MODEL_LABELS[id];
  }

  if (id.startsWith('reges/cloud/')) {
    return `Reges · Cloud ${id.slice('reges/cloud/'.length)}`;
  }

  if (id.startsWith('reges/local/')) {
    return `Reges · Local ${id.slice('reges/local/'.length)}`;
  }

  return id.startsWith('reges/') ? `Reges · ${id.slice('reges/'.length)}` : id;
}

export function normalizeRegesBaseUrl(url?: string): string {
  const raw = (url || REGES_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

/** Any key works on loopback; placeholders fall back to the literal "reges". */
export function resolveRegesApiKey(key?: string): string {
  const trimmed = key?.trim();

  if (trimmed && !trimmed.includes('your_') && !trimmed.includes('_here')) {
    return trimmed;
  }

  return 'reges';
}

/**
 * luxCoder sends its own long system prompt (boltArtifact format), so by default the
 * gateway is asked to behave as a plain model: no Reges preamble, no Reges tools, no
 * trace deltas. Set REGES_MODE=harness to get the full Reges harness instead.
 */
export function regesRequestHeaders(mode?: string): Record<string, string> {
  if ((mode || '').trim().toLowerCase() === 'harness') {
    return { 'X-Reges-Trace': 'off' };
  }

  return {
    'X-Reges-Preamble': 'none',
    'X-Reges-Tools': 'none',
    'X-Reges-Trace': 'off',
    'X-Reges-Reasoning': 'off',
  };
}
