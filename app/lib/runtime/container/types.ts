/**
 * Runtime abstraction for LuxCoder.
 *
 * Everything the workbench needs from a code runtime (files, processes, terminals, dev-server
 * ports and preview URLs) goes through `RuntimeContainer`. Two implementations exist:
 *
 *  - `local` (default): a Node sidecar on 127.0.0.1 that runs real processes in a per-project
 *    workspace directory (runtime-sidecar/, client in ./local.ts).
 *  - `webcontainer` (optional): StackBlitz WebContainer, only loaded when selected. Commercial
 *    production use of the WebContainer runtime needs a StackBlitz licence.
 *
 * The shape deliberately mirrors the subset of the WebContainer API bolt.diy already used, so
 * both backends are drop-in for the stores, action runner and UI.
 */

export type RuntimeKind = 'local' | 'webcontainer';

export interface RuntimeDirEnt<T = string> {
  name: T;
  isFile(): boolean;
  isDirectory(): boolean;
}

/** fs.promises-like API. Paths are relative to `workdir`, or absolute "/home/project/...". */
export interface RuntimeFileSystem {
  readFile(path: string, encoding?: null): Promise<Uint8Array>;
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string | Uint8Array, options?: string | { encoding?: string | null } | null): Promise<void>;
  mkdir(path: string, options?: { recursive?: false }): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<string>;
  readdir(path: string, options: { withFileTypes: true; encoding?: string | null }): Promise<RuntimeDirEnt[]>;
  readdir(path: string, options?: { withFileTypes?: false; encoding?: string | null } | string | null): Promise<string[]>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export interface RuntimeProcess {
  /** Terminal output of the process and its descendants. */
  output: ReadableStream<string>;

  /** Terminal input (keystrokes). */
  input: WritableStream<string>;

  /** Resolves with the exit code. */
  exit: Promise<number>;
  kill(): void;
  resize(dimensions: { cols: number; rows: number }): void;
}

export interface RuntimeSpawnOptions {
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  output?: boolean;
  terminal?: { cols: number; rows: number };
}

export interface RuntimePathWatcherEvent {
  type: 'change' | 'add_file' | 'remove_file' | 'add_dir' | 'remove_dir' | 'update_directory';
  path: string;
  mtime: number;
  buffer?: Uint8Array;
  ino: number;
}

export interface RuntimeWatchPathsOptions {
  path?: string;
  include?: string[];
  exclude?: string[];
  gitignore?: string[];
  includeContent?: boolean;
  ignoreHiddenFiles?: boolean;
  excludeLargeContent?: number;
}

export interface RuntimeTextSearchRange {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
}

export interface RuntimeTextSearchMatch {
  preview: { text: string; matches: RuntimeTextSearchRange[] };
  ranges: RuntimeTextSearchRange[];
}

export interface RuntimeTextSearchOptions {
  folders: string[];
  includes: string[];
  excludes: string[];
  homeDir?: string;
  gitignore: boolean;
  requireGit: boolean;
  globalIgnoreFiles: boolean;
  isRegex: boolean;
  caseSensitive: boolean;
  isWordMatch: boolean;
  ignoreSymlinks: boolean;
  resultLimit: number;
}

export type RuntimeTextSearchOnProgress = (path: string, matches: RuntimeTextSearchMatch[]) => void;

export interface RuntimePreviewMessage {
  type: string;
  message?: string;
  stack?: string;
  pathname: string;
  search: string;
  hash: string;
  port: number;
  [key: string]: unknown;
}

export interface RuntimeEventMap {
  /** A dev server opened ('open') or closed ('close') `port`; `url` is the preview URL. */
  port: (port: number, type: 'open' | 'close', url: string) => void;
  'server-ready': (port: number, url: string) => void;
  'preview-message': (message: RuntimePreviewMessage) => void;
  error: (error: { message: string }) => void;
}

export type Unsubscribe = () => void;

export interface RuntimeContainer {
  readonly kind: RuntimeKind;

  /** Virtual project root, always "/home/project". */
  readonly workdir: string;

  /** Where files really live (local runtime: the workspace directory; WebContainer: in-browser). */
  readonly location: string;

  fs: RuntimeFileSystem;
  spawn(command: string, args?: string[], options?: RuntimeSpawnOptions): Promise<RuntimeProcess>;
  on<E extends keyof RuntimeEventMap>(event: E, listener: RuntimeEventMap[E]): Unsubscribe;

  /** Script injected into every preview page (element inspector). */
  setPreviewScript(script: string): Promise<void>;

  internal: {
    watchPaths(options: RuntimeWatchPathsOptions, cb: (events: RuntimePathWatcherEvent[]) => void): Unsubscribe;
    textSearch(
      pattern: string,
      options?: Partial<RuntimeTextSearchOptions>,
      onProgress?: RuntimeTextSearchOnProgress,
    ): Promise<unknown>;
  };

  /** Stops every process of the current project (local runtime: kills the process trees). */
  closeProject?(): Promise<void>;
}
