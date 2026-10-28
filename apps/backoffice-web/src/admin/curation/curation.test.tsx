// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CurationItem, StalenessRecord } from '../../api';
import { ConfirmProvider } from '../../shell/ConfirmDialog';
import { WithPageTitle } from '../../shell/testing';
import { CurationPage } from './CurationPage';
import { StalenessPage } from './StalenessPage';

const DEST = { id: 'd1', name: 'Trogir' };
const BASE = {
  status: 'open' as const,
  destination: DEST,
  host: null,
  record: null,
  candidate: null,
  drafted: false,
  createdAt: '2026-10-20T10:00:00Z',
  reviewedAt: null,
};

const DRAFT: CurationItem = {
  ...BASE,
  id: 'i-draft',
  kind: 'draft',
  payload: { kind: 'draft', changes: { title: 'Konoba New', description: 'Fresh fish.' } },
  record: {
    id: 'r1',
    title: 'Konoba Old',
    kind: 'place',
    placeCategory: 'restaurant',
    verifiedAt: null,
  },
  actions: ['approve', 'edit', 'reject', 'needs_visit'],
};

const PROVIDER: CurationItem = {
  ...BASE,
  id: 'i-provider',
  kind: 'host_provider_suggestion',
  host: { id: 'h1', email: 'host@example.test' },
  payload: {
    kind: 'host_provider_suggestion',
    name: 'Kayak Bros',
    contact: '+385 91 000',
    note: null,
  },
  actions: ['approve', 'reject', 'needs_visit'],
};

const CLUSTER: CurationItem = {
  ...BASE,
  id: 'i-cluster',
  kind: 'fallback_topic_cluster',
  payload: {
    kind: 'fallback_topic_cluster',
    topic: 'kayak rental',
    topics: ['kayak rental', 'rental kayak'],
    places: ['okrug'],
    count: 4,
    noResults: 3,
    weekStart: '2026-10-12',
  },
  actions: ['approve', 'reject', 'needs_visit'],
};

const FLAGGED: CurationItem = {
  ...BASE,
  id: 'i-flagged',
  kind: 'guest_flagged',
  payload: { kind: 'guest_flagged', reason: 'outdated', count: 3 },
  record: {
    id: 'r9',
    title: 'Plaža Pantan',
    kind: 'place',
    placeCategory: 'beach',
    verifiedAt: null,
  },
  actions: ['approve', 'edit', 'reject', 'needs_visit'],
};

const WAITING: CurationItem = {
  ...BASE,
  id: 'i-waiting',
  kind: 'draft',
  payload: { kind: 'draft', changes: {}, candidateId: 'c1' },
  candidate: { id: 'c1', name: 'Saldun' },
  actions: ['reject'],
};

const VENUE = 'https://svdominik.com/';
const CONTACT = 'https://svdominik.com/kontakt';

const DRAFTED: CurationItem = {
  ...BASE,
  id: 'i-drafted',
  kind: 'draft',
  payload: {
    kind: 'draft',
    candidateId: 'c2',
    changes: {
      title: 'Restoran Sv. Dominik',
      phone: '+385 21 000 000',
      openingHours: [
        { weekday: 1, opens: '08:00', closes: '23:00', validFrom: null, validTo: null },
      ],
      fieldSources: { title: VENUE, phone: CONTACT, openingHours: CONTACT },
    },
    place: {
      placeCategory: 'restaurant',
      categorySourceUrl: 'https://www.openstreetmap.org/node/9',
      location: { lat: 43.5, lng: 16.25 },
      locationSource: 'osm',
      locationSourceUrl: 'https://www.openstreetmap.org/node/9',
    },
    images: [
      {
        url: 'https://upload.wikimedia.org/a.jpg',
        licence: 'CC BY-SA 4.0',
        attribution: 'Jane Doe',
        sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
      },
    ],
    drafting: { status: 'drafted', at: '2026-10-24T08:00:00Z', pages: [VENUE, CONTACT] },
  },
  candidate: { id: 'c2', name: 'Sv. Dominik' },
  drafted: true,
  actions: ['approve', 'edit', 'reject', 'needs_visit'],
};

