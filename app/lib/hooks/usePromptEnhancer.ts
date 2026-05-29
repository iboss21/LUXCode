import { useState } from 'react';
import type { ProviderInfo } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('usePromptEnhancement');

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);

  const resetEnhancer = () => {
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (
    input: string,
    setInput: (value: string) => void,
    model: string,
    provider: ProviderInfo,
    apiKeys?: Record<string, string>,
  ): Promise<boolean> => {
    if (!input.trim()) {
      return false;
    }

    setEnhancingPrompt(true);
    setPromptEnhanced(false);

    const originalInput = input;

    try {
      const response = await fetch('/api/enhancer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          model,
          provider,
          apiKeys,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error(`Enhancer failed (${response.status}):`, errorText);

        return false;
      }

      const reader = response.body?.getReader();

      if (!reader) {
        logger.error('Enhancer returned no response body');
        return false;
      }

      const decoder = new TextDecoder();
      let enhanced = '';

      setInput('');

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        enhanced += decoder.decode(value, { stream: true });
        setInput(enhanced);
      }

      enhanced += decoder.decode();

      if (!enhanced.trim()) {
        setInput(originalInput);
        return false;
      }

      setInput(enhanced.trim());
      setPromptEnhanced(true);

      return true;
    } catch (error) {
      logger.error('Enhancer error:', error);
      setInput(originalInput);

      return false;
    } finally {
      setEnhancingPrompt(false);
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
