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

import { createRequestHandler } from '@remix-run/node';
import { createServer } from 'http';
import { installGlobals } from '@remix-run/node';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// Install fetch, Request, Response globals for Node.js
installGlobals();

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables
const loadEnv = () => {
  try {
    // Try to load from .env files
    const dotenv = await import('dotenv');
    dotenv.config({ path: resolve(__dirname, '.env.local') });
    dotenv.config({ path: resolve(__dirname, '.env') });
  } catch (error) {
    // dotenv not available or .env files don't exist - use process.env directly
    console.warn('Could not load dotenv, using existing environment variables');
  }
};

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';

console.log('🚀 Starting LUXCode Node.js Server...');
console.log(`   Mode: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
console.log(`   Port: ${PORT}`);
console.log(`   Host: ${HOST}`);

// Load the Remix server build
let build;
const buildPath = resolve(__dirname, 'build', 'server', 'index.js');

try {
  build = await import(buildPath);
  console.log('✅ Loaded Remix server build from:', buildPath);
} catch (error) {
  console.error('❌ Failed to load Remix build. Did you run `npm run build`?');
  console.error('   Looking for:', buildPath);
  console.error('   Error:', error.message);
  process.exit(1);
}

// Create mock Cloudflare environment for compatibility
// This provides the same API surface as Cloudflare Workers but uses Node.js environment
const createNodeEnv = () => {
  return new Proxy(process.env, {
    get(target, prop) {
      // Convert any property access to environment variable lookup
      return target[prop] || undefined;
    },
  });
};

// Create Remix request handler with Node.js context
const remixHandler = createRequestHandler({
  build,
  mode: isProduction ? 'production' : 'development',
  getLoadContext: (req) => {
    // Provide a compatible context object that matches Cloudflare's shape
    // but uses Node.js environment variables
    return {
      cloudflare: {
        env: createNodeEnv(),
        cf: null, // Cloudflare request properties not available on Node.js
        ctx: {
          waitUntil: (promise) => {
            // In Cloudflare Workers, waitUntil keeps the worker alive
            // On Node.js, we just let promises complete naturally
            promise.catch(console.error);
          },
          passThroughOnException: () => {
            // No-op on Node.js
          },
        },
      },
      // Add runtime identifier for conditional logic
      runtime: 'node',
    };
  },
});

// Create HTTP server
const server = createServer(async (req, res) => {
  try {
    // Health check endpoint
    if (req.url === '/api/health' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', runtime: 'node', timestamp: new Date().toISOString() }));
      return;
    }

    // Serve static files from build/client
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
      const staticPath = join(__dirname, 'build', 'client', req.url);
      try {
        const stat = await import('fs/promises').then(fs => fs.stat(staticPath));
        if (stat.isFile()) {
          const content = readFileSync(staticPath);
          const ext = staticPath.split('.').pop();
          const contentTypes = {
            'html': 'text/html',
            'js': 'application/javascript',
            'css': 'text/css',
            'json': 'application/json',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'svg': 'image/svg+xml',
            'ico': 'image/x-icon',
          };
          res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
          res.end(content);
          return;
        }
      } catch (err) {
        // File doesn't exist, fall through to Remix handler
      }
    }

    // Convert Node.js request to Web Request
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) {
            headers.append(key, v);
          }
        } else {
          headers.set(key, value);
        }
      }
    }

    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });
    }

    const request = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    // Handle with Remix
    const response = await remixHandler(request);

    // Convert Web Response to Node.js response
    res.writeHead(response.status, Object.fromEntries(response.headers));
    
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        await pump();
      };
      await pump();
    } else {
      res.end();
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Graceful shutdown
const shutdown = () => {
  console.log('\n🛑 Shutting down gracefully...');
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

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('🎉 LUXCode is running!');
  console.log('');
  console.log(`   ➜ Local:   http://localhost:${PORT}`);
  console.log(`   ➜ Network: http://${HOST}:${PORT}`);
  console.log('');
  console.log('   Press Ctrl+C to stop');
  console.log('');
});

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
