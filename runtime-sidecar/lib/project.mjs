/**
 * A project = one workspace directory + the shells, processes, watchers and dev-server ports
 * that belong to it. Closing a project kills every process tree it started.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { removeContainer } from './docker.mjs';
import { RuntimeError, isInside } from './paths.mjs';
import { PortTracker } from './ports.mjs';
import { IS_WIN, descendantsOf, killTree, pidAlive, processTable, runCapture } from './procs.mjs';
import { previewOrigin } from './proxy.mjs';

const IDLE_CLOSE_MS = Number(process.env.LUXCODER_RUNTIME_IDLE_CLOSE_MS) || 8000;

export class Project {
  constructor(runtime, id) {
    this.runtime = runtime;
    this.id = id;
    this.root = null;
    this.conns = new Set();
    this.sessions = new Map(); // pid -> ShellSession
    this.children = new Set(); // ChildProcess roots
    this.watchers = new Map();
    this.knownPids = new Set();
    this.previewScript = '';
    this.closeTimer = null;
    this.closed = false;
    this.dockerPorts = null;
    this.fsQueue = Promise.resolve();
    this.nextPid = 1;
    this.ports = new PortTracker({
      previewUrl: (port) => `${previewOrigin(this.id, port, runtime.port)}/`,
      emit: (msg) => this.emit(msg),
      reservedPorts: runtime.reservedPorts,
      knownPids: this.knownPids,
      mapPort: null,
      log: (m) => runtime.log(`[${this.id}] ${m}`),
    });
  }

  settings() {
    return this.runtime.settings;
  }

  async init() {
    const base = this.runtime.workspacesRootReal;
    const dir = path.join(base, this.id);

    await fsp.mkdir(dir, { recursive: true });

    const real = await fsp.realpath(dir);

    // the project directory itself must not be a link that leads out of the workspaces root
    if (!isInside(base, real) || real === base) {
      throw new RuntimeError('EACCES', 'workspace directory resolves outside the workspaces root');
    }

    this.root = real;
  }

  emit(msg) {
    const data = JSON.stringify(msg);

    for (const ws of this.conns) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  attach(ws) {
    this.conns.add(ws);
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  detach(ws) {
    this.conns.delete(ws);

    if (this.conns.size === 0 && !this.closed) {
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => void this.close('no client connected'), IDLE_CLOSE_MS);
    }
  }

  /** Serialises file-system operations so they apply in the order the UI issued them. */
  queueFs(fn) {
    const run = this.fsQueue.then(fn, fn);
    this.fsQueue = run.catch(() => {});

    return run;
  }

  allocPid() {
    return this.nextPid++;
  }

  trackChild(child) {
    this.children.add(child);

    if (child.pid) {
      this.knownPids.add(child.pid);
    } else {
      child.once('spawn', () => this.knownPids.add(child.pid));
    }

    child.once('close', () => this.children.delete(child));
  }

  /** Kills every process tree started by this project (and orphans seen in its trees). */
  async killAll() {
    const roots = [...this.children].map((c) => c.pid).filter(Boolean);
    let sweep = new Set();

    if (IS_WIN && (roots.length || this.knownPids.size)) {
      try {
        const table = await processTable();

        for (const pid of roots) {
          descendantsOf(table, pid).forEach((d) => sweep.add(d));
        }

        // orphans: pids we saw in our trees earlier whose parent is gone
        for (const pid of this.knownPids) {
          const ppid = table.get(pid);

          if (ppid !== undefined && !table.has(ppid)) {
            sweep.add(pid);
            descendantsOf(table, pid).forEach((d) => sweep.add(d));
          }
        }
      } catch {
        sweep = new Set();
      }
    }

    for (const session of this.sessions.values()) {
      await session.dispose();
    }

    await Promise.all(roots.map((pid) => killTree(pid)));

    for (const pid of sweep) {
      if (pidAlive(pid)) {
        await runCapture('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeoutMs: 10000 });
      }
    }
  }

  async close(reason = 'closed') {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearTimeout(this.closeTimer);
    this.runtime.log(`[${this.id}] closing project (${reason})`);

    for (const w of this.watchers.values()) {
      w.close();
    }

    this.watchers.clear();

    await this.killAll();

    for (const [pid] of this.sessions) {
      this.emit({ ev: 'proc.exit', pid, code: 137 });
    }

    this.sessions.clear();
    this.ports.dispose();

    if (this.dockerPorts) {
      await removeContainer(this);
    }

    // Pages that never created a file leave an empty workspace behind: remove it.
    try {
      if (this.root && (await fsp.readdir(this.root)).length === 0) {
        await fsp.rmdir(this.root);
      }
    } catch {
      // keep it
    }

    this.emit({ ev: 'project.closed', reason });
    this.runtime.projects.delete(this.id);
  }
}
