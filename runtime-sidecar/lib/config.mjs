/**
 * LuxCoder local runtime: configuration, persisted settings and the scrubbed child environment.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Default sidecar port. Chosen from the RegesCore "devtools" band (3600-3699) next to
 * LuxCoder itself (3600) and the GGUF editor (3601); 3000 and every registered port are avoided.
 * Override with LUXCODER_RUNTIME_PORT. If the port is busy the sidecar falls back to an
 * OS-assigned ephemeral port (always above the 3000-9000 registry range on Windows).
 */
export const DEFAULT_RUNTIME_PORT = 3602;

/** Virtual path the UI uses for the project root (same as WebContainer's workdir). */
export const VIRTUAL_ROOT = '/home/project';

/** Command heads the shell may start without "full shell" mode. */
export const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
  'node',
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'yarnpkg',
  'bun',
  'bunx',
  'deno',
  'corepack',
  'vite',
  'git',
  'tsc',
  'tsx',
  'ts-node',
  'next',
  'astro',
  'nuxi',
  'remix',
  'svelte-kit',
  'eslint',
  'prettier',
  'vitest',
  'jest',
]);

export const DEFAULT_SETTINGS = Object.freeze({
  /** Allow any command, pipes and redirects to the system shell. Off by default. */
  fullShell: false,

  /** Run external commands inside a Docker container (only when Docker is detected). */
  docker: false,
  dockerImage: 'node:20',

  /** Per-command timeout. Cleared once the command starts a dev server (opens a port). */
  commandTimeoutMs: 20 * 60 * 1000,

  /** Extra command heads to allow, e.g. ["python"]. */
  extraAllowedCommands: [],
});

export function dataRoot() {
  if (process.env.LUXCODER_DATA_DIR) {
    return path.resolve(process.env.LUXCODER_DATA_DIR);
  }

  const base =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));

  return path.join(base, 'LuxCoder');
}

export function settingsFile() {
  return path.join(dataRoot(), 'runtime-settings.json');
}

/** Workspace root: env LUXCODER_WORKSPACES_DIR, then settings file `workspacesRoot`, then the default. */
export function workspacesRoot(settings) {
  const fromEnv = process.env.LUXCODER_WORKSPACES_DIR;
  const fromFile = typeof settings?.workspacesRoot === 'string' ? settings.workspacesRoot : '';

  return path.resolve(fromEnv || fromFile || path.join(dataRoot(), 'workspaces'));
}

function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const out = { ...base };

  if (!input || typeof input !== 'object') {
    return out;
  }

  if (typeof input.fullShell === 'boolean') {
    out.fullShell = input.fullShell;
  }

  if (typeof input.docker === 'boolean') {
    out.docker = input.docker;
  }

  if (typeof input.dockerImage === 'string' && /^[a-z0-9][a-z0-9._\/:@-]{0,127}$/i.test(input.dockerImage)) {
    out.dockerImage = input.dockerImage;
  }

  if (Number.isFinite(input.commandTimeoutMs)) {
    out.commandTimeoutMs = Math.min(6 * 3600_000, Math.max(10_000, Math.round(input.commandTimeoutMs)));
  }

  if (Array.isArray(input.extraAllowedCommands)) {
    out.extraAllowedCommands = input.extraAllowedCommands
      .filter((c) => typeof c === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(c))
      .slice(0, 50)
      .map((c) => c.toLowerCase());
  }

  // workspacesRoot is honoured from the file only; it can never be changed over the API.
  if (typeof input.workspacesRoot === 'string' && base === DEFAULT_SETTINGS) {
    out.workspacesRoot = input.workspacesRoot;
  }

  return out;
}

export function loadSettings() {
  let fileSettings = {};

  try {
    fileSettings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    // no settings yet
  }

  const settings = sanitizeSettings(fileSettings);

  if (process.env.LUXCODER_FULL_SHELL === '1') {
    settings.fullShell = true;
  }

  return settings;
}

/** Applies an API patch (never touches workspacesRoot) and persists it. */
export function saveSettings(current, patch) {
  const { workspacesRoot: _ignored, ...safePatch } = patch || {};
  const next = sanitizeSettings(safePatch, current);

  if (current.workspacesRoot) {
    next.workspacesRoot = current.workspacesRoot;
  }

  fs.mkdirSync(dataRoot(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));

  return next;
}

/* ------------------------------------------------------------------------------------------ */
/* Scrubbed environment                                                                        */
/* ------------------------------------------------------------------------------------------ */

const KEEP_ENV = new Set(
  [
    // search path and Windows essentials (without SystemRoot/ComSpec many tools refuse to start)
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMW6432',
    'COMMONPROGRAMFILES',
    'PROGRAMDATA',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',

    // home and temp (npm keeps its cache under LOCALAPPDATA and its global prefix under APPDATA)
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USER',
    'USERNAME',
    'LOGNAME',

    // terminal and locale
    'LANG',
    'LC_ALL',
    'TERM',
    'COLORTERM',

    // Node / package-manager toolchains
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'NVM_HOME',
    'NVM_SYMLINK',
    'NVM_DIR',
    'VOLTA_HOME',
    'FNM_DIR',
    'FNM_MULTISHELL_PATH',
    'COREPACK_HOME',
    'PNPM_HOME',
    'BUN_INSTALL',
    'DENO_DIR',
  ].map((k) => k.toUpperCase()),
);

const SECRETISH = /(TOKEN|SECRET|PASSW|AUTH|API_?KEY|CREDENTIAL|PRIVATE|SESSION|COOKIE)/i;

/**
 * Builds the environment for commands run in a workspace: only the variables in KEEP_ENV plus
 * non-secret npm_config_* values. Everything else from the parent (LLM API keys, cloud tokens,
 * .env contents loaded by LuxCoder) is dropped.
 */
export function scrubbedEnv(parent = process.env, extra = {}) {
  const out = {};

  for (const [key, value] of Object.entries(parent)) {
    if (typeof value !== 'string') {
      continue;
    }

    const upper = key.toUpperCase();

    if (KEEP_ENV.has(upper)) {
      out[key] = value;
      continue;
    }

    if (upper.startsWith('NPM_CONFIG_') && !SECRETISH.test(upper.slice('NPM_CONFIG_'.length))) {
      out[key] = value;
    }
  }

  Object.assign(out, {
    FORCE_COLOR: '1',
    BROWSER: 'none',
    NO_UPDATE_NOTIFIER: '1',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    LUXCODER_RUNTIME: 'local',
  });

  if (!out.TERM) {
    out.TERM = 'xterm-256color';
  }

  return { ...out, ...extra };
}

/** Returns the value of an env var regardless of key case (Windows keys are case-insensitive). */
export function envGet(env, name) {
  const upper = name.toUpperCase();

  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper) {
      return value;
    }
  }

  return undefined;
}
