import { WORK_DIR } from '~/utils/constants';
import { currentProjectId, fetchRuntimeSession, type LocalRuntimeSession } from './config';
import type {
  RuntimeContainer,
  RuntimeDirEnt,
  RuntimeEventMap,
  RuntimeFileSystem,
  RuntimePathWatcherEvent,
  RuntimePreviewMessage,
  RuntimeProcess,
  RuntimeSpawnOptions,
  RuntimeTextSearchMatch,
  RuntimeTextSearchOnProgress,
  RuntimeTextSearchOptions,
  RuntimeWatchPathsOptions,
  Unsubscribe,
} from './types';

/**
 * Browser client for the LuxCoder local runtime sidecar (runtime-sidecar/server.mjs).
 * One WebSocket per page: JSON RPC ({id, op, args} -> {re, ok, result|error}) plus pushed
 * events (process output/exit, fs watch events, dev-server ports).
 */

const PROTOCOL = 'luxcoder-rt.v1';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onResult?: (result: any) => void };

class RuntimeCallError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }

  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(bin);
}

class LocalProcess implements RuntimeProcess {
  output: ReadableStream<string>;
  input: WritableStream<string>;
  exit: Promise<number>;
  pid = 0;
  #controller!: ReadableStreamDefaultController<string>;
  #resolveExit!: (code: number) => void;
  #done = false;
  #buffer: string[] = [];

