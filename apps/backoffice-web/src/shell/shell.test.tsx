// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { AdminOverview, AdminPropertyRow, HostSummary, Me, PropertySummary } from '../api';
import { longDay, todayIso } from '../forms/datetime';
import { MoreActions } from './MoreActions';

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

const OVERVIEW: AdminOverview = {
  approvalsPending: 1,
  curationOpen: 0,
  curationNeedsVisit: 0,
  recordsDue: 0,
  paymentProblems: 0,
  ordersNeedAction: 0,
};

const WAITING: AdminPropertyRow = {
  id: 'p1',
  name: 'Villa Mare',
  city: 'Trogir',
  hostEmail: 'host@example.test',
  unitCount: 2,
  readyUnitCount: 1,
  createdAt: '2026-10-20T10:00:00Z',
  approvedAt: null,
};
const APPROVED: AdminPropertyRow = {
  ...WAITING,
  id: 'p2',
  name: 'Kuća Sunce',
  approvedAt: '2026-10-25T10:00:00Z',
};

const ACTIVE_HOST: HostSummary = {
  id: 'h1',
  email: 'host@example.test',
  emailVerified: true,
  suspended: false,
  createdAt: '2026-10-01T10:00:00Z',
  propertyCount: 1,
};
const SUSPENDED_HOST: HostSummary = {
  ...ACTIVE_HOST,
  id: 'h2',
  email: 'paused@example.test',
  suspended: true,
};

const PROPERTY: PropertySummary = {
  id: 'p1',
  name: 'Villa Mare',
  city: 'Trogir',
  approved: true,
  units: [{ id: 'u1', name: 'Apartment 1', hasQr: true, live: true }],
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

async function mount(path: string, me: Me) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url === '/api/auth/me') return json(me);
    if (url === '/api/host/inbox')
      return json({ messages: [], unread: 0, orders: [], ordersWaiting: 0 });
    if (url === '/api/admin/overview') return json(OVERVIEW);
    if (url.startsWith('/api/admin/orders')) return json({ orders: [], total: 0 });
    if (url === '/api/admin/properties?status=all')
      return json({ properties: [WAITING, APPROVED] });
    if (url === '/api/admin/hosts') return json({ hosts: [ACTIVE_HOST, SUSPENDED_HOST] });
    if (url === '/api/admin/act-as') return json({ ...ADMIN_ME, actingAs: ACTIVE_HOST });
    if (url === '/api/host/properties') return json({ properties: [PROPERTY] });
    if (url === '/api/host/stays') return json({ stays: [] });
    if (url === '/api/host/stay-proposals')
      return json({ proposals: [], bookingLinks: { domain: 'booking.com', pending: [] } });
    if (url === '/api/host/suggestions') return json({ suggestions: [] });
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
}

const header = () => el.querySelector('header.topbar');

