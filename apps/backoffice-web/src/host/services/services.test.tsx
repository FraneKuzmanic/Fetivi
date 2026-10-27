// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OfferTranslations } from '../../admin/providers/OfferTranslations';
import type { HostProvider, Offer, OfferSummary, OfferTranslationsView } from '../../api';
import { ProvidersPage } from './ProvidersPage';
import { NewServicePage } from './ServicePage';
import { ServicesPage } from './ServicesPage';

const TRANSFER: OfferSummary = {
  id: 'o1',
  providerId: null,
  destination: null,
  title: 'Airport transfer',
  category: 'transfer',
  orderKind: 'booking',
  availabilityMode: 'on_request',
  paymentMode: 'direct',
  priceMinor: 4500,
  currency: 'EUR',
  priceUnit: 'group',
  active: true,
  translation: { status: 'published', error: null, revision: 1, publishedRevision: 1 },
};

const MARE: HostProvider = {
  id: 'p1',
  name: 'Mare Boats',
  offerCount: 2,
  destinations: ['Trogir'],
  hidden: false,
};

const PAYMENTS = { stripeConnected: false, stripeCardPayments: null, stripeCheckedAt: null };

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubApi(routes: Record<string, (body: unknown) => Response>) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const handler = routes[`${method} ${url}`];
    return handler ? handler(body) : json({ error: 'not-found' }, 404);
  });
}

async function mount(path: string, element: ReactNode, extra?: ReactNode) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={element} />
          {extra}
        </Routes>
      </MemoryRouter>,
    ),
  );
}

const field = <T extends HTMLElement>(label: string): T => {
  const lab = [...el.querySelectorAll('label')].find((l) => l.textContent === label);
  const input = lab?.htmlFor ? el.querySelector<T>(`#${CSS.escape(lab.htmlFor)}`) : null;
  if (!input) throw new Error(`no field ${label}`);
  return input;
};

const setValue = (
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) =>
  act(async () => {
    const proto = Object.getPrototypeOf(input);
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });

const button = (name: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name));