const FAILED: CurationItem = {
  ...WAITING,
  id: 'i-failed',
  payload: {
    kind: 'draft',
    changes: {},
    candidateId: 'c3',
    drafting: { status: 'no_sources', at: '2026-10-24T08:00:00Z', pages: [] },
  },
  candidate: { id: 'c3', name: 'Parking Lokva' },
};

const DIFF: CurationItem = {
  ...BASE,
  id: 'i-diff',
  kind: 'refresh_diff',
  payload: {
    kind: 'refresh_diff',
    runId: 'run1',
    changes: {
      phone: '+385 21 111 111',
      address: 'Obala 1',
      fieldSources: { phone: CONTACT, address: 'javascript:alert(1)' },
    },
    previous: { phone: '+385 21 000 000' },
  },
  record: {
    id: 'r2',
    title: 'Konoba Diff',
    kind: 'place',
    placeCategory: 'restaurant',
    verifiedAt: '2026-05-01T00:00:00Z',
  },
  actions: ['approve', 'edit', 'reject', 'needs_visit'],
};

const COUNTS = {
  draft: 1,
  refresh_diff: 0,
  guest_flagged: 0,
  host_place_suggestion: 0,
  host_provider_suggestion: 1,
  fallback_topic_cluster: 1,
};

const STALE: StalenessRecord[] = [
  {
    id: 's1',
    destinationId: 'd1',
    destinationName: 'Trogir',
    kind: 'place',
    placeCategory: 'beach',
    title: 'Pantan beach',
    verifiedAt: '2025-01-01T00:00:00Z',
    staleness: { status: 'stale', staleAt: '2025-07-01T00:00:00Z' },
    recommendations: 12,
    score: 26,
  },
  {
    id: 's2',
    destinationId: 'd1',
    destinationName: 'Trogir',
    kind: 'day_trip',
    placeCategory: null,
    title: 'Krka day trip',
    verifiedAt: null,
    staleness: { status: 'never_verified', staleAt: null },
    recommendations: 0,
    score: 1,
  },
];

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string }[] = [];

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

function stubApi() {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url === '/api/admin/destinations') return json({ destinations: [DEST] });
    if (url.endsWith('/edit')) return json({ recordId: 'r1' });
    if (url.endsWith('/approve')) return json({ ...DRAFT, status: 'approved', actions: [] });
    if (url.endsWith('/verify')) return json({});
    if (url.startsWith('/api/admin/curation/staleness')) return json({ records: STALE });
    return json({
      items: [DRAFT, PROVIDER, CLUSTER, FLAGGED, WAITING, DRAFTED, FAILED, DIFF],
      counts: COUNTS,
    });
  });
}

function RecordStub() {
  return <p>Record {useParams().id}</p>;
}

async function mount(path: string) {
  stubApi();
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <ConfirmProvider>
        <WithPageTitle>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/admin/curation" element={<CurationPage />} />
              <Route path="/admin/curation/staleness" element={<StalenessPage />} />
              <Route path="/admin/catalog/records/:id" element={<RecordStub />} />
            </Routes>
          </MemoryRouter>
        </WithPageTitle>
      </ConfirmProvider>,
    );
  });
}

const rowOf = (text: string) =>
  [...el.querySelectorAll('li.block-row, tbody tr')].find((row) => row.textContent?.includes(text));

/** The buttons a row shows, the "⋯" menu's included by its accessible name. */
const buttonsOf = (row: Element | undefined) =>
  [...(row?.querySelectorAll('button') ?? [])].map(
    (b) => b.textContent || b.getAttribute('aria-label'),
  );

async function click(button: Element | undefined | null) {
  await act(async () => {
    (button as HTMLButtonElement | undefined)?.click();
  });
}

/** Every action of a row: its one visible button, then what its "⋯" menu holds (in the body). */
async function actionsOf(row: Element | undefined, subject: string) {
  const visible = row?.querySelector('.queue-actions > button')?.textContent;
  const more = row?.querySelector(`button[aria-label="More for ${subject}"]`);
  if (!more) return [visible];
  await click(more);
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
  await click(more);
  return [visible, ...items];
}

/** Opens a row's "⋯" menu and picks one of its items. */
async function pick(row: Element | undefined, subject: string, item: string) {
  await click(row?.querySelector(`button[aria-label="More for ${subject}"]`));
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === item),
  );
}

