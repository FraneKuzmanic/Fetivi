// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CurationItem, StalenessRecord } from '../../api';
import { CurationPage } from './CurationPage';
import { StalenessPage } from './StalenessPage';

const DEST = { id: 'd1', name: 'Trogir' };
const BASE = {
  status: 'open' as const,
  destination: DEST,
  host: null,
  record: null,
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
    return json({ items: [DRAFT, PROVIDER, CLUSTER], counts: COUNTS });
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
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/curation" element={<CurationPage />} />
          <Route path="/admin/curation/staleness" element={<StalenessPage />} />
          <Route path="/admin/catalog/records/:id" element={<RecordStub />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const rowOf = (text: string) =>
  [...el.querySelectorAll('li.block-row')].find((li) => li.textContent?.includes(text));

const buttonsOf = (row: Element | undefined) =>
  [...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent);

async function click(button: Element | undefined) {
  await act(async () => {
    (button as HTMLButtonElement | undefined)?.click();
  });
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

const buttonIn = (row: Element | undefined, name: string) =>
  [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);

describe('CurationPage', () => {
  it('shows each kind with its own actions', async () => {
    await mount('/admin/curation');
    expect(calls[0]?.url).toBe('/api/admin/curation?status=open');
    expect(buttonsOf(rowOf('Konoba Old'))).toEqual(['Approve', 'Edit', 'Reject', 'Needs a visit']);
    expect(rowOf('Konoba Old')?.textContent).toContain('Proposes Title, Description');
    expect(buttonsOf(rowOf('Kayak Bros'))).toEqual(['Approve', 'Reject', 'Needs a visit']);
    expect(rowOf('Kayak Bros')?.textContent).toContain('host@example.test');
    const cluster = rowOf('kayak rental')?.textContent ?? '';
    expect(cluster).toContain('4 searches, 3 without results');
    expect(cluster).toContain('Near okrug');
    expect(el.textContent).toContain('Host Provider suggestion (1)');
    expect(el.textContent).toContain('All kinds (3)');
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

  it('says where an item went after Needs a visit', async () => {
    await mount('/admin/curation');
    await click(buttonIn(rowOf('Kayak Bros'), 'Needs a visit'));
    expect(rowOf('Kayak Bros')).toBeUndefined();
    expect(status()).toBe('Kayak Bros moved to Needs a visit.');
  });

  it('opens the record editor on Edit', async () => {
    await mount('/admin/curation');
    await click(buttonIn(rowOf('Konoba Old'), 'Edit'));
    expect(calls).toContainEqual({ url: '/api/admin/curation/i-draft/edit', method: 'POST' });
    expect(el.textContent).toContain('Record r1');
  });
});

describe('StalenessPage', () => {
  it('lists records in API order and marks one verified', async () => {
    await mount('/admin/curation/staleness');
    const titles = [...el.querySelectorAll('li.block-row strong')].map((s) => s.textContent);
    expect(titles).toEqual(['Pantan beach', 'Krka day trip']);
    expect(rowOf('Pantan beach')?.textContent).toContain('Recommended 12 times in 90 days');
    expect(rowOf('Pantan beach')?.textContent).toContain('Past its budget');
    expect(rowOf('Krka day trip')?.textContent).toContain('Day trip · Trogir');
    await click(buttonIn(rowOf('Pantan beach'), 'Mark verified'));
    expect(calls).toContainEqual({
      url: '/api/admin/catalog/records/s1/verify',
      method: 'POST',
    });
    expect(rowOf('Pantan beach')).toBeUndefined();
    expect(status()).toBe('Pantan beach marked verified.');
  });
});
