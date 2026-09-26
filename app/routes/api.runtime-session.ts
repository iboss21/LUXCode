import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';

/**
 * Hands the browser the LuxCoder local runtime's address and per-session token.
 *
 * Same-origin only: no CORS headers are sent (other sites cannot read the response), requests
 * whose Host is not a loopback name are refused (DNS rebinding), and browsers that send
 * Sec-Fetch-Site must report "same-origin".
 */

interface SidecarInfo {
  port: number;
  url: string;
  wsUrl: string;
  token: string;
  workspacesRoot: string;
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

function runtimeDefault(env: Record<string, string | undefined>): 'local' | 'webcontainer' {
  return String(env.LUXCODER_RUNTIME || 'local').toLowerCase() === 'webcontainer' ? 'webcontainer' : 'local';
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = ((context as any)?.cloudflare?.env ?? {}) as Record<string, string | undefined>;
  const nodeEnv = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;
  const runtime = runtimeDefault({ ...env, ...nodeEnv });
  const headers = { 'Cache-Control': 'no-store' };

  const host = request.headers.get('host') || '';
  const fetchSite = request.headers.get('sec-fetch-site');

  if (!LOOPBACK_HOST.test(host) || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
    return json({ runtime, local: { available: false } }, { status: 403, headers });
  }

  const sidecar = (globalThis as any).__luxcoderRuntimeSidecar as SidecarInfo | undefined;

  if (!sidecar) {
    return json({ runtime, local: { available: false } }, { headers });
  }

  return json(
    {
      runtime,
      local: {
        available: true,
        url: sidecar.url,
        wsUrl: sidecar.wsUrl,
        port: sidecar.port,
        token: sidecar.token,
        workspacesRoot: sidecar.workspacesRoot,
      },
    },
    { headers },
  );
}
