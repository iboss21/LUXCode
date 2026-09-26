/**
 * Preview reverse proxy.
 *
 * Each dev server is exposed at   http://p<port>-<projectId>.localhost:<sidecarPort>/
 * Browsers resolve every *.localhost name to loopback (RFC 6761), so no DNS is involved, the
 * app is served from "/" (absolute asset paths and Vite's HMR client work unmodified) and each
 * preview gets its own origin, isolated from the LuxCoder UI origin.
 *
 * The legacy path form /preview/<projectId>/<port>/... redirects to the host form.
 * HTTP and WebSocket upgrades (Vite/webpack HMR) are forwarded. Host/Origin are rewritten to
 * localhost:<port> so dev servers with host checks (Vite allowedHosts) accept the request.
 */
import http from 'node:http';
import net from 'node:net';

const PREVIEW_HOST_RE = /^p(\d{2,5})-([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\.localhost(?::(\d{1,5}))?$/i;

export function parsePreviewHost(hostHeader, sidecarPort) {
  const m = PREVIEW_HOST_RE.exec(String(hostHeader || ''));

  if (!m) {
    return null;
  }

  if (m[3] && Number(m[3]) !== sidecarPort) {
    return null;
  }

  return { port: Number(m[1]), projectId: m[2].toLowerCase() };
}

export function previewOrigin(projectId, port, sidecarPort) {
  return `http://p${port}-${projectId}.localhost:${sidecarPort}`;
}

function errorPage(res, status, title, detail) {
  if (res.headersSent) {
    res.destroy();
    return;
  }

  const body = `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:2rem;color:#ccc;background:#111"><h2>${title}</h2><p>${detail}</p><p style="opacity:.6">LuxCoder local runtime</p></body>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'cross-origin',
  });
  res.end(body);
}

function rewriteLocation(location, port, origin) {
  try {
    const u = new URL(location, `http://localhost:${port}`);

    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(u.hostname) && Number(u.port || 80) === port) {
      return origin + u.pathname + u.search + u.hash;
    }
  } catch {
    // leave untouched
  }

  return location;
}

function injectIntoHtml(html, snippet) {
  const headMatch = /<head(\s[^>]*)?>/i.exec(html);

  if (headMatch) {
    const at = headMatch.index + headMatch[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }

  const htmlMatch = /<html(\s[^>]*)?>/i.exec(html);

  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, at) + snippet + html.slice(at);
  }

  return snippet + html;
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {{host:string, port:number, origin:string, injection?:string}} target
 */
export function proxyHttp(req, res, target) {
  const { host, port, origin, injection } = target;
  const headers = { ...req.headers };

  headers.host = `localhost:${port}`;
  headers['accept-encoding'] = 'identity';

  if (headers.origin) {
    headers.origin = `http://localhost:${port}`;
  }

  if (headers.referer) {
    headers.referer = `http://localhost:${port}${safePath(headers.referer)}`;
  }

  delete headers['x-forwarded-for'];

  const upstream = http.request(
    { host, port, method: req.method, path: req.url, headers, family: host.includes(':') ? 6 : 4 },
    (ures) => {
      const out = { ...ures.headers };

      delete out.connection;
      delete out['keep-alive'];

      if (out.location) {
        out.location = rewriteLocation(String(out.location), port, origin);
      }

      // The LuxCoder UI is cross-origin isolated (COEP require-corp): the preview frame must opt in.
      out['cross-origin-resource-policy'] = 'cross-origin';
      out['cross-origin-embedder-policy'] = 'credentialless';

      const type = String(out['content-type'] || '');
      const canInject =
        injection &&
        req.method === 'GET' &&
        (ures.statusCode || 0) < 300 &&
        type.includes('text/html') &&
        !out['content-encoding'];

      if (!canInject) {
        res.writeHead(ures.statusCode || 502, ures.statusMessage, out);
        ures.pipe(res);
        return;
      }

      const chunks = [];
      ures.on('data', (c) => chunks.push(c));
      ures.on('end', () => {
        const html = injectIntoHtml(Buffer.concat(chunks).toString('utf8'), injection);
        const body = Buffer.from(html, 'utf8');

        delete out['transfer-encoding'];
        delete out.etag;
        out['content-length'] = String(body.length);
        res.writeHead(ures.statusCode || 200, ures.statusMessage, out);
        res.end(body);
      });
      ures.on('error', () => res.destroy());
    },
  );

  upstream.on('error', () =>
    errorPage(res, 502, 'Dev server not reachable', `Nothing answered on localhost:${port}. Is the dev server still running?`),
  );

  req.pipe(upstream);
}

function safePath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/** Forwards a WebSocket upgrade (HMR) to the dev server as raw TCP after rewriting Host/Origin. */
export function proxyUpgrade(req, socket, head, target) {
  const { host, port } = target;
  const upstream = net.connect({ host, port });

  const fail = () => {
    upstream.destroy();
    socket.destroy();
  };

  upstream.once('connect', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];

    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      let value = req.rawHeaders[i + 1];
      const lower = key.toLowerCase();

      if (lower === 'host') {
        value = `localhost:${port}`;
      } else if (lower === 'origin') {
        value = `http://localhost:${port}`;
      }

      if (/[\r\n]/.test(value)) {
        continue;
      }

      lines.push(`${key}: ${value}`);
    }

    upstream.write(lines.join('\r\n') + '\r\n\r\n');

    if (head && head.length) {
      upstream.write(head);
    }

    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', fail);
  socket.on('error', fail);
  upstream.on('close', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
}

export { errorPage };

/**
 * Script injected into preview HTML: forwards uncaught errors to the LuxCoder UI (the same
 * PREVIEW_UNCAUGHT_EXCEPTION / PREVIEW_UNHANDLED_REJECTION shape WebContainer used) and runs the
 * element-inspector script the UI registered via setPreviewScript().
 */
export function buildInjection({ port, uiOrigins, previewScript }) {
  const origins = JSON.stringify(uiOrigins);
  const forwarder = `(function(){var O=${origins};function post(t,e){var m={__luxcoderPreview:1,type:t,message:String(e&&e.message||e||'Unknown error'),stack:String(e&&e.stack||''),pathname:location.pathname,search:location.search,hash:location.hash,port:${Number(port)}};for(var i=0;i<O.length;i++){try{parent.postMessage(m,O[i])}catch(_){}}}window.addEventListener('error',function(ev){post('PREVIEW_UNCAUGHT_EXCEPTION',ev.error||ev.message)});window.addEventListener('unhandledrejection',function(ev){post('PREVIEW_UNHANDLED_REJECTION',ev.reason)});})();`;
  const safe = (s) => String(s).replace(/<\/script/gi, '<\\/script');
  let out = `<script data-luxcoder="preview">${safe(forwarder)}</script>`;

  if (previewScript) {
    out += `<script data-luxcoder="inspector">${safe(previewScript)}</script>`;
  }

  return out;
}
