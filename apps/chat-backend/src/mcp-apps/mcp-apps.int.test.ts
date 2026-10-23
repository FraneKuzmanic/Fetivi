import { seedGuestUnit } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFerryhopper } from '../mcp/external/ferryhopper';
import { recordedFerryhopperFetch } from '../mcp/external/testing';
import { createTestApp, enterSpace, get, type TestApp, write } from '../testing';

const PICKER = 'ui://widgets/ferry-trips-picker.html';
const widgetUrl = (uri: string) =>
  `/api/mcp-apps/ferryhopper/widget?uri=${encodeURIComponent(uri)}`;
const CALL = '/api/mcp-apps/ferryhopper/call';

let t: TestApp;
let cookie: string;
const fetch = recordedFerryhopperFetch();

beforeAll(async () => {
  const ferryhopper = createFerryhopper({
    url: 'https://mcp.test/mcp',
    fetch,
    log: { info: () => {}, warn: () => {} },
  });
  t = await createTestApp({ ferryhopper });
  const seed = await seedGuestUnit(t.db, { now: t.clock.now() });
  ({ cookie } = await enterSpace(t, seed));
});

afterAll(async () => {
  await t?.close();
});

const calls = (name: string) =>
  fetch.requests.filter((r) => r.method === 'tools/call' && r.name === name);

describe('GET /api/mcp-apps/ferryhopper/widget', () => {
  it('needs a space', async () => {
    expect((await get(t.app, widgetUrl(PICKER))).statusCode).toBe(401);
  });

  it("serves a pinned tool's widget with its CSP, cacheable for the guest", async () => {
    const response = await get(t.app, widgetUrl(PICKER), cookie);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, max-age=86400');
    const body = response.json<{
      html: string;
      csp?: { connectDomains?: string[] };
      pinHash: string;
    }>();
    expect(body.html).toContain('<');
    expect(body.csp?.connectDomains).toContain('https://www.ferryhopper.com');
    expect(body.pinHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the pin hash the page keys its HTTP cache by', async () => {
    const pinned = await get(t.app, `${widgetUrl(PICKER)}&pin=hash-1`, cookie);
    expect(pinned.statusCode).toBe(200);
  });

  it('refuses a URI no pinned tool declares', async () => {
    const response = await get(t.app, widgetUrl('ui://evil/x.html'), cookie);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'widget-not-found' });
    expect((await get(t.app, widgetUrl('https://evil.example'), cookie)).statusCode).toBe(400);
  });
});

describe('POST /api/mcp-apps/ferryhopper/call', () => {
  it('blocks a tool outside the pin and sends nothing to Ferryhopper', async () => {
    for (const name of ['search_trips', 'create_booking']) {
      const response = await write('POST', t.app, CALL, { name, arguments: {} }, { cookie });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'tool-blocked', reason: 'not-pinned' });
      expect(calls(name)).toHaveLength(0);
    }
  });

  it('runs a pinned tool for the widget', async () => {
    const response = await write(
      'POST',
      t.app,
      CALL,
      { name: 'get_ports', arguments: {} },
      { cookie },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ content: unknown[]; isError?: boolean }>().isError).not.toBe(true);
    expect(calls('get_ports')).toHaveLength(1);
  });

  it('needs the app origin and a space', async () => {
    const body = { name: 'get_ports', arguments: {} };
    const foreign = await write('POST', t.app, CALL, body, { cookie, origin: 'http://evil.test' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ error: 'bad-origin' });
    expect((await write('POST', t.app, CALL, body)).statusCode).toBe(401);
  });
});