async function choose(label: string, value: string) {
  const select = [...el.querySelectorAll('label')]
    .find((l) => l.querySelector('.field-label')?.textContent === label)
    ?.querySelector('select') as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return select;
}

const status = () => el.querySelector('output[aria-live="polite"]')?.textContent;

const buttonIn = (row: Element | undefined | null, name: string) =>
  [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);

const dialog = () => document.querySelector('dialog.confirm-dialog');

describe('CurationPage', () => {
  it('shows each kind with its own actions', async () => {
    await mount('/admin/curation');
    expect(calls[0]?.url).toBe('/api/admin/curation?status=open');
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual([
      'To review',
      'Needs a visit',
      'Done',
    ]);
    expect(el.querySelector('a[href="/admin/curation/staleness"]')?.textContent).toBe(
      'Due for a re-check',
    );
    const draft = rowOf('Konoba Old');
    expect(await actionsOf(draft, 'Konoba Old')).toEqual([
      'Approve',
      'Edit',
      'Reject',
      'Move to Needs a visit',
    ]);
    expect(buttonIn(draft, 'Approve')?.className).toBe('primary');
    expect(draft?.textContent).toContain('Proposes Title, Description');
    expect(draft?.textContent).toContain('Trogir · Added 20.10.2026');
    expect(await actionsOf(rowOf('Kayak Bros'), 'Kayak Bros')).toEqual([
      'Approve',
      'Reject',
      'Move to Needs a visit',
    ]);
    expect(rowOf('Kayak Bros')?.textContent).toContain('host@example.test');
    const cluster = rowOf('kayak rental')?.textContent ?? '';
    expect(cluster).toContain('4 searches, 3 without results, week of 12.10.2026');
    expect(cluster).toContain('Near okrug');
    expect(el.textContent).toContain('Host Provider suggestion (1)');
    expect(el.textContent).toContain('All kinds (3)');
  });

  it('counts guest flags by answer, not by guest', async () => {
    await mount('/admin/curation');
    expect(rowOf('Plaža Pantan')?.textContent).toContain('Flagged as outdated in 3 answers');
  });

  it('filters by kind', async () => {
    await mount('/admin/curation');
    const select = await choose('Kind', 'draft');
    expect(calls.at(-1)?.url).toBe('/api/admin/curation?status=open&kind=draft');
    expect(select.value).toBe('draft');
  });

  it('approves an item, removes its row and says so', async () => {
    await mount('/admin/curation');
    await click(buttonIn(rowOf('Konoba Old'), 'Approve'));
    expect(calls).toContainEqual({ url: '/api/admin/curation/i-draft/approve', method: 'POST' });
    expect(rowOf('Konoba Old')).toBeUndefined();
    expect(rowOf('Kayak Bros')).toBeDefined();
    expect(status()).toBe('Konoba Old approved. It is under Done.');
  });

  it('says where an item went after Move to Needs a visit', async () => {
    await mount('/admin/curation');
    await pick(rowOf('Kayak Bros'), 'Kayak Bros', 'Move to Needs a visit');
    expect(calls).toContainEqual({
      url: '/api/admin/curation/i-provider/needs-visit',
      method: 'POST',
    });
    expect(rowOf('Kayak Bros')).toBeUndefined();
    expect(status()).toBe('Kayak Bros moved to Needs a visit.');
  });

  it('asks before rejecting, and rejects only on the dialog’s Reject', async () => {
    await mount('/admin/curation');
    await pick(rowOf('Kayak Bros'), 'Kayak Bros', 'Reject');
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Reject Kayak Bros?');
    await click(buttonIn(dialog(), 'Cancel'));
    expect(dialog()).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/reject'))).toBe(false);
    expect(rowOf('Kayak Bros')).toBeDefined();

    await pick(rowOf('Kayak Bros'), 'Kayak Bros', 'Reject');
    await click(buttonIn(dialog(), 'Reject'));
    expect(calls).toContainEqual({ url: '/api/admin/curation/i-provider/reject', method: 'POST' });
    expect(rowOf('Kayak Bros')).toBeUndefined();
    expect(status()).toBe('Kayak Bros rejected. It is under Done.');
  });

  it('shows a waiting seeding draft by its candidate name, with Reject only', async () => {
    await mount('/admin/curation?kind=draft');
    expect(calls[0]?.url).toBe('/api/admin/curation?status=open&kind=draft');
    const row = rowOf('Saldun');
    expect(row?.textContent).toContain('to be drafted');
    expect(buttonsOf(row)).toEqual(['Reject']);
  });

  it('shows a drafted candidate draft with all actions and its proposal with sources', async () => {
    await mount('/admin/curation?kind=draft');
    const row = rowOf('Sv. Dominik');
    expect(await actionsOf(row, 'Sv. Dominik')).toEqual([
      'Approve',
      'Edit',
      'Reject',
      'Move to Needs a visit',
    ]);
    expect(row?.querySelector('summary')?.textContent).toBe('Show proposal');
    const fields = [...(row?.querySelectorAll('.proposal dl > div') ?? [])].map((d) => [
      d.querySelector('dt')?.textContent,
      d.querySelector('dd')?.textContent,
      d.querySelector('a')?.getAttribute('href') ?? null,
    ]);
    expect(fields).toEqual([
      ['Title', 'Restoran Sv. Dominik source', VENUE],
      ['Phone', '+385 21 000 000 source', CONTACT],
      ['Opening hours', 'Mon 08:00–23:00 source', CONTACT],
      ['Category', 'Restaurant source', 'https://www.openstreetmap.org/node/9'],
      ['Location', 'From OpenStreetMap source', 'https://www.openstreetmap.org/node/9'],
      [
        'Image',
        'Wikimedia Commons, Jane Doe · CC BY-SA 4.0 source',
        'https://commons.wikimedia.org/wiki/File:A.jpg',
      ],
    ]);
    const link = row?.querySelector('.proposal a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('says why a candidate draft has nothing to approve', async () => {
    await mount('/admin/curation?kind=draft');
    const row = rowOf('Parking Lokva');
    expect(row?.textContent).toContain('Couldn’t be drafted: no readable web page about it');
    expect(buttonsOf(row)).toEqual(['Reject']);
    expect(row?.querySelector('.proposal')).toBeNull();
  });

  it('shows a refresh diff with its previous values, and links only web sources', async () => {
    await mount('/admin/curation?kind=refresh_diff');
    const row = rowOf('Konoba Diff');
    expect(row?.textContent).toContain('Changed: Address, Phone');
    const [address, phone] = [...(row?.querySelectorAll('.proposal dd') ?? [])];
    expect(phone?.querySelector('del')?.textContent).toBe('+385 21 000 000');
    expect(phone?.textContent).toContain('+385 21 111 111');
    expect(address?.textContent).toContain('Was empty.');
    expect(address?.querySelector('a')).toBeNull();
  });

  it('opens the record editor on Edit', async () => {
    await mount('/admin/curation');
    await pick(rowOf('Konoba Old'), 'Konoba Old', 'Edit');
    expect(calls).toContainEqual({ url: '/api/admin/curation/i-draft/edit', method: 'POST' });
    expect(el.textContent).toContain('Record r1');
  });
});

describe('StalenessPage', () => {
  it('lists records in API order and marks one verified', async () => {
    await mount('/admin/curation/staleness');
    expect(el.querySelector('h1')?.textContent).toBe('Due for a re-check');
    const titles = [...el.querySelectorAll('table.data-table tbody .row-target')].map(
      (a) => a.textContent,
    );
    expect(titles).toEqual(['Pantan beach', 'Krka day trip']);
    const pantan = rowOf('Pantan beach');
    expect(pantan?.textContent).toContain('Overdue since 01.07.2025');
    expect(pantan?.textContent).toContain('12 times in 90 days');
    expect(rowOf('Krka day trip')?.textContent).toContain('Day trip · Trogir');
    expect(rowOf('Krka day trip')?.textContent).toContain('Never checked');
    expect(rowOf('Krka day trip')?.textContent).toContain('Not lately');
    await click(buttonIn(pantan, 'Mark verified'));
    expect(calls).toContainEqual({
      url: '/api/admin/catalog/records/s1/verify',
      method: 'POST',
    });
    expect(rowOf('Pantan beach')).toBeUndefined();
    expect(status()).toBe('Pantan beach marked verified.');
  });
});
