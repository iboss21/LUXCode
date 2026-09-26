import type { RuntimeKind } from './types';

/**
 * Runtime selection.
 *
 * Order: the user's choice in Settings -> Runtime (localStorage) wins, then the server default
 * (env LUXCODER_RUNTIME=local|webcontainer, default local). WebContainer is never chosen as an
 * automatic fallback: it is only loaded when explicitly selected.
 */

export const RUNTIME_STORAGE_KEY = 'luxcoder.runtime';

export interface LocalRuntimeSession {
  available: boolean;
  url?: string;
  wsUrl?: string;
  port?: number;
  token?: string;
  workspacesRoot?: string;
}

export interface RuntimeSession {
  runtime: RuntimeKind;
  local: LocalRuntimeSession;
}

export function getRuntimeOverride(): RuntimeKind | null {
  try {
    const value = globalThis.localStorage?.getItem(RUNTIME_STORAGE_KEY);
    return value === 'local' || value === 'webcontainer' ? value : null;
  } catch {
    return null;
  }
}

export function setRuntimeOverride(kind: RuntimeKind | null) {
  try {
    if (kind) {
      localStorage.setItem(RUNTIME_STORAGE_KEY, kind);
    } else {
      localStorage.removeItem(RUNTIME_STORAGE_KEY);
    }
  } catch {
    // storage unavailable
  }
}

/** Same-origin call to the LuxCoder server; returns the sidecar URL and session token. */
export async function fetchRuntimeSession(): Promise<RuntimeSession> {
  try {
    const res = await fetch('/api/runtime-session', { cache: 'no-store', credentials: 'same-origin' });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    return (await res.json()) as RuntimeSession;
  } catch {
    return { runtime: 'local', local: { available: false } };
  }
}

export async function resolveRuntimeChoice(): Promise<{ kind: RuntimeKind; session: RuntimeSession }> {
  const session = await fetchRuntimeSession();
  const kind = getRuntimeOverride() ?? session.runtime ?? 'local';

  return { kind, session };
}

/** Project id for the local workspace: the chat id from the URL, else a fresh id. */
export function currentProjectId(): string {
  const match = globalThis.location?.pathname.match(/\/chat\/([^/?#]+)/);
  const raw = match
    ? decodeURIComponent(match[1])
    : `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  return clean || `new-${Date.now().toString(36)}`;
}
