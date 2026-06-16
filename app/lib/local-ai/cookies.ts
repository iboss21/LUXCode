/** Sync provider enable/baseUrl settings to cookie so /api/models sees them. */
export function syncProviderSettingsCookie() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const raw = localStorage.getItem('provider_settings');

    if (!raw) {
      return;
    }

    const all = JSON.parse(raw) as Record<string, { settings?: Record<string, unknown> }>;
    const providerSetting: Record<string, Record<string, unknown>> = {};

    Object.keys(all).forEach((name) => {
      providerSetting[name] = all[name]?.settings ?? {};
    });

    document.cookie = `providers=${encodeURIComponent(JSON.stringify(providerSetting))}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}
