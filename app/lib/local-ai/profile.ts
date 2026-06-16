/** PC-friendly inference profiles — keeps VRAM/RAM usage under control */

export type LocalAiProfile = 'lite' | 'balanced' | 'max';

export const LOCAL_AI_PROFILE_KEY = 'luxcoder_local_ai_profile';

export const LOCAL_AI_PROFILES: Record<
  LocalAiProfile,
  { label: string; description: string; numCtx: number; maxLLMSteps: number; defaultOllamaModel: string }
> = {
  lite: {
    label: 'Lite',
    description: 'Fast replies, low VRAM — best for daily coding without heating the PC',
    numCtx: 8192,
    maxLLMSteps: 6,
    defaultOllamaModel: 'qwen2.5-coder:7b',
  },
  balanced: {
    label: 'Balanced',
    description: 'Good quality on 12 GB GPU (RTX 4070 Super class)',
    numCtx: 16384,
    maxLLMSteps: 8,
    defaultOllamaModel: 'qwen2.5-coder:14b',
  },
  max: {
    label: 'Max',
    description: 'Largest context and agent steps — uses more RAM/VRAM',
    numCtx: 32768,
    maxLLMSteps: 10,
    defaultOllamaModel: 'qwen2.5-coder:14b',
  },
};

export function getStoredLocalAiProfile(): LocalAiProfile {
  if (typeof window === 'undefined') {
    return 'lite';
  }

  const stored = localStorage.getItem(LOCAL_AI_PROFILE_KEY);

  if (stored === 'lite' || stored === 'balanced' || stored === 'max') {
    return stored;
  }

  return 'lite';
}

export function setStoredLocalAiProfile(profile: LocalAiProfile) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LOCAL_AI_PROFILE_KEY, profile);
  }
}

export function getProfileNumCtx(profile?: LocalAiProfile): number {
  return LOCAL_AI_PROFILES[profile ?? getStoredLocalAiProfile()].numCtx;
}

export function getProfileMaxLLMSteps(profile?: LocalAiProfile): number {
  return LOCAL_AI_PROFILES[profile ?? getStoredLocalAiProfile()].maxLLMSteps;
}
