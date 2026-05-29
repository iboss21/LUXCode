import { useEffect, useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { Dialog, DialogRoot, DialogClose, DialogTitle, DialogButton } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { useMCPStore } from '~/lib/stores/mcp';
import McpServerList from '~/components/@settings/tabs/mcp/McpServerList';
import { MCP_PRESETS, countAvailableTools, countConfiguredServers, type McpPresetId } from '~/lib/mcp/presets';
import { requestOpenSettings } from '~/lib/stores/settingsPanel';
import { toast } from 'react-toastify';

export function McpTools() {
  const isInitialized = useMCPStore((state) => state.isInitialized);
  const settings = useMCPStore((state) => state.settings);
  const serverTools = useMCPStore((state) => state.serverTools);
  const isUpdatingConfig = useMCPStore((state) => state.isUpdatingConfig);
  const initialize = useMCPStore((state) => state.initialize);
  const applyPreset = useMCPStore((state) => state.applyPreset);
  const checkServersAvailabilities = useMCPStore((state) => state.checkServersAvailabilities);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingServers, setIsCheckingServers] = useState(false);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [applyingPreset, setApplyingPreset] = useState<McpPresetId | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

  const checkServerAvailability = async () => {
    setIsCheckingServers(true);
    setError(null);

    try {
      await checkServersAvailabilities();
    } catch (e) {
      setError(`Failed to check server availability: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsCheckingServers(false);
    }
  };

  const handleApplyPreset = async (presetId: McpPresetId) => {
    setApplyingPreset(presetId);
    setError(null);

    try {
      await applyPreset(presetId);
      toast.success(`${MCP_PRESETS[presetId].label} enabled — tools are ready to use in chat.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast.error(`Failed to enable MCP tools: ${message}`);
    } finally {
      setApplyingPreset(null);
    }
  };

  const toggleServerExpanded = (serverName: string) => {
    setExpandedServer(expandedServer === serverName ? null : serverName);
  };

  const serverEntries = useMemo(() => Object.entries(serverTools), [serverTools]);
  const configuredCount = countConfiguredServers(settings.mcpConfig);
  const availableToolCount = countAvailableTools(serverTools);
  const hasServers = configuredCount > 0;

  return (
    <div className="relative">
      <div className="flex">
        <IconButton
          onClick={() => setIsDialogOpen(!isDialogOpen)}
          title={
            hasServers
              ? `MCP tools — ${availableToolCount} tool(s) available`
              : 'MCP tools — click to enable web fetch, docs, memory'
          }
          disabled={!isInitialized}
          className="transition-all disabled:opacity-50 disabled:cursor-not-allowed relative"
        >
          {!isInitialized ? (
            <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl animate-spin"></div>
          ) : (
            <>
              <div className="i-bolt:mcp text-xl"></div>
              {availableToolCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#c9a96e] text-[10px] font-bold text-black leading-4 text-center">
                  {availableToolCount > 99 ? '99+' : availableToolCount}
                </span>
              )}
            </>
          )}
        </IconButton>
      </div>

      <DialogRoot open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        {isDialogOpen && (
          <Dialog className="max-w-4xl w-full p-6">
            <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-2">
              <DialogTitle>
                <div className="i-bolt:mcp text-xl"></div>
                MCP tools
              </DialogTitle>

              <p className="text-sm text-bolt-elements-textSecondary">
                Give luxCoder extra powers — fetch URLs, search documentation, remember context, and run multi-step tool
                calls (like Cursor agent tools). Requires Node.js on your PC for local MCP servers.
              </p>

              <div className="space-y-4">
                {!hasServers && (
                  <div className="rounded-lg border border-[rgba(201,169,110,0.25)] bg-[rgba(201,169,110,0.06)] p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">Quick setup — one click</h4>
                    <div className="grid gap-2">
                      {(Object.keys(MCP_PRESETS) as McpPresetId[]).map((presetId) => {
                        const preset = MCP_PRESETS[presetId];
                        const isApplying = applyingPreset === presetId;

                        return (
                          <div
                            key={presetId}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 rounded-lg bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor"
                          >
                            <div>
                              <p className="text-sm font-medium text-bolt-elements-textPrimary">{preset.label}</p>
                              <p className="text-xs text-bolt-elements-textSecondary">{preset.description}</p>
                            </div>
                            <button
                              disabled={!!applyingPreset || isUpdatingConfig}
                              onClick={() => handleApplyPreset(presetId)}
                              className={classNames(
                                'shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium',
                                'border border-[rgba(201,169,110,0.35)] text-[#c9a96e]',
                                'hover:bg-[rgba(201,169,110,0.12)] transition-colors',
                                'disabled:opacity-50 disabled:cursor-not-allowed',
                              )}
                            >
                              {isApplying ? 'Enabling…' : 'Enable'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {hasServers && (
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(MCP_PRESETS) as McpPresetId[]).map((presetId) => (
                      <button
                        key={presetId}
                        disabled={!!applyingPreset || isUpdatingConfig}
                        onClick={() => handleApplyPreset(presetId)}
                        className="px-3 py-1.5 rounded-lg text-xs border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-3 disabled:opacity-50"
                      >
                        + {MCP_PRESETS[presetId].label}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setIsDialogOpen(false);
                        requestOpenSettings('mcp');
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-3"
                    >
                      Advanced settings
                    </button>
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-bolt-elements-textSecondary">
                      {hasServers
                        ? `${configuredCount} server(s) · ${availableToolCount} tool(s) ready · max ${settings.maxLLMSteps} steps`
                        : 'No servers yet'}
                    </span>
                    <button
                      onClick={checkServerAvailability}
                      disabled={isCheckingServers || serverEntries.length === 0}
                      className={classNames(
                        'px-3 py-1.5 rounded-lg text-sm',
                        'bg-bolt-elements-background-depth-3 hover:bg-bolt-elements-background-depth-4',
                        'text-bolt-elements-textPrimary',
                        'transition-all duration-200',
                        'flex items-center gap-2',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                    >
                      {isCheckingServers ? (
                        <div className="i-svg-spinners:90-ring-with-bg w-3 h-3 text-bolt-elements-loader-progress animate-spin" />
                      ) : (
                        <div className="i-ph:arrow-counter-clockwise w-3 h-3" />
                      )}
                      Check availability
                    </button>
                  </div>

                  {serverEntries.length > 0 ? (
                    <McpServerList
                      checkingServers={isCheckingServers}
                      expandedServer={expandedServer}
                      serverEntries={serverEntries}
                      onlyShowAvailableServers={false}
                      toggleServerExpanded={toggleServerExpanded}
                    />
                  ) : (
                    <div className="py-4 text-center text-bolt-elements-textSecondary">
                      <p>No MCP servers configured</p>
                      <p className="text-xs mt-1">Use a quick setup preset above, or open Settings → MCP Servers</p>
                    </div>
                  )}
                </div>

                {error && <p className="text-sm text-bolt-elements-icon-error">{error}</p>}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                {!hasServers && (
                  <button
                    onClick={() => {
                      setIsDialogOpen(false);
                      requestOpenSettings('mcp');
                    }}
                    className="px-4 py-2 rounded-lg text-sm border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-3"
                  >
                    Open MCP Settings
                  </button>
                )}
                <DialogClose asChild>
                  <DialogButton type="secondary">Close</DialogButton>
                </DialogClose>
              </div>
            </div>
          </Dialog>
        )}
      </DialogRoot>
    </div>
  );
}
