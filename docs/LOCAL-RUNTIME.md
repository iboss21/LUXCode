# LuxCoder local runtime

LuxCoder runs generated projects on **this PC** by default, through a small Node sidecar. It no
longer needs StackBlitz WebContainer, which requires a paid StackBlitz licence for commercial
production use. WebContainer is still available as an **optional** backend. It is off by default
and only loaded when selected.

| | Local runtime (default) | WebContainer (optional) |
|---|---|---|
| Where code runs | Real processes on the host, in `%LOCALAPPDATA%\LuxCoder\workspaces\<projectId>` | In-browser (StackBlitz runtime) |
| Licence | MIT (LuxCoder code) | Commercial production use needs a StackBlitz licence |
| Select | default, or `LUXCODER_RUNTIME=local` | Settings -> Runtime, or `LUXCODER_RUNTIME=webcontainer` |

## 1. Where bolt.diy used WebContainer (the map)

| Area | File(s) | What it used |
|---|---|---|
| Boot, preview script, preview error forwarding | `app/lib/webcontainer/index.ts` | `WebContainer.boot`, `setPreviewScript`, `on('preview-message')` |
| Action runner: file writes, build, shell/start actions, command pre-checks | `app/lib/runtime/action-runner.ts` | `fs.mkdir/writeFile/readFile/readdir`, `spawn('npm',['run','build'])`, `workdir` |
| Shell / terminal (jsh with OSC 654 codes) | `app/utils/shell.ts`, `app/lib/stores/terminal.ts` | `spawn('/bin/jsh', ['--osc'])`, process `input/output/resize/kill` |
| Preview ports, server-ready, preview URL ids | `app/lib/stores/previews.ts`, `app/components/workbench/Preview.tsx` | `on('port')`, `on('server-ready')`, `*.webcontainer-api.io` URL parsing |
| File tree / editor sync (file watching) | `app/lib/stores/files.ts` | `internal.watchPaths`, `fs.writeFile/mkdir/rm` |
| Workbench wiring | `app/lib/stores/workbench.ts` | lazy runtime promise, `workdir` |
| Search panel | `app/components/workbench/Search.tsx` | `internal.textSearch` |
| Git clone / import (isomorphic-git fs adapter) | `app/lib/hooks/useGit.ts` | `fs.*` |
| Chat snapshot restore | `app/lib/persistence/useChatHistory.ts` | `fs.mkdir/writeFile` |
| Deploy (GitHub, GitLab, Netlify, Vercel) | `app/components/deploy/*.client.tsx` | `fs.readdir/readFile` of the build output |
| Preview pop-out and connect routes | `app/routes/webcontainer.preview.$id.tsx`, `webcontainer.connect.$id.tsx` | WebContainer-only relay pages (kept for the WebContainer backend) |
| Stack traces | `app/utils/stacktrace.ts` | strips `webcontainer-api.io` URLs (harmless) |

Zip download (`workbenchStore.downloadZip`) and folder import go through the files store, so they
work with either backend without direct runtime calls.

## 2. The abstraction

`app/lib/runtime/container/`

- `types.ts`: `RuntimeContainer`, the interface every backend implements. It mirrors the
  subset of the WebContainer API the app already used, so both backends are drop-in:
  - `fs`: `readFile`, `writeFile`, `mkdir`, `readdir`, `rm`, `rename`. Paths are relative to `workdir`
    (`/home/project`) or absolute under it.
  - `spawn(cmd, args, opts)`: a process with a streamed `output`, an `input` stream (terminal
    keystrokes), `exit` (exit code), `kill()` and `resize()`. `spawn('/bin/jsh')` is the interactive shell.
  - `on('port' | 'server-ready' | 'preview-message' | 'error')` for dev-server ports, preview
    URLs and preview errors.
  - `internal.watchPaths` (file watching), `internal.textSearch`, `setPreviewScript`, `closeProject`.
- `index.ts` picks the backend, boots it lazily (first workbench use), registers the inspector
  script and preview-error alerts, and exports `runtime` / `ensureRuntimeBoot` plus the
  preview-URL helpers. `~/lib/webcontainer` remains a thin compatibility re-export.
- `local.ts` is the browser client for the sidecar: one WebSocket, JSON RPC plus pushed events,
  and automatic reconnect that re-reads the session if the sidecar restarted.
- `webcontainer.ts` wraps StackBlitz WebContainer. `@webcontainer/api` is imported
  dynamically, so it is not downloaded unless selected.
- `config.ts` handles runtime selection and the session fetch.

