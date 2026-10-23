// @vitest-environment happy-dom
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { SpaceProvider } from '../space';
import { ChatTab, ChatView } from './ChatTab';
import { hasGuestAnswer } from './chat-api';

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

const ORDER = {
  id: 'f2b1c3d4-0000-4000-8000-000000000001',
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  status: 'confirmed',
  paymentStatus: 'none',
  paymentMode: 'direct',
  date: '2026-10-22',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-21T10:00:00.000Z',
};

/** The stored history: the guest asked, and the answer paused on create_order with its card. */
const paused = (): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Book the boat trip for two' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-create_order',
        toolCallId: 'call-order',
        state: 'input-available',
        input: { offerId: 'o-1', date: '2026-10-22', quantity: 2 },
      },
      {
        type: 'data-elicitation',
        id: 'call-order',
        data: {
          toolCallId: 'call-order',
          toolName: 'create_order',
          key: 'confirm',
          message: 'Book Blue Lagoon boat trip?',
          requestedSchema: {
            type: 'object',
            // Stored as jsonb, which sorts keys: name comes back before email.
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
            required: ['email', 'name'],
          },
          requestState: 'sealed.state',
          draft: DRAFT,
        },
      },
    ] as UIMessage['parts'],
  },
];

/** The stored history once the tap went through: the receipt and the words, no card. */
const answered = (): UIMessage[] => [
  paused()[0] as UIMessage,
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-create_order',
        toolCallId: 'call-order',
        state: 'output-available',
        input: { offerId: 'o-1', date: '2026-10-22', quantity: 2 },
        output: { outcome: 'ordered', order: ORDER },
      },
      {
        type: 'data-component',
        id: 'call-order',
        data: { name: 'receipt-card', payload: { order: ORDER } },
      },
      { type: 'text', text: 'Your boat trip is booked.' },
    ] as UIMessage['parts'],
  },
];

/** What the backend streams after the tap: the same message continues with the Order. */
const resumeResponse = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: 'a1' });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'call-order',
          output: { outcome: 'ordered', order: ORDER },
        });
        writer.write({
          type: 'data-component',
          id: 'call-order',
          data: { name: 'receipt-card', payload: { order: ORDER } },
        });
        writer.write({ type: 'start-step' });
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: 'Your boat trip is booked.' });
        writer.write({ type: 'text-end', id: 't1' });
        writer.write({ type: 'finish-step' });
        writer.write({ type: 'finish' });
      },
    }),
  });

const calls: { url: string; method: string; body: unknown }[] = [];
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
  calls.length = 0;
});

