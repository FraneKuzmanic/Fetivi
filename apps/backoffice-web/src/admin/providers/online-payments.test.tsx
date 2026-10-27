// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Provider, providers } from '../../api';
import { OnlinePaymentsPanel } from './OnlinePaymentsPanel';

const PROVIDER: Provider = {
  id: 'p1',
  name: 'Mare Boats',
  email: 'bookings@mare.example',
  whatsappPhone: null,
  language: 'hr',
  taxNumber: null,
  commissionBp: 1250,
  dealNotes: null,
  stripeConnected: false,
  stripeCardPayments: null,
  stripeCheckedAt: null,
  active: true,
  offerCount: 0,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

const LINK = 'https://connect.stripe.com/setup/e/acct_x/abc';

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string }[] = [];
let changed: Provider[] = [];

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
    if (url.endsWith('/stripe/onboarding-link')) {
      return json({ url: LINK, expiresAt: '2026-10-23T10:05:00Z' });
    }
    if (url.endsWith('/stripe/refresh')) {
      return json({ ...PROVIDER, stripeConnected: true, stripeCardPayments: 'active' });
    }
    return json({ error: 'not-found' }, 404);
  });
}

async function mount(provider: Provider, path = '/admin/providers/p1') {
  stubApi();
  changed = [];
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <OnlinePaymentsPanel
          status={provider}
          onLink={() => providers.stripeOnboardingLink(provider.id)}
          onRefresh={() => providers.stripeRefresh(provider.id)}
          onChange={(p) => changed.push(p)}
        />
      </MemoryRouter>,
    );
  });
}

const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));

describe('OnlinePaymentsPanel', () => {
  it('shows each card status', async () => {
    await mount(PROVIDER);
    expect(el.textContent).toContain('Not set up');
    expect(button('Refresh status')).toBeUndefined();
    act(() => root?.unmount());
    await mount({ ...PROVIDER, stripeConnected: true, stripeCardPayments: 'pending' });
    expect(el.textContent).toContain('Waiting for the Provider to finish Stripe onboarding.');
    expect(button('Refresh status')).toBeDefined();
    act(() => root?.unmount());
    await mount({
      ...PROVIDER,
      stripeConnected: true,
      stripeCardPayments: 'active',
      stripeCheckedAt: '2026-10-23T09:00:00Z',
    });
    expect(el.textContent).toContain('Can take card payments.');
    expect(el.textContent).toContain('Last checked');
    expect(calls).toEqual([]);
  });

  it('creates a link to copy or open', async () => {
    await mount(PROVIDER);
    await act(async () => button('Create onboarding link')?.click());
    expect(calls).toEqual([
      { url: '/api/admin/providers/p1/stripe/onboarding-link', method: 'POST' },
    ]);
    const input = el.querySelector<HTMLInputElement>('#onboarding-link');
    expect(input?.value).toBe(LINK);
    expect(input?.readOnly).toBe(true);
    expect(el.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(LINK);

    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await act(async () => button('Copy')?.click());
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(el.textContent).toContain('Copied');
  });

  it('refreshes once on the return from Stripe', async () => {
    await mount({ ...PROVIDER, stripeConnected: true }, '/admin/providers/p1?stripe=return');
    expect(calls).toEqual([{ url: '/api/admin/providers/p1/stripe/refresh', method: 'POST' }]);
    expect(changed.map((p) => p.stripeCardPayments)).toEqual(['active']);
  });
});
