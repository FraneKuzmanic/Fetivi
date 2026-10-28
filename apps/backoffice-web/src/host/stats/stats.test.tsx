// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import type { AdminFeedbackStats, Me, UnitStats } from '../../api';
import { thumbsRatio } from '../../stats/StatsWidgets';

const ZERO = { conversations: 0, answers: 0, up: 0, down: 0, wrong: 0, outdated: 0, notHelpful: 0 };

const UNIT = {
  id: 'u1',
  name: 'Apartment Mare',
  propertyId: 'p1',
  propertyName: 'Villa Mare',
};

const STATS: UnitStats = {
  unit: { id: 'u1', name: 'Apartment Mare' },
  totals: { ...ZERO, conversations: 3, answers: 9 },
  topTopics: [
    { topic: 'wifi', count: 4 },
    { topic: 'beach', count: 2 },
  ],
  stays: [
    {
      stayId: 's1',
      checkIn: '2026-10-21',
      checkout: '2026-10-24',
      bookerName: 'Ana Horvat',
      conversations: 2,
      answers: 6,
      up: 3,
      down: 1,
    },
  ],
};

const ADMIN_STATS: AdminFeedbackStats = {
  totals: { ...ZERO, conversations: 5, answers: 20, up: 6, down: 2, wrong: 1, outdated: 1 },
  topTopics: [{ topic: 'transport', count: 3 }],
  units: [
    {
      ...ZERO,
      unitId: 'u1',
      unitName: 'Apartment Mare',
      propertyName: 'Villa Mare',
      hostEmail: 'host@example.test',
      stays: 2,
      conversations: 5,
      answers: 20,
      up: 6,
      down: 2,
      wrong: 1,
      outdated: 1,
    },
  ],
};

const HOST_ME: Me = {
  account: {
    id: 'h1',
    email: 'host@example.test',
    role: 'host',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};
const ADMIN_ME: Me = {
  account: {
    id: 'a1',
    email: 'admin@example.test',
    role: 'admin',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};

let root: Root | null = null;
let el: HTMLElement;

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

async function mount(
  path: string,
  me: Me,
  stats: UnitStats = STATS,
  adminStats: AdminFeedbackStats = ADMIN_STATS,
) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/me') return json(me);
    if (url === '/api/host/inbox')
      return json({ messages: [], unread: 0, orders: [], ordersWaiting: 0 });
    if (url === '/api/host/units/u1') return json(UNIT);
    if (url === '/api/host/units/u1/stats') return json(stats);
    if (url === '/api/admin/feedback-stats') return json(adminStats);
    return new Response(null, { status: 404 });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).not.toBe(''));
}

const text = () => el.textContent ?? '';
const navLabels = () => [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());

describe('thumbsRatio', () => {
  it('is a dash before any rating, else the rounded share of thumbs up', () => {
    expect(thumbsRatio(0, 0)).toBe('—');
    expect(thumbsRatio(6, 1)).toBe('86%');
    expect(thumbsRatio(0, 3)).toBe('0%');
  });
});

describe('UnitStatsPage', () => {
  it('shows totals, topic labels and the started Stays, with the counts-only note', async () => {
    await mount('/units/u1/stats', HOST_ME);
    await vi.waitFor(() => expect(text()).toContain('Guest stats'));
    expect(text()).toContain('You never see what guests wrote to Fetivi.');
    const figures = [...el.querySelectorAll('.figures dd')].map((d) => d.textContent);
    expect(figures).toEqual(['3', '9', '—0 up · 0 down']);
    expect([...el.querySelectorAll('.topic-name')].map((t) => t.textContent)).toEqual([
      'Wi-Fi',
      'Beach',
    ]);
    const row = el.querySelector('.stats-stays-table a[href="/stays/s1"]');
    expect(row?.textContent).toContain('21 Oct – 24 Oct 2026');
    expect(row?.textContent).toContain('Ana Horvat');
    expect(row?.textContent).toContain('75%');
    expect(el.querySelector('a[href="/units/u1"]')?.textContent).toBe('Apartment Mare');
  });

  it('says so when no Stay has started', async () => {
    await mount('/units/u1/stats', HOST_ME, { ...STATS, topTopics: [], stays: [] });
    await vi.waitFor(() => expect(text()).toContain('No Stays have started yet.'));
    expect(text()).toContain('No answers yet.');
  });

  it('leaves the host nav without the admin Feedback item', async () => {
    await mount('/units/u1/stats', HOST_ME);
    await vi.waitFor(() => expect(navLabels()).toContain('Properties'));
    expect(navLabels()).not.toContain('Feedback');
  });
});

describe('FeedbackStatsPage', () => {
  it('shows the totals, reasons and a row per unit linked to the flags, without the flags button or target note', async () => {
    await mount('/admin/feedback', ADMIN_ME);
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('Feedback'));
    expect(navLabels()).toContain('Feedback');
    expect(el.querySelector('.page-head a[href="/admin/curation?kind=guest_flagged"]')).toBeNull();
    expect(text()).not.toContain('Review flagged places');
    expect(text()).not.toContain('How guests rate Fetivi’s answers.');
    expect(el.querySelector('.reasons-line')?.textContent).toContain(
      'Wrong 1 · Outdated 1 · Not helpful 0',
    );
    expect(el.querySelector('.reasons-line')?.textContent).toContain('10% of answers');
    const row = el.querySelector('.table-frame .data-table tbody tr');
    expect(row?.textContent).toContain('Apartment Mare');
    expect(row?.textContent).toContain('host@example.test');
    expect(row?.textContent).toContain('75%');
    expect(row?.querySelectorAll('a[href="/admin/curation?kind=guest_flagged"]')).toHaveLength(2);
    expect(text()).toContain('Getting around');
  });

  it('says so when no answer has been rated', async () => {
    await mount('/admin/feedback', ADMIN_ME, STATS, { ...ADMIN_STATS, units: [] });
    await vi.waitFor(() => expect(text()).toContain('No rated answers yet'));
    expect(el.querySelector('.data-table')).toBeNull();
  });
});