function stubBackend(chat: () => Response, ...histories: (() => UIMessage[])[]) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/saved-places') {
      return new Response(JSON.stringify({ placeIds: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/chat' && method === 'POST') return chat();
    if (url.endsWith('/checkout') && method === 'POST') {
      return new Response(JSON.stringify({ state: 'closed' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === '/api/chat') {
      const messages = (histories.length > 1 ? histories.shift() : histories[0])?.() ?? [];
      return new Response(JSON.stringify({ messages }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 404 });
  });
}

async function mount(initial: UIMessage[] | 'tab') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <SpaceProvider
          initial={{
            status: 'ready',
            space: {
              language: 'en',
              closedAt: '2099-01-01T00:00:00.000Z',
              closed: false,
              unitSlug: 'qrabc',
            },
          }}
        >
          {initial === 'tab' ? <ChatTab /> : <ChatView initial={initial} />}
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const input = (name: string) => {
  const el = host.querySelector<HTMLInputElement>(`.fv-confirm input[name="${name}"]`);
  if (!el) throw new Error(`no input ${name}`);
  return el;
};
const type = (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const chatPosts = () => calls.filter((c) => c.url === '/api/chat' && c.method === 'POST');

describe('booking confirmation in the guest app', () => {
  it('fills the card by keyboard, sends only the answer and shows the receipt', async () => {
    stubBackend(resumeResponse);
    await mount(paused());

    const card = host.querySelector('.fv-confirm');
    expect(card?.textContent).toContain('Blue Lagoon boat trip');
    expect(card?.textContent).toContain('Free cancellation up to 24 hours before.');
    expect(card?.textContent).toContain('People2');
    // The card's own order, whatever order the stored schema's keys come back in.
    const names = [...host.querySelectorAll('.fv-confirm input')].map((i) =>
      i.getAttribute('name'),
    );
    expect(names).toEqual(['email', 'name']);

    await type(input('email'), 'guest@example.test');
    await type(input('name'), 'Ana');
    // Enter in a field submits the form.
    await act(async () => {
      input('name').form?.requestSubmit();
    });

    await vi.waitFor(() => {
      expect(host.querySelector('.fv-receipt')?.textContent).toContain('Confirmed');
      expect(host.textContent).toContain('Your boat trip is booked.');
    });
    expect(host.querySelector('.fv-confirm')).toBeNull();
    // Focus does not fall to the page when the card goes: the guest carries on in the composer.
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('chat-input'));
    expect(chatPosts().map((c) => c.body)).toEqual([
      {
        answer: {
          toolCallId: 'call-order',
          action: 'accept',
          content: { email: 'guest@example.test', name: 'Ana' },
        },
      },
    ]);
    // Exactly one request: the reply does not send the tap again.
    await new Promise((r) => setTimeout(r, 20));
    expect(chatPosts()).toHaveLength(1);
  });

  it('a failed answer reloads the chat; the card still open takes another tap', async () => {
    stubBackend(
      () =>
        new Response(JSON.stringify({ error: 'turn-failed' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
      paused,
    );
    await mount('tab');
    await vi.waitFor(() => expect(host.querySelector('.fv-confirm-no')).not.toBeNull());
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('.fv-confirm-no')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('nothing is booked yet');
    });
    expect(chatPosts().map((c) => c.body)).toEqual([
      { answer: { toolCallId: 'call-order', action: 'cancel' } },
    ]);
    // The history was loaded again: once on landing, once after the failure.
    expect(calls.filter((c) => c.url === '/api/chat' && c.method === 'GET')).toHaveLength(2);
    expect(host.textContent).toContain('Book the boat trip for two');
    expect(host.querySelector('.fv-confirm-yes')).not.toBeNull();
    expect(host.querySelector('[role="alert"] button')).toBeNull();
  });

  it('an answer the server already took shows the stored Order, not "tap again"', async () => {
    // The stream broke after the server stored the answer: the next tap gets 409.
    stubBackend(
      () =>
        new Response(JSON.stringify({ error: 'nothing-to-answer' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      paused,
      answered,
    );
    await mount('tab');
    await vi.waitFor(() => expect(host.querySelector('.fv-confirm')).not.toBeNull());
    await type(input('email'), 'guest@example.test');
    await type(input('name'), 'Ana');
    await act(async () => {
      input('name').form?.requestSubmit();
    });
    await vi.waitFor(() => {
      expect(host.querySelector('.fv-receipt')?.textContent).toContain('Confirmed');
    });
    expect(host.querySelector('.fv-confirm')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(chatPosts()).toHaveLength(1);
  });

  it('the availability picker of an answer with a card is read-only', async () => {
    stubBackend(resumeResponse);
    const [user, assistant] = paused() as [UIMessage, UIMessage];
    assistant.parts.push({
      type: 'data-component',
      id: 'call-availability',
      data: {
        name: 'availability-picker',
        payload: {
          offerId: 'o-1',
          date: '2026-10-22',
          quantity: 2,
          starts: [{ slotId: 's-1', startsAtLocal: '2026-10-22T09:00', remaining: 10 }],
        },
      },
    } as UIMessage['parts'][number]);
    await mount([user, assistant]);
    expect(host.querySelector('.fv-confirm')).not.toBeNull();
    expect(host.querySelector('.fv-choice')?.textContent).toContain('Places left: 10');
    expect(host.querySelector('[role="radio"]')).toBeNull();
  });
});

describe('Pay now on a chat receipt', () => {
  it('asks the server, which says the stored receipt is out of date', async () => {
    stubBackend(resumeResponse);
    const online = {
      ...ORDER,
      status: 'confirming',
      paymentMode: 'online',
      payBy: '2026-10-22T06:30:00.000Z',
    };
    const history = answered();
    const part = history[1]?.parts[2] as { data: { payload: { order: unknown } } };
    part.data.payload.order = online;
    await mount(history);
    const pay = [...host.querySelectorAll('.fv-receipt button')].find(
      (b) => b.textContent === 'Pay now',
    );
    expect(host.querySelector('.fv-receipt')?.textContent).toContain('Complete payment by');
    await act(async () => (pay as HTMLButtonElement | undefined)?.click());
    await vi.waitFor(() =>
      expect(host.querySelector('.fv-receipt')?.textContent).toContain(
        'This payment window has closed.',
      ),
    );
    expect(
      calls.some((c) => c.url === `/api/orders/${ORDER.id}/checkout` && c.method === 'POST'),
    ).toBe(true);
  });
});

describe('hasGuestAnswer', () => {
  it('ignores an ordinary answer that ends with a tool call', () => {
    const messages: UIMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        parts: [
          {
            type: 'tool-suggest_replies',
            toolCallId: 'c',
            state: 'output-available',
            input: {},
            output: { shown: true },
          },
        ] as UIMessage['parts'],
      },
    ];
    expect(hasGuestAnswer({ messages })).toBe(false);
  });
});
