// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReconciliationFinding, ReconciliationRun } from '../../api';
import { WithPageTitle } from '../../shell/testing';
import { ReconciliationPage } from './ReconciliationPage';

const RUN: ReconciliationRun = {
  id: 'r1',
  trigger: 'schedule',
  startedAt: '2026-10-23T10:00:00Z',
  finishedAt: '2026-10-23T10:00:02Z',
  checked: 12,
  found: 2,
  resolved: 1,
  error: null,
};

const EARLIER: ReconciliationRun = {
  ...RUN,
  id: 'r0',
  startedAt: '2026-10-23T09:55:00Z',
  finishedAt: '2026-10-23T09:55:01Z',
  error: 'stripe-unavailable',
};

const OPEN: ReconciliationFinding = {
  id: 'f-open',
  kind: 'orphan_session',
  status: 'needs_attention',
  orderId: null,
  stripeRef: 'cs_1',
  detail: 'status=complete intent=pi_1',
  action: null,
  subject: null,
  firstSeenAt: '2026-10-23T09:00:00Z',
  lastSeenAt: '2026-10-23T10:00:00Z',
  resolvedAt: null,
};

const RESOLVED: ReconciliationFinding = {
  id: 'f-done',
  kind: 'session_completed',
  status: 'resolved',
  orderId: '0b3f1c2d-aaaa-4bbb-8ccc-123456789abc',
  stripeRef: 'cs_2',
  detail: 'session=complete intent=pi_2',
  action: 'authorize: applied',
  subject: {
    kind: 'order',
    id: '0b3f1c2d-aaaa-4bbb-8ccc-123456789abc',
    label: 'Blue Lagoon boat trip',
  },
  firstSeenAt: '2026-10-23T10:00:00Z',
  lastSeenAt: '2026-10-23T10:00:00Z',
  resolvedAt: '2026-10-23T10:00:00Z',
};

const RACED: ReconciliationFinding = {
  ...RESOLVED,
  id: 'f-raced',
  kind: 'hold_expired',
  action: 'expire: unchanged',
  subject: { kind: 'provider', id: 'p1', label: 'Adriatic Boats' },
};

const DISMISSED: ReconciliationFinding = {
  ...OPEN,
  id: 'f-dismissed',
  kind: 'refund_failed',
  status: 'dismissed',
  detail: '',
};

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
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/run')) return json({ queued: true }, 202);
    if (url.endsWith('/resolve')) return new Response(null, { status: 204 });
    if (url.includes('status=resolved')) {
      return json({ runs: [RUN, EARLIER], findings: [RESOLVED, RACED, DISMISSED] });
    }
    return json({ runs: [RUN, EARLIER], findings: [OPEN] });
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
        <MemoryRouter>
          <ReconciliationPage />
        </MemoryRouter>
      </WithPageTitle>,
    );
  });
}

const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));

async function click(name: string) {
  await act(async () => {
    button(name)?.click();
  });
}

describe('ReconciliationPage', () => {
  it('lists what needs attention, and what was put right under Resolved', async () => {
    await mount();
    expect(el.querySelector('h1')?.textContent).toBe('Payment checks');
    expect(calls[0]).toEqual({
      url: '/api/admin/reconciliation?status=needs_attention',
      method: 'GET',
    });
    expect(el.textContent).not.toContain('Every 5 minutes Fetivi compares');
    expect(el.textContent).not.toContain('Last check');
    expect(el.querySelector('details.help')).toBeNull();
    const tabsRow = el.querySelector('.tabs-row');
    expect(tabsRow?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabsRow?.querySelector('button.primary')?.textContent).toContain('Check now');
    const open = el.querySelector('.data-table tbody tr');
    expect(open?.textContent).toContain('Stripe payment with no order');
    expect(open?.textContent).toContain('Nothing yet');
    expect(open?.querySelector('details.tech-details summary')?.textContent).toBe(
      'Technical details',
    );
    expect(open?.querySelector('details.tech-details')?.textContent).toContain(
      'status=complete intent=pi_1',
    );
    expect(button('Mark resolved')).toBeDefined();

    await click('Resolved');
    expect(calls.at(-1)?.url).toBe('/api/admin/reconciliation?status=resolved');
    const rows = [...el.querySelectorAll('.data-table tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Payment went through, but Fetivi missed it');
    expect(rows[0]?.textContent).toContain('Order: Blue Lagoon boat trip');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe(
      `/admin/orders/${RESOLVED.orderId}`,
    );
    expect(rows[1]?.textContent).toContain('Provider: Adriatic Boats');
    expect(rows[1]?.querySelector('a')?.getAttribute('href')).toBe('/admin/providers/p1');
    // The stored action codes read as words.
    expect(rows[0]?.textContent).toContain('Card hold recorded');
    expect(rows[1]?.textContent).toContain('Order expired (already up to date)');
    expect(rows[2]?.textContent).toContain('Refund failed at Stripe');
    expect(rows[2]?.textContent).toContain('Nothing yet · marked resolved');
    expect(rows[2]?.querySelector('details')).toBeNull();
    expect(el.textContent).not.toContain(': applied');
    expect(button('Mark resolved')).toBeUndefined();
  });

  it('queues a check', async () => {
    await mount();
    await click('Check now');
    expect(calls.at(-1)).toEqual({ url: '/api/admin/reconciliation/run', method: 'POST' });
    expect(el.textContent).toContain('Check started. It finishes within a minute.');
    expect(button('Check now')?.disabled).toBe(true);
  });

  it('marks a finding resolved without asking and removes it from the list', async () => {
    await mount();
    await click('Mark resolved');
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/reconciliation/findings/f-open/resolve',
      method: 'POST',
    });
    expect(el.textContent).toContain('All caught up');
    expect(el.querySelector('.data-table')).toBeNull();
  });
});