describe('host services', () => {
  it('lists the services with the card payments line and the Providers link', async () => {
    stubApi({
      'GET /api/host/offers': () => json({ offers: [TRANSFER] }),
      'GET /api/host/payments': () => json(PAYMENTS),
    });
    await mount('/services', <ServicesPage />);
    await vi.waitFor(() => expect(el.textContent).toContain('Airport transfer'));
    expect(el.textContent).toContain('Transfer · On request · €45.00 per group');
    expect(el.querySelector('a[href="/services/o1"]')).not.toBeNull();
    const payments = el.querySelector('a[href="/settings/payments"]');
    expect(payments?.textContent).toContain('Card payments');
    expect(payments?.textContent).toContain('Not connected');
    expect(el.querySelector('a[href="/services/providers"]')).not.toBeNull();
    expect(el.querySelector('.mascot, img')).toBeNull();
  });

  it('creates a service without a destination, and never offers live mode', async () => {
    stubApi({
      'GET /api/host/payments': () => json(PAYMENTS),
      'POST /api/host/offers': () => json({ id: 'o2' }, 201),
    });
    await mount(
      '/services/new',
      <NewServicePage />,
      <Route path="/services/:id" element={<p>editor</p>} />,
    );
    const mode = field<HTMLSelectElement>('Availability');
    expect([...mode.options].map((o) => o.value)).toEqual(['on_request', 'allotment']);
    await setValue(field('Title'), 'Airport transfer');
    await setValue(field('Description'), 'Split airport to your door.');
    await setValue(field('Cancellation policy'), 'Free until a day before.');
    await setValue(field('Price (€)'), '45');
    await act(async () => {
      // happy-dom reads 45 as off the 0.01 step, so the browser's own check is skipped here.
      el.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() => expect(el.textContent).toContain('editor'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/host/offers');
    expect(post?.body).toEqual({
      title: 'Airport transfer',
      description: 'Split airport to your door.',
      cancellationPolicy: 'Free until a day before.',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      category: 'transfer',
      orderKind: 'booking',
      availabilityMode: 'on_request',
      paymentMode: 'direct',
      priceMinor: 4500,
      priceUnit: 'person',
    });
  });

  it('drafts the policy from the cancellation choice until the host writes their own', async () => {
    stubApi({
      'GET /api/host/payments': () => json(PAYMENTS),
      'POST /api/host/offers': () => json({ id: 'o2' }, 201),
    });
    await mount(
      '/services/new',
      <NewServicePage />,
      <Route path="/services/:id" element={<p>editor</p>} />,
    );
    const policy = field<HTMLTextAreaElement>('Cancellation policy');
    expect(policy.value).toBe('Free cancellation until 24 h before the start, then no refund.');
    const free = [...el.querySelectorAll<HTMLLabelElement>('.choice-option')].find((l) =>
      l.textContent?.includes('Free cancellation'),
    );
    await act(async () => free?.querySelector('input')?.click());
    expect(field<HTMLTextAreaElement>('Cancellation policy').value).toBe('Always a full refund.');
    await setValue(field('Title'), 'Olive oil');
    await setValue(field('Description'), 'From our grove.');
    await act(async () => {
      el.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() => expect(el.textContent).toContain('editor'));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      cancellationPolicy: 'Always a full refund.',
      freeCancelHoursBefore: 0,
      refundPercentAfter: 100,
    });
  });

  it('hides a Provider with one toggle', async () => {
    stubApi({
      'GET /api/host/providers': () =>
        json({ providers: [MARE], destinations: [{ id: 'd1', name: 'Trogir' }] }),
      'PUT /api/host/providers/p1/hidden': () => json({ ...MARE, hidden: true }),
    });
    await mount('/services/providers', <ProvidersPage />);
    await vi.waitFor(() => expect(el.textContent).toContain('Mare Boats'));
    expect(el.textContent).toContain('Trogir · 2 offers');
    expect(el.textContent).toContain('Shown');
    const toggle = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => toggle?.click());
    await vi.waitFor(() => expect(el.querySelector('.chip')?.textContent).toBe('Hidden'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ hidden: true });
  });

  it('sends a suggestion and thanks the host', async () => {
    stubApi({
      'GET /api/host/providers': () =>
        json({ providers: [], destinations: [{ id: 'd1', name: 'Trogir' }] }),
      'POST /api/host/provider-suggestions': () => json({ id: 'c1' }, 201),
    });
    await mount('/services/providers', <ProvidersPage />);
    await vi.waitFor(() => expect(el.textContent).toContain('No approved Providers'));
    // One destination: no area to choose.
    expect(el.querySelector('select')).toBeNull();
    await setValue(field('Name'), 'Konoba Bura');
    await setValue(field('Contact'), '+385 91 000 0000');
    await act(async () => button('Send suggestion')?.click());
    await vi.waitFor(() =>
      expect(el.textContent).toContain('Thanks — the Fetivi team will review it.'),
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Konoba Bura',
      contact: '+385 91 000 0000',
      note: null,
      destinationId: 'd1',
    });
  });

  it('calls an unpublished service a service in its translations', async () => {
    const view: OfferTranslationsView = {
      offerId: 'o1',
      revision: 1,
      publishedRevision: null,
      status: 'pending',
      error: null,
      sourceLanguage: 'en',
      languages: [],
    };
    const client = { translations: async () => view, retryTranslation: async () => ({ view }) };
    const offer = { id: 'o1', translation: TRANSFER.translation } as Offer;
    await mount(
      '/services/o1',
      <OfferTranslations offer={offer} client={client} onChanged={async () => {}} noun="service" />,
    );
    await vi.waitFor(() =>
      expect(el.textContent).toContain("Guests don't see this service until it is translated."),
    );
  });
});
