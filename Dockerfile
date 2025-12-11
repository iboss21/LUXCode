# ============================================
# LUXCode Production Dockerfile
# Optimized for Coolify, VPS, and Docker deployments
# Final image size: ~120-140MB
# ============================================

# ---------- Build stage ----------
FROM node:20-alpine AS builder

# Install build essentials
RUN apk add --no-cache \
    bash \
    git \
    python3 \
    make \
    g++

# Enable pnpm via corepack
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

# Copy dependency files first for better caching
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the production bundle
# This creates build/client (static assets) and build/server (SSR bundle)
RUN pnpm run build

# ---------- Production Runtime stage ----------
FROM node:20-alpine AS production

# Install runtime dependencies only
RUN apk add --no-cache \
    bash \
    curl \
    tini

# Enable pnpm
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.14.4 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only (excludes devDependencies like wrangler)
RUN pnpm install --prod --frozen-lockfile

# Copy built application from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/public ./public

# Copy server file and other necessary files
COPY server.js ./
COPY pre-start.cjs ./

# Create non-root user
RUN addgroup -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Environment configuration
ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0

# Expose port (configurable via PORT env var)
EXPOSE 5173

# Health check for Coolify/Docker
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5173/api/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the Node.js server (NOT wrangler!)
CMD ["node", "server.js"]
