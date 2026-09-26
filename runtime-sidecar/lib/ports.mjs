/**
 * Dev-server port detection for one project.
 *
 * Two signals:
 *  1. Output parsing: localhost URLs / "listening on port N" in a command's output.
 *  2. Polling fallback: new TCP LISTEN sockets (netstat / lsof) that appear while a command runs.
 *
 * A candidate port is only exposed through the preview proxy when it answers on loopback AND
 * (where the OS lets us check) the listening socket belongs to a process in the command's own
 * process tree. So a process that merely prints "http://localhost:3000" cannot make the proxy
 * expose some other local service.
 */
import net from 'node:net';
import { descendantsOf, listeningPorts, pidAlive, processTable } from './procs.mjs';

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const URL_PORT_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):(\d{2,5})\b/gi;
const PHRASE_PORT_RE = /\b(?:listening|running|started|serving|available)\b[^\n]{0,40}?\bport\s*:?\s*(\d{2,5})\b/gi;

export function extractPorts(text) {
  const clean = text.replace(ANSI_RE, '');
  const found = new Set();

  for (const re of [URL_PORT_RE, PHRASE_PORT_RE]) {
    re.lastIndex = 0;

    let m;

    while ((m = re.exec(clean))) {
      const port = Number(m[1]);

      if (port >= 1024 && port <= 65535) {
        found.add(port);
      }
    }
  }

  return found;
}

function tryConnect(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Returns the loopback host the port answers on ('127.0.0.1' | '::1') or null. */
export async function probePort(port) {
  if (await tryConnect('127.0.0.1', port)) {
    return '127.0.0.1';
  }

  if (await tryConnect('::1', port)) {
    return '::1';
  }

  return null;
}

export class PortTracker {
  /**
   * @param {object} opts
   * @param {(port:number)=>string} opts.previewUrl
   * @param {(msg:object)=>void} opts.emit
   * @param {number[]} opts.reservedPorts ports never exposed (sidecar, LuxCoder UI)
   * @param {(port:number)=>number|undefined} [opts.mapPort] docker container->host port mapping
   * @param {Set<number>} opts.knownPids shared set of pids seen in this project's trees
   * @param {(msg:string)=>void} [opts.log]
   */
  constructor(opts) {
    this.opts = opts;
    this.ports = new Map(); // port -> { host, url, rootPid, verified, misses }
    this.inFlight = new Set();
    this.closed = false;
    this.closeCheck = setInterval(() => this.#checkClosed(), 5000);
    this.closeCheck.unref?.();
  }

  get(port) {
    return this.ports.get(port);
  }

  list() {
    return [...this.ports.entries()].map(([port, info]) => ({ port, url: info.url }));
  }

  /** Called with every output chunk of a command. */
  observeOutput(rootPid, state, text, onFound) {
    state.tail = (state.tail + text).slice(-600);

    for (const port of extractPorts(state.tail)) {
      if (!state.seen.has(port)) {
        state.seen.add(port);
        void this.#consider(port, rootPid, { fromOutput: true, onFound });
      }
    }
  }

  /** Per-command tracking state; call before the command starts. */
  async beginCommand(rootPidPromise, onFound) {
    const state = { tail: '', seen: new Set(), timer: null, baseline: null, started: Date.now(), stopped: false };

    try {
      state.baseline = new Set((await listeningPorts()).keys());
    } catch {
      state.baseline = new Set();
    }

    const poll = async () => {
      if (state.stopped || this.closed) {
        return;
      }

      const rootPid = await rootPidPromise;

      if (!rootPid || !pidAlive(rootPid)) {
        return;
      }

      try {
        const listening = await listeningPorts();
        const fresh = [...listening.keys()].filter(
          (p) => !state.baseline.has(p) && !this.ports.has(p) && !state.seen.has(p) && p >= 1024,
        );

        if (fresh.length) {
          const table = await processTable();
          const tree = descendantsOf(table, rootPid);
          tree.add(rootPid);
          tree.forEach((pid) => this.opts.knownPids.add(pid));

          for (const port of fresh) {
            const owners = listening.get(port) || new Set();

            if ([...owners].some((pid) => tree.has(pid))) {
              state.seen.add(port);
              void this.#consider(port, rootPid, { fromOutput: false, onFound, preverified: true });
            }
          }
        }
      } catch {
        // polling is best effort
      }

      const age = Date.now() - state.started;
      state.timer = setTimeout(poll, age < 180_000 ? 5000 : 20000);
      state.timer.unref?.();
    };

    state.timer = setTimeout(poll, 6000);
    state.timer.unref?.();

    return state;
  }

  endCommand(state) {
    if (state) {
      state.stopped = true;
      clearTimeout(state.timer);
    }
  }

  async #consider(port, rootPid, { fromOutput, onFound, preverified = false }) {
    if (this.closed || this.ports.has(port) || this.inFlight.has(port)) {
      return;
    }

    const hostPort = this.opts.mapPort ? this.opts.mapPort(port) : port;

    if (!hostPort || this.opts.reservedPorts.includes(hostPort)) {
      return;
    }

    this.inFlight.add(port);

    try {
      // Output often prints the URL just before the socket is bound: retry for ~20 s.
      let host = null;

      for (let i = 0; i < 40 && !this.closed; i++) {
        host = await probePort(hostPort);

        if (host) {
          break;
        }

        if (rootPid && !pidAlive(rootPid)) {
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      if (!host || this.closed) {
        return;
      }

      let verified = preverified;

      if (!verified && fromOutput && rootPid && !this.opts.mapPort) {
        const result = await this.#verifyOwner(hostPort, rootPid);

        if (result === 'foreign') {
          this.opts.log?.(`port ${port} is owned by a process outside this project; not exposing it`);
          return;
        }

        verified = result === 'ours';
      }

      if (this.opts.mapPort) {
        verified = true; // docker-published port of this project's own container
      }

      const url = this.opts.previewUrl(port);
      this.ports.set(port, { host, hostPort, url, rootPid, verified, misses: 0 });
      this.opts.emit({ ev: 'port', port, type: 'open', url });
      this.opts.emit({ ev: 'server-ready', port, url });
      onFound?.(port);
    } finally {
      this.inFlight.delete(port);
    }
  }

  /** 'ours' | 'foreign' | 'unknown' */
  async #verifyOwner(port, rootPid) {
    try {
      const listening = await listeningPorts();
      const owners = listening.get(port);

      if (!owners || owners.size === 0) {
        return 'unknown';
      }

      const table = await processTable();

      if (table.size === 0) {
        return 'unknown';
      }

      const tree = descendantsOf(table, rootPid);
      tree.add(rootPid);
      tree.forEach((pid) => this.opts.knownPids.add(pid));

      return [...owners].some((pid) => tree.has(pid) || this.opts.knownPids.has(pid)) ? 'ours' : 'foreign';
    } catch {
      return 'unknown';
    }
  }

  async #checkClosed() {
    for (const [port, info] of this.ports) {
      const host = await probePort(info.hostPort);

      if (host) {
        info.misses = 0;
        info.host = host;
        continue;
      }

      info.misses += 1;

      if (info.misses >= 2) {
        this.ports.delete(port);
        this.opts.emit({ ev: 'port', port, type: 'close', url: info.url });
      }
    }
  }

  dispose() {
    this.closed = true;
    clearInterval(this.closeCheck);

    for (const [port, info] of this.ports) {
      this.opts.emit({ ev: 'port', port, type: 'close', url: info.url });
    }

    this.ports.clear();
  }
}
