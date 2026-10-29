// @vitest-environment happy-dom
import type { GeoPlace } from '@fetivi/domain/geocode-vocabulary';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block, HostPicks, PropertyDetail } from '../../api';
import { WithPageTitle } from '../../shell/testing';
import { HostPicksPage } from './HostPicksPage';

// No WebGL here: the map fails, so the picker opens its coordinate fields (the keyboard path).
vi.mock('@fetivi/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fetivi/ui')>()),
  loadMapLibre: () => Promise.reject(new Error('no WebGL')),
}));

const PUBLISHED = { status: 'published' as const, error: null };

const TIPS: Block = {
  id: 'b1',
  propertyId: 'pr1',
  unitId: null,
  category: 'host_picks',
  title: 'Bread and coffee',
  body: 'The bakery opens at 6.',
  visibility: 'always',
  revision: 1,
  translation: { ...PUBLISHED, publishedRevision: 1, sourceLanguage: 'en' },
  replacesBlockId: null,
  wizardKey: 'neighbourhood_tips',
  position: 0,
  createdAt: '2027-07-01T10:00:00Z',
  updatedAt: '2027-07-01T10:00:00Z',
  media: [],
};

const PROPERTY: PropertyDetail = {
  id: 'pr1',
  name: 'Villa Mare',
  propertyType: 'villa',
  addressLine: null,
  city: 'Trogir',
  postalCode: null,
  country: 'HR',
  location: { lat: 43.517, lng: 16.251 },
  timezone: 'Europe/Zagreb',
  buildingDoorCode: null,
  approved: true,
  amenities: [],
  blocks: [TIPS, { ...TIPS, id: 'b2', category: 'how_tos', title: 'Washer' }],
  units: [],
  fieldTranslations: [],
  checkInTime: null,
  checkoutTime: null,
  checkInMethod: null,
  accessInstructions: null,
  parkingType: null,
  parkingNotes: null,
  petsAllowed: null,
  smokingAllowed: null,
  partiesAllowed: null,
  quietHoursFrom: null,
  quietHoursTo: null,
  houseRulesNotes: null,
  hostPhone: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  licenceNumber: null,
};

const PICKS: HostPicks = {
  destination: { id: 'd1', name: 'Trogir' },
  picks: [
    {
      id: 'h1',
      recordId: 'r1',
      title: 'Konoba Mare',
      kind: 'place',
      placeCategory: 'restaurant',
      note: 'Ask for the catch of the day.',
      translation: PUBLISHED,
    },
  ],
  added: [
    {
      id: 'h2',
      name: 'Uvala Saldun',
      placeCategory: 'beach',
      location: { lat: 43.51, lng: 16.23 },
      address: 'Čiovo',
      note: 'A quiet cove.',
      inCatalog: false,
      translation: PUBLISHED,
    },
  ],
};

const TRI_VOLTA: GeoPlace = {
  label: 'Tri Volta, Ribarska ulica, 21220 Trogir, HR',
  addressLine: 'Ribarska ulica',
  city: 'Trogir',
  postalCode: '21220',
  country: 'HR',
  lat: 43.5161561,
  lng: 16.2507282,
};

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

function stubApi(routes: Record<string, (body: unknown) => Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const handler = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`];
    return handler ? handler(body) : json({ error: 'not-found' }, 404);
  });
}

const BASE = {
  'GET /api/host/properties/pr1': () => json(PROPERTY),
  'GET /api/host/properties/pr1/picks': () => json(PICKS),
};

async function mount() {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <WithPageTitle>
        <MemoryRouter initialEntries={['/properties/pr1/picks']}>
          <Routes>
            <Route path="/properties/:id/picks" element={<HostPicksPage />} />
          </Routes>
        </MemoryRouter>
      </WithPageTitle>,
    ),
  );
  await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('Host picks and tips'));
}

const field = <T extends HTMLElement>(label: string): T => {
  const lab = [...el.querySelectorAll('label')].find((l) => l.textContent === label);
  const input = lab?.htmlFor ? el.querySelector<T>(`#${CSS.escape(lab.htmlFor)}`) : null;
  if (!input) throw new Error(`no field ${label}`);
  return input;
};

const setValue = (
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) =>
  act(async () => {
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });

