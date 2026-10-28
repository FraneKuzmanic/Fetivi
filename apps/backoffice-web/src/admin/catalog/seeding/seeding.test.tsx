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
import { WithPageTitle } from '../../../shell/testing';
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
      <WithPageTitle>
        <MemoryRouter initialEntries={[`/admin/catalog/destinations/${DEST}/seeding`]}>
          <Routes>
            <Route path="/admin/catalog/destinations/:id/seeding" element={<SeedingPage />} />
          </Routes>
        </MemoryRouter>
      </WithPageTitle>,
    );
  });
}

const rowOf = (name: string) =>
  [...el.querySelectorAll('table.data-table tbody tr, li.block-row')].find(
    (row) => row.querySelector('strong')?.textContent === name,
  );

const button = (name: string, within: Element | undefined = el) =>
  [...(within?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);

const labelled = (label: string) => el.querySelector(`[aria-label="${label}"]`);

const tab = (name: string) =>
  [...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(name));

const selection = () => el.querySelector('section[aria-label="Selected places"]');

async function click(target: Element | undefined | null) {
  await act(async () => {
    (target as HTMLElement | undefined)?.click();
  });
}

const status = () => el.querySelector('output[aria-live="polite"]')?.textContent;

describe('SeedingPage', () => {
  it('lists candidates with their distance, last search and where places come from', async () => {
    await mount();
    expect(calls.map((c) => c.url)).toContain(`${BASE}?status=new`);
    expect(el.querySelector('h1')?.textContent).toBe('Find places');
    expect(button('Search again')?.disabled).toBe(false);
    expect(rowOf('Saldun')?.textContent).toContain('Beach');
    expect(rowOf('Saldun')?.textContent).toContain('0.7 km');
    expect(el.textContent).toContain('Places within 3 km of Trogir.');
    expect(el.textContent).toMatch(/Last search \d{2}\.\d{2}\.2026, \d{2}:\d{2}\./);
    expect(el.textContent).toContain('Some sources didn’t answer');
    const where = [...el.querySelectorAll('details')].find(
      (d) => d.querySelector('summary')?.textContent === 'Where places come from',
    );
    expect([...(where?.querySelectorAll('li') ?? [])].map((l) => l.textContent)).toEqual([
      'OpenStreetMap: 187 places',
      'Bathing water (EEA): 11 places',
      'Overture Maps: did not answer',
    ]);
    expect(where?.textContent).toContain('© OpenStreetMap contributors');
    expect(el.textContent).toContain('6 places already in the catalog are left out');
    expect(tab('To review')?.querySelector('.tab-count')?.textContent).toBe('2');
    expect(tab('Possible duplicates')?.querySelector('.tab-count')?.textContent).toBe('2');
    expect(tab('Dismissed')?.querySelector('.tab-count')?.textContent).toBe('1');
  });

  it('selects two candidates and sends them to drafting', async () => {
    await mount();
    expect(selection()).toBeNull();
    await click(labelled('Select Saldun'));
    await click(labelled('Select Plaža Saldun'));
    expect(selection()?.textContent).toContain('2 selected');
    await click(button('Draft 2 places', selection() ?? undefined));
    expect(calls).toContainEqual({
      url: `${BASE}/draft`,
      method: 'POST',
      body: { candidateIds: ['c-saldun', 'c-plaza'] },
    });
    expect(status()).toBe(
      'Sent 2 places to drafting. The drafts show up in Curation when they are ready.',
    );
    expect(selection()).toBeNull();
  });

  it('clears the selection without sending', async () => {
    await mount();
    await click(labelled('Select Saldun'));
    expect(button('Draft 1 place', selection() ?? undefined)).toBeDefined();
    await click(button('Clear', selection() ?? undefined));
    expect(selection()).toBeNull();
    expect((labelled('Select Saldun') as HTMLInputElement).checked).toBe(false);
    expect(calls.some((c) => c.url === `${BASE}/draft`)).toBe(false);
  });

  it('merges a possible duplicate into the candidate', async () => {
    await mount();
    await click(tab('Possible duplicates'));
    const row = rowOf('Saldun');
    expect(row?.textContent).toContain('Looks like Plaža Saldun, 20 m away');
    await click(button('Merge', row));
    expect(calls).toContainEqual({
      url: '/api/admin/seeding/candidates/c-plaza/merge',
      method: 'POST',
      body: { intoId: 'c-saldun' },
    });
    expect(status()).toBe('Saldun and Plaža Saldun are now one place.');
  });

  it('keeps two possible duplicates apart', async () => {
    await mount();
    await click(tab('Possible duplicates'));
    await click(button('Keep both', rowOf('Saldun')));
    expect(calls).toContainEqual({
      url: '/api/admin/seeding/candidates/c-saldun/keep-apart',
      method: 'POST',
      body: { otherId: 'c-plaza' },
    });
    expect(status()).toBe('Saldun and Plaža Saldun stay separate.');
  });

  it('selects page by page, at most one request, and says how many are listed', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...PLAZA,
      id: `c${i}`,
      name: `Place ${String(i).padStart(3, '0')}`,
      possibleDuplicates: [],
    }));
    newList = { candidates: many, count: 2400 };
    await mount();
    expect(el.textContent).toContain('Showing the first 250 of 2400, by name.');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(el.querySelector('.pager')?.textContent).toContain('1–50 of 250');
    for (let p = 0; p < 5; p++) {
      if (p > 0) await click(button('Next', el.querySelector('.pager') ?? undefined));
      await click(labelled('Select every place on this page'));
    }
    expect(selection()?.textContent).toContain('250 selected');
    expect(selection()?.textContent).toContain('send up to 200 at a time');
    expect(button('Draft 250 places', selection() ?? undefined)?.disabled).toBe(true);
    // Unticking the last page brings it back to one request.
    await click(labelled('Select every place on this page'));
    await click(button('Draft 200 places', selection() ?? undefined));
    const draft = calls.find((c) => c.url === `${BASE}/draft`);
    expect((draft?.body as { candidateIds: string[] } | undefined)?.candidateIds).toHaveLength(200);
    expect(status()).toBe(
      'Sent 200 places to drafting. 25 are being drafted now; 175 wait for the next run (up to 25 at a time).',
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
      'Drafting: 18 drafted, 3 couldn’t be drafted (no readable web page), 4 didn’t work. 5 wait for the next run.',
    );
    await click(button('Draft 5 now'));
    expect(calls).toContainEqual({ url: DRAFTING, method: 'POST', body: undefined });
    expect(status()).toBe('5 are being drafted now.');
  });

  it('filters the list by name, ignoring accents, and by category', async () => {
    newList = {
      candidates: [SALDUN, { ...PLAZA, name: 'Konoba Mare', placeCategory: 'restaurant' }],
      count: 2,
    };
    await mount();
    const search = el.querySelector('input[type="search"]') as HTMLInputElement;
    expect(el.querySelector(`label[for="${search.id}"]`)?.textContent).toBe('Search by name');
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
    const select = [...el.querySelectorAll('label')]
      .find((l) => l.querySelector('.field-label')?.textContent === 'Category')
      ?.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = 'restaurant';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(rowOf('Saldun')).toBeUndefined();
    expect(rowOf('Konoba Mare')).toBeDefined();
  });

  it('lists the entries of a place found more than once and splits one off', async () => {
    await mount();
    const entries = rowOf('Saldun')?.querySelector('details');
    expect(entries?.querySelector('summary')?.textContent).toBe('Found as 2 entries');
    expect(
      [...(entries?.querySelectorAll('li') ?? [])].map((li) => [
        li.firstElementChild?.textContent,
        li.querySelector('a')?.getAttribute('href') ?? null,
      ]),
    ).toEqual([
      ['Saldun', null],
      ['Plaža Saldun', 'https://www.openstreetmap.org/way/1'],
    ]);
    expect(rowOf('Plaža Saldun')?.querySelector('details')).toBeNull();
    await click(button('Split off', entries?.querySelector('li') ?? undefined));
    expect(calls).toContainEqual({
      url: '/api/admin/seeding/sources/s1/split',
      method: 'POST',
      body: undefined,
    });
    expect(status()).toBe('Saldun is now a place of its own.');
  });

  it('disables the search while one is running', async () => {
    lastImport = {
      ...DONE_RUN,
      status: 'running',
      startedAt: '2026-10-25T23:50:00',
      finishedAt: null,
      sources: {},
    };
    await mount();
    expect(button('Search again')?.disabled).toBe(true);
    expect(el.textContent).toContain('Searching since 25.10.2026, 23:50…');
  });

  it('dismisses a candidate and restores it from the Dismissed tab', async () => {
    await mount();
    await click(labelled('Dismiss Saldun'));
    expect(calls.some((c) => c.url === '/api/admin/seeding/candidates/c-saldun/dismiss')).toBe(
      true,
    );
    expect(status()).toBe('Saldun dismissed.');
    await click(tab('Dismissed'));
    expect(calls.map((c) => c.url)).toContain(`${BASE}?status=dismissed`);
    expect(labelled('Dismiss Parking lot')).toBeNull();
    await click(labelled('Restore Parking lot'));
    expect(calls.some((c) => c.url === '/api/admin/seeding/candidates/c-junk/restore')).toBe(true);
    expect(status()).toBe('Parking lot is back in To review.');
  });
});
