// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { AdminOverview, AdminPropertyRow, Me } from '../api';
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

async function mount(path: string, me: Me) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/me') return json(me);
    if (url === '/api/host/inbox')
      return json({ messages: [], unread: 0, orders: [], ordersWaiting: 0 });
    if (url === '/api/admin/overview') return json(OVERVIEW);
    if (url.startsWith('/api/admin/orders')) return json({ orders: [], total: 0 });
    if (url === '/api/admin/properties?status=pending') return json({ properties: [WAITING] });
    if (url === '/api/admin/properties?status=all')
      return json({ properties: [WAITING, APPROVED] });
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

  it('lists only the waiting properties on admin Today, with a link to all approvals', async () => {
    await mount('/', ADMIN_ME);
    const section = await vi.waitFor(() => {
      const s = el.querySelector('section[aria-labelledby="waiting-approvals"]');
      expect(s?.querySelector('.data-table')).toBeTruthy();
      return s as HTMLElement;
    });
    expect(section.querySelector('h2')?.textContent).toBe('Waiting for approval');
    const rows = [...section.querySelectorAll('.data-table tbody tr')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Waiting');
    expect(section.querySelector('a[href="/admin/approvals"]')?.textContent).toBe('All approvals');
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
