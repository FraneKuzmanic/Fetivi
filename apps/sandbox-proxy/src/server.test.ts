import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxServer } from './server';

const APP = 'http://localhost:5173';
const server = createSandboxServer({ appOrigin: APP });
let base = '';
// biome-ignore lint/style/noRestrictedGlobals: the test client of the local server, not server egress.
const get = (path: string) => fetch(`${base}${path}`);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('sandbox server', () => {
  it('serves the page with the declared CSP and the app as the only frame ancestor', async () => {
    const csp = encodeURIComponent(
      JSON.stringify({ connectDomains: ['https://www.ferryhopper.com'] }),
    );
    const res = await get(`/sandbox.html?csp=${csp}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const header = res.headers.get('content-security-policy') ?? '';
    expect(header).toContain("connect-src 'self' https://www.ferryhopper.com");
    expect(header).toContain(`frame-ancestors ${APP}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain(`var EXPECTED_HOST_ORIGIN = "${APP}";`);
  });

  it('uses the restrictive default without a CSP', async () => {
    const res = await get('/sandbox.html');
    expect(res.headers.get('content-security-policy')).toContain("connect-src 'none'");
  });

  it('answers the health check', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves nothing else', async () => {
    expect((await get('/other')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
  });
});
