/**
 * Starts the LuxCoder local runtime sidecar as a child process of the LuxCoder server
 * (Vite dev server via vite.config.ts, or server.js in production).
 *
 * The session token is generated here, handed to the sidecar via its environment and kept in
 * memory (globalThis.__luxcoderRuntimeSidecar) for the same-origin /api/runtime-session route.
 * It is never written to disk or logged.
 */
import { fork } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from './lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, 'server.mjs');
const KEY = '__luxcoderRuntimeSidecar';

export function runtimeMode() {
  return String(process.env.LUXCODER_RUNTIME || 'local').toLowerCase() === 'webcontainer' ? 'webcontainer' : 'local';
}

export function getRuntimeSidecar() {
  return globalThis[KEY] || null;
}

export function uiOriginsFor(uiPort) {
  return [`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`, `http://[::1]:${uiPort}`];
}

/**
 * @param {{ uiPort: number, log?: (msg: string) => void }} options
 * @returns {Promise<null | {url:string, wsUrl:string, port:number, token:string, workspacesRoot:string, stop:()=>Promise<void>}>}
 */
export async function startRuntimeSidecar({ uiPort, log = (m) => console.log(m) }) {
  if (process.env.LUXCODER_RUNTIME_SIDECAR === '0') {
    log('[luxcoder-runtime] sidecar disabled (LUXCODER_RUNTIME_SIDECAR=0)');
    return null;
  }

  const existing = getRuntimeSidecar();

  if (existing && existing.child.exitCode === null) {
    existing.child.send?.({ type: 'origins', origins: uiOriginsFor(uiPort) });
    return existing;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const passthrough = {};

  for (const key of [
    'LUXCODER_RUNTIME_PORT',
    'LUXCODER_WORKSPACES_DIR',
    'LUXCODER_DATA_DIR',
    'LUXCODER_FULL_SHELL',
    'LUXCODER_RUNTIME_IDLE_CLOSE_MS',
  ]) {
    if (process.env[key]) {
      passthrough[key] = process.env[key];
    }
  }

  // The sidecar itself also gets a scrubbed environment: no LLM keys or other LuxCoder secrets.
  const env = scrubbedEnv(process.env, {
    ...passthrough,
    LUXCODER_RUNTIME_TOKEN: token,
    LUXCODER_UI_ORIGINS: uiOriginsFor(uiPort).join(','),
    LUXCODER_PARENT_PID: String(process.pid),
  });

  const child = fork(SERVER, [], {
    env,
    execArgv: [],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local runtime sidecar did not start within 30 s')), 30000);

    child.once('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`local runtime sidecar exited during startup (code ${code})`));
    });
  });

  const info = {
    child,
    port: ready.port,
    url: `http://127.0.0.1:${ready.port}`,
    wsUrl: `ws://127.0.0.1:${ready.port}/rt`,
    token,
    workspacesRoot: ready.workspacesRoot,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }

      const exited = new Promise((r) => child.once('exit', r));
      child.send?.({ type: 'shutdown' });

      const timeout = new Promise((r) => setTimeout(r, 15000));
      await Promise.race([exited, timeout]);

      if (child.exitCode === null) {
        child.kill();
      }

      if (globalThis[KEY] === info) {
        delete globalThis[KEY];
      }
    },
  };

  child.once('exit', () => {
    if (globalThis[KEY] === info) {
      delete globalThis[KEY];
    }
  });

  globalThis[KEY] = info;
  log(`[luxcoder-runtime] local runtime ready on ${info.url} (workspaces: ${info.workspacesRoot})`);

  return info;
}

export async function stopRuntimeSidecar() {
  await getRuntimeSidecar()?.stop();
}
