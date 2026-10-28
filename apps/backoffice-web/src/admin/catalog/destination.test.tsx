// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WithPageTitle } from '../../shell/testing';
import { NewDestinationPage } from './DestinationPage';

// No WebGL here: the map fails and the picker opens its coordinate fields.
vi.mock('@fetivi/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fetivi/ui')>()),
  loadMapLibre: () => Promise.reject(new Error('no WebGL')),
}));

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string; body: unknown }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount() {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url: String(input),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return json({ id: 'd1' }, 201);
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <WithPageTitle>
        <MemoryRouter initialEntries={['/admin/catalog/destinations/new']}>
          <Routes>
            <Route path="/admin/catalog/destinations/new" element={<NewDestinationPage />} />
            <Route path="/admin/catalog/destinations/:id" element={<p>created</p>} />
          </Routes>
        </MemoryRouter>
      </WithPageTitle>,
    ),
  );
}

const field = (label: string) => {
  const lab = [...el.querySelectorAll('label')].find((l) => l.textContent === label);
  const input = lab?.htmlFor
    ? el.querySelector<HTMLInputElement>(`#${CSS.escape(lab.htmlFor)}`)
    : null;
  if (!input) throw new Error(`no field ${label}`);
  return input;
};

async function type(element: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('NewDestinationPage', () => {
  it('takes the centre from the map picker and keeps a changed radius', async () => {
    await mount();
    expect(el.textContent).toContain('Centre of the area');
    expect(el.textContent).not.toContain('Copy the centre point');
    await type(field('Name'), 'Trogir');
    await type(field('Area radius (km)'), '12');
    expect(field('Area radius (km)').value).toBe('12');
    await vi.waitFor(() => field('Latitude'));
    await type(field('Latitude'), '43.517');
    await type(field('Longitude'), '16.2514');
    expect(field('Area radius (km)').value).toBe('12');
    await act(async () => {
      el.querySelector('form')?.requestSubmit();
    });
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      url: '/api/admin/destinations',
      method: 'POST',
      body: {
        name: 'Trogir',
        centre: { lat: 43.517, lng: 16.2514 },
        radiusKm: 12,
        timezone: 'Europe/Zagreb',
      },
    });
  });
});
