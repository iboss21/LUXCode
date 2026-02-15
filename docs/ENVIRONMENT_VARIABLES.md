# Environment Variables Configuration

## Overview

LUXCode now includes a dedicated Environment Variables management tab in the Settings panel, making it easier to configure API keys and services without manually editing `.env` files.

## Accessing Environment Variables

1. Click the **Settings** button in the top-right corner
2. Navigate to the **Environment Variables** tab
3. Browse or search for the environment variables you need
4. Enter your API keys and save

## Features

### Search and Filter
- **Search**: Quickly find variables by name or description
- **Category Filters**: 
  - **AI Providers**: API keys for OpenAI, Anthropic, DeepSeek, GitHub Models, etc.
  - **Services**: Tokens for GitHub, GitLab, Vercel, Netlify, Supabase
  - **Development**: Local model URLs (Ollama, LMStudio) and debugging settings

### Security Features
- **Password Protection**: Values are hidden by default (show/hide toggle)
- **Copy to Clipboard**: Easy copying of variable names
- **Security Warning**: Clear notice about client-side vs server-side storage

## Supported Environment Variables

### AI Providers
- `OPENAI_API_KEY` - OpenAI GPT models
- `ANTHROPIC_API_KEY` - Claude models
- `GOOGLE_GENERATIVE_AI_API_KEY` - Gemini models
- `DEEPSEEK_API_KEY` - DeepSeek models
- `GITHUB_API_KEY` - GitHub Models (requires PAT with GitHub Models permission)
- `GROQ_API_KEY` - Groq fast inference
- `MISTRAL_API_KEY` - Mistral models
- `COHERE_API_KEY` - Cohere models
- `XAI_API_KEY` - Grok models
- `TOGETHER_API_KEY` - Together AI
- `PERPLEXITY_API_KEY` - Perplexity AI
- `HYPERBOLIC_API_KEY` - Hyperbolic
- `HuggingFace_API_KEY` - HuggingFace models
- `CEREBRAS_API_KEY` - Cerebras
- `FIREWORKS_API_KEY` - Fireworks AI
- `OPEN_ROUTER_API_KEY` - OpenRouter

### Services
- `VITE_GITHUB_ACCESS_TOKEN` - GitHub repository operations
- `VITE_GITLAB_ACCESS_TOKEN` - GitLab operations
- `VITE_VERCEL_ACCESS_TOKEN` - Vercel deployments
- `VITE_NETLIFY_ACCESS_TOKEN` - Netlify deployments
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

### Development
- `OLLAMA_API_BASE_URL` - Ollama base URL (e.g., http://127.0.0.1:11434)
- `LMSTUDIO_API_BASE_URL` - LM Studio base URL (e.g., http://127.0.0.1:1234)
- `OPENAI_LIKE_API_BASE_URL` - OpenAI-compatible API base URL
- `OPENAI_LIKE_API_KEY` - OpenAI-compatible API key
- `VITE_LOG_LEVEL` - Logging level (debug, info, warn, error)
- `DEFAULT_NUM_CTX` - Default context window size for local models

## Important Security Notes

### Development vs Production

- **Development**: Variables set in the UI are stored in browser localStorage
- **Production**: Always use server-side environment variables:
  - **Docker**: Use `.env` file or `docker-compose.yml` environment section
  - **Vercel/Netlify**: Use the platform's environment variables dashboard
  - **VPS**: Use `.env` file or system environment variables

### Best Practices

1. **Never commit `.env` files to version control**
2. **Use `.env.example` as a template** - Copy to `.env.local` and fill in your keys
3. **Rotate API keys regularly** - Especially if exposed
4. **Use GitHub Models with proper PAT** - Ensure your Personal Access Token has "GitHub Models" permission
5. **Limit token permissions** - Only grant necessary scopes to service tokens

## GitHub Models Configuration

For the `deepseek/deepseek-v3-0324` model and other GitHub Models:

1. Generate a GitHub Personal Access Token at: https://github.com/settings/tokens
2. Grant the "GitHub Models" permission
3. Add the token as `GITHUB_API_KEY` in Environment Variables
4. The model will now be available in the model selector

## Troubleshooting

### "No access to model" Error

If you see this error:
1. Check that your API key is set correctly in Environment Variables
2. For GitHub Models, ensure your PAT has the "GitHub Models" permission
3. Verify the model is available in your region
4. Try selecting a different model from the dropdown

### Model Not Appearing

1. Refresh the page to reload model lists
2. Check that the provider's API key is set
3. Look in the browser console for error messages
4. Verify your API key has access to the model

## Related Files

- `.env.example` - Template with all available variables
- `.env.production` - Production configuration template
- `app/components/@settings/tabs/env/EnvVarsTab.tsx` - Environment Variables UI
