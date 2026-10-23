import { describe, expect, it, vi } from 'vitest';
import { createFerryhopper, ToolBlockedError, WidgetNotFoundError } from './ferryhopper';
import { FERRYHOPPER_PINNED_TOOLS } from './pin';
import { recordedFerryhopperFetch } from './testing';

const PICKER = 'ui://widgets/ferry-trips-picker.html';
const log = () => ({ info: vi.fn(), warn: vi.fn() });

function setup(fetch = recordedFerryhopperFetch()) {
  const l = log();
  return {
    fetch,
    log: l,
    ferryhopper: createFerryhopper({ url: 'https://mcp.test/mcp', fetch, log: l }),
  };
}

describe('createFerryhopper', () => {
  it('connects in auto mode and falls back to 2025-11-25', async () => {
    const { fetch, ferryhopper } = setup();
    await ferryhopper.list();
    expect(fetch.requests.slice(0, 2).map((r) => r.method)).toEqual([
      'server/discover',
      'initialize',
    ]);
    const list = fetch.requests.find((r) => r.method === 'tools/list');
    expect(list?.protocolVersion).toBe('2025-11-25');
  });

  it('lists only the five pinned tools, labelled as Ferryhopper’s', async () => {
    const { ferryhopper, log: l } = setup();
    const listed = await ferryhopper.list();
    expect(listed.map((t) => t.tool.name)).toEqual([...FERRYHOPPER_PINNED_TOOLS]);
    expect(listed.every((t) => t.server === 'ferryhopper')).toBe(true);
    expect(listed.every((t) => t.tool.description?.startsWith('Ferryhopper (external): '))).toBe(
      true,
    );
    expect(ferryhopper.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(l.info).toHaveBeenCalledWith(
      expect.objectContaining({ pinHash: ferryhopper.pinHash }),
      expect.any(String),
    );
  });

  it('lists once per process', async () => {
    const { fetch, ferryhopper } = setup();
    await ferryhopper.list();
    const sent = fetch.requests.length;
    await ferryhopper.list();
    expect(fetch.requests.length).toBe(sent);
  });

  it('returns [] while Ferryhopper is down and lists once it is back', async () => {
    let down = true;
    const healthy = recordedFerryhopperFetch();
    const broken = recordedFerryhopperFetch({ down: true });
    const fetch = Object.assign(
      (url: string | URL, init?: RequestInit) => (down ? broken(url, init) : healthy(url, init)),
      { requests: healthy.requests },
    );
    const { ferryhopper, log: l } = setup(fetch);
    expect(await ferryhopper.list()).toEqual([]);
    expect(l.warn).toHaveBeenCalled();
    down = false;
    expect(await ferryhopper.list()).toHaveLength(5);
  });

  it('gives up listing after the timeout', async () => {
    const hanging = Object.assign(() => new Promise<Response>(() => {}), { requests: [] });
    const ferryhopper = createFerryhopper({
      url: 'https://mcp.test/mcp',
      fetch: hanging,
      log: log(),
      timeoutMs: 20,
    });
    expect(await ferryhopper.list()).toEqual([]);
  });

  it('calls a pinned tool and returns the recorded result', async () => {
    const { ferryhopper } = setup();
    const result = await ferryhopper.call(
      'search_ferry_trips',
      {
        legs: [
          {
            departureLocation: 'Split',
            arrivalLocation: 'Stari Grad',
            departureDate: '2026-11-02',
          },
        ],
      },
      'model',
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty('legs');
  });

  it('blocks a tool outside the pin without sending it', async () => {
    const { fetch, ferryhopper, log: l } = setup();
    await expect(ferryhopper.call('search_trips', {}, 'app')).rejects.toEqual(
      new ToolBlockedError('not-pinned'),
    );
    await expect(ferryhopper.call('create_booking', {}, 'model')).rejects.toBeInstanceOf(
      ToolBlockedError,
    );
    expect(fetch.requests.some((r) => r.method === 'tools/call')).toBe(false);
    expect(l.info).toHaveBeenCalledWith(
      { caller: 'app', name: 'search_trips', outcome: 'not-pinned' },
      expect.any(String),
    );
  });

  it('logs every widget call', async () => {
    const { ferryhopper, log: l } = setup();
    await ferryhopper.call('get_ports', {}, 'app');
    expect(l.info).toHaveBeenCalledWith(
      { caller: 'app', name: 'get_ports', outcome: 'ok' },
      expect.any(String),
    );
  });

  it('reconnects once after a transport failure', async () => {
    const healthy = recordedFerryhopperFetch();
    let failNextCall = false;
    const fetch = Object.assign(
      async (url: string | URL, init?: RequestInit) => {
        if (failNextCall && String(init?.body).includes('"tools/call"')) {
          failNextCall = false;
          throw new TypeError('fetch failed');
        }
        return healthy(url, init);
      },
      { requests: healthy.requests },
    );
    const { ferryhopper } = setup(fetch);
    await ferryhopper.list();
    failNextCall = true;
    const result = await ferryhopper.call('get_ports', {}, 'model');
    expect(result.isError).toBeFalsy();
    expect(healthy.requests.filter((r) => r.method === 'initialize')).toHaveLength(2);
  });

  it('knows which tools carry a widget', async () => {
    const { ferryhopper } = setup();
    await ferryhopper.list();
    expect(ferryhopper.widgetUriOf('search_ferry_trips')).toBe(PICKER);
    expect(ferryhopper.widgetUriOf('get_ports')).toBeUndefined();
    expect(ferryhopper.widgetUriOf('search_trips')).toBeUndefined();
  });

  it('reads a widget with its declared CSP and caches it', async () => {
    const { fetch, ferryhopper } = setup();
    const widget = await ferryhopper.readWidget(PICKER);
    expect(widget.html).toContain('<html');
    expect(widget.csp?.connectDomains).toContain('https://www.ferryhopper.com');
    expect(widget.pinHash).toBe(ferryhopper.pinHash);
    const sent = fetch.requests.length;
    await ferryhopper.readWidget(PICKER);
    expect(fetch.requests.length).toBe(sent);
  });

  it('refuses a widget no pinned tool declares', async () => {
    const { fetch, ferryhopper } = setup();
    await expect(ferryhopper.readWidget('ui://evil/x.html')).rejects.toBeInstanceOf(
      WidgetNotFoundError,
    );
    expect(fetch.requests.some((r) => r.method === 'resources/read')).toBe(false);
  });
});
