#!/usr/bin/env node
/**
 * LuxCoder local runtime sidecar.
 *
 * Replaces StackBlitz WebContainer: workspaces are real directories on this machine, commands
 * run as local processes, dev servers are reached through a reverse proxy.
 *
 * Listens on 127.0.0.1 only. Started by runtime-sidecar/launch.mjs (LuxCoder's Vite dev server
 * or server.js); stops when its parent goes away.
 *
 * Security model (details: docs/LOCAL-RUNTIME.md):
 *  - control plane (WebSocket /rt, HTTP /api/*) requires the per-session token AND an Origin in
 *    the LuxCoder UI allowlist; any Host other than 127.0.0.1/localhost/[::1]:<port> is refused
 *    (DNS rebinding defence).
 *  - preview hosts p<port>-<project>.localhost only proxy to ports opened by that project's own
 *    process tree.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { DEFAULT_RUNTIME_PORT, VIRTUAL_ROOT, loadSettings, saveSettings, workspacesRoot } from './lib/config.mjs';
import { detectDocker } from './lib/docker.mjs';
import { RuntimeError, resolveParentReal, resolveReal, sanitizeProjectId, toRelative } from './lib/paths.mjs';
import { pidAlive } from './lib/procs.mjs';
import { Project } from './lib/project.mjs';
import { buildInjection, errorPage, parsePreviewHost, proxyHttp, proxyUpgrade } from './lib/proxy.mjs';
import { textSearch } from './lib/search.mjs';
import { BUILTINS, ShellSession, parseCommandLine } from './lib/shell.mjs';
import { WorkspaceWatcher } from './lib/watch.mjs';

const VERSION = '1.0.0';
const TOKEN = process.env.LUXCODER_RUNTIME_TOKEN || '';
const PROTOCOL = 'luxcoder-rt.v1';

if (!/^[a-f0-9]{32,128}$/.test(TOKEN)) {
  console.error('[luxcoder-runtime] LUXCODER_RUNTIME_TOKEN missing or malformed; refusing to start');
  process.exit(2);
}

// The token is only needed in memory; do not leak it to anything spawned later.
delete process.env.LUXCODER_RUNTIME_TOKEN;

const runtime = {
  port: 0,
  settings: loadSettings(),
  projects: new Map(),
  uiOrigins: (process.env.LUXCODER_UI_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  reservedPorts: [],
  workspacesRootReal: '',
  log: (msg) => console.log(`[luxcoder-runtime] ${msg}`),
};

/* ------------------------------------------------------------------------------------------ */
/* Auth helpers                                                                                */
/* ------------------------------------------------------------------------------------------ */

