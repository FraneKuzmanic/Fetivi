// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SeedingCandidate, SeedingImport, SeedingOverview } from '../../../api';
import { SeedingPage } from './SeedingPage';

const DEST = 'd1';
const BASE = '/api/admin/catalog/destinations/d1/seeding';

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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  lastImport = DONE_RUN;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function overview(status: string): SeedingOverview {
  return {
    destination: { id: DEST, name: 'Trogir', radiusM: 3000 },
    lastImport,
    counts: { new: 2, ticked: 0, dismissed: 1 },
    matchedRecords: 6,
    candidates: status === 'dismissed' ? [DISMISSED] : status === 'new' ? [SALDUN, PLAZA] : [],
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
    if (url === `${BASE}/draft`) return json({ drafted: 2 });
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
    expect(calls[0]?.url).toBe(`${BASE}?status=new`);
    const chips = [...(rowOf('Saldun')?.querySelectorAll('.chips .chip') ?? [])];
    expect(chips.map((c) => [c.textContent, c.getAttribute('title')])).toEqual([
      ['Bathing water (EEA)', 'CC-BY-4.0'],
      ['OpenStreetMap', 'ODbL-1.0'],
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
    expect(status()).toBe('2 sent to drafting. They wait in the curation queue as drafts.');
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
    expect(status()).toBe('Plaža Saldun merged into Saldun.');
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
    expect(calls.at(-1)?.url).toBe(`${BASE}?status=dismissed`);
    await click(button('Restore', rowOf('Parking lot')));
    expect(calls.some((c) => c.url === '/api/admin/seeding/candidates/c-junk/restore')).toBe(true);
    expect(status()).toBe('Parking lot restored to New.');
  });
});