`app/utils/shell.ts` (`BoltShell`) now reads the OSC codes with **one** background reader and
hands each code to its waiter. The old version let several callers read the same stream at once,
so an interrupted dev server could steal another caller's `prompt`/`exit` code.

## 3. The sidecar (`runtime-sidecar/`)

```
LuxCoder UI (browser, http://127.0.0.1:5199)
   |  GET /api/runtime-session  (same-origin: sidecar URL + session token)
   |  WebSocket ws://127.0.0.1:3602/rt   (token + Origin checked)
   v
runtime-sidecar/server.mjs  (127.0.0.1 only)
   |- lib/paths.mjs    workspace path containment (realpath through symlinks/junctions)
   |- lib/shell.mjs    lxsh: OSC-654 shell, builtins, allowlist, && || ; > >>, timeouts
   |- lib/procs.mjs    exe resolution, safe .cmd spawning, process-tree kill, netstat/CIM tables
   |- lib/ports.mjs    dev-server detection (output URLs + LISTEN polling, ownership check)
   |- lib/proxy.mjs    preview reverse proxy incl. WebSocket upgrade (HMR)
   |- lib/watch.mjs    recursive fs.watch -> add_file/change/remove_* events
   |- lib/search.mjs   text search
   |- lib/docker.mjs   optional Docker isolation (experimental)
   '- lib/project.mjs  per-project shells, processes, watchers, ports; close kills everything
iframe  http://p5173-<projectId>.localhost:3602/  ->  proxy  ->  localhost:5173 (Vite)
```

- **Start/stop.** `runtime-sidecar/launch.mjs` forks the sidecar from LuxCoder's own server:
  the Vite dev server (`vite.config.ts`, plugin `luxcoder-local-runtime`) or `server.js` in
  production. The sidecar exits when its parent disconnects or dies, and kills all project
  processes on the way out.
- **Port.** Default **3602**, registered for LuxCoder in the RegesCore `devtools` band next to
  LuxCoder (3600) and the GGUF editor (3601). It never uses 3000 or another registered port.
  Override with `LUXCODER_RUNTIME_PORT`. If the port is busy, the sidecar uses an OS ephemeral port.
- **Workspaces.** `%LOCALAPPDATA%\LuxCoder\workspaces\<projectId>`. The `projectId` is the chat
  id from the URL (`/chat/<id>`), or `new-<time>-<random>` for a page that has no chat yet.
  Override the root with `LUXCODER_WORKSPACES_DIR`, or with `workspacesRoot` in
  `%LOCALAPPDATA%\LuxCoder\runtime-settings.json`. The root can never be changed over the API.
  Empty workspaces are removed when their project closes. Others are kept, so delete old ones
  by hand.
- **Preview URLs.** `http://p<port>-<projectId>.localhost:<sidecarPort>/`. Every browser
  resolves `*.localhost` to loopback (RFC 6761), so no DNS is involved. The app is served at `/`,
  so absolute asset paths and Vite's HMR client work unmodified. Each preview has its own
  origin, isolated from the LuxCoder UI. The requested path form
  `/preview/<projectId>/<port>/...` is supported as a 302 redirect to that host.
- **HMR.** WebSocket upgrades on a preview host are forwarded as raw TCP after rewriting
  `Host`/`Origin` to `localhost:<port>`, so Vite's `allowedHosts` check passes. This was verified
  with Vite 5 (an `index.html` edit reloads the preview).
- **Server-ready.** A port counts as a dev server when either signal fires:
  - Its URL appears in the command output (`http://localhost:5173/`, `listening on port 3000`, ...).
  - A new LISTEN socket owned by the command's process tree shows up in `netstat -ano`.
  
  The port must also answer on 127.0.0.1 or ::1. Then `port` and `server-ready` are emitted with
  the preview URL. A port that stops answering twice in a row is reported as closed.

## 4. Security model

**Who can drive the runtime (control plane: WebSocket `/rt`, HTTP `/api/*`)**
- The sidecar listens on `127.0.0.1` only.
- A random 256-bit session token is generated at startup by the LuxCoder server. It is passed to
  the sidecar in its environment (deleted from `process.env` after start-up), kept in memory
  only, never logged, and never written to disk.
- The browser gets the token only from `GET /api/runtime-session` on the LuxCoder origin. That
  route sends no CORS headers, refuses non-loopback `Host` headers (403), and refuses
  `Sec-Fetch-Site` values other than `same-origin`/`none` (403).
