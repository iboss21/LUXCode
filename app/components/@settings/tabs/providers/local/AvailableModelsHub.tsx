import { useCallback, useEffect, useState } from 'react';
import { Button } from '~/components/ui/Button';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { DiscoveredProvider } from '~/lib/local-ai/discovery';
import { classNames } from '~/utils/classNames';

interface AvailableModelsHubProps {
  onSelectModel?: (provider: string, model: string) => void;
}

export function AvailableModelsHub({ onSelectModel }: AvailableModelsHubProps) {
  const [providers, setProviders] = useState<DiscoveredProvider[]>([]);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/discover-local-ai');
      const data = (await res.json()) as { providers: DiscoveredProvider[]; allModels: ModelInfo[] };
      setProviders(data.providers ?? []);
      setAllModels(data.allModels ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredModels = filter === 'all' ? allModels : allModels.filter((m) => m.provider === filter);

  const onlineCount = providers.filter((p) => p.online).length;

  return (
    <div className="rounded-lg border border-[rgba(201,169,110,0.35)] bg-bolt-elements-background-depth-2 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">All available models</h3>
          <p className="text-xs text-bolt-elements-textSecondary mt-1">
            Auto-scanned from OmniRoute, Ollama, and LM Studio. Pick any model — full freedom.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Scanning…' : 'Rescan'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setFilter(p.name)}
            className={classNames(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors',
              filter === p.name
                ? 'border-[rgba(201,169,110,0.5)] bg-[rgba(201,169,110,0.08)] text-[#c9a96e]'
                : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:border-[rgba(201,169,110,0.25)]',
            )}
          >
            <span className={classNames('w-2 h-2 rounded-full', p.online ? 'bg-green-500' : 'bg-red-400')} />
            {p.name}
            <span className="opacity-70">({p.modelCount})</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={classNames(
            'px-3 py-1.5 rounded-lg border text-xs',
            filter === 'all'
              ? 'border-[rgba(201,169,110,0.5)] text-[#c9a96e]'
              : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary',
          )}
        >
          All ({allModels.length})
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-bolt-elements-textTertiary">Discovering local AI…</div>
      ) : filteredModels.length === 0 ? (
        <div className="py-8 text-center text-sm text-bolt-elements-textSecondary space-y-2">
          <p>No models found{onlineCount === 0 ? ' — start OmniRoute, Ollama, or LM Studio' : ''}.</p>
          <p className="text-xs text-bolt-elements-textTertiary">
            OmniRoute: connect Ollama under Providers in the OmniRoute dashboard, then rescan here.
          </p>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto grid gap-1">
          {filteredModels.map((m) => (
            <div
              key={`${m.provider}:${m.name}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-bolt-elements-borderColor/60 hover:border-[rgba(201,169,110,0.3)] hover:bg-bolt-elements-background-depth-3"
            >
              <div className="min-w-0">
                <div className="text-sm text-bolt-elements-textPrimary truncate">{m.label || m.name}</div>
                <div className="text-[10px] text-bolt-elements-textTertiary">{m.provider}</div>
              </div>
              {onSelectModel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 text-xs h-7"
                  onClick={() => onSelectModel(m.provider, m.name)}
                >
                  Use in chat
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
