/**
 * Process helpers: executable resolution, safe spawning on Windows, process-tree kill,
 * process-table snapshots and listening-port tables.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { envGet } from './config.mjs';

export const IS_WIN = process.platform === 'win32';

/* ------------------------------------------------------------------------------------------ */
/* Executable resolution                                                                       */
/* ------------------------------------------------------------------------------------------ */

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds `head` in `dirs` (then PATH). On Windows PATHEXT extensions are tried; extensionless
 * files (sh shims) are skipped because CreateProcess cannot run them.
 */
export function resolveExecutable(head, env, extraDirs = []) {
  const pathVar = envGet(env, 'PATH') || '';
  const dirs = [...extraDirs, ...pathVar.split(path.delimiter).filter(Boolean)];

  if (!IS_WIN) {
    for (const dir of dirs) {
      const candidate = path.join(dir, head);

      if (isFile(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  const exts = (envGet(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map((e) => e.toLowerCase());
  const hasExt = exts.includes(path.extname(head).toLowerCase());

  for (const dir of dirs) {
    if (hasExt) {
      const candidate = path.join(dir, head);

      if (isFile(candidate)) {
        return candidate;
      }

      continue;
    }

    for (const ext of exts) {
      const candidate = path.join(dir, head + ext);

      if (isFile(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/** npm/npx: run their JS entry with node directly so no cmd.exe is involved. */
function npmCliFor(head, nodePath) {
  const script = head === 'npx' ? 'npx-cli.js' : 'npm-cli.js';
  const candidates = [
    path.join(path.dirname(nodePath), 'node_modules', 'npm', 'bin', script),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', script),
  ];

  return candidates.find(isFile) || null;
}

/* cmd.exe escaping, after cross-spawn (MIT) lib/util/escape.js — https://qntm.org/cmd */
const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(arg) {
  return arg.replace(metaCharsRegExp, '^$1');
}

function escapeArgument(arg, doubleEscape) {
  let out = `${arg}`;
  out = out.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  out = out.replace(/(?=(\\+?)?)\1$/, '$1$1');
  out = `"${out}"`;
  out = out.replace(metaCharsRegExp, '^$1');

  if (doubleEscape) {
    out = out.replace(metaCharsRegExp, '^$1');
  }

  return out;
}

/**
 * Turns (resolved executable, args) into a spawn() triple that is safe on Windows:
 * .exe runs directly; .cmd/.bat run through `cmd.exe /d /s /c` with every argument escaped.
 */
export function buildSpawn(file, args, env) {
  if (!IS_WIN) {
    return { command: file, args, options: {} };
  }

  const ext = path.extname(file).toLowerCase();

  if (ext === '.exe' || ext === '.com') {
    return { command: file, args, options: {} };
  }

  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [escapeCommand(path.normalize(file)), ...args.map((a) => escapeArgument(a, doubleEscape))].join(' ');
  const comspec = envGet(env, 'COMSPEC') || 'cmd.exe';

  return {
    command: comspec,
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

/**
 * Resolves a command head for the workspace. Returns { file, args } ready for buildSpawn or null.
 */
export function resolveCommand(head, args, { env, binDirs }) {
  const lower = head.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');

  if (lower === 'npm' || lower === 'npx') {
    const node = resolveExecutable('node', env) || process.execPath;
    const cli = npmCliFor(lower, node);

    if (cli) {
      return { file: node, args: [cli, ...args] };
    }
  }

  const file = resolveExecutable(head, env, binDirs);

  return file ? { file, args } : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Running helper commands                                                                     */
/* ------------------------------------------------------------------------------------------ */

export function runCapture(command, args, { timeoutMs = 15000, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    let child;

    try {
      child = spawn(command, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: -1, out: '', err: String(error) });
      return;
    }

    const timer = setTimeout(() => {
      if (!done) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (error) => {
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, out, err: err + String(error) });
    });
    child.on('close', (code) => {
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Process table and tree kill                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Map pid -> ppid for every process on the machine (Windows: CIM, POSIX: ps). */
export async function processTable() {
  const table = new Map();

  if (IS_WIN) {
    const script =
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
    const res = await runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeoutMs: 20000,
    });

    for (const line of res.out.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);

      if (m) {
        table.set(Number(m[1]), Number(m[2]));
      }
    }

    return table;
  }

  const res = await runCapture('ps', ['-A', '-o', 'pid=,ppid='], { timeoutMs: 10000 });

  for (const line of res.out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);

    if (m) {
      table.set(Number(m[1]), Number(m[2]));
    }
  }

  return table;
}

/** All descendants of `rootPid` (not including it). */
export function descendantsOf(table, rootPid) {
  const children = new Map();

  for (const [pid, ppid] of table) {
    if (pid === ppid) {
      continue;
    }

    if (!children.has(ppid)) {
      children.set(ppid, []);
    }

    children.get(ppid).push(pid);
  }

  const out = new Set();
  const stack = [rootPid];

  while (stack.length) {
    const pid = stack.pop();

    for (const child of children.get(pid) || []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }

  return out;
}

/** Kills a process and all of its descendants. Resolves when the kill command finished. */
export async function killTree(pid) {
  if (!pid) {
    return;
  }

  if (IS_WIN) {
    await runCapture('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { timeoutMs: 15000 });
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }

  await new Promise((r) => setTimeout(r, 1500));

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Listening ports                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** Map port -> Set<pid> of TCP LISTEN sockets on loopback / any addresses. */
export async function listeningPorts() {
  const map = new Map();
  const add = (port, pid) => {
    if (!map.has(port)) {
      map.set(port, new Set());
    }

    map.get(port).add(pid);
  };

  if (IS_WIN) {
    const res = await runCapture('netstat.exe', ['-ano', '-p', 'TCP'], { timeoutMs: 15000 });
    const res6 = await runCapture('netstat.exe', ['-ano', '-p', 'TCPv6'], { timeoutMs: 15000 });

    for (const line of `${res.out}\n${res6.out}`.split(/\r?\n/)) {
      const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i);

      if (m) {
        add(Number(m[2]), Number(m[3]));
      }
    }

    return map;
  }

  const res = await runCapture('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { timeoutMs: 10000 });
  let pid = 0;

  for (const line of res.out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
    } else if (line.startsWith('n')) {
      const m = line.match(/:(\d+)$/);

      if (m) {
        add(Number(m[1]), pid);
      }
    }
  }

  return map;
}
