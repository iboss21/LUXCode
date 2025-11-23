# ---------- Build stage ----------
FROM node:20-alpine AS builder

# System tools you will want inside the container
RUN apk add --no-cache bash git

# Enable pnpm via corepack (matches README requirements) :contentReference[oaicite:1]{index=1}
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

WORKDIR /app

# Install dependencies with a frozen lockfile
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the source
COPY . .

# Build the production bundle
RUN pnpm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

WORKDIR /app

# Hardened runtime env
ENV NODE_ENV=production

# Non-root user
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

# Bring in the built app and node_modules
COPY --from=builder /app /app

# Vite preview default prod port
EXPOSE 4173

# Run preview server on 0.0.0.0 so Coolify/Traefik can reach it
CMD ["pnpm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
