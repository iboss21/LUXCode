import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Switch } from '~/components/ui/Switch';
import {
  fetchRuntimeSession,
  getRuntimeOverride,
  setRuntimeOverride,
  type RuntimeSession,
} from '~/lib/runtime/container/config';
import type { RuntimeKind } from '~/lib/runtime/container/types';
import { classNames } from '~/utils/classNames';

interface SidecarSettings {
  settings: {
    fullShell: boolean;
    docker: boolean;
    dockerImage: string;
    commandTimeoutMs: number;
    extraAllowedCommands: string[];
  };
  workspacesRoot: string;
  docker: { available: boolean; version: string | null };
}

/** Settings -> Runtime: pick local runtime vs WebContainer, and the local runtime's sandbox options. */
export function RuntimeSettings() {
  const [session, setSession] = useState<RuntimeSession | null>(null);
  const [choice, setChoice] = useState<RuntimeKind | 'default'>('default');
  const [sidecar, setSidecar] = useState<SidecarSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (s: RuntimeSession, method: 'GET' | 'POST', body?: unknown) => {
    const res = await fetch(`${s.local.url}/api/settings`, {
      method,
      headers: { authorization: `Bearer ${s.local.token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      throw new Error(`local runtime returned HTTP ${res.status}`);
    }

    return (await res.json()) as SidecarSettings;
  }, []);

  useEffect(() => {
    setChoice(getRuntimeOverride() ?? 'default');

    void (async () => {
      const s = await fetchRuntimeSession();
      setSession(s);

      if (s.local.available) {
        try {
          setSidecar(await call(s, 'GET'));
        } catch (e) {
          setError(String((e as Error).message));
        }
      }
    })();
  }, [call]);

  const update = async (patch: Partial<SidecarSettings['settings']>) => {
    if (!session) {
      return;
    }

    try {
      setSidecar(await call(session, 'POST', patch));
      toast.success('Runtime settings saved');
    } catch (e) {
      toast.error(`Could not save runtime settings: ${(e as Error).message}`);
    }
  };

  const changeRuntime = (value: string) => {
    const kind = value === 'local' || value === 'webcontainer' ? value : null;
    setRuntimeOverride(kind);
    setChoice(kind ?? 'default');
    toast.info('Runtime changed. Reload the page to switch.');
  };

  const effective = choice === 'default' ? (session?.runtime ?? 'local') : choice;

  return (
    <motion.div
      className="bg-white dark:bg-[#0A0A0A] rounded-lg shadow-sm dark:shadow-none p-4 space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <div className="flex items-center gap-2">
        <div className="i-ph:terminal-window-fill w-4 h-4 text-purple-500" />
        <span className="text-sm font-medium text-bolt-elements-textPrimary">Runtime</span>
      </div>

      <div>
        <label className="block text-sm text-bolt-elements-textSecondary mb-2">Where projects run</label>
        <select
          value={choice}
          onChange={(e) => changeRuntime(e.target.value)}
          className={classNames(
            'w-full px-3 py-2 rounded-lg text-sm',
            'bg-[#FAFAFA] dark:bg-[#0A0A0A]',
            'border border-[#E5E5E5] dark:border-[#1A1A1A]',
            'text-bolt-elements-textPrimary',
            'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
          )}
        >
          <option value="default">
            Default ({session?.runtime === 'webcontainer' ? 'WebContainer' : 'LuxCoder local runtime'})
          </option>
          <option value="local">LuxCoder local runtime (this PC)</option>
          <option value="webcontainer">WebContainer (StackBlitz, in-browser)</option>
        </select>
        {effective === 'webcontainer' && (
          <p className="mt-2 text-xs text-amber-500">
            WebContainer loads StackBlitz&apos;s runtime. Commercial production use needs a StackBlitz licence.
          </p>
        )}
        {effective === 'local' && session && !session.local.available && (
          <p className="mt-2 text-xs text-red-500">
            The local runtime is not running. Start LuxCoder with pnpm run dev or the Windows launcher.
          </p>
        )}
      </div>

      {sidecar && (
        <>
          <div className="text-xs text-bolt-elements-textTertiary break-all">Workspaces: {sidecar.workspacesRoot}</div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-bolt-elements-textPrimary">Full shell</div>
              <div className="text-xs text-bolt-elements-textSecondary">
                Allow any command, pipes and scripts through the system shell. Off: only node, npm, npx, pnpm, yarn,
                bun, vite, git and project tools.
              </div>
            </div>
            <Switch
              checked={sidecar.settings.fullShell}
              onCheckedChange={(checked) => void update({ fullShell: checked })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-bolt-elements-textPrimary">Docker isolation (experimental)</div>
              <div className="text-xs text-bolt-elements-textSecondary">
                {sidecar.docker.available
                  ? `Run commands in a ${sidecar.settings.dockerImage} container with only the workspace mounted (Docker ${sidecar.docker.version}).`
                  : 'Docker was not detected on this PC.'}
              </div>
            </div>
            {(sidecar.docker.available || sidecar.settings.docker) && (
              <Switch
                checked={sidecar.settings.docker}
                onCheckedChange={(checked) => void update({ docker: checked })}
              />
            )}
          </div>
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </motion.div>
  );
}
