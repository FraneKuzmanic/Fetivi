// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DraftingStatus,
  SeedingCandidate,
  SeedingImport,
  SeedingOverview,
} from '../../../api';
import { SeedingPage } from './SeedingPage';

const DEST = 'd1';
const BASE = '/api/admin/catalog/destinations/d1/seeding';
const DRAFTING = '/api/admin/catalog/destinations/d1/drafting';

const NO_DRAFTING: DraftingStatus = { waiting: 0, draft: null, refresh: null, refreshDue: 0 };

const SALDUN: SeedingCandidate = {
  id: 'c-saldun',
  status: 'new',
  name: 'Saldun',
  placeCategory: 'beach',
  location: { lat: 43.51046, lng: 16.25093 },
  distanceM: 715,
  sources: [
    {
      id: 's1',
      source: 'bathing_water',
      externalId: 'HRBWC-COAST-HR4-2072',
      name: 'Saldun',
      licence: 'CC-BY-4.0',
      sourceUrl: null,
    },
    {
      id: 's2',
      source: 'osm',
      externalId: 'way/1',
      name: 'Plaža Saldun',
      licence: 'ODbL-1.0',
      sourceUrl: 'https://www.openstreetmap.org/way/1',
    },
  ],
  draft: null,
  possibleDuplicates: [{ id: 'c-plaza', name: 'Plaža Saldun', distanceM: 20, score: 1 }],
};

const PLAZA: SeedingCandidate = {
  ...SALDUN,
  id: 'c-plaza',
  name: 'Plaža Saldun',
  sources: [{ ...(SALDUN.sources[1] as SeedingCandidate['sources'][number]), id: 's3' }],
  possibleDuplicates: [{ id: 'c-saldun', name: 'Saldun', distanceM: 20, score: 1 }],
};

const DISMISSED: SeedingCandidate = {
  ...PLAZA,
  id: 'c-junk',
  status: 'dismissed',
  name: 'Parking lot',
  possibleDuplicates: [],
};

const DONE_RUN: SeedingImport = {
  id: 'imp1',
  status: 'done',
  startedAt: '2026-10-24T08:00:00Z',
  finishedAt: '2026-10-24T08:01:00Z',
  sources: {
    osm: { outcome: 'ok', fetched: 242, kept: 187, skipped: 55 },
    bathing_water: { outcome: 'ok', fetched: 11, kept: 11, skipped: 0 },
    overture: { outcome: 'failed', failure: 'unavailable' },
  },
};

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string; body: unknown }[] = [];
let lastImport: SeedingImport | null = DONE_RUN;
/** Replaces the New tab's list and count when set. */
let newList: { candidates: SeedingCandidate[]; count: number } | null = null;
let draftingStatus: DraftingStatus = NO_DRAFTING;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  lastImport = DONE_RUN;
  newList = null;
  draftingStatus = NO_DRAFTING;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function overview(status: string): SeedingOverview {
  return {
    destination: { id: DEST, name: 'Trogir', radiusM: 3000 },
    lastImport,
    counts: { new: newList?.count ?? 2, ticked: 0, dismissed: 1 },
    matchedRecords: 6,
    candidates:
      status === 'dismissed'
        ? [DISMISSED]
        : status === 'new'
          ? (newList?.candidates ?? [SALDUN, PLAZA])
          : [],
  };
}

function stubApi() {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith(`${BASE}?`)) {
      return json(overview(new URLSearchParams(url.split('?')[1]).get('status') ?? 'new'));
    }
    if (url === `${BASE}/draft`) {
      const n = (JSON.parse(String(init?.body)) as { candidateIds: string[] }).candidateIds.length;
      return json({ drafted: n, run: { queued: Math.min(n, 25), waiting: Math.max(0, n - 25) } });
    }
    if (url === DRAFTING && method === 'GET') return json(draftingStatus);
    if (url === DRAFTING) return json({ runId: 'run2', queued: 5, waiting: 0 }, 202);
    if (url.endsWith('/merge')) return json({ candidateId: 'c-saldun' });
    return new Response(null, { status: 204 });
  });
}

