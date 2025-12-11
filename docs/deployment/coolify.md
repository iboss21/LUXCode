# Coolify Configuration for LUXCode

This file documents the exact configuration needed to deploy LUXCode on Coolify.

## Quick Start

1. **Create New Resource** in Coolify
   - Type: **Application**
   - Source: **Git Repository**

2. **Repository Configuration**
   - Git Repository: `https://github.com/iboss21/LUXCode`
   - Branch: `main`
   - Build Pack: **Dockerfile**

3. **Build Settings**
   - Dockerfile Location: `./Dockerfile`
   - Docker Build Context: `.`
   - Target Stage: `production` (optional, it's the default)

4. **Port Configuration**
   - Application Port: **5173**
   - Expose Port: Yes
   - Protocol: HTTP

5. **Health Check**
   - Enabled: **Yes**
   - Path: `/api/health`
   - Port: 5173
   - Interval: 30s
   - Timeout: 10s
   - Retries: 3
   - Start Period: 40s

## Environment Variables

### Required (at least one LLM provider)

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Groq
GROQ_API_KEY=gsk_...

# xAI (Grok)
XAI_API_KEY=xai-...

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=...

# Other providers
OPEN_ROUTER_API_KEY=...
TOGETHER_API_KEY=...
DEEPSEEK_API_KEY=...
MISTRAL_API_KEY=...
COHERE_API_KEY=...
PERPLEXITY_API_KEY=...
```

### Optional Configuration

```bash
# Node.js Configuration
NODE_ENV=production
PORT=5173
HOST=0.0.0.0
NODE_OPTIONS=--max_old_space_size=4096

# Ollama (for local models)
OLLAMA_API_BASE_URL=http://host.docker.internal:11434

# GitHub Integration
GITHUB_TOKEN=ghp_...

# Logging
VITE_LOG_LEVEL=info
```

## Resource Limits

### Recommended Minimums
- **CPU**: 1 vCPU
- **Memory**: 2GB RAM
- **Disk**: 10GB

### Recommended for Production
- **CPU**: 2 vCPUs
- **Memory**: 4GB RAM
- **Disk**: 20GB

## Domain Configuration

1. **Custom Domain**
   - Add your domain in Coolify
   - Coolify will handle SSL/TLS automatically via Let's Encrypt

2. **Subdomain Example**
   - `luxcode.yourdomain.com`
   - CNAME points to your Coolify server

## Build Process

1. **Build Time**: ~3-5 minutes (first build)
2. **Build Stages**:
   - Install pnpm
   - Install dependencies (~1-2 min)
   - Build Remix app (~1 min)
   - Create production image

3. **Image Size**: ~120-140MB (final production image)

## Troubleshooting

### Build Fails with "Out of Memory"

**Solution**: Increase Node.js memory limit
```bash
NODE_OPTIONS=--max_old_space_size=8192
```

### Application Won't Start

**Check**:
1. Verify environment variables are set
2. Check logs: `docker logs <container-name>`
3. Verify port 5173 is accessible
4. Check health endpoint: `curl http://localhost:5173/api/health`

### Health Check Fails

**Common Causes**:
1. App still starting up (wait 30-40 seconds)
2. Port mismatch (ensure PORT=5173)
3. Health check path incorrect (must be `/api/health`)

**Solution**: Increase start period to 60s

### Static Assets Don't Load

**Solution**:
1. Ensure build completed successfully
2. Check build/client directory exists in container
3. Verify Express is serving static files

### Environment Variables Not Working

**Check**:
1. Variables are set in Coolify UI
2. No quotes around values
3. Restart container after adding variables

## Advanced Configuration

### Using with Ollama

If you want to use local Ollama models:

1. **Install Ollama** on Coolify server:
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. **Set Environment Variable**:
   ```bash
   OLLAMA_API_BASE_URL=http://host.docker.internal:11434
   ```

3. **Pull Models**:
   ```bash
   ollama pull llama2
   ollama pull codellama
   ```

### Custom Build Args

If you need custom build arguments:

```dockerfile
# Add to Dockerfile
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine AS builder
```

In Coolify, add build args:
```
NODE_VERSION=20
```

### Persistent Storage

To persist data across deploys:

1. Create volume in Coolify
2. Mount to `/app/data`
3. Update app to use `/app/data` for storage

## Monitoring

### Logs

View logs in Coolify:
- **Build Logs**: Available during build
- **Runtime Logs**: Available after deployment

### Metrics

Monitor in Coolify:
- CPU Usage
- Memory Usage
- Network Traffic
- Response Times

### Health Check

- Endpoint: `http://your-domain.com/api/health`
- Expected Response:
  ```json
  {
    "status": "ok",
    "runtime": "node",
    "mode": "production",
    "timestamp": "2025-12-11T..."
  }
  ```

## Deployment Workflow

### Initial Deployment

1. Configure in Coolify (steps above)
2. Click "Deploy"
3. Wait ~3-5 minutes for build
4. Access via generated URL or custom domain

### Updates

1. Push changes to GitHub
2. Coolify auto-deploys (if auto-deploy enabled)
   OR
   Click "Redeploy" in Coolify UI

### Rollback

1. Go to "Deployments" in Coolify
2. Find previous successful deployment
3. Click "Redeploy" on that version

## Security

### Best Practices

1. ✅ Use environment variables for secrets (never commit)
2. ✅ Enable HTTPS via Coolify's Let's Encrypt integration
3. ✅ Set up firewall rules on server
4. ✅ Regularly update dependencies
5. ✅ Monitor logs for suspicious activity

### API Key Security

- ✅ API keys stored as environment variables
- ✅ Not exposed in logs
- ✅ Not accessible from client-side code
- ✅ Rotated regularly

## Performance Optimization

### Caching

Coolify caches:
- ✅ Docker layers (faster rebuilds)
- ✅ pnpm store (faster installs)
- ✅ Node modules (when possible)

### CDN

For better performance:
1. Use Cloudflare CDN in front of Coolify
2. Configure caching rules for static assets
3. Enable HTTP/2 or HTTP/3

### Scaling

For high traffic:
1. Increase resources (CPU/RAM)
2. Enable horizontal scaling in Coolify
3. Use load balancer
4. Add Redis for session storage (if needed)

## Cost Estimation

### VPS Requirements (Monthly)

- **Basic**: 1 vCPU, 2GB RAM - $5-10/month
- **Standard**: 2 vCPU, 4GB RAM - $10-20/month
- **High-Traffic**: 4 vCPU, 8GB RAM - $20-40/month

### Additional Costs

- Domain: $10-15/year
- SSL: Free (Let's Encrypt via Coolify)
- Backups: Depends on VPS provider

## Support

### Getting Help

1. **LUXCode Issues**: https://github.com/iboss21/LUXCode/issues
2. **Coolify Docs**: https://coolify.io/docs
3. **Community**: Check discussions in both repos

### Common Questions

**Q: Can I use Nixpacks instead of Dockerfile?**  
A: Yes, but Dockerfile is recommended for better control and consistency.

**Q: How do I update to latest version?**  
A: Push to GitHub, Coolify auto-deploys (or click Redeploy).

**Q: Can I run multiple instances?**  
A: Yes, Coolify supports horizontal scaling.

**Q: What about database?**  
A: LUXCode doesn't require a database by default. If you add one, configure it in Coolify.

---

**Last Updated**: 2025-12-11  
**LUXCode Version**: Compatible with latest main branch  
**Coolify Version**: v4.0+
