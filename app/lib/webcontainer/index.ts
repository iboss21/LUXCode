import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

let bootPromise: Promise<WebContainer> | null = null;

async function bootWebContainer(): Promise<WebContainer> {
  const webcontainer = await WebContainer.boot({
    coep: 'credentialless',
    workdirName: WORK_DIR_NAME,
    forwardPreviewErrors: true,
  });

  webcontainerContext.loaded = true;

  const { workbenchStore } = await import('~/lib/stores/workbench');

  const response = await fetch('/inspector-script.js');
  const inspectorScript = await response.text();
  await webcontainer.setPreviewScript(inspectorScript);

  webcontainer.on('preview-message', (message) => {
    console.log('WebContainer preview message:', message);

    if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
      const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
      const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
      workbenchStore.actionAlert.set({
        type: 'preview',
        title,
        description: 'message' in message ? message.message : 'Unknown error',
        content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
        source: 'preview',
      });
    }
  });

  return webcontainer;
}

/** Boot WebContainer on first build/workbench use — not on initial page load. */
export function ensureWebContainerBoot(): Promise<WebContainer> {
  if (import.meta.env.SSR) {
    return new Promise(() => {});
  }

  if (import.meta.hot?.data.webcontainer) {
    return import.meta.hot.data.webcontainer as Promise<WebContainer>;
  }

  if (!bootPromise) {
    bootPromise = bootWebContainer();

    if (import.meta.hot) {
      import.meta.hot.data.webcontainer = bootPromise;
    }
  }

  return bootPromise;
}

function createLazyWebContainerPromise(): Promise<WebContainer> {
  if (import.meta.env.SSR) {
    return new Promise(() => {});
  }

  return {
    then(onFulfilled, onRejected) {
      return ensureWebContainerBoot().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return ensureWebContainerBoot().catch(onRejected);
    },
    finally(onFinally) {
      return ensureWebContainerBoot().finally(onFinally);
    },
    [Symbol.toStringTag]: 'Promise',
  } as Promise<WebContainer>;
}

export let webcontainer: Promise<WebContainer> = createLazyWebContainerPromise();

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    webcontainer = createLazyWebContainerPromise();
  });
}
