// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MapPicker, type MapPoint } from './MapPicker';

// No WebGL in happy-dom: the map either never finishes loading or fails, as each test needs.
let mapFails = true;
vi.mock('@fetivi/ui', () => ({
  MAP_STYLE_URL: 'x',
  loadMapLibre: () => (mapFails ? Promise.reject(new Error('no WebGL')) : new Promise(() => {})),
}));

const PLACE = {
  label: 'Trogir, Hrvatska',
  addressLine: null,
  city: 'Trogir',
  postalCode: null,
  country: 'HR',
  lat: 43.517,
  lng: 16.2514,
};

let root: Root | null = null;
let el: HTMLElement;
let calls: string[] = [];
let changes: MapPoint[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  mapFails = true;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Harness({ required, initial }: { required?: boolean; initial?: MapPoint }) {
  const [value, setValue] = useState<MapPoint>(initial ?? { lat: null, lng: null });
  return (
    <MapPicker
      label="Centre of the area"
      value={value}
      onChange={(p) => {
        changes.push(p);
        setValue(p);
      }}
      search={{ label: 'Find the town', kind: 'settlement' }}
      required={required}
    />
  );
}

async function mount(
  options: { geocode?: () => Response; required?: boolean; initial?: MapPoint } = {},
) {
  calls = [];
  changes = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return options.geocode?.() ?? json({ places: [PLACE] });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(<Harness required={options.required} initial={options.initial} />);
  });
}

const input = (label: string) => {
  const target = [...el.querySelectorAll('label')].find((l) => l.textContent === label);
  const found = target ? document.getElementById(target.htmlFor) : null;
  if (!found) throw new Error(`no field ${label}`);
  return found as HTMLInputElement;
};

const hasField = (label: string) =>
  [...el.querySelectorAll('label')].some((l) => l.textContent === label);

async function type(element: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

describe('MapPicker', () => {
  it('searches the geocoder and fills the point from a picked place', async () => {
    mapFails = false;
    await mount();
    await type(input('Find the town'), 'Trog');
    await vi.waitFor(() => expect(el.querySelector('[role="option"]')).not.toBeNull());
    expect(calls[0]).toMatch(/^\/api\/geocode\?q=Trog&kind=settlement&lat=/);
    await act(async () => {
      (el.querySelector('[role="option"]') as HTMLElement).click();
    });
    expect(changes.at(-1)).toEqual({ lat: 43.517, lng: 16.2514 });
  });

  it('opens the coordinate fields when the map cannot load, and they set the point', async () => {
    await mount();
    await vi.waitFor(() => expect(hasField('Latitude')).toBe(true));
    expect(el.textContent).toContain('The map could not load here.');
    await type(input('Latitude'), '43.5');
    await type(input('Longitude'), '16.25');
    expect(changes.at(-1)).toEqual({ lat: 43.5, lng: 16.25 });
  });

  it('shows and hides the coordinate fields with the toggle', async () => {
    mapFails = false;
    await mount();
    expect(hasField('Latitude')).toBe(false);
    await act(async () => button('Enter coordinates by hand')?.click());
    expect(hasField('Latitude')).toBe(true);
    await act(async () => button('Hide coordinates')?.click());
    expect(hasField('Latitude')).toBe(false);
  });

  it('says when search is down, and the fields still work', async () => {
    await mount({ geocode: () => json({ error: 'geocoder-unavailable' }, 503) });
    await type(input('Find the town'), 'Trogir');
    await vi.waitFor(() => expect(el.textContent).toContain('Search is not available right now.'));
    await vi.waitFor(() => expect(hasField('Latitude')).toBe(true));
    await type(input('Latitude'), '43.5');
    expect(changes.at(-1)).toEqual({ lat: 43.5, lng: null });
  });

  it('shows a stored point to six decimals, not the sixteen a map click gives', async () => {
    await mount({ initial: { lat: 43.51689910888672, lng: 16.257335571579517 } });
    await vi.waitFor(() => expect(hasField('Latitude')).toBe(true));
    expect(input('Latitude').value).toBe('43.516899');
    expect(input('Longitude').value).toBe('16.257336');
  });

  it('asks for a point while a required one is missing', async () => {
    mapFails = false;
    await mount({ required: true });
    expect(el.textContent).toContain('Place the pin on the map or enter the coordinates.');
    await act(async () => button('Enter coordinates by hand')?.click());
    await type(input('Latitude'), '43.5');
    await type(input('Longitude'), '16.25');
    expect(el.textContent).not.toContain('Place the pin on the map or enter the coordinates.');
  });
});