  constructor(private readonly _runtime: LocalRuntime) {
    this.output = new ReadableStream<string>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.exit = new Promise((resolve) => (this.#resolveExit = resolve));
    this.input = new WritableStream<string>({
      write: (data) => {
        if (this.pid) {
          this._runtime.send('proc.input', { pid: this.pid, data });
        } else {
          this.#buffer.push(data);
        }
      },
    });
  }

  attach(pid: number) {
    this.pid = pid;

    for (const data of this.#buffer.splice(0)) {
      this._runtime.send('proc.input', { pid, data });
    }
  }

  push(data: string) {
    if (!this.#done) {
      this.#controller.enqueue(data);
    }
  }

  end(code: number) {
    if (this.#done) {
      return;
    }

    this.#done = true;

    try {
      this.#controller.close();
    } catch {
      // already closed
    }

    this.#resolveExit(code);
  }

  kill() {
    if (this.pid && !this.#done) {
      this._runtime.send('proc.kill', { pid: this.pid });
    }
  }

  resize(dimensions: { cols: number; rows: number }) {
    if (this.pid) {
      this._runtime.send('proc.resize', { pid: this.pid, ...dimensions });
    }
  }
}

function dirent(name: string, type: string): RuntimeDirEnt {
  return { name, isFile: () => type === 'file', isDirectory: () => type === 'dir' };
}

export class LocalRuntime implements RuntimeContainer {
  readonly kind = 'local' as const;
  readonly workdir = WORK_DIR;
  location = '';
  projectId: string;
  sidecarPort = 0;

  #session: LocalRuntimeSession;
  #ws: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #procs = new Map<number, LocalProcess>();
  #orphanOutput = new Map<number, string[]>();
  #watchers = new Map<string, (events: RuntimePathWatcherEvent[]) => void>();
  #listeners: { [K in keyof RuntimeEventMap]: Set<RuntimeEventMap[K]> } = {
    port: new Set(),
    'server-ready': new Set(),
    'preview-message': new Set(),
    error: new Set(),
  };
  #closedByUs = false;
  #reconnecting: Promise<void> | null = null;

  constructor(session: LocalRuntimeSession, projectId: string) {
    this.#session = session;
    this.projectId = projectId;
    window.addEventListener('message', this.#onWindowMessage);
    window.addEventListener('pagehide', () => {
      this.#closedByUs = true;
      this.#ws?.close();
    });
  }

  /* ------------------------------------------------------------------------------------------ */
  /* Connection                                                                                  */
  /* ------------------------------------------------------------------------------------------ */

  async connect(): Promise<void> {
    const { wsUrl, token } = this.#session;

    if (!wsUrl || !token) {
      throw new Error('local runtime session is missing');
    }

    const ws = new WebSocket(wsUrl, [PROTOCOL, `auth.${token}`]);

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`cannot reach the LuxCoder local runtime at ${wsUrl}`));
      ws.onclose = () => reject(new Error(`the LuxCoder local runtime refused the connection (${wsUrl})`));
    });

    ws.onmessage = (event) => this.#onMessage(String(event.data));
    ws.onerror = null;
    ws.onclose = () => this.#onClose();
    this.#ws = ws;

    const hello = await this.call('hello', { projectId: this.projectId });
    this.location = hello.workspace;
    this.sidecarPort = hello.sidecarPort;

    if (!hello.resumed) {
      // the sidecar lost the project (restart or idle close): processes from before are gone
      for (const proc of this.#procs.values()) {
        proc.push('\r\n\x1b[33m[LuxCoder local runtime restarted]\x1b[0m\r\n');
        proc.end(137);
      }

      this.#procs.clear();
    }
  }

  #onClose() {
    this.#ws = null;

    for (const pending of this.#pending.values()) {
      pending.reject(new RuntimeCallError('EDISCONNECTED', 'local runtime disconnected'));
    }

    this.#pending.clear();

    if (!this.#closedByUs) {
      void this.#reconnect();
    }
  }

  async #reconnect() {
    if (this.#reconnecting) {
      return this.#reconnecting;
    }

    this.#reconnecting = (async () => {
      for (let attempt = 0; attempt < 30 && !this.#closedByUs; attempt++) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (attempt + 1))));

        try {
          // the LuxCoder server may have restarted the sidecar with a new token
          const session = await fetchRuntimeSession();

          if (session.local.available) {
            this.#session = session.local;
          }

          await this.connect();

          // re-establish file watchers
          for (const [oldId, cb] of [...this.#watchers]) {
            this.#watchers.delete(oldId);

            const { watchId } = await this.call('fs.watch', { exclude: this.#lastWatchExclude, includeContent: true });
            this.#watchers.set(watchId, cb);
          }

          return;
        } catch {
          // retry
        }
      }

      this.#emit('error', { message: 'Lost connection to the LuxCoder local runtime.' });
    })().finally(() => (this.#reconnecting = null));

    return this.#reconnecting;
  }

  #lastWatchExclude: string[] = [];

  #onMessage(raw: string) {
    let msg: any;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.re !== undefined) {
      const pending = this.#pending.get(msg.re);
      this.#pending.delete(msg.re);

      if (!pending) {
        return;
      }

      if (msg.ok) {
        pending.onResult?.(msg.result);
        pending.resolve(msg.result);
      } else {
        pending.reject(new RuntimeCallError(msg.error?.code || 'EIO', msg.error?.message || 'runtime error'));
      }

      return;
    }

    switch (msg.ev) {
      case 'proc.out': {
        const proc = this.#procs.get(msg.pid);

        if (proc) {
          proc.push(msg.data);
        } else {
          const buf = this.#orphanOutput.get(msg.pid) ?? [];
          buf.push(msg.data);
          this.#orphanOutput.set(msg.pid, buf);
        }

        break;
      }
      case 'proc.exit':
        this.#procs.get(msg.pid)?.end(msg.code);
        this.#procs.delete(msg.pid);
        break;
      case 'fs': {
        const cb = this.#watchers.get(msg.watchId);

        if (cb) {
          cb(
            (msg.events as any[]).map((e) => ({
              type: e.type,
              path: e.path,
              mtime: e.mtime,
              ino: e.ino ?? 0,
              buffer: typeof e.base64 === 'string' ? base64ToBytes(e.base64) : undefined,
            })),
          );
        }

        break;
      }
      case 'port':
        this.#emit('port', msg.port, msg.type, msg.url);
        break;
      case 'server-ready':
        this.#emit('server-ready', msg.port, msg.url);
        break;
      case 'project.closed':
        for (const proc of this.#procs.values()) {
          proc.end(137);
        }

        this.#procs.clear();
        break;
    }
  }

  #onWindowMessage = (event: MessageEvent) => {
    const data = event.data as RuntimePreviewMessage & { __luxcoderPreview?: number };

    if (!data || data.__luxcoderPreview !== 1 || !this.sidecarPort) {
      return;
    }

    const originRe = new RegExp(`^http://p\\d{2,5}-${this.projectId}\\.localhost:${this.sidecarPort}$`);

    if (!originRe.test(event.origin)) {
      return;
    }

    this.#emit('preview-message', data);
  };

  #emit<E extends keyof RuntimeEventMap>(event: E, ...args: Parameters<RuntimeEventMap[E]>) {
    for (const listener of this.#listeners[event]) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (error) {
        console.error('[LocalRuntime] listener failed', error);
      }
    }
  }

  call(op: string, args: Record<string, unknown> = {}, onResult?: (result: any) => void): Promise<any> {
    const ws = this.#ws;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new RuntimeCallError('EDISCONNECTED', 'local runtime is not connected'));
    }

    const id = this.#nextId++;

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onResult });
      ws.send(JSON.stringify({ id, op, args }));
    });
  }

  /** Fire-and-forget message (terminal input, resize). Order is preserved by the WebSocket. */
  send(op: string, args: Record<string, unknown>) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify({ id: this.#nextId++, op, args }));
    }
  }

  /* ------------------------------------------------------------------------------------------ */
  /* RuntimeContainer                                                                            */
  /* ------------------------------------------------------------------------------------------ */

  fs: RuntimeFileSystem = {
    readFile: (async (path: string, encoding?: string | null) => {
      const result = await this.call('fs.readFile', { path, encoding: encoding ? 'utf8' : null });
      return encoding ? (result.text as string) : base64ToBytes(result.base64);
    }) as RuntimeFileSystem['readFile'],

    writeFile: async (path, data) => {
      if (typeof data === 'string') {
        await this.call('fs.writeFile', { path, text: data });
      } else {
        await this.call('fs.writeFile', { path, base64: bytesToBase64(data) });
      }
    },

    mkdir: (async (path: string, options?: { recursive?: boolean }) => {
      const result = await this.call('fs.mkdir', { path, recursive: Boolean(options?.recursive) });
      return options?.recursive ? (result.path as string) : undefined;
    }) as RuntimeFileSystem['mkdir'],

    readdir: (async (path: string, options?: any) => {
      const result = await this.call('fs.readdir', { path });
      const entries = result.entries as Array<{ name: string; type: string }>;

      return options && typeof options === 'object' && options.withFileTypes
        ? entries.map((e) => dirent(e.name, e.type))
        : entries.map((e) => e.name);
    }) as RuntimeFileSystem['readdir'],

    rm: async (path, options) => {
      await this.call('fs.rm', { path, recursive: Boolean(options?.recursive), force: Boolean(options?.force) });
    },

    rename: async (from, to) => {
      await this.call('fs.rename', { from, to });
    },
  };

  async spawn(command: string, args: string[] = [], options: RuntimeSpawnOptions = {}): Promise<RuntimeProcess> {
    const proc = new LocalProcess(this);

    await this.call(
      'proc.spawn',
      {
        command,
        args,
        cwd: options.cwd,
        env: options.env,
        terminal: options.terminal,
      },
      (result) => {
        // registered synchronously so no output event can arrive before the process is known
        proc.attach(result.pid);
        this.#procs.set(result.pid, proc);

        for (const data of this.#orphanOutput.get(result.pid) ?? []) {
          proc.push(data);
        }

        this.#orphanOutput.delete(result.pid);
      },
    );

    return proc;
  }

  on<E extends keyof RuntimeEventMap>(event: E, listener: RuntimeEventMap[E]): Unsubscribe {
    const set = this.#listeners[event] as Set<RuntimeEventMap[E]>;
    set.add(listener);

    return () => set.delete(listener);
  }

  async setPreviewScript(script: string) {
    await this.call('preview.setScript', { script });
  }

  internal = {
    watchPaths: (options: RuntimeWatchPathsOptions, cb: (events: RuntimePathWatcherEvent[]) => void): Unsubscribe => {
      let watchId: string | null = null;
      let cancelled = false;

      this.#lastWatchExclude = options.exclude ?? [];
      this.call(
        'fs.watch',
        { exclude: options.exclude ?? [], includeContent: options.includeContent !== false },
        (result) => {
          watchId = result.watchId;

          if (!cancelled) {
            this.#watchers.set(result.watchId, cb);
          }
        },
      ).catch((error) => console.error('[LocalRuntime] watch failed', error));

      return () => {
        cancelled = true;

        if (watchId) {
          this.#watchers.delete(watchId);
          this.send('fs.unwatch', { watchId });
        }
      };
    },

    textSearch: async (
      pattern: string,
      options: Partial<RuntimeTextSearchOptions> = {},
      onProgress?: RuntimeTextSearchOnProgress,
    ) => {
      const result = await this.call('search.text', {
        pattern,
        options: {
          isRegex: options.isRegex,
          caseSensitive: options.caseSensitive,
          isWordMatch: options.isWordMatch,
          resultLimit: options.resultLimit,
          excludes: options.excludes,
        },
      });
      const map = new Map<string, RuntimeTextSearchMatch[]>();

      for (const file of result.files as Array<{ path: string; matches: RuntimeTextSearchMatch[] }>) {
        map.set(file.path, file.matches);
        onProgress?.(file.path, file.matches);
      }

      return map;
    },
  };

  async closeProject() {
    await this.call('project.close');
  }
}

export async function bootLocalRuntime(session: LocalRuntimeSession): Promise<RuntimeContainer> {
  if (!session.available || !session.wsUrl || !session.token) {
    throw new Error(
      'The LuxCoder local runtime is not running. Start LuxCoder with `pnpm run dev` (it launches the runtime sidecar), ' +
        'or choose WebContainer in Settings -> Runtime.',
    );
  }

  const runtime = new LocalRuntime(session, currentProjectId());
  await runtime.connect();

  return runtime;
}