describe('Shell header', () => {
  it('shows the page title as the only h1, today’s date and the tab title', async () => {
    await mount('/', HOST_ME);
    await vi.waitFor(() => expect(header()?.querySelector('h1')?.textContent).toBe('Today'));
    expect(header()?.querySelector('.topbar-date')?.textContent).toBe(longDay(todayIso(), 'en'));
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(header()?.closest('main')).toBeNull();
    expect(document.title).toBe('Today · Fetivi');
  });

  it('opens the profile menu with the email and Sign out, and no Log out anywhere', async () => {
    await mount('/', HOST_ME);
    const trigger = await vi.waitFor(() => {
      const b = header()?.querySelector<HTMLButtonElement>('button[aria-label="Account"]');
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    });
    await act(async () => trigger.click());
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('host@example.test');
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(labels).toContain('Sign out');
    expect(document.body.textContent).not.toContain('Log out');
    // The language is one item opening a submenu, not a flat list of languages.
    expect(document.querySelectorAll('[role="menu"] [aria-haspopup="menu"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
  });
});

describe('Approvals', () => {
  it('has a Destination column and no date beside an approved status', async () => {
    await mount('/admin/approvals', ADMIN_ME);
    await vi.waitFor(() => expect(header()?.querySelector('h1')?.textContent).toBe('Approvals'));
    await vi.waitFor(() => expect(el.querySelectorAll('.data-table tbody tr')).toHaveLength(2));
    const heads = [...el.querySelectorAll('.data-table thead th')].map((th) => th.textContent);
    expect(heads).toContain('Destination');
    const [waiting, approved] = [...el.querySelectorAll('.data-table tbody tr')];
    expect(waiting?.querySelector('td')?.textContent).toBe('Villa Mare');
    expect(waiting?.textContent).toContain('Trogir');
    const status = approved?.querySelectorAll('td')[5];
    expect(status?.textContent).toBe('Approved');
  });

  it('lists approvals under Needs your attention, with no separate approvals table', async () => {
    await mount('/', ADMIN_ME);
    const attention = await vi.waitFor(() => {
      const s = el.querySelector('section[aria-labelledby="attention"]');
      expect(s?.textContent).toContain('1 property waits for approval');
      return s as HTMLElement;
    });
    expect(attention.querySelector('a[href="/admin/approvals"]')).not.toBeNull();
    expect(el.querySelector('section[aria-labelledby="waiting-approvals"]')).toBeNull();
    expect(el.textContent).not.toContain('Waiting for approval');
    expect(calls.some((c) => c.url.startsWith('/api/admin/properties'))).toBe(false);
  });
});

describe('Hosts', () => {
  const menuFor = (email: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="More for ${email}"]`);
  const itemLabels = () =>
    [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);

  it("puts Act as in each host's ⋯ menu", async () => {
    await mount('/admin/hosts', ADMIN_ME);
    await vi.waitFor(() => expect(el.querySelectorAll('.data-table tbody tr')).toHaveLength(2));
    const buttons = [...el.querySelectorAll('.data-table button')].map((b) => b.textContent);
    expect(buttons).not.toContain('Act as');

    await act(async () => menuFor('paused@example.test')?.click());
    expect(itemLabels()).toEqual(['Lift suspension', 'Delete']);
    await act(async () => menuFor('paused@example.test')?.click());

    await act(async () => menuFor('host@example.test')?.click());
    expect(itemLabels()).toEqual(['Act as', 'Suspend', 'Delete']);
    await act(async () => (document.querySelector('[role="menuitem"]') as HTMLElement).click());
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        url: '/api/admin/act-as',
        method: 'POST',
        body: { hostId: 'h1' },
      }),
    );
  });
});

describe('host Today', () => {
  it('has no Register a Stay', async () => {
    await mount('/', HOST_ME);
    await vi.waitFor(() => expect(el.textContent).toContain('No arrivals in the next'));
    const main = el.querySelector('main');
    expect(main?.querySelector('a[href="/stays/new"]')).toBeNull();
    const controls = [...(main?.querySelectorAll('a, button') ?? [])].map((c) => c.textContent);
    expect(controls).not.toContain('Register a Stay');
  });
});

describe('MoreActions', () => {
  async function render(count: number) {
    el = document.createElement('div');
    document.body.append(el);
    root = createRoot(el);
    const items = [
      { label: 'Delete destination', danger: true, onSelect: () => {} },
      { label: 'Pause', onSelect: () => {} },
    ].slice(0, count);
    await act(async () => root?.render(<MoreActions label="More actions" items={items} />));
  }

  it('shows a lone action as its own danger button', async () => {
    await render(1);
    expect(el.querySelector('button.danger')?.textContent).toBe('Delete destination');
    expect(el.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });

  it('puts two or more actions under the ⋯ menu', async () => {
    await render(2);
    expect(el.querySelector('[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe(
      'More actions',
    );
    expect(el.querySelector('button.danger')).toBeNull();
  });
});
