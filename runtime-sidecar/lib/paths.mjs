/**
 * Workspace path resolution. Every path from the browser or the shell goes through here.
 *
 * Rules
 *  - Paths are POSIX style. "/home/project/x" and "/x" both mean "<workspace>/x" (chroot
 *    semantics, as in WebContainer). Relative paths are relative to the workspace root, or to
 *    the shell's cwd when the shell passes one.
 *  - Windows drive paths (C:\..., C:/...), UNC paths (\\server\share) and NUL bytes are refused.
 *  - ".." that climbs above the workspace root is refused.
 *  - After the lexical checks the deepest existing ancestor is resolved with realpath (this
 *    follows symlinks AND NTFS junctions); the result must still be inside the workspace.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { VIRTUAL_ROOT } from './config.mjs';

export class RuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function escapeError(p) {
  return new RuntimeError('EACCES', `path escapes the workspace: ${String(p).slice(0, 200)}`);
}

/**
 * Lexically normalises a user path to a workspace-relative POSIX path ('' = root).
 * `baseRel` is the directory relative paths are resolved against.
 */
export function toRelative(p, baseRel = '') {
  if (typeof p !== 'string') {
    throw new RuntimeError('EINVAL', 'path must be a string');
  }

  if (p.includes('\0')) {
    throw new RuntimeError('EINVAL', 'path contains a NUL byte');
  }

  let s = p.replace(/\\/g, '/');

  if (/^[a-zA-Z]:/.test(s) || s.startsWith('//')) {
    throw escapeError(p);
  }

  let joined;

  if (s === VIRTUAL_ROOT || s.startsWith(VIRTUAL_ROOT + '/')) {
    joined = s.slice(VIRTUAL_ROOT.length);
  } else if (s.startsWith('/')) {
    joined = s;
  } else if (s === '~' || s.startsWith('~/')) {
    joined = s.slice(1);
  } else {
    joined = `${baseRel ? `/${baseRel}` : ''}/${s}`;
  }

  // Resolve against a fake root so ".." can be detected precisely.
  const segments = [];

  for (const part of joined.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }

    if (part === '..') {
      if (segments.length === 0) {
        throw escapeError(p);
      }

      segments.pop();
      continue;
    }

    segments.push(part);
  }

  return segments.join('/');
}

export function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolves a workspace-relative path to a real absolute path, following symlinks/junctions of
 * every existing component. Throws EACCES if the result leaves the workspace.
 */
export async function resolveReal(root, rel) {
  const lexical = rel ? path.join(root, ...rel.split('/')) : root;
  const rest = [];
  let probe = lexical;

  for (;;) {
    try {
      const real = await fsp.realpath(probe);

      if (!isInside(root, real)) {
        throw escapeError(rel);
      }

      const full = rest.length ? path.join(real, ...rest.reverse()) : real;

      if (!isInside(root, full)) {
        throw escapeError(rel);
      }

      return full;
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        const parent = path.dirname(probe);

        if (parent === probe || !isInside(root, parent)) {
          throw escapeError(rel);
        }

        rest.push(path.basename(probe));
        probe = parent;
        continue;
      }

      throw error;
    }
  }
}

/**
 * Like resolveReal but does NOT follow the final component (used by rm/rename so that a link
 * inside the workspace can be removed without touching what it points at).
 */
export async function resolveParentReal(root, rel) {
  if (!rel) {
    throw new RuntimeError('EPERM', 'refusing to operate on the workspace root');
  }

  const parts = rel.split('/');
  const base = parts.pop();
  const parent = await resolveReal(root, parts.join('/'));

  return path.join(parent, base);
}

/** Converts a real absolute path inside the workspace back to its virtual "/home/project/..." form. */
export function toVirtual(root, real) {
  const rel = path.relative(root, real).split(path.sep).join('/');
  return rel ? `${VIRTUAL_ROOT}/${rel}` : VIRTUAL_ROOT;
}

/** projectId -> safe directory / DNS label. */
export function sanitizeProjectId(id) {
  const clean = String(id || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  if (!clean) {
    throw new RuntimeError('EINVAL', 'invalid project id');
  }

  return clean;
}
