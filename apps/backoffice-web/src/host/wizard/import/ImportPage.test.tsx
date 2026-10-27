// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ManualDraftItem, ManualImport } from '../../../api';
import { SessionProvider } from '../../../session';
import { ImportPage } from './ImportPage';

const CORE = {
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

const UNIT = {
  ...CORE,
  id: 'u1',
  propertyId: 'p1',
  propertyName: 'Apartman Mare',
  name: 'A1',
  noWifi: false,
  wifiNetwork: null,
  wifiPassword: null,
  doorCode: null,
  lockboxCode: null,
  maxOccupancy: null,
  bedrooms: null,
  beds: [],
  bathrooms: null,
  arrivalReleaseDaysBefore: 1,
  amenities: [],
  propertyAmenities: [],
  effective: { inherited: {}, blocks: [], amenities: [] },
};

const PROPERTY = {
  ...CORE,
  checkoutTime: '11:00',
  id: 'p1',
  name: 'Apartman Mare',
  addressLine: null,
  city: null,
  postalCode: null,
  location: null,
  buildingDoorCode: null,
  amenities: [],
  blocks: [],
  units: [],
};

const ME = {
  account: { id: 'h1', email: 'a@example.test', role: 'host', language: 'en' },
  actingAs: null,
};

const ITEMS: ManualDraftItem[] = [
  {
    id: 'd1',
    status: 'pending',
    kind: 'field',
    fieldId: 'check_in_time',
    values: { checkInTime: '15:00' },
  },
  {
    id: 'd2',
    status: 'pending',
    kind: 'field',
    fieldId: 'checkout_time',
    values: { checkoutTime: '10:00' },
  },
  {
    id: 'd3',
    status: 'pending',
    kind: 'block',
    category: 'how_tos',
    wizardKey: 'heating_cooling',
    title: 'Air conditioning',
    body: '1. Press ON/OFF.',
    scrubbed: false,
    warnings: [],
  },
  {
    id: 'd4',
    status: 'pending',
    kind: 'unmapped',
    text: "Our cat Mici visits the terrace, please don't feed her.",
    fieldId: null,
  },
];

const importOf = (items: ManualDraftItem[]): ManualImport => ({
  id: 'i1',
  source: 'paste',
  createdAt: '2026-10-22T10:00:00Z',
  items,
});

let root: Root | null = null;
let posts: { url: string; body: unknown }[] = [];
let current: ManualImport;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Answers the page's reads; a confirm or dismiss resolves that item in the stored import. */
function stubApi(items: ManualDraftItem[]) {
  posts = [];
  current = importOf(items);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/auth/me') return json(ME);
      if (url === '/api/host/units/u1') return json(UNIT);
      if (url === '/api/host/properties/p1') return json(PROPERTY);
      if (url === '/api/host/units/u1/manual-import' && init?.method !== 'POST') {
        return json({ import: current });
      }
      const action = /items\/(d\d+)\/(confirm|dismiss)$/.exec(url);
      if (action && init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        const status = action[2] === 'confirm' ? 'confirmed' : 'dismissed';
        current = importOf(current.items.map((i) => (i.id === action[1] ? { ...i, status } : i)));
        return json({ import: current, warnings: [] });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={['/units/u1/setup/import']}>
        <SessionProvider>
          <Routes>
            <Route path="/units/:id/setup/import" element={<ImportPage />} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>,
    ),
  );
}

const rowOf = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.manual-row')].find((r) =>
    r.textContent?.includes(text),
  ) as HTMLElement;

const buttonIn = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as
    | HTMLButtonElement
    | undefined;

async function click(button: HTMLButtonElement | undefined) {
  if (!button) throw new Error('no such button');
  await act(async () => button.click());
}

/** Sets a controlled input's value the way typing does. */
async function type(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ImportPage', () => {
  it('shows the drafts under their wizard steps, each from the manual', async () => {
    stubApi(ITEMS);
    await mount();
    const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual([
      'Arrival and access',
      'House rules and checkout',
      'How-tos',
      'Not placed yet',
    ]);
    expect(document.getElementById('step-arrival_access')).not.toBeNull();
    expect(document.querySelectorAll('.manual-tag')).toHaveLength(4);
    expect(document.body.textContent).toContain('From your manual');
    // The saved checkout differs, so it is shown next to the draft.
    expect(rowOf('Checkout by').textContent).toContain('Now: 11:00');
  });

  it('labels a value that is one part of a multi-part field', async () => {
    stubApi([
      {
        id: 'd1',
        status: 'pending',
        kind: 'field',
        fieldId: 'quiet_hours',
        values: { quietHoursTo: '07:00' },
      },
    ]);
    await mount();
    expect(rowOf('Quiet hours').querySelector('dt')?.textContent).toBe('Until');
  });

  it('confirms a draft as it is', async () => {
    stubApi(ITEMS);
    await mount();
    await click(buttonIn(rowOf('Check-in from'), 'Confirm'));
    expect(posts).toEqual([
      {
        url: '/api/host/units/u1/manual-import/items/d1/confirm',
        body: { values: { checkInTime: '15:00' } },
      },
    ]);
    expect(rowOf('Check-in from').textContent).toContain('Confirmed');
    expect(buttonIn(rowOf('Check-in from'), 'Confirm')).toBeUndefined();
  });

  it('confirms an edited value', async () => {
    stubApi(ITEMS);
    await mount();
    await click(buttonIn(rowOf('Checkout by'), 'Edit'));
    const input = rowOf('Checkout by').querySelector('.picker.time input') as HTMLInputElement;
    await type(input, '10:30');
    await click(buttonIn(rowOf('Checkout by'), 'Confirm'));
    expect(posts.at(-1)?.body).toEqual({ values: { checkoutTime: '10:30' } });
  });

  it('places unmapped text as a block in a chosen section', async () => {
    stubApi(ITEMS);
    await mount();
    await click(buttonIn(rowOf('Mici'), 'Add as block'));
    const row = rowOf('Section');
    await type(row.querySelector('select') as HTMLSelectElement, 'house_rules_checkout');
    await type(row.querySelector('input') as HTMLInputElement, 'Our cat');
    await click(buttonIn(row, 'Add as block'));
    expect(posts.at(-1)).toEqual({
      url: '/api/host/units/u1/manual-import/items/d4/confirm',
      body: {
        category: 'house_rules_checkout',
        title: 'Our cat',
        body: "Our cat Mici visits the terrace, please don't feed her.",
      },
    });
  });

  it('says when every draft is reviewed', async () => {
    stubApi(ITEMS.map((i) => ({ ...i, status: 'dismissed' as const })));
    await mount();
    expect(document.body.textContent).toContain('All drafts reviewed.');
    expect(document.body.textContent).toContain('0 to review · 0 confirmed · 4 dismissed');
  });

  it('offers the paste form when there is no import yet', async () => {
    stubApi([]);
    current = null as unknown as ManualImport;
    await mount();
    expect(document.body.textContent).toContain('Paste text');
    expect(document.body.textContent).toContain('Upload a file');
  });
});
