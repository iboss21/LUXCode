// Type definitions
export type ProviderName = 'OmniRoute' | 'Ollama' | 'LMStudio' | 'OpenAILike';

export interface OllamaModel {
  name: string;
  digest: string;
  size: number;
  modified_at: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  status?: 'idle' | 'updating' | 'updated' | 'error' | 'checking';
  error?: string;
  newDigest?: string;
  progress?: {
    current: number;
    total: number;
    status: string;
  };
}

export interface LMStudioModel {
  id: string;
  object: 'model';
  owned_by: string;
  created?: number;
}

// Constants
export const OLLAMA_API_URL = 'http://127.0.0.1:11434';

export const PROVIDER_ICONS = {
  OmniRoute: 'Path',
  Ollama: 'Server',
  LMStudio: 'Monitor',
  OpenAILike: 'Globe',
} as const;

export const PROVIDER_DESCRIPTIONS = {
  OmniRoute: 'Local AI gateway — route Ollama, cloud APIs, and smart fallback (Cursor-style)',
  Ollama: 'Run open-source models locally on your machine',
  LMStudio: 'Local model inference with LM Studio',
  OpenAILike: 'Connect to OpenAI-compatible API endpoints',
} as const;