async function mount() {
  stubApi();
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[`/admin/catalog/destinations/${DEST}/seeding`]}>
        <Routes>
          <Route path="/admin/catalog/destinations/:id/seeding" element={<SeedingPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const rowOf = (name: string) =>
  [...el.querySelectorAll('li.block-row')].find(
    (li) => li.querySelector('strong')?.textContent === name,
  );

const button = (name: string, within: Element | undefined = el) =>
  [...(within?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);

async function click(target: Element | undefined | null) {
  await act(async () => {
    (target as HTMLElement | undefined)?.click();
  });
}

const status = () => el.querySelector('output[aria-live="polite"]')?.textContent;

describe('SeedingPage', () => {
  it('lists candidates with their source chips, licences and last run', async () => {
    await mount();
    expect(calls.map((c) => c.url)).toContain(`${BASE}?status=new`);
    const chips = [...(rowOf('Saldun')?.querySelectorAll('.chips .chip') ?? [])];
    expect(chips.map((c) => [c.textContent, c.getAttribute('title')])).toEqual([
      ['Bathing water (EEA)', 'Saldun · CC-BY-4.0'],
      ['OpenStreetMap', 'Plaža Saldun · ODbL-1.0'],
    ]);
    expect(chips[1]?.getAttribute('href')).toBe('https://www.openstreetmap.org/way/1');
    expect(rowOf('Saldun')?.textContent).toContain('0.7 km from the centre');
    expect(el.textContent).toContain('within 3 km');
    expect(el.textContent).toContain('OpenStreetMap: 187 places (55 skipped)');
    expect(el.textContent).toContain('Overture Maps: did not answer');
    expect(el.textContent).toContain('6 already in the catalog');
    expect(el.textContent).toContain('© OpenStreetMap contributors');
  });

  it('ticks two candidates and sends them to drafting', async () => {
    await mount();
    expect(button('Send 0 to drafting')?.disabled).toBe(true);
    await click(el.querySelector('input[aria-label="Tick Saldun"]'));
    await click(el.querySelector('input[aria-label="Tick Plaža Saldun"]'));
    await click(button('Send 2 to drafting'));
    expect(calls).toContainEqual({
      url: `${BASE}/draft`,
      method: 'POST',
      body: { candidateIds: ['c-saldun', 'c-plaza'] },
    });
    expect(status()).toBe('Sent 2 to drafting. The drafts appear in the curation queue when done.');
    expect(button('Send 0 to drafting')).toBeDefined();
  });

  it('merges a possible duplicate into the candidate', async () => {
    await mount();
    await click(button('Merge', rowOf('Saldun')));
    expect(calls).toContainEqual({
      url: '/api/admin/seeding/candidates/c-plaza/merge',
      method: 'POST',
      body: { intoId: 'c-saldun' },
    });
    expect(status()).toBe('Merged Saldun and Plaža Saldun.');
  });

  it('selects at most one request of candidates and says how many are listed', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...PLAZA,
      id: `c${i}`,
      name: `Place ${String(i).padStart(3, '0')}`,
      possibleDuplicates: [],
    }));
    newList = { candidates: many, count: 2400 };
    await mount();
    expect(el.textContent).toContain('Showing the first 250 of 2400, by name.');
    await click(button('Select first 200'));
    await click(button('Send 200 to drafting'));
    const draft = calls.find((c) => c.url === `${BASE}/draft`);
    expect((draft?.body as { candidateIds: string[] } | undefined)?.candidateIds).toHaveLength(200);
    expect(status()).toBe(
      'Sent 200 to drafting. 25 are drafting now; 175 wait for the next run (at most 25 per run).',
    );
  });

  it('shows the drafting status and drafts the waiting candidates', async () => {
    draftingStatus = {
      waiting: 5,
      draft: {
        id: 'run1',
        startedAt: '2026-10-24T08:00:00Z',
        cap: 25,
        waiting: 5,
        counts: { queued: 0, drafted: 18, diffed: 0, unchanged: 0, no_sources: 3, failed: 4 },
      },
      refresh: null,
      refreshDue: 0,
    };
    await mount();
    expect(el.textContent).toContain(
      'Drafting: 18 drafted, 3 without a usable source, 4 failed. 5 wait for the next run.',
    );
    await click(button('Draft 5 waiting'));
    expect(calls).toContainEqual({ url: DRAFTING, method: 'POST', body: undefined });
    expect(status()).toBe('5 are drafting now.');
  });

  it('filters the list by name, ignoring accents, and by category', async () => {
    newList = {
      candidates: [SALDUN, { ...PLAZA, name: 'Konoba Mare', placeCategory: 'restaurant' }],
      count: 2,
    };
    await mount();
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(search, 'šal');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rowOf('Saldun')).toBeDefined();
    expect(rowOf('Konoba Mare')).toBeUndefined();
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const select = el.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'restaurant';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(rowOf('Saldun')).toBeUndefined();
    expect(rowOf('Konoba Mare')).toBeDefined();
  });

  it('numbers the chips of two rows from one source', async () => {
    newList = {
      candidates: [
        {
          ...PLAZA,
          sources: [
            { ...(PLAZA.sources[0] as SeedingCandidate['sources'][number]) },
            { ...(PLAZA.sources[0] as SeedingCandidate['sources'][number]), id: 's4' },
          ],
        },
      ],
      count: 1,
    };
    await mount();
    const chips = [...(rowOf('Plaža Saldun')?.querySelectorAll('.chips .chip') ?? [])];
    expect(chips.map((c) => c.textContent)).toEqual(['OpenStreetMap 1', 'OpenStreetMap 2']);
  });

  it('splits a source row off a multi-source candidate', async () => {
    await mount();
    await click(button('Split off', rowOf('Saldun')));
    expect(calls.some((c) => c.url === '/api/admin/seeding/sources/s1/split')).toBe(true);
  });

  it('disables the import while a run is running', async () => {
    lastImport = { ...DONE_RUN, status: 'running', finishedAt: null, sources: {} };
    await mount();
    expect(button('Import candidates')?.disabled).toBe(true);
    expect(el.textContent).toContain('Import running since');
  });

  it('shows Restore on the Dismissed tab', async () => {
    await mount();
    await click(
      [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith('Dismissed')),
    );
    expect(calls.map((c) => c.url)).toContain(`${BASE}?status=dismissed`);
    await click(button('Restore', rowOf('Parking lot')));
    expect(calls.some((c) => c.url === '/api/admin/seeding/candidates/c-junk/restore')).toBe(true);
    expect(status()).toBe('Parking lot restored to New.');
  });
});
