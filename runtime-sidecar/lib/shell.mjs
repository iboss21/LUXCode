/**
 * lxsh: the LuxCoder local-runtime shell.
 *
 * A small line-oriented shell that runs in the sidecar and speaks the same OSC 654 protocol as
 * WebContainer's jsh, so the existing terminal / BoltShell code works unchanged:
 *   ESC ]654;interactive BEL   shell ready
 *   ESC ]654;prompt BEL        waiting for input
 *   ESC ]654;exit=<n>:<code> BEL  a command line finished with <code>
 *
 * Command lines support `&&`, `||`, `;`, quotes, `NAME=value cmd`, `>`, `>>`, `2>&1` and
 * `>/dev/null`. File-system builtins (cd, ls, cat, mkdir, rm, cp, mv, touch, echo, ...) are
 * implemented here with the workspace containment rules, so they behave the same on Windows.
 * External commands must be in the allowlist (or node_modules/.bin) unless "full shell" is on;
 * pipes, background jobs and substitutions also need full shell.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { DEFAULT_ALLOWED_COMMANDS, VIRTUAL_ROOT, envGet, scrubbedEnv } from './config.mjs';
import { detectDocker, dockerExecArgs, ensureContainer, restartContainer } from './docker.mjs';
import { RuntimeError, resolveParentReal, resolveReal, toRelative } from './paths.mjs';
import { IS_WIN, buildSpawn, killTree, resolveCommand, resolveExecutable } from './procs.mjs';
import { globToRegExp } from './watch.mjs';

const OSC = (payload) => `\x1b]654;${payload}\x07`;

export const BUILTINS = Object.freeze([
  'cd',
  'pwd',
  'ls',
  'echo',
  'cat',
  'mkdir',
  'rm',
  'rmdir',
  'cp',
  'mv',
  'touch',
  'clear',
  'exit',
  'true',
  'false',
  'which',
  'env',
  'export',
  'help',
  'sleep',
]);

/* ------------------------------------------------------------------------------------------ */
/* Tokenizer                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * Parses a command line.
 * @returns {{ segments: Array<{words:string[], globs:boolean[], redirects:Array<object>, next:string|null}>, complex: string|null }}
 *   `complex` names the first construct that needs full shell (pipe, background, subshell...).
 */
