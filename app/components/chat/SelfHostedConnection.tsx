import { useStore } from '@nanostores/react';
import { getEnabledServices, selfHostedServicesStore } from '~/lib/stores/selfHostedServices';
import { requestOpenSettings } from '~/lib/stores/settingsPanel';
import { Dialog, DialogRoot, DialogClose, DialogTitle, DialogButton } from '~/components/ui/Dialog';
import { useState } from 'react';

export function SelfHostedConnection() {
  const state = useStore(selfHostedServicesStore);
  const enabled = getEnabledServices(state);
  const [open, setOpen] = useState(false);

  if (enabled.length === 0) {
    return (
      <button
        type="button"
        title="Add self-hosted services (Coolify)"
        onClick={() => requestOpenSettings('self-hosted')}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-bolt-elements-borderColor text-bolt-elements-textTertiary hover:text-[#c9a96e] hover:border-[rgba(201,169,110,0.4)]"
      >
        <span className="i-ph:hard-drives text-sm" />
        Self-host
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${enabled.length} self-hosted service(s) active`}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-[rgba(201,169,110,0.35)] text-[#c9a96e] hover:bg-[rgba(201,169,110,0.08)]"
      >
        <span className="i-ph:hard-drives text-sm" />
        {enabled.length} self-hosted
      </button>

      <DialogRoot open={open} onOpenChange={setOpen}>
        {open && (
          <Dialog className="max-w-md p-6">
            <DialogTitle>
              <span className="i-ph:hard-drives" />
              Self-hosted services
            </DialogTitle>
            <ul className="mt-4 space-y-2 text-sm text-bolt-elements-textSecondary">
              {enabled.map((s) => (
                <li key={s.id} className="flex flex-col gap-0.5 p-2 rounded bg-bolt-elements-background-depth-2">
                  <span className="font-medium text-bolt-elements-textPrimary">{s.name}</span>
                  <span className="text-xs truncate">{s.baseUrl}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-bolt-elements-textTertiary">
              luxCoder uses these in generated .env files instead of paid cloud defaults.
            </p>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  requestOpenSettings('self-hosted');
                }}
                className="px-3 py-1.5 text-sm rounded border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-2"
              >
                Manage
              </button>
              <DialogClose asChild>
                <DialogButton type="secondary">Close</DialogButton>
              </DialogClose>
            </div>
          </Dialog>
        )}
      </DialogRoot>
    </div>
  );
}
