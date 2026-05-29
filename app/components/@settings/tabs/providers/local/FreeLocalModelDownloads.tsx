import { useState } from 'react';
import { Button } from '~/components/ui/Button';
import { Download, Loader2, CheckCircle2 } from 'lucide-react';

export const RECOMMENDED_LOCAL_MODELS = [
  {
    id: 'qwen2.5-coder:14b',
    label: 'Qwen2.5 Coder 14B',
    description: 'Best for vibe coding on 12 GB GPU (recommended)',
    sizeHint: '~9 GB',
  },
  {
    id: 'qwen2.5-coder:7b',
    label: 'Qwen2.5 Coder 7B',
    description: 'Faster replies, lighter on VRAM',
    sizeHint: '~5 GB',
  },
  {
    id: 'deepseek-coder-v2:16b',
    label: 'DeepSeek Coder v2 16B',
    description: 'Strong multi-file refactors',
    sizeHint: '~10 GB',
  },
] as const;

interface FreeLocalModelDownloadsProps {
  ollamaBaseUrl: string;
  installedModelNames: string[];
  onPullComplete?: () => void;
}

export function FreeLocalModelDownloads({
  ollamaBaseUrl,
  installedModelNames,
  onPullComplete,
}: FreeLocalModelDownloadsProps) {
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const pullModel = async (modelId: string) => {
    setPulling(modelId);
    setProgress('Starting download…');

    try {
      const base = ollamaBaseUrl.replace(/\/$/, '');
      const response = await fetch(`${base}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelId }),
      });

      if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
      }

      const reader = response.body?.getReader();

      if (!reader) {
        throw new Error('No download stream');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = new TextDecoder().decode(value);

        for (const line of text.split('\n').filter(Boolean)) {
          try {
            const data = JSON.parse(line) as { status?: string; completed?: number; total?: number };

            if (data.status) {
              if (data.completed && data.total) {
                const pct = Math.round((data.completed / data.total) * 100);
                setProgress(`${data.status} (${pct}%)`);
              } else {
                setProgress(data.status);
              }
            }
          } catch {
            /* ignore partial JSON */
          }
        }
      }

      setProgress('Done');
      onPullComplete?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      setProgress(message);
      window.alert(
        `Could not download ${modelId}.\n\nInstall Ollama from https://ollama.com/download and make sure it is running, then try again.\n\n${message}`,
      );
    } finally {
      setPulling(null);
      setTimeout(() => setProgress(null), 4000);
    }
  };

  return (
    <div className="rounded-lg border border-[rgba(201,169,110,0.25)] bg-[rgba(201,169,110,0.06)] p-4 space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Free local AI — no API key</h4>
        <p className="text-xs text-bolt-elements-textSecondary mt-1">
          Models run on your GPU/CPU like a local ChatGPT. Download once, use forever. Pick a coding model below, then
          select <strong>Ollama</strong> in the chat provider dropdown.
        </p>
      </div>

      <div className="grid gap-2">
        {RECOMMENDED_LOCAL_MODELS.map((model) => {
          const installed = installedModelNames.some(
            (n) => n === model.id || n.startsWith(`${model.id}:`) || n.includes(model.id),
          );
          const isPulling = pulling === model.id;

          return (
            <div
              key={model.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-bolt-elements-textPrimary">{model.label}</span>
                  {installed && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                </div>
                <p className="text-xs text-bolt-elements-textSecondary">{model.description}</p>
                <p className="text-xs text-bolt-elements-textTertiary">{model.sizeHint}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={!!pulling}
                onClick={() => pullModel(model.id)}
                className="shrink-0 border-[rgba(201,169,110,0.35)] text-[#c9a96e] hover:bg-[rgba(201,169,110,0.12)]"
              >
                {isPulling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    Downloading…
                  </>
                ) : installed ? (
                  'Re-download'
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {progress && <p className="text-xs text-bolt-elements-textTertiary">{progress}</p>}

      <p className="text-xs text-bolt-elements-textTertiary">
        Requires{' '}
        <a href="https://ollama.com/download" target="_blank" rel="noreferrer" className="text-[#c9a96e] underline">
          Ollama
        </a>{' '}
        installed and running. Custom model: use the field below or{' '}
        <code className="text-[10px] bg-bolt-elements-background-depth-3 px-1 rounded">ollama pull model-name</code>
      </p>
    </div>
  );
}
