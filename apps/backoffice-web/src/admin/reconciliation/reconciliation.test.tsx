// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReconciliationFinding, ReconciliationRun } from '../../api';
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

const OPEN: ReconciliationFinding = {
  id: 'f-open',
  kind: 'orphan_session',
  status: 'needs_attention',
  orderId: null,
  stripeRef: 'cs_1',
  detail: 'status=complete intent=pi_1',
  action: null,
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
  firstSeenAt: '2026-10-23T10:00:00Z',
  lastSeenAt: '2026-10-23T10:00:00Z',
  resolvedAt: '2026-10-23T10:00:00Z',
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
    if (url.includes('status=resolved')) return json({ runs: [RUN], findings: [RESOLVED] });
    return json({ runs: [RUN], findings: [OPEN] });
  });
}

async function mount() {
  stubApi();
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(<ReconciliationPage />);
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
    expect(el.textContent).toContain('Stripe checkout with no Order');
    expect(el.textContent).toContain('checked 12 · 1 put right · 1 need attention');
    expect(button('Mark resolved')).toBeDefined();

    await click('Resolved');
    expect(calls.at(-1)?.url).toBe('/api/admin/reconciliation?status=resolved');
    expect(el.textContent).toContain('Payment completed, webhook missed');
    expect(el.textContent).toContain('Order 0b3f1c2d');
    expect(button('Mark resolved')).toBeUndefined();
  });

  it('queues a run', async () => {
    await mount();
    await click('Run now');
    expect(calls.at(-1)).toEqual({ url: '/api/admin/reconciliation/run', method: 'POST' });
    expect(el.textContent).toContain('Run queued');
  });

  it('marks a finding resolved and removes it from the list', async () => {
    await mount();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    await click('Mark resolved');
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/reconciliation/findings/f-open/resolve',
      method: 'POST',
    });
    expect(el.textContent).toContain('Nothing needs attention.');
  });
});
