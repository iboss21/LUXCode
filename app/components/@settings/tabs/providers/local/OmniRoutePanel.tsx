import { useCallback, useEffect, useState } from 'react';
import { Button } from '~/components/ui/Button';
import { useSettings } from '~/lib/hooks/useSettings';
import {
  LOCAL_AI_PROFILES,
  type LocalAiProfile,
  getStoredLocalAiProfile,
  setStoredLocalAiProfile,
} from '~/lib/local-ai/profile';
import { OMNIROUTE_DASHBOARD_URL, OMNIROUTE_DEFAULT_BASE_URL, OMNIROUTE_AUTO_MODEL } from '~/lib/omniroute/config';
import { classNames } from '~/utils/classNames';

interface OmniRouteStatus {
  running: boolean;
  modelCount?: number;
  models?: string[];
  error?: string;
  dashboardUrl?: string;
}

export function OmniRoutePanel() {
  const { providers, updateProviderSettings } = useSettings();
  const [status, setStatus] = useState<OmniRouteStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<LocalAiProfile>(() => getStoredLocalAiProfile());
  const [apiKey, setApiKey] = useState(() => {
    const saved = (providers?.OmniRoute?.settings as any)?.apiKey;
    return saved || 'luxcoder-local';
  });

  // Keep the input in sync if settings change externally (e.g. auto-connect on startup)
  useEffect(() => {
    const saved = (providers?.OmniRoute?.settings as any)?.apiKey;

    if (saved && saved !== apiKey && !apiKey) {
      setApiKey(saved);
    }
  }, [providers?.OmniRoute?.settings]);

  const omnirouteSettings = providers?.OmniRoute?.settings;
  const isEnabled = omnirouteSettings?.enabled ?? false;

  // Prefill the key input from current settings or a friendly default
  const currentKey = (omnirouteSettings as any)?.apiKey || '';

  if (!apiKey && currentKey) {
    // only set once on mount / when settings arrive
    if (currentKey !== 'luxcoder-local') {
      // don't overwrite if user is typing, but on first load we can show what's saved
    }
  }

  const refreshStatus = useCallback(async () => {
    setChecking(true);

    try {
      const res = await fetch('/api/omniroute-status');
      setStatus((await res.json()) as OmniRouteStatus);
    } catch {
      setStatus({ running: false, error: 'Could not reach luxCoder API' });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connectOmniRoute = (useDefaultKey = false) => {
    const desiredKey = apiKey.trim() || (useDefaultKey ? 'luxcoder-local' : undefined);

    const payload: any = {
      enabled: true,
      baseUrl: omnirouteSettings?.baseUrl || OMNIROUTE_DEFAULT_BASE_URL,
    };

    if (desiredKey) {
      payload.apiKey = desiredKey;
    }

    updateProviderSettings('OmniRoute', payload);

    // Also persist a friendly default key into localStorage provider settings for future auto-connects
    if (desiredKey === 'luxcoder-local') {
      try {
        const raw = localStorage.getItem('provider_settings');
        const all = raw ? JSON.parse(raw) : {};
        all.OmniRoute = {
          ...(all.OmniRoute || {}),
          settings: {
            ...(all.OmniRoute?.settings || {}),
            enabled: true,
            baseUrl: payload.baseUrl,
            apiKey: 'luxcoder-local',
          },
        };
        localStorage.setItem('provider_settings', JSON.stringify(all));
      } catch {}
    }
  };

  const selectProfile = (next: LocalAiProfile) => {
    setProfile(next);
    setStoredLocalAiProfile(next);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgba(201,169,110,0.35)] bg-[rgba(201,169,110,0.06)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-bolt-elements-textPrimary flex items-center gap-2">
              <span className="i-ph:path text-[#c9a96e]" />
              OmniRoute — Cursor-style AI gateway
            </h4>
            <p className="text-xs text-bolt-elements-textSecondary mt-1 max-w-xl">
              One local endpoint for Ollama, cloud APIs, and smart fallback. Point luxCoder at{' '}
              <code className="text-[#c9a96e]">localhost:20128/v1</code> like Cursor + Claude Code. Routes models,
              compresses tokens, and avoids maxing your GPU.
            </p>
          </div>
          <span
            className={classNames(
              'shrink-0 text-xs px-2 py-1 rounded-full border',
              status?.running
                ? 'border-green-500/40 text-green-400 bg-green-500/10'
                : 'border-bolt-elements-borderColor text-bolt-elements-textTertiary',
            )}
          >
            {checking ? 'Checking…' : status?.running ? `${status.modelCount ?? 0} models` : 'Offline'}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              connectOmniRoute(true); // one-click with luxcoder-local default
              void refreshStatus();
            }}
          >
            {isEnabled ? 'OmniRoute connected' : 'One-click connect (auto)'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              connectOmniRoute(false);
              void refreshStatus();
            }}
          >
            Enable with my key
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.open(OMNIROUTE_DASHBOARD_URL, '_blank')}>
            Open dashboard
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={checking}>
            Refresh
          </Button>
        </div>

        {!status?.running && (
          <div className="mt-3 text-xs text-bolt-elements-textSecondary space-y-1">
            <p>Install and start OmniRoute (once) — the launcher can do this for you:</p>
            <code className="block p-2 rounded bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary">
              Just run starter.bat — it will offer to install + start OmniRoute automatically.
            </code>
            <p>
              Or manually: <code>npm install -g omniroute && omniroute</code>
              <br />
              Then in Dashboard → Endpoints create a key, or just use <code>luxcoder-local</code> for quick testing.
            </p>
          </div>
        )}

        {status?.running && (
          <div className="mt-2 text-[11px] text-bolt-elements-textTertiary">
            luxCoder auto-detects running OmniRoute on startup and connects with model <b>auto</b>.
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-bolt-elements-textSecondary">
            API key (Dashboard → Endpoints)
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-… or luxcoder-local"
              className="mt-1 w-full px-3 py-2 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm"
            />
          </label>
          <label className="text-xs text-bolt-elements-textSecondary">
            Chat model
            <input
              readOnly
              value={OMNIROUTE_AUTO_MODEL}
              className="mt-1 w-full px-3 py-2 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary text-sm opacity-80"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-bolt-elements-borderColor p-4">
        <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">PC load profile</h4>
        <p className="text-xs text-bolt-elements-textSecondary mt-1 mb-3">
          Controls context size and agent steps so local inference stays fast and cool.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(LOCAL_AI_PROFILES) as LocalAiProfile[]).map((key) => {
            const item = LOCAL_AI_PROFILES[key];
            const active = profile === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => selectProfile(key)}
                className={classNames(
                  'text-left p-3 rounded-lg border transition-colors',
                  active
                    ? 'border-[rgba(201,169,110,0.5)] bg-[rgba(201,169,110,0.08)]'
                    : 'border-bolt-elements-borderColor hover:border-[rgba(201,169,110,0.25)]',
                )}
              >
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{item.label}</div>
                <div className="text-xs text-bolt-elements-textSecondary mt-1">{item.description}</div>
                <div className="text-[10px] text-bolt-elements-textTertiary mt-2">
                  ctx {item.numCtx.toLocaleString()} · {item.maxLLMSteps} agent steps
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