- The WebSocket needs the `luxcoder-rt.v1` subprotocol plus `auth.<token>`, compared in constant
  time. It also needs an `Origin` in the allowlist (`http://127.0.0.1:<uiPort>`,
  `http://localhost:<uiPort>`, `http://[::1]:<uiPort>`).
- `/api/*` refuses any foreign `Origin`, even with a valid token, and requires the bearer token.
- DNS rebinding: every non-preview request needs `Host` = `127.0.0.1|localhost|[::1]:<port>`,
  otherwise 403.

**What a project can touch**
- **Paths.** Every path is normalized lexically: `..` above the root, `C:\...`, UNC paths and
  NUL bytes are refused. `/x` and `/home/project/x` both mean `<workspace>/x` (chroot semantics,
  as in WebContainer). The deepest existing ancestor is then resolved with `realpath`, which
  follows symlinks **and NTFS junctions**, and must stay inside the workspace. `rm`/`mv` act on
  a link itself and never on its target.
- **Commands.** The shell (`lxsh`) runs with `cwd` inside the workspace, `windowsHide`, and a
  **scrubbed environment**. Only PATH/PATHEXT, SystemRoot/ComSpec/windir (Windows needs them),
  HOME/USERPROFILE/APPDATA/LOCALAPPDATA (npm cache and prefix), TEMP/TMP, locale/terminal
  variables, Node toolchain variables (NVM/Volta/fnm/pnpm/corepack) and non-secret
  `npm_config_*` are kept. LLM API keys, `.env` contents and anything named like
  TOKEN/SECRET/PASSWORD/AUTH/KEY are dropped. The sidecar itself also starts with the scrubbed
  environment. `PATH`, `COMSPEC` and `NODE_OPTIONS` cannot be overridden from the shell.
- **Allowlist.** Command heads allowed without full shell: `node npm npx pnpm pnpx yarn yarnpkg
  bun bunx deno corepack vite git tsc tsx ts-node next astro nuxi remix svelte-kit eslint
  prettier vitest jest`, any tool in the project's `node_modules/.bin`, plus
  `extraAllowedCommands` from the settings. Builtins (`cd ls cat echo mkdir rm cp mv touch pwd
  clear env export which help sleep true false exit`) are implemented in the sidecar with the
  same path rules. Anything else, including pipes, `&`, `$(...)` and `<`, is refused (exit 126)
  unless **Full shell** is enabled. Full shell sends the line to Git Bash if installed, else
  `cmd.exe`.
- `.cmd`/`.bat` shims are run through `cmd.exe /d /s /c` with cross-spawn's escaping, so
  arguments cannot inject commands. `npm`/`npx` run as `node npm-cli.js` directly.
- **Timeouts and kill.** Each command has a timeout (default 20 min, `commandTimeoutMs`), which
  is cleared once the command opens a dev-server port. Ctrl+C, a new start command, project
  close and sidecar shutdown kill the **whole process tree** (`taskkill /T /F`). On project
  close, any orphans seen earlier in the project's trees are swept too. A project closes 8 s
  after its last browser connection goes away (`LUXCODER_RUNTIME_IDLE_CLOSE_MS`).
- **Preview proxy.** It forwards only to ports detected for that project. When a port was seen
  only in output, its listening socket must belong to the project's own process tree
  (netstat + CIM process table). Printing `http://localhost:3000` therefore cannot expose
  another local service. The proxy adds `Cross-Origin-Resource-Policy: cross-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`, because the LuxCoder page is cross-origin
  isolated. It injects a small script that posts uncaught errors, and the element inspector,
  only to the LuxCoder UI origins.

**What this is not.** The allowlist is a guard-rail for the agent and the terminal, not a
sandbox. `npm install` runs package lifecycle scripts, `npm run x` runs `package.json` scripts
through the system shell, and `node` runs arbitrary JavaScript. All of that runs as your Windows
user. Only generate and run code you are willing to run on your machine. For isolation, use
Docker mode, a VM, or a separate Windows account.

Also open LuxCoder at `http://127.0.0.1:<port>`, which is what the launcher prints. Previews on
`*.localhost` are then a different site from the UI and do not receive its cookies.

## 5. Settings

