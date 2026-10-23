// biome-ignore lint/style/noRestrictedImports: the proxy only listens; it never makes outbound requests.
import { createServer, type Server } from 'node:http';
import type { SandboxConfig } from './config';
import { buildCspHeader, parseCspParam } from './csp';
import { sandboxPage } from './page';

/** Serves only the sandbox page (with the widget's CSP as a header) and a health check. */
export function createSandboxServer(config: Pick<SandboxConfig, 'appOrigin'>): Server {
  const page = sandboxPage(config.appOrigin);
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.invalid');
    const method = req.method ?? 'GET';
    if ((method === 'GET' || method === 'HEAD') && url.pathname === '/sandbox.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        // A header, not a meta tag: the widget's HTML cannot loosen it.
        'content-security-policy': buildCspHeader(
          parseCspParam(url.searchParams.get('csp')),
          config.appOrigin,
        ),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      res.end(method === 'HEAD' ? undefined : page);
      return;
    }
    if (method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
}
