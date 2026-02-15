import type { AppLoadContext } from '@remix-run/cloudflare';
import { RemixServer } from '@remix-run/react';
import { isbot } from 'isbot';
import * as ReactDOMServer from 'react-dom/server';
import { renderHeadToString } from 'remix-island';
import { Head } from './root';
import { themeStore } from '~/lib/stores/theme';

// Handle CommonJS/ESM compatibility
const renderToReadableStream =
  typeof ReactDOMServer.renderToReadableStream === 'function'
    ? ReactDOMServer.renderToReadableStream
    : (ReactDOMServer as any).default?.renderToReadableStream;

const renderToString =
  typeof ReactDOMServer.renderToString === 'function'
    ? ReactDOMServer.renderToString
    : (ReactDOMServer as any).default?.renderToString;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
  _loadContext: AppLoadContext,
) {
  // await initializeModelList({});

  // Check if renderToReadableStream is available (Cloudflare Workers/Browser)
  if (renderToReadableStream) {
    return handleCloudflareRequest(request, responseStatusCode, responseHeaders, remixContext);
  }

  // Use Node.js rendering (renderToString)
  return handleNodeRequest(request, responseStatusCode, responseHeaders, remixContext);
}

// Cloudflare Workers / Browser streaming
async function handleCloudflareRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
) {
  const readable = await renderToReadableStream(<RemixServer context={remixContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      console.error(error);
      responseStatusCode = 500;
    },
  });

  const body = new ReadableStream({
    start(controller) {
      const head = renderHeadToString({ request, remixContext, Head });

      controller.enqueue(
        new Uint8Array(
          new TextEncoder().encode(
            `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">`,
          ),
        ),
      );

      const reader = readable.getReader();

      function read() {
        reader
          .read()
          .then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
            if (done) {
              controller.enqueue(new Uint8Array(new TextEncoder().encode('</div></body></html>')));
              controller.close();

              return;
            }

            controller.enqueue(value);
            read();
          })
          .catch((error: unknown) => {
            controller.error(error);
            readable.cancel();
          });
      }
      read();
    },

    cancel() {
      readable.cancel();
    },
  });

  if (isbot(request.headers.get('user-agent') || '')) {
    await readable.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');

  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

// Node.js rendering (non-streaming for simplicity)
function handleNodeRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: any,
): Response {
  const head = renderHeadToString({ request, remixContext, Head });

  let markup = '';

  try {
    markup = renderToString(<RemixServer context={remixContext} url={request.url} />);
  } catch (error: unknown) {
    console.error(error);
    responseStatusCode = 500;
  }

  const html = `<!DOCTYPE html><html lang="en" data-theme="${themeStore.value}"><head>${head}</head><body><div id="root" class="w-full h-full">${markup}</div></body></html>`;

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
  responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

  return new Response(html, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
