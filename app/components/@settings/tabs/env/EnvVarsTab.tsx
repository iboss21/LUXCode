import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { Eye, EyeOff, Copy, Save, AlertTriangle, Key } from 'lucide-react';

interface EnvVariable {
  key: string;
  value: string;
  description: string;
  category: 'ai-providers' | 'services' | 'development';
}

const ENV_VARIABLES: EnvVariable[] = [
  // AI Providers
  { key: 'OPENAI_API_KEY', value: '', description: 'OpenAI API Key for GPT models', category: 'ai-providers' },
  { key: 'ANTHROPIC_API_KEY', value: '', description: 'Anthropic API Key for Claude models', category: 'ai-providers' },
  { key: 'GOOGLE_GENERATIVE_AI_API_KEY', value: '', description: 'Google API Key for Gemini models', category: 'ai-providers' },
  { key: 'GROQ_API_KEY', value: '', description: 'Groq API Key for fast inference', category: 'ai-providers' },
  { key: 'DEEPSEEK_API_KEY', value: '', description: 'DeepSeek API Key', category: 'ai-providers' },
  { key: 'GITHUB_API_KEY', value: '', description: 'GitHub Personal Access Token for GitHub Models', category: 'ai-providers' },
  { key: 'OPEN_ROUTER_API_KEY', value: '', description: 'OpenRouter API Key', category: 'ai-providers' },
  { key: 'MISTRAL_API_KEY', value: '', description: 'Mistral API Key', category: 'ai-providers' },
  { key: 'COHERE_API_KEY', value: '', description: 'Cohere API Key', category: 'ai-providers' },
  { key: 'XAI_API_KEY', value: '', description: 'X.AI API Key for Grok models', category: 'ai-providers' },
  { key: 'TOGETHER_API_KEY', value: '', description: 'Together AI API Key', category: 'ai-providers' },
  { key: 'PERPLEXITY_API_KEY', value: '', description: 'Perplexity AI API Key', category: 'ai-providers' },
  { key: 'HYPERBOLIC_API_KEY', value: '', description: 'Hyperbolic API Key', category: 'ai-providers' },
  { key: 'HuggingFace_API_KEY', value: '', description: 'HuggingFace API Key', category: 'ai-providers' },
  { key: 'CEREBRAS_API_KEY', value: '', description: 'Cerebras API Key', category: 'ai-providers' },
  { key: 'FIREWORKS_API_KEY', value: '', description: 'Fireworks AI API Key', category: 'ai-providers' },
  
  // Services
  { key: 'VITE_GITHUB_ACCESS_TOKEN', value: '', description: 'GitHub token for repository operations', category: 'services' },
  { key: 'VITE_GITLAB_ACCESS_TOKEN', value: '', description: 'GitLab access token', category: 'services' },
  { key: 'VITE_VERCEL_ACCESS_TOKEN', value: '', description: 'Vercel deployment token', category: 'services' },
  { key: 'VITE_NETLIFY_ACCESS_TOKEN', value: '', description: 'Netlify deployment token', category: 'services' },
  { key: 'VITE_SUPABASE_URL', value: '', description: 'Supabase project URL', category: 'services' },
  { key: 'VITE_SUPABASE_ANON_KEY', value: '', description: 'Supabase anonymous key', category: 'services' },
  
  // Development
  { key: 'OLLAMA_API_BASE_URL', value: '', description: 'Ollama base URL (e.g., http://127.0.0.1:11434)', category: 'development' },
  { key: 'LMSTUDIO_API_BASE_URL', value: '', description: 'LM Studio base URL (e.g., http://127.0.0.1:1234)', category: 'development' },
  { key: 'OPENAI_LIKE_API_BASE_URL', value: '', description: 'OpenAI-compatible API base URL', category: 'development' },
  { key: 'OPENAI_LIKE_API_KEY', value: '', description: 'OpenAI-compatible API key', category: 'development' },
  { key: 'VITE_LOG_LEVEL', value: '', description: 'Logging level (debug, info, warn, error)', category: 'development' },
  { key: 'DEFAULT_NUM_CTX', value: '', description: 'Default context window size for local models', category: 'development' },
];

