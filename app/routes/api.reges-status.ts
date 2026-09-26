import { json, type LoaderFunction } from '@remix-run/cloudflare';
import {
  REGES_DASHBOARD_URL,
  REGES_DEFAULT_BASE_URL,
  REGES_DEFAULT_MODEL,
  normalizeRegesBaseUrl,
  resolveRegesApiKey,
} from '~/lib/reges/config';

/** Is the Reges harness gateway reachable? Server-side probe (the gateway refuses cross-site browser calls). */
export const loader: LoaderFunction = async ({ context }) => {
  const env = (context?.cloudflare?.env ?? process.env) as unknown as Record<string, string | undefined>;
  const baseUrl = normalizeRegesBaseUrl(env.REGES_API_BASE_URL || REGES_DEFAULT_BASE_URL);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${resolveRegesApiKey(env.REGES_API_KEY)}` },
      signal: AbortSignal.timeout(2500),
    });

    if (!response.ok) {
      return json({ running: false, baseUrl, dashboardUrl: REGES_DASHBOARD_URL, error: `HTTP ${response.status}` });
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    const ids = data.data?.map((m) => m.id) ?? [];

    return json({
      running: true,
      baseUrl,
      dashboardUrl: REGES_DASHBOARD_URL,
      modelCount: ids.length,
      models: ids.slice(0, 12),
      defaultModel: ids.includes(REGES_DEFAULT_MODEL) ? REGES_DEFAULT_MODEL : ids[0],
    });
  } catch {
    return json({ running: false, baseUrl, dashboardUrl: REGES_DASHBOARD_URL, error: 'Unreachable' });
  }
};
