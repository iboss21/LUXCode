#!/usr/bin/env node

/**
 * Node.js Production Server for LUXCode
 * 
 * This server runs the Remix app on Node.js runtime instead of Cloudflare Workers.
 * It's designed for deployment on:
 * - Coolify (self-hosted PaaS)
 * - Raw VPS with Docker
 * - Raw VPS with PM2/systemd
 * 
 * The app still works 100% on Cloudflare Workers/Pages with `wrangler dev` and `wrangler deploy`.
 */

import { createRequestHandler as createNodeRequestHandler } from '@remix-run/node';
import { broadcastDevReady, installGlobals } from '@remix-run/node';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Install fetch, Request, Response globals for Node.js
installGlobals();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment detection
const MODE = process.env.NODE_ENV || 'production';
const IS_PROD = MODE === 'production';
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';

console.log('🚀 Starting LUXCode Node.js Server...');
console.log(`   Mode: ${MODE.toUpperCase()}`);
console.log(`   Port: ${PORT}`);
console.log(`   Host: ${HOST}`);

const app = express();

// Production middleware
if (IS_PROD) {
  app.use(compression());
  // Trust proxy for correct IP addresses
  app.set('trust proxy', 1);
}

// Logging
app.use(morgan('tiny'));

// Serve static files from build/client
const BUILD_PATH = join(__dirname, 'build', 'client');
app.use(
  express.static(BUILD_PATH, {
    maxAge: IS_PROD ? '1y' : '0',
    immutable: IS_PROD,
  })
);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    runtime: 'node',
    mode: MODE,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    runtime: 'node',
    mode: MODE,
    timestamp: new Date().toISOString(),
  });
});

async function startServer() {
  try {
    // Dynamically import the server build
    const BUILD_SERVER_PATH = join(__dirname, 'build', 'server', 'index.js');
    const buildModule = await import(BUILD_SERVER_PATH);
    
    // Remix vite plugin exports named exports, not default
    const build = buildModule;

    console.log('✅ Loaded Remix server build');

    // Create mock Cloudflare environment for compatibility
    const createNodeEnv = () => {
      return new Proxy(process.env, {
        get(target, prop) {
          return target[prop] || undefined;
        },
      });
    };

    // Create Remix request handler with Node.js context
    const requestHandler = createNodeRequestHandler({
      build,
      mode: MODE,
      getLoadContext: (req, res) => {
        // Provide a compatible context object that matches Cloudflare's shape
        // but uses Node.js environment variables
        return {
          cloudflare: {
            env: createNodeEnv(),
            cf: null,
            ctx: {
              waitUntil: (promise) => {
                promise.catch(console.error);
              },
              passThroughOnException: () => {},
            },
          },
          runtime: 'node',
        };
      },
    });

    // Handle all other requests with Remix
    app.all('*', requestHandler);

    // Start server
    const server = app.listen(PORT, HOST, () => {
      console.log('');
      console.log('🎉 LUXCode is running!');
      console.log('');
      console.log(`   ➜ Local:   http://localhost:${PORT}`);
      console.log(`   ➜ Network: http://${HOST}:${PORT}`);
      console.log('');
      if (!IS_PROD) {
        console.log('   Press Ctrl+C to stop');
      }
      console.log('');

      if (!IS_PROD) {
        broadcastDevReady(build);
      }
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });

      // Force close after 10 seconds
      setTimeout(() => {
        console.error('❌ Forced shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.error('   Try setting a different PORT environment variable');
      } else {
        console.error('❌ Server error:', error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('');
    console.error('   Make sure you ran `npm run build` first');
    console.error('   Looking for: build/server/index.js');
    process.exit(1);
  }
}

// Start the server
startServer();
