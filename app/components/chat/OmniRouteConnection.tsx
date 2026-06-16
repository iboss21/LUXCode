import { useCallback, useEffect, useState } from 'react';
import { requestOpenSettings } from '~/lib/stores/settingsPanel';
import { OMNIROUTE_AUTO_MODEL } from '~/lib/omniroute/config';
import { classNames } from '~/utils/classNames';

interface OmniRouteStatus {
  running: boolean;
  modelCount?: number;
}

export function OmniRouteConnection() {
  const [status, setStatus] = useState<OmniRouteStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/omniroute-status');
      setStatus((await res.json()) as OmniRouteStatus);
    } catch {
      setStatus({ running: false });
    }
  }, []);

  useEffect(() => {
    void refresh();

    const interval = setInterval(refresh, 30000);

    return () => clearInterval(interval);
  }, [refresh]);

  if (status?.running) {
    return (
      <button
        type="button"
        title={`OmniRoute active · ${status.modelCount ?? 0} models · use "${OMNIROUTE_AUTO_MODEL}" for smart routing`}
        onClick={() => requestOpenSettings('local-providers')}
        className={classNames(
          'flex items-center gap-1 px-2 py-1 text-xs rounded-md border',
          'border-[rgba(201,169,110,0.35)] text-[#c9a96e] hover:bg-[rgba(201,169,110,0.08)]',
        )}
      >
        <span className="i-ph:path text-sm" />
        OmniRoute
      </button>
    );
  }

  return (
    <button
      type="button"
      title="Connect OmniRoute local AI gateway (like Cursor)"
      onClick={() => requestOpenSettings('local-providers')}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-bolt-elements-borderColor text-bolt-elements-textTertiary hover:text-[#c9a96e] hover:border-[rgba(201,169,110,0.4)]"
    >
      <span className="i-ph:path text-sm" />
      OmniRoute
    </button>
  );
}