function tokenMatches(candidate) {
  if (typeof candidate !== 'string') {
    return false;
  }

  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function controlHostOk(hostHeader) {
  const host = String(hostHeader || '').toLowerCase();
  return [`127.0.0.1:${runtime.port}`, `localhost:${runtime.port}`, `[::1]:${runtime.port}`].includes(host);
}

function originAllowed(origin) {
  return typeof origin === 'string' && runtime.uiOrigins.includes(origin);
}

/* ------------------------------------------------------------------------------------------ */
/* Projects                                                                                    */
/* ------------------------------------------------------------------------------------------ */

async function openProject(rawId) {
  const id = sanitizeProjectId(rawId);
  let project = runtime.projects.get(id);
  let resumed = true;

  if (!project || project.closed) {
    project = new Project(runtime, id);
    runtime.projects.set(id, project);
    resumed = false;

    try {
      await project.init();
    } catch (error) {
      runtime.projects.delete(id);
      throw error;
    }
  }

  return { project, resumed };
}

/* ------------------------------------------------------------------------------------------ */
/* RPC operations                                                                              */
/* ------------------------------------------------------------------------------------------ */

function rel(p) {
  return toRelative(p);
}

const ops = {
  async 'fs.readFile'(project, { path, encoding }) {
    const real = await resolveReal(project.root, rel(path));
    const buf = await fsp.readFile(real);

    return encoding ? { text: buf.toString('utf8') } : { base64: buf.toString('base64') };
  },

  async 'fs.writeFile'(project, { path, text, base64 }) {
    const r = rel(path);

    if (!r) {
      throw new RuntimeError('EISDIR', 'cannot write to the workspace root');
    }

    const real = await resolveReal(project.root, r);
    await fsp.writeFile(real, typeof base64 === 'string' ? Buffer.from(base64, 'base64') : String(text ?? ''));

    return {};
  },

  async 'fs.mkdir'(project, { path, recursive }) {
    const r = rel(path);
    const real = await resolveReal(project.root, r);

    if (!r) {
      return { path: VIRTUAL_ROOT };
    }

    await fsp.mkdir(real, { recursive: Boolean(recursive) });

    return { path: `${VIRTUAL_ROOT}/${r}` };
  },

  async 'fs.readdir'(project, { path }) {
    const real = await resolveReal(project.root, rel(path));
    const entries = await fsp.readdir(real, { withFileTypes: true });

    return {
      entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' })),
    };
  },

  async 'fs.stat'(project, { path }) {
    const real = await resolveReal(project.root, rel(path));
    const s = await fsp.stat(real);

    return { type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', size: s.size, mtimeMs: s.mtimeMs };
  },

  async 'fs.rm'(project, { path, recursive, force }) {
    const r = rel(path);

    if (!r) {
      throw new RuntimeError('EPERM', 'refusing to remove the workspace root');
    }

    const real = await resolveParentReal(project.root, r);

    try {
      const st = await fsp.lstat(real);

      if (st.isDirectory() && !recursive) {
        throw new RuntimeError('EISDIR', `is a directory: ${path}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT' && force) {
        return {};
      }

      throw error;
    }

    await fsp.rm(real, { recursive: Boolean(recursive), force: Boolean(force) });

    return {};
  },

  async 'fs.rename'(project, { from, to }) {
    const src = await resolveParentReal(project.root, rel(from));
    const dst = await resolveReal(project.root, rel(to));
    await fsp.rename(src, dst);

    return {};
  },

  async 'fs.watch'(project, { exclude, includeContent }, ws) {
    const watchId = crypto.randomUUID();
    const watcher = new WorkspaceWatcher(project.root, { exclude, includeContent }, (events) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ ev: 'fs', watchId, events }));
      }
    });

    project.watchers.set(watchId, watcher);
    ws.once('close', () => {
      watcher.close();
      project.watchers.delete(watchId);
    });

    // reply first, then stream the initial scan
    setImmediate(() => void watcher.start());

    return { watchId };
  },

  async 'fs.unwatch'(project, { watchId }) {
    project.watchers.get(watchId)?.close();
    project.watchers.delete(watchId);

    return {};
  },

  async 'search.text'(project, { pattern, options }) {
    return { files: await textSearch(project.root, pattern, options || {}) };
  },

  async 'proc.spawn'(project, { command, args, cwd, env, terminal }) {
    if (typeof command !== 'string' || !command) {
      throw new RuntimeError('EINVAL', 'command required');
    }

    const argv = Array.isArray(args) ? args.map(String) : [];
    const pid = project.allocPid();
    const cwdRel = cwd ? rel(cwd) : '';
    const cleanEnv = {};

    for (const [k, v] of Object.entries(env && typeof env === 'object' ? env : {})) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        cleanEnv[k] = String(v);
      }
    }

    const isShell = /^(\/bin\/)?(jsh|sh|bash|lxsh)$/.test(command);
    const session = new ShellSession(project, {
      pid,
      interactive: isShell,
      cwdRel,
      env: cleanEnv,
      send: (data) => project.emit({ ev: 'proc.out', pid, data }),
      onExit: (code) => {
        project.sessions.delete(pid);
        project.emit({ ev: 'proc.exit', pid, code });
      },
    });

    session.cols = terminal?.cols;
    project.sessions.set(pid, session);

    setImmediate(() => {
      if (isShell) {
        session.start();
      } else {
        void session.runOnce([command, ...argv]);
      }
    });

    return { pid };
  },

  async 'proc.input'(project, { pid, data }) {
    project.sessions.get(pid)?.input(String(data ?? ''));
    return {};
  },

  async 'proc.kill'(project, { pid }) {
    const session = project.sessions.get(pid);

    if (session) {
      await session.dispose();
      project.sessions.delete(pid);
      project.emit({ ev: 'proc.exit', pid, code: 137 });
    }

    return {};
  },

  async 'proc.resize'() {
    return {};
  },

  async 'preview.setScript'(project, { script }) {
    project.previewScript = typeof script === 'string' ? script.slice(0, 1024 * 1024) : '';
    return {};
  },

  async 'project.close'(project) {
    await project.close('closed by client');
    return {};
  },

  async 'settings.get'() {
    return publicSettings();
  },

  async 'settings.set'(_project, { patch }) {
    runtime.settings = saveSettings(runtime.settings, patch);
    return publicSettings();
  },

  async 'shell.parse'(_project, { line }) {
    return parseCommandLine(String(line));
  },
};

const FS_OPS = new Set(['fs.readFile', 'fs.writeFile', 'fs.mkdir', 'fs.readdir', 'fs.stat', 'fs.rm', 'fs.rename']);
const NO_REPLY = new Set(['proc.input', 'proc.resize']);

async function publicSettings() {
  const docker = await detectDocker();

  return {
    settings: { ...runtime.settings, workspacesRoot: undefined },
    workspacesRoot: runtime.workspacesRootReal,
    allowedCommands: runtime.settings.extraAllowedCommands,
    builtins: BUILTINS,
    docker: { available: docker.available, version: docker.version },
    version: VERSION,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* WebSocket control plane                                                                     */
/* ------------------------------------------------------------------------------------------ */

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 96 * 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
});

wss.on('connection', (ws) => {
  let project = null;

  const reply = (id, payload) => {
    if (id !== undefined && ws.readyState === 1) {
      ws.send(JSON.stringify({ re: id, ...payload }));
    }
  };

  ws.on('message', async (raw) => {
    let msg;

    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    const { id, op, args = {} } = msg || {};

    try {
      if (op === 'hello') {
        const opened = await openProject(args.projectId);

        if (project && project !== opened.project) {
          project.detach(ws);
        }

        project = opened.project;
        project.attach(ws);
        reply(id, {
          ok: true,
          result: {
            projectId: project.id,
            workdir: VIRTUAL_ROOT,
            workspace: project.root,
            resumed: opened.resumed,
            sessions: [...project.sessions.keys()],
            ports: project.ports.list(),
            sidecarPort: runtime.port,
            version: VERSION,
          },
        });

        return;
      }

      if (!project || project.closed) {
        throw new RuntimeError('ENOPROJECT', 'no open project; send hello first');
      }

      const handler = ops[op];

      if (!handler) {
        throw new RuntimeError('ENOSYS', `unknown op ${op}`);
      }

      const current = project;
      const run = () => handler(current, args, ws);
      const result = FS_OPS.has(op) ? await current.queueFs(run) : await run();

      if (!NO_REPLY.has(op)) {
        reply(id, { ok: true, result });
      }
    } catch (error) {
      reply(id, { ok: false, error: { code: error?.code || 'EIO', message: String(error?.message || error) } });
    }
  });

  ws.on('close', () => project?.detach(ws));
  ws.on('error', () => {});
});

/* ------------------------------------------------------------------------------------------ */
/* HTTP                                                                                        */
/* ------------------------------------------------------------------------------------------ */

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function findPreview(host) {
  const target = parsePreviewHost(host, runtime.port);

  if (!target) {
    return null;
  }

  const project = runtime.projects.get(target.projectId);
  const info = project?.ports.get(target.port);

  return { target, project, info };
}

async function readBody(req, limit = 64 * 1024) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;

    if (size > limit) {
      throw new RuntimeError('E2BIG', 'body too large');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  const preview = findPreview(host);

  // 1. Preview hosts: p<port>-<project>.localhost:<sidecarPort>
  if (preview) {
    if (!preview.info) {
      errorPage(res, 404, 'No dev server here', 'This preview is not running (the project was closed or the server stopped).');
      return;
    }

    proxyHttp(req, res, {
      host: preview.info.host,
      port: preview.info.hostPort,
      origin: `http://${host}`,
      injection: buildInjection({
        port: preview.target.port,
        uiOrigins: runtime.uiOrigins,
        previewScript: preview.project.previewScript,
      }),
    });

    return;
  }

  // 2. Everything else must be addressed to the sidecar by a loopback name (DNS rebinding defence).
  if (!controlHostOk(host)) {
    sendJson(res, 403, { error: 'forbidden host' });
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${runtime.port}`);

  if (url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, name: 'LuxCoder local runtime', version: VERSION });
    return;
  }

  const legacy = url.pathname.match(/^\/preview\/([a-z0-9-]{1,40})\/(\d{2,5})(\/.*)?$/i);

  if (legacy) {
    const location = `http://p${legacy[2]}-${legacy[1].toLowerCase()}.localhost:${runtime.port}${legacy[3] || '/'}${url.search}`;
    res.writeHead(302, { location, 'cache-control': 'no-store' });
    res.end();

    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;

    // A browser always sends Origin on CORS/POST requests: a foreign one is refused outright.
    if (origin !== undefined && !originAllowed(origin)) {
      sendJson(res, 403, { error: 'forbidden origin' });
      return;
    }

    const cors = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-max-age': '600',
          vary: 'Origin',
        }
      : {};

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();

      return;
    }

    const auth = String(req.headers.authorization || '');

    if (!tokenMatches(auth.replace(/^Bearer\s+/i, ''))) {
      sendJson(res, 401, { error: 'unauthorized' }, cors);
      return;
    }

    try {
      if (url.pathname === '/api/status' && req.method === 'GET') {
        sendJson(
          res,
          200,
          {
            ok: true,
            version: VERSION,
            projects: [...runtime.projects.values()].map((p) => ({ id: p.id, sessions: p.sessions.size, ports: p.ports.list() })),
          },
          cors,
        );

        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'GET') {
        sendJson(res, 200, await publicSettings(), cors);
        return;
      }

      if (url.pathname === '/api/settings' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        runtime.settings = saveSettings(runtime.settings, body);
        runtime.log(`settings updated: fullShell=${runtime.settings.fullShell} docker=${runtime.settings.docker}`);
        sendJson(res, 200, await publicSettings(), cors);

        return;
      }
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error) }, cors);
      return;
    }

    sendJson(res, 404, { error: 'not found' }, cors);

    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.on('upgrade', (req, socket, head) => {
  const preview = findPreview(req.headers.host);

  if (preview) {
    if (!preview.info) {
      socket.destroy();
      return;
    }

    proxyUpgrade(req, socket, head, { host: preview.info.host, port: preview.info.hostPort });

    return;
  }

  const reject = (status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  if (!controlHostOk(req.headers.host)) {
    reject(403, 'Forbidden');
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${runtime.port}`);

  if (url.pathname !== '/rt') {
    reject(404, 'Not Found');
    return;
  }

  if (!originAllowed(req.headers.origin)) {
    runtime.log(`refused control connection from origin ${String(req.headers.origin).slice(0, 100)}`);
    reject(403, 'Forbidden');

    return;
  }

  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((s) => s.trim());
  const tokenProto = protocols.find((p) => p.startsWith('auth.'));

  if (!protocols.includes(PROTOCOL) || !tokenMatches(tokenProto?.slice(5))) {
    reject(401, 'Unauthorized');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

/* ------------------------------------------------------------------------------------------ */
/* Lifecycle                                                                                   */
/* ------------------------------------------------------------------------------------------ */

let shuttingDown = false;

async function shutdown(reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  runtime.log(`shutting down (${reason})`);

  const hardExit = setTimeout(() => process.exit(0), 20000);
  hardExit.unref();

  await Promise.allSettled([...runtime.projects.values()].map((p) => p.close('runtime shutdown')));

  server.close();
  process.exit(0);
}

process.on('disconnect', () => void shutdown('parent disconnected'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('message', (msg) => {
  if (msg?.type === 'shutdown') {
    void shutdown('requested');
  } else if (msg?.type === 'origins' && Array.isArray(msg.origins)) {
    runtime.uiOrigins = msg.origins.filter((o) => typeof o === 'string');
  }
});

const parentPid = Number(process.env.LUXCODER_PARENT_PID) || 0;

if (parentPid) {
  setInterval(() => {
    if (!pidAlive(parentPid)) {
      void shutdown('parent exited');
    }
  }, 3000).unref();
}

async function listen(port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function main() {
  const root = workspacesRoot(runtime.settings);
  await fsp.mkdir(root, { recursive: true });
  runtime.workspacesRootReal = await fsp.realpath(root);

  const wanted = Number(process.env.LUXCODER_RUNTIME_PORT) || DEFAULT_RUNTIME_PORT;

  try {
    runtime.port = await listen(wanted);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') {
      throw error;
    }

    runtime.log(`port ${wanted} is busy; using an ephemeral port`);
    runtime.port = await listen(0);
  }

  const uiPorts = runtime.uiOrigins.map((o) => Number(new URL(o).port)).filter(Boolean);
  runtime.reservedPorts = [runtime.port, ...uiPorts];

  runtime.log(`listening on http://127.0.0.1:${runtime.port} (workspaces: ${runtime.workspacesRootReal})`);

  if (process.send) {
    process.send({ type: 'ready', port: runtime.port, workspacesRoot: runtime.workspacesRootReal, version: VERSION });
  }
}

main().catch((error) => {
  console.error('[luxcoder-runtime] failed to start:', error);
  process.exit(1);
});
