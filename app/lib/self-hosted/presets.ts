import type { SelfHostedService, SelfHostedServiceType } from '~/lib/stores/selfHostedServices';

export type SelfHostedPreset = {
  type: SelfHostedServiceType;
  label: string;
  description: string;
  defaultName: string;
  baseUrlPlaceholder: string;
  fields: Array<{ key: string; label: string; secret?: boolean; placeholder?: string }>;
};

export const SELF_HOSTED_PRESETS: SelfHostedPreset[] = [
  {
    type: 'supabase',
    label: 'Supabase (self-hosted)',
    description: 'Supabase stack on Coolify - use your project URL and keys, not supabase.com cloud.',
    defaultName: 'My Supabase',
    baseUrlPlaceholder: 'https://supabase.yourdomain.com',
    fields: [
      { key: 'VITE_SUPABASE_URL', label: 'Supabase URL', placeholder: 'https://supabase.yourdomain.com' },
      { key: 'VITE_SUPABASE_ANON_KEY', label: 'Anon key', secret: true },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service role key (server only)', secret: true },
    ],
  },
  {
    type: 'appwrite',
    label: 'Appwrite (self-hosted)',
    description: 'Appwrite on your Coolify server - no Appwrite Cloud subscription.',
    defaultName: 'My Appwrite',
    baseUrlPlaceholder: 'https://appwrite.yourdomain.com/v1',
    fields: [
      { key: 'VITE_APPWRITE_ENDPOINT', label: 'API endpoint', placeholder: 'https://appwrite.yourdomain.com/v1' },
      { key: 'VITE_APPWRITE_PROJECT_ID', label: 'Project ID' },
      { key: 'APPWRITE_API_KEY', label: 'API key', secret: true },
    ],
  },
  {
    type: 'n8n',
    label: 'n8n (self-hosted)',
    description: 'Workflow automation on your server - webhooks and API.',
    defaultName: 'My n8n',
    baseUrlPlaceholder: 'https://n8n.yourdomain.com',
    fields: [
      { key: 'N8N_WEBHOOK_URL', label: 'Webhook base URL', placeholder: 'https://n8n.yourdomain.com/webhook' },
      { key: 'N8N_API_URL', label: 'API URL', placeholder: 'https://n8n.yourdomain.com/api/v1' },
      { key: 'N8N_API_KEY', label: 'API key', secret: true },
    ],
  },
  {
    type: 'pocketbase',
    label: 'PocketBase',
    description: 'Lightweight backend on Coolify.',
    defaultName: 'My PocketBase',
    baseUrlPlaceholder: 'https://pb.yourdomain.com',
    fields: [{ key: 'VITE_POCKETBASE_URL', label: 'PocketBase URL' }],
  },
  {
    type: 'directus',
    label: 'Directus',
    description: 'Headless CMS / API on your infrastructure.',
    defaultName: 'My Directus',
    baseUrlPlaceholder: 'https://directus.yourdomain.com',
    fields: [
      { key: 'VITE_DIRECTUS_URL', label: 'Directus URL' },
      { key: 'DIRECTUS_TOKEN', label: 'Static token', secret: true },
    ],
  },
  {
    type: 'minio',
    label: 'MinIO / S3-compatible',
    description: 'Object storage on Coolify (MinIO, Garage, etc.).',
    defaultName: 'My Storage',
    baseUrlPlaceholder: 'https://s3.yourdomain.com',
    fields: [
      { key: 'S3_ENDPOINT', label: 'S3 endpoint URL' },
      { key: 'S3_ACCESS_KEY', label: 'Access key', secret: true },
      { key: 'S3_SECRET_KEY', label: 'Secret key', secret: true },
      { key: 'S3_BUCKET', label: 'Default bucket' },
    ],
  },
  {
    type: 'postgres',
    label: 'PostgreSQL (connection string)',
    description: 'Database URL for server-side apps (never expose in client code).',
    defaultName: 'My Postgres',
    baseUrlPlaceholder: 'postgres://user:pass@db.yourdomain.com:5432/mydb',
    fields: [{ key: 'DATABASE_URL', label: 'Database URL', secret: true }],
  },
  {
    type: 'custom',
    label: 'Custom service',
    description: 'Any Coolify app - define your own env vars.',
    defaultName: 'Custom service',
    baseUrlPlaceholder: 'https://api.yourdomain.com',
    fields: [
      { key: 'CUSTOM_API_URL', label: 'API URL' },
      { key: 'CUSTOM_API_KEY', label: 'API key', secret: true },
    ],
  },
];

export function createServiceFromPreset(preset: SelfHostedPreset, baseUrl = ''): SelfHostedService {
  return {
    id: crypto.randomUUID(),
    name: preset.defaultName,
    type: preset.type,
    baseUrl,
    enabled: true,
    fields: preset.fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.key.includes('URL') || field.key.includes('ENDPOINT') ? baseUrl : '',
      secret: field.secret,
    })),
  };
}

export function getPreset(type: SelfHostedServiceType): SelfHostedPreset | undefined {
  return SELF_HOSTED_PRESETS.find((p) => p.type === type);
}
