/**
 * Workspace file watcher producing WebContainer-style PathWatcherEvents
 * ({ type: add_file|change|remove_file|add_dir|remove_dir, path: "/home/project/...", buffer }).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { VIRTUAL_ROOT } from './config.mjs';

const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
const ALWAYS_SKIP = new Set(['node_modules', '.git']);

/** Minimal glob -> RegExp: supports **, *, ? */
export function globToRegExp(glob) {
  let re = '';

  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];

    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;

        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }

  return new RegExp(`^${re}$`);
}

/** Builds a predicate over workspace-relative paths from WebContainer-style exclude globs. */
export function buildExcluder(patterns = []) {
  const regexes = patterns
    .filter((p) => typeof p === 'string' && p.length < 200)
    .map((p) => {
      let g = p.replace(/\\/g, '/');

      if (g.startsWith(VIRTUAL_ROOT + '/')) {
        g = g.slice(VIRTUAL_ROOT.length + 1);
      }

      return globToRegExp(g.replace(/^\/+/, ''));
    });

  return (rel) => {
    const parts = rel.split('/');

    if (parts.some((p) => ALWAYS_SKIP.has(p))) {
      return true;
    }

    // a path is excluded if it or any ancestor matches
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');

      if (regexes.some((r) => r.test(prefix))) {
        return true;
      }
    }

    return false;
  };
}

export class WorkspaceWatcher {
  /**
   * @param {string} root real workspace path
   * @param {{exclude?: string[], includeContent?: boolean}} options
   * @param {(events: object[]) => void} emit
   */
  constructor(root, options, emit) {
    this.root = root;
    this.includeContent = options.includeContent !== false;
    this.isExcluded = buildExcluder(options.exclude || []);
    this.emit = emit;
    this.known = new Map(); // rel -> 'file' | 'dir'
    this.pending = new Set();
    this.flushTimer = null;
    this.watcher = null;
    this.closed = false;
  }

  async start() {
    const initial = [];
    await this.#scan('', initial);
    this.#emitBatched(initial);

    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_type, filename) => {
        if (!filename || this.closed) {
          return;
        }

        const rel = String(filename).split(path.sep).join('/');

        if (this.isExcluded(rel)) {
          return;
        }

        this.pending.add(rel);

        if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => void this.#flush(), 60);
        }
      });
      this.watcher.on('error', () => {
        // the workspace may be deleted while watching
      });
    } catch {
      // recursive fs.watch unsupported (older Linux Node): initial scan only
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.flushTimer);
    this.watcher?.close();
  }

  #virtual(rel) {
    return rel ? `${VIRTUAL_ROOT}/${rel}` : VIRTUAL_ROOT;
  }

  async #fileEvent(type, rel, abs) {
    const event = { type, path: this.#virtual(rel), mtime: Date.now(), ino: 0 };

    if (this.includeContent) {
      try {
        const stat = await fsp.stat(abs);

        if (stat.size <= MAX_CONTENT_BYTES) {
          event.base64 = (await fsp.readFile(abs)).toString('base64');
        }
      } catch {
        // file vanished between events
      }
    }

    return event;
  }

  async #scan(rel, out) {
    const abs = rel ? path.join(this.root, ...rel.split('/')) : this.root;
    let entries;

    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;

      if (this.isExcluded(childRel) || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        this.known.set(childRel, 'dir');
        out.push({ type: 'add_dir', path: this.#virtual(childRel), mtime: Date.now(), ino: 0 });
        await this.#scan(childRel, out);
      } else if (entry.isFile()) {
        this.known.set(childRel, 'file');
        out.push(await this.#fileEvent('add_file', childRel, path.join(abs, entry.name)));
      }
    }
  }

  #emitBatched(events) {
    for (let i = 0; i < events.length; i += 200) {
      this.emit(events.slice(i, i + 200));
    }
  }

  async #flush() {
    this.flushTimer = null;

    if (this.flushing) {
      this.flushTimer = setTimeout(() => void this.#flush(), 60);
      return;
    }

    this.flushing = true;

    try {
      await this.#flushOnce();
    } finally {
      this.flushing = false;
    }
  }

  async #flushOnce() {
    const rels = [...this.pending].sort();
    this.pending.clear();

    const events = [];

    for (const rel of rels) {
      const abs = path.join(this.root, ...rel.split('/'));
      let stat = null;

      try {
        stat = await fsp.lstat(abs);
      } catch {
        stat = null;
      }

      const before = this.known.get(rel);

      if (!stat) {
        if (before === 'dir') {
          for (const [k, t] of [...this.known]) {
            if (k.startsWith(rel + '/')) {
              this.known.delete(k);
              events.push({ type: t === 'dir' ? 'remove_dir' : 'remove_file', path: this.#virtual(k), mtime: Date.now(), ino: 0 });
            }
          }

          this.known.delete(rel);
          events.push({ type: 'remove_dir', path: this.#virtual(rel), mtime: Date.now(), ino: 0 });
        } else if (before === 'file') {
          this.known.delete(rel);
          events.push({ type: 'remove_file', path: this.#virtual(rel), mtime: Date.now(), ino: 0 });
        }

        continue;
      }

      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        if (before !== 'dir') {
          this.known.set(rel, 'dir');
          events.push({ type: 'add_dir', path: this.#virtual(rel), mtime: Date.now(), ino: 0 });

          // a directory that appears via rename/move brings its contents without child events
          await this.#scan(rel, events);
        }

        continue;
      }

      if (stat.isFile()) {
        this.known.set(rel, 'file');
        events.push(await this.#fileEvent(before === 'file' ? 'change' : 'add_file', rel, abs));
      }
    }

    if (events.length && !this.closed) {
      this.#emitBatched(events);
    }
  }
}
