const PLACEHOLDER_PATTERNS = [/^your[_-]/i, /_here$/i, /^hf_your/i, /^sk-your/i, /^placeholder$/i];

export function normalizeApiKey(key: string | undefined | null): string | undefined {
  if (key == null) {
    return undefined;
  }

  const trimmed = key.trim();

  if (!trimmed) {
    return undefined;
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return undefined;
  }

  return trimmed;
}

export function isPlausibleApiKey(key: string | undefined | null, providerName?: string): boolean {
  const normalized = normalizeApiKey(key);

  if (!normalized) {
    return false;
  }

  if (providerName === 'HuggingFace') {
    return normalized.startsWith('hf_') && normalized.length >= 20;
  }

  return normalized.length >= 8;
}