export function parseCommandLine(line) {
  const segments = [];
  let words = [];
  let globs = [];
  let redirects = [];
  let cur = '';
  let curGlob = false;
  let hasCur = false;
  let quotedCur = false;
  let pendingRedirect = null;
  let complex = null;
  let inSingle = false;
  let inDouble = false;

  const pushWord = () => {
    if (!hasCur) {
      return;
    }

    if (pendingRedirect) {
      redirects.push({ ...pendingRedirect, target: cur });
      pendingRedirect = null;
    } else {
      words.push(cur);
      globs.push(curGlob);
    }

    cur = '';
    curGlob = false;
    hasCur = false;
    quotedCur = false;
  };

  const endSegment = (next) => {
    pushWord();

    if (pendingRedirect) {
      throw new RuntimeError('EINVAL', 'syntax error: missing redirect target');
    }

    if (words.length === 0 && redirects.length === 0) {
      if (next || segments.length) {
        throw new RuntimeError('EINVAL', `syntax error near '${next || segments[segments.length - 1]?.next}'`);
      }

      return;
    }

    segments.push({ words, globs, redirects, next });
    words = [];
    globs = [];
    redirects = [];
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (inSingle) {
      if (c === "'") {
        inSingle = false;
      } else {
        cur += c;
      }

      continue;
    }

    if (inDouble) {
      if (c === '"') {
        inDouble = false;
      } else if (c === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) {
        cur += line[++i];
      } else {
        if (c === '`' || (c === '$' && line[i + 1] === '(')) {
          complex ??= 'command substitution';
        }

        cur += c;
      }

      continue;
    }

    if (c === "'") {
      inSingle = true;
      hasCur = true;
      quotedCur = true;
      continue;
    }

    if (c === '"') {
      inDouble = true;
      hasCur = true;
      quotedCur = true;
      continue;
    }

    if (c === '\\') {
      // POSIX escape only before whitespace/specials, so Windows paths like src\app still work
      const next = line[i + 1];

      if (next !== undefined && /[\s'"\\$&|;<>()*?#`]/.test(next)) {
        cur += next;
        hasCur = true;
        i++;
      } else {
        cur += c;
        hasCur = true;
      }

      continue;
    }

    if (/\s/.test(c)) {
      pushWord();
      continue;
    }

    if (c === '#' && !hasCur) {
      break; // comment
    }

    if (c === '&' && line[i + 1] === '&') {
      endSegment('&&');
      i++;
      continue;
    }

    if (c === '|' && line[i + 1] === '|') {
      endSegment('||');
      i++;
      continue;
    }

    if (c === ';') {
      endSegment(';');
      continue;
    }

    if (c === '>') {
      let fd = 1;

      if (hasCur && !quotedCur && (cur === '1' || cur === '2')) {
        fd = Number(cur);
        cur = '';
        hasCur = false;
      } else {
        pushWord();
      }

      const append = line[i + 1] === '>';

      if (append) {
        i++;
      }

      if (line[i + 1] === '&' && /[12]/.test(line[i + 2] ?? '')) {
        redirects.push({ fd, dup: Number(line[i + 2]) });
        i += 2;
        continue;
      }

      pendingRedirect = { fd, append };
      continue;
    }

    if (c === '|') {
      complex ??= 'pipe';
    } else if (c === '&') {
      complex ??= 'background job';
    } else if (c === '<') {
      complex ??= 'input redirect';
    } else if (c === '(' || c === ')') {
      complex ??= 'subshell';
    } else if (c === '`' || (c === '$' && line[i + 1] === '(')) {
      complex ??= 'command substitution';
    }

    if (c === '*' || c === '?') {
      curGlob = true;
    }

    cur += c;
    hasCur = true;
  }

  if (inSingle || inDouble) {
    throw new RuntimeError('EINVAL', 'syntax error: unterminated quote');
  }

  endSegment(null);

  return { segments, complex };
}

/* ------------------------------------------------------------------------------------------ */
/* Shell session                                                                               */
/* ------------------------------------------------------------------------------------------ */

const ENV_ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const BLOCKED_ENV = new Set(['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'NODE_OPTIONS']);

function toTerminal(text) {
  return text.replace(/\r?\n/g, '\r\n');
}

function gitBash() {
  if (!IS_WIN) {
    return null;
  }

  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, 'Git', 'bin', 'bash.exe');

    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export class ShellSession {
  /**
   * @param {import('./project.mjs').Project} project
   * @param {{pid:number, interactive:boolean, cwdRel?:string, env?:object, send:(s:string)=>void, onExit:(code:number)=>void}} opts
   */
  constructor(project, opts) {
    this.project = project;
    this.pid = opts.pid;
    this.interactive = opts.interactive;
    this.cwdRel = opts.cwdRel || '';
    this.exports = { ...(opts.env || {}) };
    this.sendRaw = opts.send;
    this.onExit = opts.onExit;
    this.line = '';
    this.history = [];
    this.historyIndex = -1;
    this.running = null;
    this.busy = false;
    this.typeahead = '';
    this.escape = '';
    this.lastWasCR = false;
    this.exited = false;
  }

  send(text) {
    if (!this.exited) {
      this.sendRaw(text);
    }
  }

  promptText() {
    const where = this.cwdRel ? `~/project/${this.cwdRel}` : '~/project';
    return `\x1b[1;36m${where}\x1b[0m \x1b[1;35m❯\x1b[0m `;
  }

  prompt() {
    this.send(OSC('prompt'));
    this.send(this.promptText());
  }

  start() {
    this.send(`\x1b[2mLuxCoder local runtime - workspace ${this.project.root}\x1b[0m\r\n`);
    this.send(OSC('interactive'));
    this.prompt();
  }

  /** Runs a single command (proc.spawn of a non-shell command) and exits with its code. */
  async runOnce(words) {
    let code;

    try {
      code = await this.#runWords(words, words.map(() => false), [], {});
    } catch (error) {
      this.send(toTerminal(`${error.message}\n`));
      code = 1;
    }

    this.#exit(code);
  }

  #exit(code) {
    if (this.exited) {
      return;
    }

    this.exited = true;
    this.onExit(code);
  }

  resize() {
    // no PTY: nothing to resize
  }

  /** Input from the terminal (xterm onData). */
  input(data) {
    if (this.exited) {
      return;
    }

    if (this.busy) {
      this.#inputWhileBusy(data);
      return;
    }

    for (let i = 0; i < data.length; i++) {
      if (this.busy) {
        // a command started mid-chunk: keep the rest for after it (type-ahead)
        this.typeahead += data.slice(i);
        return;
      }

      this.#idleChar(data[i]);
    }
  }

  #idleChar(ch) {
    if (this.escape) {
      this.escape += ch;

      if (this.escape.length === 2 && ch !== '[' && ch !== 'O') {
        this.escape = '';
      } else if (this.escape.length > 2 && /[@-~]/.test(ch)) {
        const seq = this.escape;
        this.escape = '';

        if (seq === '\x1b[A' || seq === '\x1bOA') {
          this.#history(-1);
        } else if (seq === '\x1b[B' || seq === '\x1bOB') {
          this.#history(1);
        }
      }

      return;
    }

    if (ch === '\n' && this.lastWasCR) {
      this.lastWasCR = false;
      return;
    }

    this.lastWasCR = ch === '\r';

    switch (ch) {
      case '\x1b':
        this.escape = ch;
        return;
      case '\r':
      case '\n': {
        const line = this.line;
        this.line = '';
        this.historyIndex = -1;
        this.send('\r\n');
        void this.#execute(line);

        return;
      }
      case '\x7f':
      case '\b':
        if (this.line.length) {
          this.line = this.line.slice(0, -1);
          this.send('\b \b');
        }

        return;
      case '\x03':
        this.line = '';
        this.send('^C\r\n');
        this.prompt();

        return;
      case '\x0c':
        this.send('\x1b[2J\x1b[3J\x1b[H' + this.promptText() + this.line);
        return;
      case '\x15': // Ctrl+U
        this.send('\r\x1b[2K' + this.promptText());
        this.line = '';

        return;
      case '\t':
      case '\x04':
        return;
      default:
        if (ch >= ' ') {
          this.line += ch;
          this.send(ch);
        }
    }
  }

  #history(delta) {
    if (!this.history.length) {
      return;
    }

    let idx = this.historyIndex === -1 ? this.history.length : this.historyIndex;
    idx = Math.min(this.history.length, Math.max(0, idx + delta));
    this.historyIndex = idx === this.history.length ? -1 : idx;
    this.line = idx === this.history.length ? '' : this.history[idx];
    this.send('\r\x1b[2K' + this.promptText() + this.line);
  }

  #inputWhileBusy(data) {
    const run = this.running;

    for (const ch of data) {
      if (ch === '\x03') {
        this.send('^C');
        this.typeahead = '';
        void this.interrupt();
        continue;
      }

      if (!run || !run.child) {
        this.typeahead += ch;
        continue;
      }

      // cooked-mode line discipline for programs reading stdin (no PTY on Windows)
      if (ch === '\r' || ch === '\n') {
        if (ch === '\n' && run.lastWasCR) {
          run.lastWasCR = false;
          continue;
        }

        run.lastWasCR = ch === '\r';
        this.send('\r\n');

        try {
          run.child.stdin.write(run.stdinLine + '\n');
        } catch {
          // stdin closed
        }

        run.stdinLine = '';
      } else if (ch === '\x7f' || ch === '\b') {
        if (run.stdinLine.length) {
          run.stdinLine = run.stdinLine.slice(0, -1);
          this.send('\b \b');
        }
      } else if (ch === '\x04') {
        try {
          run.child.stdin.end();
        } catch {
          // ignore
        }
      } else if (ch >= ' ') {
        run.stdinLine += ch;
        this.send(ch);
      }
    }
  }

  async interrupt() {
    const run = this.running;

    if (!run) {
      return;
    }

    run.interrupted = true;

    if (run.docker) {
      await restartContainer(this.project);
    }

    if (run.child?.pid) {
      await killTree(run.child.pid);
    }
  }

  async #execute(line) {
    const trimmed = line.trim();

    if (!trimmed) {
      this.prompt();
      return;
    }

    if (this.history[this.history.length - 1] !== trimmed) {
      this.history.push(trimmed);

      if (this.history.length > 200) {
        this.history.shift();
      }
    }

    this.busy = true;

    let code = 0;

    try {
      code = await this.#runLine(trimmed);
    } catch (error) {
      this.send(toTerminal(`lxsh: ${error.message}\n`));
      code = error instanceof RuntimeError && error.code === 'EINVAL' ? 2 : 1;
    }

    this.busy = false;

    if (this.exited) {
      return;
    }

    // Each OSC in its own chunk: BoltShell matches one OSC per chunk.
    this.send(OSC(`exit=${this.pid}:${Math.max(0, code)}`));
    this.prompt();

    if (this.typeahead) {
      const pending = this.typeahead;
      this.typeahead = '';
      this.input(pending);
    }
  }

  async #runLine(line) {
    const parsed = parseCommandLine(line);
    const settings = this.project.settings();

    if (parsed.complex) {
      if (settings.fullShell) {
        return this.#runSystemShell(line);
      }

      this.send(
        toTerminal(
          `lxsh: ${parsed.complex} is not supported in the restricted LuxCoder shell.\n` +
            `      Use && / || / ; and > redirects, or enable "Full shell" in Settings -> Runtime.\n`,
        ),
      );

      return 126;
    }

    if (settings.fullShell && parsed.segments.some((s) => !this.#isRunnable(s))) {
      return this.#runSystemShell(line);
    }

    let code = 0;
    let skip = false;

    for (let i = 0; i < parsed.segments.length; i++) {
      const seg = parsed.segments[i];

      if (!skip) {
        code = await this.#runSegment(seg);

        if (this.running?.interrupted || this.exited) {
          return code;
        }
      }

      const op = seg.next;

      if (op === '&&') {
        skip = code !== 0;
      } else if (op === '||') {
        skip = code === 0;
      } else {
        skip = false;
      }
    }

    return code;
  }

  #stripEnv(words) {
    let i = 0;
    const env = {};

    while (i < words.length && ENV_ASSIGN_RE.test(words[i])) {
      const [, key, value] = ENV_ASSIGN_RE.exec(words[i]);
      env[key] = value;
      i++;
    }

    return { env, index: i };
  }

  #isRunnable(seg) {
    const { index } = this.#stripEnv(seg.words);
    const head = seg.words[index];

    return !head || BUILTINS.includes(head) || this.#isAllowed(head);
  }

  #isAllowed(head) {
    if (/[\\/]/.test(head)) {
      return false;
    }

    const lower = head.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
    const settings = this.project.settings();

    if (DEFAULT_ALLOWED_COMMANDS.includes(lower) || settings.extraAllowedCommands.includes(lower)) {
      return true;
    }

    // project-local binaries installed by the package manager (vite, next, tsc, ...)
    for (const dir of this.#binDirs()) {
      for (const ext of IS_WIN ? ['.cmd', '.exe'] : ['']) {
        if (fs.existsSync(path.join(dir, lower + ext))) {
          return true;
        }
      }
    }

    return false;
  }

  #binDirs() {
    const root = this.project.root;
    const dirs = [];

    if (this.cwdRel) {
      dirs.push(path.join(root, ...this.cwdRel.split('/'), 'node_modules', '.bin'));
    }

    dirs.push(path.join(root, 'node_modules', '.bin'));

    return dirs;
  }

  async #runSegment(seg) {
    const { env, index } = this.#stripEnv(seg.words);
    const words = seg.words.slice(index);
    const globs = seg.globs.slice(index);

    if (words.length === 0) {
      // bare assignments set shell variables
      for (const [k, v] of Object.entries(env)) {
        if (!BLOCKED_ENV.has(k.toUpperCase())) {
          this.exports[k] = v;
        }
      }

      return 0;
    }

    return this.#runWords(words, globs, seg.redirects, env);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Redirects                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  async #openRedirects(redirects) {
    const sinks = { 1: null, 2: null }; // null = terminal, 'null' = discard, stream otherwise
    const streams = [];

    for (const r of redirects) {
      if (r.dup) {
        sinks[r.fd] = sinks[r.dup];
        continue;
      }

      if (/^(\/dev\/null|nul)$/i.test(r.target)) {
        sinks[r.fd] = 'null';
        continue;
      }

      const rel = toRelative(r.target, this.cwdRel);
      const real = await resolveReal(this.project.root, rel);
      const stream = fs.createWriteStream(real, { flags: r.append ? 'a' : 'w' });
      await new Promise((resolve, reject) => {
        stream.once('open', resolve);
        stream.once('error', reject);
      });
      streams.push(stream);
      sinks[r.fd] = stream;
    }

    const write = (fd, text) => {
      const sink = sinks[fd];

      if (sink === 'null') {
        return;
      }

      if (sink) {
        sink.write(text);
      } else {
        this.send(toTerminal(text));
      }
    };

    const close = () => Promise.all(streams.map((s) => new Promise((r) => s.end(r))));

    return { write, close };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Commands                                                                                 */
  /* ---------------------------------------------------------------------------------------- */

  async #runWords(words, globs, redirects, envOverride) {
    const io = await this.#openRedirects(redirects);

    try {
      const head = words[0];

      if (BUILTINS.includes(head)) {
        const args = await this.#expandGlobs(words.slice(1), globs.slice(1));

        try {
          return await this.#builtin(head, args, io);
        } catch (error) {
          io.write(2, `${head}: ${error.message}\n`);
          return 1;
        }
      }

      return await this.#external(words, envOverride, io);
    } finally {
      await io.close();
    }
  }

  async #expandGlobs(args, globs) {
    const out = [];

    for (let i = 0; i < args.length; i++) {
      if (!globs[i]) {
        out.push(args[i]);
        continue;
      }

      const word = args[i];
      const slash = word.lastIndexOf('/');
      const dirPart = slash >= 0 ? word.slice(0, slash) : '';
      const pattern = slash >= 0 ? word.slice(slash + 1) : word;

      try {
        const dirReal = await resolveReal(this.project.root, toRelative(dirPart || '.', this.cwdRel));
        const re = globToRegExp(pattern);
        const names = (await fsp.readdir(dirReal))
          .filter((n) => re.test(n) && (pattern.startsWith('.') || !n.startsWith('.')))
          .sort();

        if (names.length) {
          out.push(...names.map((n) => (dirPart ? `${dirPart}/${n}` : n)));
          continue;
        }
      } catch {
        // fall through to the literal word
      }

      out.push(word);
    }

    return out;
  }

  async #path(p) {
    return resolveReal(this.project.root, toRelative(p, this.cwdRel));
  }

  async #builtin(name, args, io) {
    const flags = new Set();
    const operands = [];

    for (const a of args) {
      if (/^-[a-zA-Z]+$/.test(a) && !['echo'].includes(name)) {
        for (const f of a.slice(1)) {
          flags.add(f);
        }
      } else {
        operands.push(a);
      }
    }

    switch (name) {
      case 'true':
        return 0;
      case 'false':
        return 1;
      case 'pwd':
        io.write(1, `${this.cwdRel ? `${VIRTUAL_ROOT}/${this.cwdRel}` : VIRTUAL_ROOT}\n`);
        return 0;
      case 'clear':
        this.send('\x1b[2J\x1b[3J\x1b[H');
        return 0;
      case 'echo': {
        const noNewline = args[0] === '-n';
        io.write(1, (noNewline ? args.slice(1) : args).join(' ') + (noNewline ? '' : '\n'));

        return 0;
      }
      case 'sleep': {
        const secs = Math.min(3600, Math.max(0, Number(operands[0]) || 0));
        await new Promise((r) => setTimeout(r, secs * 1000));

        return 0;
      }
      case 'cd': {
        const target = operands[0] ?? '/';
        const rel = toRelative(target, this.cwdRel);
        const real = await resolveReal(this.project.root, rel);
        const stat = await fsp.stat(real).catch(() => null);

        if (!stat || !stat.isDirectory()) {
          io.write(2, `cd: no such directory: ${target}\n`);
          return 1;
        }

        this.cwdRel = rel;

        return 0;
      }
      case 'ls': {
        const targets = operands.length ? operands : ['.'];
        let code = 0;

        for (const t of targets) {
          const real = await this.#path(t);
          const stat = await fsp.stat(real).catch(() => null);

          if (!stat) {
            io.write(2, `ls: cannot access '${t}': No such file or directory\n`);
            code = 2;
            continue;
          }

          if (targets.length > 1 && stat.isDirectory()) {
            io.write(1, `${t}:\n`);
          }

          const entries = stat.isDirectory()
            ? (await fsp.readdir(real, { withFileTypes: true }))
                .filter((e) => flags.has('a') || !e.name.startsWith('.'))
                .sort((a, b) => a.name.localeCompare(b.name))
            : [{ name: path.basename(real), isDirectory: () => false }];

          if (flags.has('l')) {
            for (const e of entries) {
              const s = await fsp.stat(path.join(stat.isDirectory() ? real : path.dirname(real), e.name)).catch(() => null);
              const kind = e.isDirectory() ? 'd' : '-';
              io.write(1, `${kind} ${String(s?.size ?? 0).padStart(10)} ${e.isDirectory() ? `\x1b[34m${e.name}/\x1b[0m` : e.name}\n`);
            }
          } else if (entries.length) {
            io.write(1, entries.map((e) => (e.isDirectory() ? `\x1b[34m${e.name}/\x1b[0m` : e.name)).join('  ') + '\n');
          }
        }

        return code;
      }
      case 'cat': {
        let code = 0;

        for (const t of operands) {
          try {
            const real = await this.#path(t);
            const stat = await fsp.stat(real);

            if (stat.isDirectory()) {
              throw new Error(`${t}: Is a directory`);
            }

            if (stat.size > 2 * 1024 * 1024) {
              throw new Error(`${t}: file too large for cat`);
            }

            io.write(1, await fsp.readFile(real, 'utf8'));
          } catch (error) {
            io.write(2, `cat: ${error.code === 'ENOENT' ? `${t}: No such file or directory` : error.message}\n`);
            code = 1;
          }
        }

        return code;
      }
      case 'mkdir': {
        for (const t of operands) {
          const real = await this.#path(t);
          await fsp.mkdir(real, { recursive: flags.has('p') });
        }

        return 0;
      }
      case 'touch': {
        for (const t of operands) {
          const real = await this.#path(t);
          const now = new Date();
          await (await fsp.open(real, 'a')).close();
          await fsp.utimes(real, now, now);
        }

        return 0;
      }
      case 'rmdir':
      case 'rm': {
        const recursive = name === 'rm' && (flags.has('r') || flags.has('R'));
        const force = flags.has('f');
        let code = 0;

        for (const t of operands) {
          const rel = toRelative(t, this.cwdRel);

          if (!rel) {
            io.write(2, `${name}: refusing to remove the project root\n`);
            code = 1;
            continue;
          }

          try {
            const real = await resolveParentReal(this.project.root, rel);

            if (name === 'rmdir') {
              await fsp.rmdir(real);
            } else {
              const st = await fsp.lstat(real);

              if (st.isDirectory() && !recursive) {
                throw Object.assign(new Error(`cannot remove '${t}': Is a directory`), { code: 'EISDIR' });
              }

              await fsp.rm(real, { recursive, force: false });
            }
          } catch (error) {
            if (force && error.code === 'ENOENT') {
              continue;
            }

            io.write(2, `${name}: ${error.code === 'ENOENT' ? `cannot remove '${t}': No such file or directory` : error.message}\n`);
            code = 1;
          }
        }

        return code;
      }
      case 'cp':
      case 'mv': {
        if (operands.length < 2) {
          io.write(2, `${name}: missing destination operand\n`);
          return 1;
        }

        const dest = operands[operands.length - 1];
        const sources = operands.slice(0, -1);
        const destReal = await this.#path(dest);
        const destStat = await fsp.stat(destReal).catch(() => null);

        if (sources.length > 1 && !destStat?.isDirectory()) {
          io.write(2, `${name}: target '${dest}' is not a directory\n`);
          return 1;
        }

        for (const s of sources) {
          const srcRel = toRelative(s, this.cwdRel);
          const srcReal = name === 'mv' ? await resolveParentReal(this.project.root, srcRel) : await this.#path(s);
          const target = destStat?.isDirectory() ? path.join(destReal, path.basename(srcReal)) : destReal;
          const srcStat = await fsp.lstat(srcReal).catch(() => null);

          if (!srcStat) {
            io.write(2, `${name}: cannot stat '${s}': No such file or directory\n`);
            return 1;
          }

          if (name === 'cp') {
            if (srcStat.isDirectory() && !(flags.has('r') || flags.has('R'))) {
              io.write(2, `cp: -r not specified; omitting directory '${s}'\n`);
              return 1;
            }

            await fsp.cp(srcReal, target, { recursive: true, force: true, verbatimSymlinks: true });
          } else {
            try {
              await fsp.rename(srcReal, target);
            } catch (error) {
              if (error.code !== 'EXDEV') {
                throw error;
              }

              await fsp.cp(srcReal, target, { recursive: true, force: true, verbatimSymlinks: true });
              await fsp.rm(srcReal, { recursive: true });
            }
          }
        }

        return 0;
      }
      case 'export': {
        for (const a of operands) {
          const m = ENV_ASSIGN_RE.exec(a);

          if (m && !BLOCKED_ENV.has(m[1].toUpperCase())) {
            this.exports[m[1]] = m[2];
          }
        }

        return 0;
      }
      case 'env': {
        const env = scrubbedEnv(process.env, this.exports);
        io.write(1, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

        return 0;
      }
      case 'which': {
        let code = 0;

        for (const cmd of operands) {
          if (BUILTINS.includes(cmd)) {
            io.write(1, `${cmd}: lxsh builtin\n`);
          } else if (this.#isAllowed(cmd) || this.project.settings().fullShell) {
            const found = resolveExecutable(cmd, scrubbedEnv(process.env), this.#binDirs());
            io.write(found ? 1 : 2, found ? `${found}\n` : `${cmd} not found\n`);
            code = found ? code : 1;
          } else {
            io.write(2, `${cmd}: not allowed\n`);
            code = 1;
          }
        }

        return code;
      }
      case 'exit': {
        const code = Number(operands[0]) || 0;

        if (this.interactive) {
          this.send('exit\r\n');
          this.#exit(code);
        }

        return code;
      }
      case 'help': {
        const settings = this.project.settings();
        io.write(
          1,
          [
            'LuxCoder local runtime shell (lxsh)',
            `  builtins: ${BUILTINS.join(' ')}`,
            `  commands: ${[...DEFAULT_ALLOWED_COMMANDS, ...settings.extraAllowedCommands].join(' ')} + node_modules/.bin`,
            `  syntax:   && || ; "quotes" 'quotes' NAME=value cmd  > >> 2>&1 >/dev/null`,
            `  full shell: ${settings.fullShell ? 'ON (pipes and any command go to the system shell)' : 'off (Settings -> Runtime)'}`,
            '',
          ].join('\n'),
        );

        return 0;
      }
      default:
        return 127;
    }
  }

  async #external(words, envOverride, io) {
    const settings = this.project.settings();
    const head = words[0];

    if (!this.#isAllowed(head)) {
      if (settings.fullShell) {
        return this.#runSystemShell(words.map(quoteForShell).join(' '));
      }

      io.write(
        2,
        `lxsh: '${head}' is not allowed in the LuxCoder local runtime.\n` +
          `      Allowed: ${[...DEFAULT_ALLOWED_COMMANDS, ...settings.extraAllowedCommands].join(', ')}, node_modules/.bin tools and lxsh builtins.\n` +
          `      Enable "Full shell" in Settings -> Runtime to run other commands.\n`,
      );

      return 126;
    }

    const cwdReal = await resolveReal(this.project.root, this.cwdRel);
    const extraEnv = {};

    for (const [k, v] of Object.entries({ ...this.exports, ...envOverride })) {
      if (!BLOCKED_ENV.has(k.toUpperCase())) {
        extraEnv[k] = v;
      }
    }

    const env = scrubbedEnv(process.env, extraEnv);

    if (settings.docker) {
      const docker = await detectDocker();

      if (docker.available) {
        const name = await ensureContainer(this.project, settings.dockerImage);
        const lower = head.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
        const spec = { command: 'docker', args: dockerExecArgs(name, this.cwdRel, extraEnv, lower, words.slice(1)), options: {} };

        return this.#spawnAndWait(spec, cwdReal, scrubbedEnv(process.env), io, { docker: true });
      }

      io.write(2, 'lxsh: Docker isolation is enabled but Docker was not detected; running on the host.\n');
    }

    const resolved = resolveCommand(head, words.slice(1), { env, binDirs: this.#binDirs() });

    if (!resolved) {
      io.write(2, `lxsh: command not found: ${head}\n`);
      return 127;
    }

    const spec = buildSpawn(resolved.file, resolved.args, env);

    return this.#spawnAndWait(spec, cwdReal, env, io, {});
  }

  async #runSystemShell(line) {
    const cwdReal = await resolveReal(this.project.root, this.cwdRel);
    const env = scrubbedEnv(process.env, this.exports);
    let spec;

    if (IS_WIN) {
      const bash = gitBash();
      spec = bash
        ? { command: bash, args: ['-c', line], options: {} }
        : { command: envGet(env, 'COMSPEC') || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
    } else {
      spec = { command: '/bin/sh', args: ['-c', line], options: {} };
    }

    const io = await this.#openRedirects([]);

    return this.#spawnAndWait(spec, cwdReal, env, io, {});
  }

  async #spawnAndWait(spec, cwd, env, io, { docker = false }) {
    const project = this.project;
    const settings = project.settings();
    let resolvePid;
    const pidPromise = new Promise((r) => (resolvePid = r));
    const onFound = () => clearTimeout(timer);
    const portState = await project.ports.beginCommand(pidPromise, onFound);

    let child;

    try {
      child = spawn(spec.command, spec.args, {
        cwd,
        env,
        windowsHide: true,
        detached: !IS_WIN,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...spec.options,
      });
    } catch (error) {
      project.ports.endCommand(portState);
      io.write(2, `lxsh: failed to start ${spec.command}: ${error.message}\n`);

      return 127;
    }

    const run = { child, interrupted: false, timedOut: false, stdinLine: '', lastWasCR: false, docker };
    this.running = run;
    project.trackChild(child);

    child.once('spawn', () => resolvePid(child.pid));
    child.stdin.on('error', () => {});

    let timer = setTimeout(() => {
      run.timedOut = true;
      io.write(2, `\nlxsh: command timed out after ${Math.round(settings.commandTimeoutMs / 1000)}s; stopping it\n`);
      void killTree(child.pid);
    }, settings.commandTimeoutMs);

    const pump = (stream, fd) => {
      const decoder = new StringDecoder('utf8');

      stream.on('data', (buf) => {
        const text = decoder.write(buf);

        if (text) {
          io.write(fd, text);
          project.ports.observeOutput(child.pid, portState, text, onFound);
        }
      });
    };

    pump(child.stdout, 1);
    pump(child.stderr, 2);

    const code = await new Promise((resolve) => {
      child.once('error', (error) => {
        io.write(2, `lxsh: ${error.message}\n`);
        resolvePid(0);
        resolve(127);
      });
      child.once('close', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    });

    clearTimeout(timer);
    project.ports.endCommand(portState);
    this.running = null;

    if (run.interrupted) {
      this.send('\r\n');
      return 130;
    }

    if (run.timedOut) {
      return 124;
    }

    return code;
  }

  async dispose() {
    this.exited = true;

    if (this.running?.child?.pid) {
      this.running.interrupted = true;
      await killTree(this.running.child.pid);
    }
  }
}

function quoteForShell(word) {
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(word)) {
    return word;
  }

  return `'${word.replace(/'/g, `'\\''`)}'`;
}
