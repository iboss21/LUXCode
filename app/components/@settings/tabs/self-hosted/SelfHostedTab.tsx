import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import {
  getEnabledServices,
  removeSelfHostedService,
  selfHostedServicesStore,
  updateSelfHostedServices,
  upsertSelfHostedService,
  type SelfHostedService,
} from '~/lib/stores/selfHostedServices';
import { SELF_HOSTED_PRESETS, createServiceFromPreset, getPreset } from '~/lib/self-hosted/presets';

export default function SelfHostedTab() {
  const state = useStore(selfHostedServicesStore);
  const [addingType, setAddingType] = useState<string>('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const enabledCount = getEnabledServices(state).length;

  const handleAdd = () => {
    const preset = SELF_HOSTED_PRESETS.find((p) => p.type === addingType);

    if (!preset) {
      return;
    }

    const service = createServiceFromPreset(preset, newBaseUrl.trim());
    upsertSelfHostedService(service);
    setEditingId(service.id);
    setAddingType('');
    setNewBaseUrl('');
    toast.success(`${preset.label} added`);
  };

  const saveService = (service: SelfHostedService) => {
    upsertSelfHostedService(service);
    toast.success('Saved');
  };

  const testUrl = async (url: string) => {
    if (!url.trim()) {
      toast.error('Enter a URL first');
      return;
    }

    try {
      await fetch(url, { mode: 'no-cors' });
      toast.success('URL reachable (browser check). Verify API keys in your Coolify dashboard.');
    } catch {
      toast.warn('Could not verify from browser (CORS). URL may still work from your server apps.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <section className="rounded-lg border border-[rgba(201,169,110,0.25)] bg-[rgba(201,169,110,0.06)] p-4 space-y-2">
        <h2 className="text-base font-semibold text-bolt-elements-textPrimary">Self-hosted & Coolify</h2>
        <p className="text-sm text-bolt-elements-textSecondary">
          Connect your own infrastructure - Supabase, Appwrite, n8n, PocketBase, MinIO, Postgres - running on{' '}
          <strong>Coolify</strong> or any VPS. No paid cloud subscriptions required. luxCoder will use these URLs and
          keys when generating apps.
        </p>
        <p className="text-xs text-bolt-elements-textTertiary">
          {enabledCount} service(s) active for AI prompts. Official tabs (Supabase Cloud, etc.) are optional.
        </p>
      </section>

      <section className="space-y-3">
        <label className="block text-sm text-bolt-elements-textSecondary">Coolify dashboard URL (optional)</label>
        <input
          type="url"
          value={state.coolifyUrl || ''}
          onChange={(e) => updateSelfHostedServices({ coolifyUrl: e.target.value })}
          placeholder="https://coolify.yourdomain.com"
          className="w-full px-3 py-2 rounded-lg text-sm bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary"
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-bolt-elements-textPrimary">Your services</h3>

        {state.services.length === 0 && (
          <p className="text-sm text-bolt-elements-textSecondary">No services yet. Add one below.</p>
        )}

        {state.services.map((service) => {
          const preset = getPreset(service.type);
          const isEditing = editingId === service.id;

          return (
            <div
              key={service.id}
              className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={service.enabled}
                    onChange={(e) => saveService({ ...service, enabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="font-medium text-bolt-elements-textPrimary truncate">{service.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary">
                    {preset?.label || service.type}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingId(isEditing ? null : service.id)}
                    className="text-xs px-2 py-1 rounded border border-bolt-elements-borderColor text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2"
                  >
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeSelfHostedService(service.id);
                      toast.info('Removed');
                    }}
                    className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <p className="text-xs text-bolt-elements-textSecondary truncate">{service.baseUrl || 'No base URL'}</p>

              {isEditing && (
                <div className="space-y-3 pt-2 border-t border-bolt-elements-borderColor">
                  <input
                    type="text"
                    value={service.name}
                    onChange={(e) => upsertSelfHostedService({ ...service, name: e.target.value })}
                    placeholder="Display name"
                    className="w-full px-3 py-2 rounded-lg text-sm bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary"
                  />
                  <input
                    type="url"
                    value={service.baseUrl}
                    onChange={(e) => {
                      const baseUrl = e.target.value;
                      const fields = service.fields.map((f) =>
                        f.key.includes('URL') || f.key.includes('ENDPOINT') ? { ...f, value: baseUrl } : f,
                      );
                      upsertSelfHostedService({ ...service, baseUrl, fields });
                    }}
                    placeholder={preset?.baseUrlPlaceholder || 'https://...'}
                    className="w-full px-3 py-2 rounded-lg text-sm bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary"
                  />
                  {service.fields.map((field, idx) => (
                    <div key={field.key}>
                      <label className="text-xs text-bolt-elements-textSecondary">{field.label}</label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={field.value}
                        onChange={(e) => {
                          const fields = [...service.fields];
                          fields[idx] = { ...field, value: e.target.value };
                          upsertSelfHostedService({ ...service, fields });
                        }}
                        placeholder={field.key}
                        className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => testUrl(service.baseUrl)}
                    className="text-xs px-3 py-1.5 rounded border border-[rgba(201,169,110,0.35)] text-[#c9a96e]"
                  >
                    Test URL
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="rounded-lg border border-bolt-elements-borderColor p-4 space-y-3">
        <h3 className="text-sm font-medium text-bolt-elements-textPrimary">Add service</h3>
        <p className="text-xs text-bolt-elements-textSecondary">Pick a preset, then enter your Coolify URL.</p>
        <div className="grid gap-2">
          {SELF_HOSTED_PRESETS.map((p) => {
            const selected = addingType === p.type;

            return (
              <button
                key={p.type}
                type="button"
                onClick={() => setAddingType(p.type)}
                className={classNames(
                  'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                  selected
                    ? 'border-[#c9a96e] bg-[rgba(201,169,110,0.15)] text-bolt-elements-textPrimary'
                    : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:border-[rgba(201,169,110,0.35)] hover:bg-bolt-elements-background-depth-3',
                )}
              >
                <span className="block text-sm font-medium">{p.label}</span>
                <span className="block text-xs text-bolt-elements-textSecondary mt-0.5">{p.description}</span>
              </button>
            );
          })}
        </div>
        {addingType && (
          <>
            <input
              type="url"
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              placeholder={getPreset(addingType as SelfHostedService['type'])?.baseUrlPlaceholder}
              className="w-full px-3 py-2 rounded-lg text-sm bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary"
            />
            <button
              type="button"
              disabled={!newBaseUrl.trim()}
              onClick={handleAdd}
              className={classNames(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'bg-[#c9a96e] text-[#080808] hover:brightness-110 disabled:opacity-50',
              )}
            >
              Add service
            </button>
          </>
        )}
      </section>
    </div>
  );
}