| Setting | Where | Default |
|---|---|---|
| Runtime (local / WebContainer) | Settings -> Runtime (per browser), env `LUXCODER_RUNTIME` (server default) | `local` |
| Full shell | Settings -> Runtime, env `LUXCODER_FULL_SHELL=1` | off |
| Docker isolation (experimental) | Settings -> Runtime (only offered when Docker is detected) | off |
| Command timeout, extra allowed commands, Docker image | `%LOCALAPPDATA%\LuxCoder\runtime-settings.json` (`commandTimeoutMs`, `extraAllowedCommands`, `dockerImage`) | 20 min, none, `node:20` |
| Sidecar port | `LUXCODER_RUNTIME_PORT` | 3602 |
| Workspaces root | `LUXCODER_WORKSPACES_DIR` or `workspacesRoot` in the settings file | `%LOCALAPPDATA%\LuxCoder\workspaces` |
| Disable the sidecar | `LUXCODER_RUNTIME_SIDECAR=0` | on |

Runtime settings persist in `runtime-settings.json`, written by the sidecar. The runtime choice
is stored per browser in `localStorage` (`luxcoder.runtime`), and switching needs a page reload.

## 6. Docker isolation (experimental, untested here)

When enabled and `docker version` succeeds, each project gets one long-lived container,
`luxcoder-<projectId>`. It is created from `node:20` with only the workspace bind-mounted at
`/workspace`, and 5173/4173/3000/8080/4321/8000 published on `127.0.0.1` (random host ports).
External commands run via `docker exec`, builtins still run in the sidecar on the mounted
directory, and the preview proxy maps container ports to the published host ports. Ctrl+C
restarts the container, because killing `docker exec` does not stop the process inside. Closing
the project removes the container.

Known limits:
- Dev servers must bind `0.0.0.0` inside the container. `HOST=0.0.0.0` is set, but Vite needs
  `--host`.
- Native modules installed in the container are Linux builds.

Docker is not installed on the development machine (VT-x is disabled), so this path has
**not** been run end to end.

## 7. Limits compared with WebContainer

- **No PTY.** Processes get pipes, not a pseudo-terminal. Interactive CLIs that require a TTY
  (arrow-key menus in `npm create vite`, `vite` keyboard shortcuts) fall back to non-interactive
  mode or wait for line input. `lxsh` supplies line editing (cooked mode) for programs that read
  stdin. Resizing is a no-op. Some tools print less colour.
- **No sandbox.** Code runs as your user (see section 4). WebContainer ran everything inside the
  browser.
- **Shell syntax.** Without full shell: `&&`, `||`, `;`, quotes, `VAR=x cmd`, `>`, `>>`, `2>&1`
  and `>/dev/null` work. Pipes, `&`, `$(...)` and `<` need full shell.
- **Windows toolchain.** Commands use whatever node/npm/pnpm/git is installed on the host.
  Projects that need other runtimes (Python, Go, ...) need them installed, plus full shell or
  `extraAllowedCommands`.
- **Workspaces are real directories.** They survive page reloads (a reload of `/chat/<id>`
  reuses `node_modules`), but a brand-new chat starts in a `new-...` workspace. Nothing is
  garbage-collected automatically except empty workspaces.
- **Port detection** on non-Windows hosts uses output parsing plus `lsof`/`ps`. The
  ownership check depends on those tools being present.
- The WebContainer-only routes (`/webcontainer/preview/:id`, `/webcontainer/connect/:id`) and
  the `pnpm -> npm` rewrite apply only when WebContainer is selected. Local-runtime previews pop
  out by opening their own URL.
- The Electron build does not start the sidecar yet. Start it from the Electron main process with
  `startRuntimeSidecar({ uiPort })`, or select WebContainer there.
- Cloudflare Pages / wrangler deployments cannot run a sidecar. Set `LUXCODER_RUNTIME=webcontainer`
  there, which needs a StackBlitz licence for commercial use, or host LuxCoder with `server.js`.

## 8. Testing

- A standalone suite drives the sidecar over its real protocol with 46 checks. It covers host,
  origin and token rejection, path escapes (`..`, drive, UNC, NTFS junction), the allowlist,
  pipes, the scrubbed environment, `&&`/`||`/redirects, dev-server detection, the proxy
  (including the WebSocket upgrade and the port-3000 exposure attempt), Ctrl+C tree kill,
  `project.close` tree kill, and clean sidecar shutdown.
- End to end in LuxCoder (dev on :5199) with a chat-generated Vite app:
  - Files are written into the workspace, and `npm install` and `npm run dev` run through the
    local runtime.
  - The preview iframe loads `http://p5173-<id>.localhost:3602/` through the proxy.
  - HMR reloads the preview on an `index.html` edit, and the counter is interactive.
  - The terminal works: `ls`/`node` run, `powershell` is refused, and `cat ../../../Windows/win.ini`
    is refused.
  - Closing the page kills npm -> cmd -> vite -> esbuild and frees :5173.
  - Killing the LuxCoder server makes the sidecar exit by itself.
