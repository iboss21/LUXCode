import { atom } from 'nanostores';

export type SelfHostedServiceType =
  | 'supabase'
  | 'appwrite'
  | 'n8n'
  | 'pocketbase'
  | 'directus'
  | 'minio'
  | 'postgres'
  | 'custom';

export interface SelfHostedServiceField {
  key: string;
  label: string;
  value: string;
  secret?: boolean;
}

export interface SelfHostedService {
  id: string;
  name: string;
  type: SelfHostedServiceType;
  baseUrl: string;
  enabled: boolean;
  fields: SelfHostedServiceField[];
  notes?: string;
}

export interface SelfHostedServicesState {
  services: SelfHostedService[];
  coolifyUrl?: string;
}

const STORAGE_KEY = 'luxcoder_self_hosted_services';

const storage =
  typeof globalThis !== 'undefined' &&
  typeof globalThis.localStorage !== 'undefined' &&
  typeof globalThis.localStorage.getItem === 'function'
    ? globalThis.localStorage
    : null;

function loadState(): SelfHostedServicesState {
  if (!storage) {
    return { services: [] };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);

    if (raw) {
      return JSON.parse(raw) as SelfHostedServicesState;
    }
  } catch (e) {
    console.error('Failed to load self-hosted services:', e);
  }

  return { services: [] };
}

function persistState(state: SelfHostedServicesState) {
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

export const selfHostedServicesStore = atom<SelfHostedServicesState>(loadState());

export function getSelfHostedState(): SelfHostedServicesState {
  return selfHostedServicesStore.get();
}

export function updateSelfHostedServices(partial: Partial<SelfHostedServicesState>) {
  const next = { ...selfHostedServicesStore.get(), ...partial };
  selfHostedServicesStore.set(next);
  persistState(next);
}

export function upsertSelfHostedService(service: SelfHostedService) {
  const state = selfHostedServicesStore.get();
  const index = state.services.findIndex((s) => s.id === service.id);
  const services =
    index >= 0 ? state.services.map((s, i) => (i === index ? service : s)) : [...state.services, service];

  updateSelfHostedServices({ services });
}

export function removeSelfHostedService(id: string) {
  const state = selfHostedServicesStore.get();
  updateSelfHostedServices({ services: state.services.filter((s) => s.id !== id) });
}

export function getEnabledServices(state: SelfHostedServicesState = getSelfHostedState()): SelfHostedService[] {
  return state.services.filter((s) => s.enabled && s.baseUrl.trim());
}

export function getSelfHostedSupabaseCredentials(
  state: SelfHostedServicesState = getSelfHostedState(),
): { supabaseUrl: string; anonKey: string } | undefined {
  const svc = getEnabledServices(state).find((s) => s.type === 'supabase');

  if (!svc) {
    return undefined;
  }

  const supabaseUrl = svc.fields.find((f) => f.key === 'VITE_SUPABASE_URL')?.value.trim() || svc.baseUrl.trim();
  const anonKey = svc.fields.find((f) => f.key === 'VITE_SUPABASE_ANON_KEY')?.value.trim();

  if (!supabaseUrl || !anonKey) {
    return undefined;
  }

  return { supabaseUrl, anonKey };
}

export function buildSelfHostedEnvBlock(state: SelfHostedServicesState = getSelfHostedState()): string {
  const enabled = getEnabledServices(state);

  if (!enabled.length) {
    return '';
  }

  const envLines = enabled.flatMap((svc) =>
    svc.fields.filter((f) => f.value.trim()).map((f) => `${f.key}=${f.value.trim()}`),
  );

  const serviceList = enabled
    .map((s) => `- ${s.name} (${s.type}): ${s.baseUrl}${s.notes ? ` - ${s.notes}` : ''}`)
    .join('\n  ');

  const coolifyNote = state.coolifyUrl?.trim() ? `\n  Coolify dashboard: ${state.coolifyUrl.trim()}` : '';

  return `
<self_hosted_services>
  IMPORTANT: The user self-hosts these services (e.g. on Coolify). Do NOT push paid SaaS (Supabase Cloud, Appwrite Cloud, etc.) when these are configured.
  Use the user's URLs and keys in generated .env files and app code.

  Active services:
  ${serviceList}${coolifyNote}

  Add to .env for new projects:
  ${envLines.join('\n  ')}
</self_hosted_services>`;
}
