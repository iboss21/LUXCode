/**
 * Optional Docker isolation (EXPERIMENTAL).
 *
 * When the "docker" setting is on AND Docker is detected, each project gets one long-lived
 * container (`luxcoder-<projectId>`) created from settings.dockerImage (default node:20) with ONLY
 * the workspace bind-mounted at /workspace and a few common dev ports published on 127.0.0.1.
 * External commands then run through `docker exec`. Builtins (ls, cd, rm, ...) still run in the
 * sidecar against the same mounted directory.
 *
 * Not verified on the development machine (Docker is not installed there: VT-x is disabled).
 */
import { runCapture } from './procs.mjs';

const PUBLISHED_PORTS = [5173, 4173, 3000, 8080, 4321, 8000];

let cache = { at: 0, available: false, version: null };

export async function detectDocker(force = false) {
  if (!force && Date.now() - cache.at < 60_000) {
    return cache;
  }

  const res = await runCapture('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 8000 });
  const version = res.code === 0 ? res.out.trim() : null;
  cache = { at: Date.now(), available: Boolean(version), version };

  return cache;
}

export function containerName(projectId) {
  return `luxcoder-${projectId}`;
}

export async function ensureContainer(project, image) {
  const name = containerName(project.id);
  const inspect = await runCapture('docker', ['inspect', '-f', '{{.State.Running}}', name], { timeoutMs: 10000 });

  if (inspect.code === 0 && inspect.out.trim() === 'true') {
    return name;
  }

  if (inspect.code === 0) {
    await runCapture('docker', ['rm', '-f', name], { timeoutMs: 20000 });
  }

  const args = [
    'run',
    '-d',
    '--init',
    '--name',
    name,
    '--label',
    'luxcoder.runtime=1',
    '-v',
    `${project.root}:/workspace`,
    '-w',
    '/workspace',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'CHOKIDAR_USEPOLLING=1',
  ];

  for (const port of PUBLISHED_PORTS) {
    args.push('-p', `127.0.0.1::${port}`);
  }

  args.push(image, 'sleep', 'infinity');

  const res = await runCapture('docker', args, { timeoutMs: 120000 });

  if (res.code !== 0) {
    throw new Error(`docker run failed: ${res.err.trim() || res.out.trim()}`);
  }

  await refreshPortMap(project);

  // dev servers inside the container print container ports; the proxy needs the published host port
  project.ports.opts.mapPort = (port) => project.dockerPorts?.get(port);

  return name;
}

export async function refreshPortMap(project) {
  const res = await runCapture('docker', ['port', containerName(project.id)], { timeoutMs: 10000 });
  const map = new Map();

  for (const line of res.out.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\/tcp\s*->\s*[^:]+:(\d+)/);

    if (m) {
      map.set(Number(m[1]), Number(m[2]));
    }
  }

  project.dockerPorts = map;

  return map;
}

/** Wraps an external command for `docker exec`. */
export function dockerExecArgs(name, cwdRel, env, head, args) {
  const out = ['exec', '-i', '-w', cwdRel ? `/workspace/${cwdRel}` : '/workspace'];

  for (const [k, v] of Object.entries(env)) {
    out.push('-e', `${k}=${v}`);
  }

  out.push(name, head, ...args);

  return out;
}

export async function restartContainer(project) {
  await runCapture('docker', ['restart', '-t', '1', containerName(project.id)], { timeoutMs: 30000 });
}

export async function removeContainer(project) {
  await runCapture('docker', ['rm', '-f', containerName(project.id)], { timeoutMs: 30000 });
}
