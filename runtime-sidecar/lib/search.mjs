/**
 * Text search over a workspace, returning WebContainer-style TextSearchMatch objects.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { VIRTUAL_ROOT } from './config.mjs';
import { buildExcluder } from './watch.mjs';

const DEFAULT_EXCLUDES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**', '**/*.lock', '**/package-lock.json'];
const MAX_FILE_BYTES = 1024 * 1024;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function textSearch(root, pattern, options = {}) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 1000) {
    return [];
  }

  const limit = Math.min(Math.max(Number(options.resultLimit) || 500, 1), 5000);
  const flags = options.caseSensitive ? 'g' : 'gi';
  let source = options.isRegex ? pattern : escapeRegExp(pattern);

  if (options.isWordMatch) {
    source = `\\b${source}\\b`;
  }

  let re;

  try {
    re = new RegExp(source, flags);
  } catch {
    return [];
  }

  const excludes = [...DEFAULT_EXCLUDES, ...(Array.isArray(options.excludes) ? options.excludes : [])].map((g) =>
    g.replace(/\/\*\*$/, ''),
  );
  const isExcluded = buildExcluder(excludes);
  const results = [];
  let total = 0;

  async function walk(rel) {
    if (total >= limit) {
      return;
    }

    const abs = rel ? path.join(root, ...rel.split('/')) : root;
    let entries;

    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (total >= limit) {
        return;
      }

      const childRel = rel ? `${rel}/${entry.name}` : entry.name;

      if (isExcluded(childRel) || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(childRel);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const file = path.join(abs, entry.name);
      let buf;

      try {
        const stat = await fsp.stat(file);

        if (stat.size > MAX_FILE_BYTES) {
          continue;
        }

        buf = await fsp.readFile(file);
      } catch {
        continue;
      }

      if (buf.subarray(0, 8000).includes(0)) {
        continue; // binary
      }

      const lines = buf.toString('utf8').split(/\r?\n/);
      const matches = [];

      for (let i = 0; i < lines.length && total < limit; i++) {
        re.lastIndex = 0;

        let m;

        while ((m = re.exec(lines[i])) && total < limit) {
          const range = {
            startLineNumber: i + 1,
            endLineNumber: i + 1,
            startColumn: m.index,
            endColumn: m.index + m[0].length,
          };
          matches.push({ preview: { text: lines[i], matches: [range] }, ranges: [range] });
          total++;

          if (m[0].length === 0) {
            re.lastIndex++;
          }
        }
      }

      if (matches.length) {
        results.push({ path: `${VIRTUAL_ROOT}/${childRel}`, matches });
      }
    }
  }

  await walk('');

  return results;
}