const button = (name: string) => {
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

const click = (name: string) => act(async () => button(name).click());

const submit = (form: Element | null) =>
  act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('host picks page', () => {
  it('lists the picks, the added places and only the tips blocks', async () => {
    stubApi(BASE);
    await mount();
    const [picks, added, tips] = el.querySelectorAll('section.panel');
    expect(picks?.querySelector('h2')?.textContent).toBe('Your picks');
    expect(picks?.textContent).toContain('catalog in Trogir');
    expect(picks?.textContent).toContain('Konoba Mare');
    expect(picks?.textContent).toContain('Ask for the catch of the day.');
    expect(added?.textContent).toContain('Uvala Saldun');
    expect(added?.textContent).toContain('Only your guests');
    expect(tips?.querySelector('h2')?.textContent).toBe('Neighbourhood tips');
    expect(tips?.textContent).toContain('Bread and coffee');
    expect(tips?.textContent).not.toContain('Washer');
    expect(el.querySelector('a[href="/properties/pr1"]')?.textContent).toBe('Villa Mare');
    expect(el.querySelector('.mascot, img')).toBeNull();
  });

  it('picks a catalog place from the search with a note', async () => {
    stubApi({
      ...BASE,
      'GET /api/host/properties/pr1/catalog-places': () =>
        json({
          places: [
            {
              id: 'r1',
              title: 'Konoba Mare',
              kind: 'place',
              placeCategory: 'restaurant',
              address: null,
              picked: true,
            },
            {
              id: 'r2',
              title: 'Plaža Pantan',
              kind: 'place',
              placeCategory: 'beach',
              address: null,
              picked: false,
            },
          ],
        }),
      'POST /api/host/properties/pr1/picks': () => json(PICKS, 201),
    });
    await mount();
    await click('Add a pick');
    await vi.waitFor(() => expect(el.textContent).toContain('Plaža Pantan'), { timeout: 2000 });
    expect(el.textContent).toContain('Already picked');
    await click('Pick Plaža Pantan');
    await setValue(field('Your note (optional)'), 'Shade after 3.');
    await submit(el.querySelector('form.pick-note'));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      url: '/api/host/properties/pr1/picks',
      method: 'POST',
      body: { recordId: 'r2', note: 'Shade after 3.' },
    });
  });

  it('adds a place, and explains a spot outside the destination', async () => {
    let outside = true;
    stubApi({
      ...BASE,
      'POST /api/host/properties/pr1/added-places': () =>
        outside ? json({ error: 'outside-destination' }, 400) : json(PICKS, 201),
    });
    await mount();
    await click('Add a place');
    await setValue(field('Name'), 'Pekara Ana');
    await setValue(field('Category'), 'shop');
    await vi.waitFor(() => field('Latitude'));
    await setValue(field('Latitude'), '42.64');
    await setValue(field('Longitude'), '18.11');
    await setValue(field('Address'), 'Obala 2');
    await setValue(field('Why your guests should go'), 'Warm burek at 6.');
    const form = el.querySelector('form[aria-label="Add a place"]');
    await submit(form);
    await vi.waitFor(() =>
      expect(form?.querySelector('[role="alert"]')?.textContent).toBe(
        "That spot is outside Trogir, your property's destination. Pick a place in the same area as your property.",
      ),
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Pekara Ana',
      placeCategory: 'shop',
      location: { lat: 42.64, lng: 18.11 },
      address: 'Obala 2',
      note: 'Warm burek at 6.',
    });
    outside = false;
    await setValue(field('Latitude'), '43.517');
    await setValue(field('Longitude'), '16.25');
    await submit(form);
    await vi.waitFor(() => expect(el.querySelector('form[aria-label="Add a place"]')).toBeNull());
  });

  it('sets the address from a picked search result, and keeps it editable', async () => {
    let places = [TRI_VOLTA];
    stubApi({
      ...BASE,
      'GET /api/geocode': () => json({ places }),
      'POST /api/host/properties/pr1/added-places': () => json(PICKS, 201),
    });
    await mount();
    await click('Add a place');
    await setValue(field('Name'), 'Tri volta');
    await setValue(field('Category'), 'restaurant');
    await setValue(field('Address'), 'Obala 2');
    await vi.waitFor(() => field('Latitude'));
    const pick = async (query: string) => {
      await setValue(field('Find the place'), query);
      await vi.waitFor(() => expect(el.querySelector('[role="option"]')).not.toBeNull());
      await act(async () => (el.querySelector('[role="option"]') as HTMLElement).click());
    };
    await pick('Tri volta Trogir');
    expect(field<HTMLInputElement>('Address').value).toBe('Ribarska ulica');
    expect(field<HTMLInputElement>('Latitude').value).toBe('43.516156');
    expect(field<HTMLInputElement>('Longitude').value).toBe('16.250728');
    // A place without a street line gives its whole label.
    places = [{ ...TRI_VOLTA, label: 'Tri Volta, 21220 Trogir, HR', addressLine: null }];
    await pick('Tri Volta 21220');
    expect(field<HTMLInputElement>('Address').value).toBe('Tri Volta, 21220 Trogir, HR');
    await setValue(field('Address'), 'Ribarska ulica 8');
    await setValue(field('Why your guests should go'), 'Fish by the canal.');
    await submit(el.querySelector('form[aria-label="Add a place"]'));
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Tri volta',
      placeCategory: 'restaurant',
      location: { lat: 43.5161561, lng: 16.2507282 },
      address: 'Ribarska ulica 8',
      note: 'Fish by the canal.',
    });
  });

  it('adds a tip in the Neighbourhood tips section only', async () => {
    stubApi({
      ...BASE,
      'POST /api/host/properties/pr1/blocks': () => json({ block: TIPS, warnings: [] }, 201),
    });
    await mount();
    const tips = el.querySelectorAll('section.panel')[2];
    expect(tips?.querySelector('.eyebrow')).toBeNull();
    await click('Add guide entry');
    expect(tips?.textContent).not.toContain('Guide section');
    await setValue(field('Title'), 'Market');
    await setValue(field('Text'), 'Fresh fish until 10.');
    await submit(tips?.querySelector('form.block-editor') ?? null);
    await vi.waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      category: 'host_picks',
      title: 'Market',
    });
  });

  it('shows only the tips outside a destination', async () => {
    stubApi({
      ...BASE,
      'GET /api/host/properties/pr1/picks': () => json({ destination: null, picks: [], added: [] }),
    });
    await mount();
    expect(el.textContent).toContain("isn't inside a Fetivi destination yet");
    expect(el.textContent).not.toContain('Your picks');
    expect(el.textContent).not.toContain('Places you added');
    expect(el.textContent).toContain('Neighbourhood tips');
  });
});
