// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import type { Space } from '../api';
import { ConfirmationPart } from '../chat/render/ConfirmationPart';
import { SpaceProvider } from '../space';
import { EmailOffer } from './EmailOffer';
import { EmailProvider } from './EmailProvider';
import type { EmailState } from './email-api';

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const SPACE: Space = {
  language: 'en',
  closedAt: '2026-10-24T22:00:00.000Z',
  closed: false,
  unitSlug: 'abc',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers GET /api/email with `state` and POST with `saved`; records every call. */
function server(state: EmailState, saved?: EmailState) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === '/api/email' && method === 'GET') return json(state);
      if (url === '/api/email' && method === 'POST') return json(saved ?? state);
      return new Response(null, { status: 204 });
    }),
  );
  return calls;
}

async function mount(node: ReactNode, space: Space = SPACE) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <SpaceProvider initial={{ status: 'ready', space }}>
          <EmailProvider>{node}</EmailProvider>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const NONE: EmailState = { email: null, verified: false, tips: false };

describe('EmailOffer', () => {
  it('is hidden once the Space has an email', async () => {
    server({ email: 'a@example.test', verified: false, tips: false });
    await mount(<EmailOffer />);
    expect(button('Email me updates')).toBeUndefined();
  });

  it('is hidden on a closed Space', async () => {
    server(NONE);
    await mount(<EmailOffer />, { ...SPACE, closed: true });
    expect(button('Email me updates')).toBeUndefined();
  });

  it('opens a form with the tips box unticked and says what the email covers', async () => {
    server(NONE);
    await mount(<EmailOffer />);
    await act(async () => button('Email me updates')?.click());
    const tips = host.querySelector<HTMLInputElement>('input[name="tips"]');
    expect(tips?.checked).toBe(false);
    expect(host.textContent).toContain('booking confirmations');
    expect(host.textContent).toContain('link back to your chat on another phone');
    expect(document.activeElement).toBe(host.querySelector('input[name="email"]'));
  });

  it('saves the email with tips false and says to check the inbox', async () => {
    const calls = server(NONE, { email: 'ana@example.test', verified: false, tips: false });
    await mount(<EmailOffer />);
    await act(async () => button('Email me updates')?.click());
    type(host.querySelector('input[name="email"]') as HTMLInputElement, ' ana@example.test ');
    await act(async () => button('Save')?.click());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      email: 'ana@example.test',
      tips: false,
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Check your inbox: I sent a link to confirm ana@example.test.',
    );
  });

  it('refuses an invalid email without calling the server', async () => {
    const calls = server(NONE);
    await mount(<EmailOffer />);
    await act(async () => button('Email me updates')?.click());
    type(host.querySelector('input[name="email"]') as HTMLInputElement, 'nope');
    await act(async () => button('Save')?.click());
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(host.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('the booking card', () => {
  const DRAFT = {
    pendingId: 'p-1',
    offerId: 'o-1',
    offerTitle: 'Blue Lagoon boat trip',
    language: 'en',
    date: '2026-10-22',
    slotId: 's-1',
    startsAt: '2026-10-22T07:00:00.000Z',
    startsAtLocal: '2026-10-22T09:00',
    quantity: 2,
    priceMinor: 9000,
    currency: 'EUR',
    priceUnit: 'person',
    paymentMode: 'direct',
    availabilityMode: 'allotment',
    cancellationPolicy: 'Free cancellation up to 24 hours before.',
    contactFields: 'name',
  };
  const card = {
    toolCallId: 'call-order',
    toolName: 'create_order',
    key: 'confirm',
    message: 'Book?',
    requestedSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string', format: 'email' } },
      required: ['email', 'name'],
    },
    requestState: 'sealed.state',
    draft: DRAFT,
  };

  it('starts with the email the Space already gave, still editable', async () => {
    server({ email: 'ana@example.test', verified: true, tips: false });
    await mount(<ConfirmationPart data={card} state="open" onAnswer={() => {}} />);
    const email = host.querySelector<HTMLInputElement>('input[name="email"]');
    expect(email?.value).toBe('ana@example.test');
    expect(email?.readOnly).toBe(false);
  });
});
