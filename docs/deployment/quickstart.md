# VPS and Coolify Deployment - Quick Start

This guide helps you deploy LUXCode on Coolify or any VPS in 5 minutes.

## 🚀 Quick Deploy on Coolify

1. **Go to Coolify** → Add New Resource → Application
2. **Set Repository**: `https://github.com/iboss21/LUXCode`
3. **Build Pack**: Dockerfile
4. **Port**: 5173
5. **Add Environment Variables** (at least one API key):
   ```
   OPENAI_API_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...
   GROQ_API_KEY=gsk_...
   ```
6. **Deploy** → Wait ~3-5 minutes → Done!

For detailed instructions, see [COOLIFY.md](./COOLIFY.md)

---

## 🐳 Docker Deployment

### Using Docker Compose (Recommended)

1. **Clone repository**:
   ```bash
   git clone https://github.com/iboss21/LUXCode.git
   cd LUXCode
   ```

2. **Create .env file**:
   ```bash
   cp .env.example .env
   nano .env  # Add your API keys
   ```

3. **Start**:
   ```bash
   docker-compose up -d
   ```

4. **Access**: http://localhost:5173

### Using Docker Directly

```bash
# Build
docker build -t luxcode:latest .

# Run
docker run -d \
  --name luxcode \
  -p 5173:5173 \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  --restart unless-stopped \
  luxcode:latest
```

---

## 💻 VPS Deployment (without Docker)

### Requirements
- Node.js 20+
- pnpm
- 2GB+ RAM

### Steps

1. **Install dependencies**:
   ```bash
   git clone https://github.com/iboss21/LUXCode.git
   cd LUXCode
   npm install -g pnpm
   pnpm install
   ```

2. **Build**:
   ```bash
   pnpm run build
   ```

3. **Create .env file**:
   ```bash
   nano .env
   # Add:
   # OPENAI_API_KEY=sk-...
   # NODE_ENV=production
   # PORT=5173
   ```

4. **Start with PM2**:
   ```bash
   npm install -g pm2
   pm2 start server.js --name luxcode
   pm2 save
   pm2 startup
   ```

5. **Access**: http://your-server-ip:5173

---

## ☁️ Cloudflare Pages Deployment

Original deployment method still works:

```bash
pnpm run deploy:cloudflare
```

---

## 🔧 Environment Variables

### Required (pick at least one)

```bash
OPENAI_API_KEY=sk-...              # OpenAI GPT models
ANTHROPIC_API_KEY=sk-ant-...       # Claude models
GROQ_API_KEY=gsk_...               # Groq models
XAI_API_KEY=xai-...                # Grok models
GOOGLE_GENERATIVE_AI_API_KEY=...  # Gemini models
```

### Optional

```bash
PORT=5173                          # Server port
NODE_ENV=production                # Environment
OLLAMA_API_BASE_URL=http://...     # Local Ollama
GITHUB_TOKEN=ghp_...               # GitHub integration
```

---

## 📊 Deployment Comparison

| Platform | Setup Time | Difficulty | Cost | Auto-Deploy |
|----------|------------|------------|------|-------------|
| **Coolify** | 5 min | ⭐ Easy | $5-20/mo | ✅ Yes |
| **Docker Compose** | 10 min | ⭐⭐ Medium | VPS cost | ❌ No |
| **VPS + PM2** | 15 min | ⭐⭐⭐ Hard | $5-20/mo | ❌ No |
| **Cloudflare** | 5 min | ⭐ Easy | Free-$5/mo | ✅ Yes |

---

## 🔍 Health Check

After deployment, verify it's working:

```bash
curl http://your-domain.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "runtime": "node",
  "mode": "production",
  "timestamp": "2025-12-11T..."
}
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Find process
lsof -i :5173
# Kill it
kill -9 <PID>
```

### Build Fails (Out of Memory)
```bash
# Increase Node memory
export NODE_OPTIONS=--max_old_space_size=4096
pnpm run build
```

### Server Won't Start
```bash
# Check logs
pm2 logs luxcode          # PM2
docker logs luxcode       # Docker
journalctl -u luxcode -f  # systemd
```

### Environment Variables Not Loading
```bash
# Ensure .env file exists
ls -la .env
# Check file permissions
chmod 600 .env
# For Docker, pass via -e or --env-file
```

---

## 📚 Documentation

- **Deployment Overview**: [README.md](./README.md)
- **Coolify Setup**: [coolify-detailed.md](./coolify-detailed.md)
- **Docker Setup**: [docker.md](./docker.md)
- **VPS Setup**: [vps.md](./vps.md)
- **Local Development**: [local-development.md](./local-development.md)
- **Main README**: [../README.md](../README.md)

---

## 🆘 Support

- **Issues**: https://github.com/iboss21/LUXCode/issues
- **Discussions**: https://github.com/iboss21/LUXCode/discussions

---

## ✅ What Changed

This deployment now works because we:

1. ❌ **Removed wrangler from production** → ✅ Uses pure Node.js
2. ❌ **Fixed build issues** → ✅ Proper CommonJS/ESM handling
3. ❌ **No Node.js server** → ✅ Express-based server
4. ❌ **Cloudflare-only code** → ✅ Compatible API layer
5. ❌ **Wrong Dockerfile** → ✅ Multi-stage production build

**Result**: Deploy anywhere that supports Node.js or Docker! 🎉

---

**Status**: 🟢 Production Ready  
**Tested On**: Coolify, Docker, Ubuntu 22.04, Debian 12  
**Node Version**: 20+