export default function EnvVarsTab() {
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'ai-providers' | 'services' | 'development'>('all');

  useEffect(() => {
    // Load environment variables from localStorage
    const saved = localStorage.getItem('bolt_env_vars');
    if (saved) {
      try {
        setEnvVars(JSON.parse(saved));
      } catch (error) {
        console.error('Failed to load environment variables:', error);
      }
    }
  }, []);

  const handleSave = () => {
    try {
      localStorage.setItem('bolt_env_vars', JSON.stringify(envVars));
      toast.success('Environment variables saved successfully');
    } catch (error) {
      console.error('Failed to save environment variables:', error);
      toast.error('Failed to save environment variables');
    }
  };

  const handleChange = (key: string, value: string) => {
    setEnvVars((prev) => ({ ...prev, [key]: value }));
  };

  const toggleVisibility = (key: string) => {
    setShowValues((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const filteredVars = ENV_VARIABLES.filter((envVar) => {
    const matchesCategory = selectedCategory === 'all' || envVar.category === selectedCategory;
    const matchesSearch =
      envVar.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      envVar.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-4">
      {/* Warning Banner */}
      <motion.div
        className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-medium mb-1">Important Security Notice</p>
            <p>
              Environment variables are stored in your browser's localStorage. For production deployments, use server-side
              environment variables via <code className="bg-yellow-100 dark:bg-yellow-900/40 px-1 py-0.5 rounded">.env</code> files or your hosting provider's dashboard.
              These client-side variables are for development and testing only.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Search and Filter */}
      <motion.div
        className="bg-white dark:bg-[#0A0A0A] rounded-lg shadow-sm dark:shadow-none p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search environment variables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={classNames(
                'w-full px-4 py-2 rounded-lg text-sm',
                'bg-[#FAFAFA] dark:bg-[#0A0A0A]',
                'border border-[#E5E5E5] dark:border-[#1A1A1A]',
                'text-bolt-elements-textPrimary',
                'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                'transition-all duration-200',
              )}
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'ai-providers', 'services', 'development'] as const).map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={classNames(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                  selectedCategory === category
                    ? 'bg-purple-500 text-white'
                    : 'bg-[#FAFAFA] dark:bg-[#0A0A0A] text-bolt-elements-textSecondary border border-[#E5E5E5] dark:border-[#1A1A1A] hover:border-purple-500/50',
                )}
              >
                {category === 'all' ? 'All' : category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Environment Variables List */}
      <motion.div
        className="bg-white dark:bg-[#0A0A0A] rounded-lg shadow-sm dark:shadow-none p-4 space-y-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-bolt-elements-textPrimary">
              Environment Variables ({filteredVars.length})
            </span>
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            Save All
          </button>
        </div>

        <div className="space-y-3">
          {filteredVars.map((envVar) => (
            <div
              key={envVar.key}
              className="p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#0A0A0A] border border-[#E5E5E5] dark:border-[#1A1A1A]"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono font-medium text-bolt-elements-textPrimary">
                      {envVar.key}
                    </code>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                      {envVar.category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    </span>
                  </div>
                  <p className="text-xs text-bolt-elements-textSecondary">{envVar.description}</p>
                </div>
                <button
                  onClick={() => copyToClipboard(envVar.key)}
                  className="p-2 hover:bg-[#E5E5E5] dark:hover:bg-[#1A1A1A] rounded transition-colors"
                  title="Copy key name"
                >
                  <Copy className="w-4 h-4 text-bolt-elements-textSecondary" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type={showValues[envVar.key] ? 'text' : 'password'}
                  value={envVars[envVar.key] || ''}
                  onChange={(e) => handleChange(envVar.key, e.target.value)}
                  placeholder={`Enter ${envVar.key}...`}
                  className={classNames(
                    'flex-1 px-3 py-2 rounded-lg text-sm font-mono',
                    'bg-white dark:bg-[#0A0A0A]',
                    'border border-[#E5E5E5] dark:border-[#1A1A1A]',
                    'text-bolt-elements-textPrimary',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                    'transition-all duration-200',
                  )}
                />
                <button
                  onClick={() => toggleVisibility(envVar.key)}
                  className="p-2 hover:bg-[#FAFAFA] dark:hover:bg-[#0A0A0A] rounded transition-colors"
                  title={showValues[envVar.key] ? 'Hide value' : 'Show value'}
                >
                  {showValues[envVar.key] ? (
                    <EyeOff className="w-4 h-4 text-bolt-elements-textSecondary" />
                  ) : (
                    <Eye className="w-4 h-4 text-bolt-elements-textSecondary" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredVars.length === 0 && (
          <div className="text-center py-8 text-bolt-elements-textSecondary">
            <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No environment variables match your search.</p>
          </div>
        )}
      </motion.div>

      {/* Instructions */}
      <motion.div
        className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">How to use environment variables:</h3>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
          <li>
            <strong>For development:</strong> Set variables here or in your <code>.env.local</code> file
          </li>
          <li>
            <strong>For production:</strong> Use your hosting provider's environment variable settings (Vercel, Netlify, Docker, etc.)
          </li>
          <li>
            <strong>GitHub Models:</strong> Requires a GitHub Personal Access Token with "GitHub Models" permission
          </li>
          <li>
            <strong>Security:</strong> Never commit <code>.env</code> files to version control
          </li>
        </ul>
      </motion.div>
    </div>
  );
}
