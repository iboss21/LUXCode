import { AnimatePresence, motion } from 'framer-motion';
import type { LlmErrorAlertType } from '~/types/actions';
import { classNames } from '~/utils/classNames';

interface Props {
  alert: LlmErrorAlertType;
  clearAlert: () => void;
}

export default function LlmErrorAlert({ alert, clearAlert }: Props) {
  const { title, description, provider, errorType } = alert;

  const huggingFaceModelHelp =
    provider === 'HuggingFace' && errorType === 'model_unavailable' ? (
      <ul className="list-disc pl-4 mt-3 space-y-1 text-xs text-bolt-elements-textTertiary">
        <li>
          Pick <strong>Qwen2.5-Coder-32B</strong> from the model dropdown (works on HF Inference Providers).
        </li>
        <li>
          For <strong>free local AI</strong> with no API: Settings → Providers → Local → Ollama → Download{' '}
          <strong>qwen2.5-coder:14b</strong>, then switch Provider to Ollama in chat.
        </li>
        <li>CodeLlama and many older HF models are not routed through Inference Providers.</li>
      </ul>
    ) : null;

  const huggingFaceAuthHelp =
    provider === 'HuggingFace' && errorType === 'authentication' ? (
      <ul className="list-disc pl-4 mt-3 space-y-1 text-xs text-bolt-elements-textTertiary">
        <li>
          Create a token at{' '}
          <a
            href="https://huggingface.co/settings/tokens"
            target="_blank"
            rel="noreferrer"
            className="text-[#c9a96e] underline"
          >
            huggingface.co/settings/tokens
          </a>
        </li>
        <li>Use a Fine-grained token with &quot;Make calls to Inference Providers&quot; enabled</li>
        <li>Click Change API Key, paste the full token (starts with hf_), then save</li>
        <li>Or use Provider: Ollama for free local coding with no cloud token</li>
      </ul>
    ) : null;

  const getErrorIcon = () => {
    switch (errorType) {
      case 'authentication':
        return 'i-ph:key-duotone';
      case 'rate_limit':
        return 'i-ph:clock-duotone';
      case 'quota':
        return 'i-ph:warning-circle-duotone';
      case 'model_unavailable':
        return 'i-ph:robot-duotone';
      default:
        return 'i-ph:warning-duotone';
    }
  };

  const getErrorMessage = () => {
    switch (errorType) {
      case 'authentication':
        return `Authentication failed with ${provider}. Please check your API key.`;
      case 'rate_limit':
        return `Rate limit exceeded for ${provider}. Please wait before retrying.`;
      case 'quota':
        return `Quota exceeded for ${provider}. Please check your account limits.`;
      case 'model_unavailable':
        return 'This model is not available with your current provider. See steps below.';
      default:
        return 'An error occurred while processing your request.';
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3 }}
        className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 mb-2"
      >
        <div className="flex items-start">
          <motion.div
            className="flex-shrink-0"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className={`${getErrorIcon()} text-xl text-bolt-elements-button-danger-text`}></div>
          </motion.div>

          <div className="ml-3 flex-1">
            <motion.h3
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-sm font-medium text-bolt-elements-textPrimary"
            >
              {title}
            </motion.h3>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="mt-2 text-sm text-bolt-elements-textSecondary"
            >
              <p>{getErrorMessage()}</p>
              {huggingFaceAuthHelp}
              {huggingFaceModelHelp}

              {description && (
                <div className="text-xs text-bolt-elements-textSecondary p-2 bg-bolt-elements-background-depth-3 rounded mt-4 mb-4">
                  Error Details: {description}
                </div>
              )}
            </motion.div>

            <motion.div
              className="mt-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <div className="flex gap-2">
                <button
                  onClick={clearAlert}
                  className={classNames(
                    'px-2 py-1.5 rounded-md text-sm font-medium',
                    'bg-bolt-elements-button-secondary-background',
                    'hover:bg-bolt-elements-button-secondary-backgroundHover',
                    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-bolt-elements-button-secondary-background',
                    'text-bolt-elements-button-secondary-text',
                  )}
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
