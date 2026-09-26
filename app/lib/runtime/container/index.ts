import { cleanStackTrace } from '~/utils/stacktrace';
import { resolveRuntimeChoice } from './config';
import type { RuntimeContainer, RuntimeKind } from './types';

export type * from './types';

interface RuntimeContext {
  loaded: boolean;
  kind: RuntimeKind | null;
}

export const runtimeContext: RuntimeContext = import.meta.hot?.data.runtimeContext ?? {
  loaded: false,
  kind: null,
};

if (import.meta.hot) {
  import.meta.hot.data.runtimeContext = runtimeContext;
}

let bootPromise: Promise<RuntimeContainer> | null = null;

async function bootRuntime(): Promise<RuntimeContainer> {
  const { kind, session } = await resolveRuntimeChoice();
  let runtime: RuntimeContainer;

  if (kind === 'webcontainer') {
    const { bootWebContainerRuntime } = await import('./webcontainer');
    runtime = await bootWebContainerRuntime();
  } else {
    const { bootLocalRuntime } = await import('./local');
    runtime = await bootLocalRuntime(session.local);
  }

  runtimeContext.loaded = true;
  runtimeContext.kind = runtime.kind;

  const { workbenchStore } = await import('~/lib/stores/workbench');

  try {
    const response = await fetch('/inspector-script.js');
    await runtime.setPreviewScript(await response.text());
  } catch (error) {
    console.warn('[Runtime] could not register the preview inspector script', error);
  }

  runtime.on('preview-message', (message) => {
    if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
      const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
      const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
      workbenchStore.actionAlert.set({
        type: 'preview',
        title,
        description: 'message' in message ? String(message.message) : 'Unknown error',
        content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
        source: 'preview',
      });
    }
  });

  runtime.on('error', (error) => {
    workbenchStore.actionAlert.set({
      type: 'error',
      title: 'Runtime error',
      description: error.message,
      content: error.message,
    });
  });

  return runtime;
}

/** Boots the selected runtime on first workbench use, not on initial page load. */
export function ensureRuntimeBoot(): Promise<RuntimeContainer> {
  if (import.meta.env.SSR) {
    return new Promise(() => {});
  }

  if (import.meta.hot?.data.runtime) {
    return import.meta.hot.data.runtime as Promise<RuntimeContainer>;
  }

  if (!bootPromise) {
    bootPromise = bootRuntime();

    // allow a retry (e.g. after the sidecar came up) instead of caching the failure forever
    bootPromise.catch(() => {
      bootPromise = null;

      if (import.meta.hot) {
        delete import.meta.hot.data.runtime;
      }
    });

    if (import.meta.hot) {
      import.meta.hot.data.runtime = bootPromise;
    }
  }

  return bootPromise;
}

function createLazyRuntimePromise(): Promise<RuntimeContainer> {
  if (import.meta.env.SSR) {
    return new Promise(() => {});
  }

  return {
    then(onFulfilled, onRejected) {
      return ensureRuntimeBoot().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return ensureRuntimeBoot().catch(onRejected);
    },
    finally(onFinally) {
      return ensureRuntimeBoot().finally(onFinally);
    },
    [Symbol.toStringTag]: 'Promise',
  } as Promise<RuntimeContainer>;
}

/** Lazy promise of the active runtime; awaiting it boots the runtime. */
export let runtime: Promise<RuntimeContainer> = createLazyRuntimePromise();

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    runtime = createLazyRuntimePromise();
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Preview URL helpers                                                                          */
/* ------------------------------------------------------------------------------------------ */

const WEBCONTAINER_PREVIEW_RE = /^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/;
const LOCAL_PREVIEW_RE = /^https?:\/\/(p\d{2,5}-[a-z0-9-]+)\.localhost(?::\d+)?/i;

/** Stable id for a preview URL (WebContainer preview id, or p<port>-<project> for local). */
export function getPreviewId(url: string): string | null {
  return url.match(WEBCONTAINER_PREVIEW_RE)?.[1] ?? url.match(LOCAL_PREVIEW_RE)?.[1] ?? null;
}

/** URL to open a preview in its own window. WebContainer previews need the relay route. */
export function getPreviewWindowUrl(baseUrl: string): string | null {
  const wc = baseUrl.match(WEBCONTAINER_PREVIEW_RE);

  if (wc) {
    return `/webcontainer/preview/${wc[1]}`;
  }

  return LOCAL_PREVIEW_RE.test(baseUrl) ? baseUrl : null;
}
