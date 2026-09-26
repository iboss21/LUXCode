import { WORK_DIR_NAME } from '~/utils/constants';
import type { RuntimeContainer } from './types';

/**
 * Optional StackBlitz WebContainer backend (the original bolt.diy behaviour).
 *
 * `@webcontainer/api` is imported dynamically, so the StackBlitz runtime is only downloaded when
 * the user explicitly selects WebContainer. Commercial production use of the WebContainer runtime
 * requires a licence from StackBlitz.
 */
export async function bootWebContainerRuntime(): Promise<RuntimeContainer> {
  const api = await import('@webcontainer/api');

  const wc = await api.WebContainer.boot({
    coep: 'credentialless',
    workdirName: WORK_DIR_NAME,
    forwardPreviewErrors: true,
  });

  const runtime: RuntimeContainer = {
    kind: 'webcontainer',
    workdir: wc.workdir,
    location: 'in-browser WebContainer',
    fs: wc.fs as unknown as RuntimeContainer['fs'],
    spawn: (command, args = [], options) => wc.spawn(command, args, options as any) as any,
    on: (event, listener) => wc.on(event as any, listener as any),
    setPreviewScript: (script) => wc.setPreviewScript(script),
    internal: {
      watchPaths: (options, cb) => wc.internal.watchPaths(options, cb as any),
      textSearch: (pattern, options, onProgress) => wc.internal.textSearch(pattern, options as any, onProgress as any),
    },
  };

  return runtime;
}
