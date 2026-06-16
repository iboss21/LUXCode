import { json, type LoaderFunction } from '@remix-run/cloudflare';
import {
  OMNIROUTE_DEFAULT_BASE_URL,
  OMNIROUTE_DASHBOARD_URL,
  normalizeOmniRouteBaseUrl,
  resolveOmniRouteApiKey,
} from '~/lib/omniroute/config';

export const loader: LoaderFunction = async ({ context }) => {
  const env = (context?.cloudflare?.env ?? process.env) as unknown as Record<string, string | undefined>;
  const baseUrl = normalizeOmniRouteBaseUrl(env.OMNIROUTE_API_BASE_URL || OMNIROUTE_DEFAULT_BASE_URL);

  // Try env key first, then common local testing keys
  const candidateKeys = [resolveOmniRouteApiKey(env.OMNIROUTE_API_KEY), 'luxcoder-local', 'omniroute', ''].filter(
    (k, i, arr) => k && arr.indexOf(k) === i,
  ); // dedupe, keep order

  for (const key of candidateKeys) {
    try {
      const headers: Record<string, string> = {};

      if (key) {
        headers.Authorization = `Bearer ${key}`;
      }

      const response = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(2500),
      });

      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id: string }> };
        return json({
          running: true,
          baseUrl,
          dashboardUrl: OMNIROUTE_DASHBOARD_URL,
          modelCount: data.data?.length ?? 0,
          models: data.data?.slice(0, 12).map((m) => m.id) ?? [],
          usedKey: key || 'none',
        });
      }
    } catch {
      // try next key
    }
  }

  return json({
    running: false,
    baseUrl,
    dashboardUrl: OMNIROUTE_DASHBOARD_URL,
    modelCount: 0,
    error: 'Unreachable or no valid key',
  });
};
