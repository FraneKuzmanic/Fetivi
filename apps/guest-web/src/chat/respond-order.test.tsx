// @vitest-environment happy-dom
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { InboxProvider } from '../inbox/InboxProvider';
import { SpaceProvider } from '../space';
import { ChatView } from './ChatTab';

const RESPOND = {
  pendingId: 'p-1',
  orderId: 'f2b1c3d4-0000-4000-8000-000000000001',
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000003',
  offerTitle: 'Private boat trip',
  language: 'en',
  proposer: 'provider_time',
  date: '2026-10-22',
  startsAtLocal: '2026-10-22T17:30',
  quantity: 2,
  priceMinor: 24000,
  currency: 'EUR',
  previous: { date: '2026-10-22', startsAtLocal: null, priceMinor: 24000 },
  paymentMode: 'direct',
  cancellationPolicy: 'Free cancellation until 24 hours before.',
  respondBy: '2026-10-21T08:00:00.000Z',
  respondByLocal: '2026-10-21T10:00',
  cancellation: {
    freeCancelHoursBefore: 24,
    lateChargePercent: 50,
    freeUntil: '2026-10-21T07:00:00.000Z',
    freeUntilLocal: '2026-10-21T09:00',
    freeWindowPassed: false,
  },
};
const CONFIRMED = {
  id: RESPOND.orderId,
  offerId: 'o-1',
  offerTitle: 'Private boat trip',
  status: 'confirmed',
  paymentStatus: 'none',
  paymentMode: 'direct',
  date: '2026-10-22',
  startsAt: '2026-10-22T15:30:00.000Z',
  startsAtLocal: '2026-10-22T17:30',
  quantity: 2,
  priceMinor: 24000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-20T10:00:00.000Z',
  payBy: null,
  refundMinor: null,
  respondBy: null,
};

/** The stored history: the answer paused on respond_to_order_update with its card. */
const paused = (): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Did the boat trip get a new time?' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'text', text: 'The provider suggested 17:30 instead.' },
      {
        type: 'tool-respond_to_order_update',
        toolCallId: 'call-respond',
        state: 'input-available',
        input: { orderId: RESPOND.orderId },
      },
      {
        type: 'data-elicitation',
        id: 'call-respond',
        data: {
          toolCallId: 'call-respond',
          toolName: 'respond_to_order_update',
          key: 'confirm',
          message: 'New terms for Private boat trip',
          requestedSchema: {
            type: 'object',
            properties: { answer: { type: 'string', enum: ['accept', 'decline'] } },
            required: ['answer'],
          },
          requestState: 'sealed.state',
          draft: null,
          hostMessage: null,
          cancelOrder: null,
          respondOrder: RESPOND,
        },
      },
    ] as UIMessage['parts'],
  },
];

const resumeResponse = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: 'a1' });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'call-respond',
          output: { outcome: 'accepted', order: CONFIRMED },
        });
        writer.write({
          type: 'data-component',
          id: 'call-respond',
          data: { name: 'receipt-card', payload: { order: CONFIRMED } },
        });
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubBackend() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/saved-places') return json({ placeIds: [] });
    if (url === '/api/inbox') return json({ unread: 0, handoffs: [] });
    if (url === '/api/chat' && method === 'POST') return resumeResponse();
    return new Response(null, { status: 404 });
  });
}

async function mount(initial: UIMessage[]) {
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
              keepForEvaluation: false,
            },
          }}
        >
          <InboxProvider>
            <ChatView initial={initial} />
          </InboxProvider>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
const chatPosts = () => calls.filter((c) => c.url === '/api/chat' && c.method === 'POST');

describe('new-terms card in the guest app', () => {
  it('shows the new time against the old, accepts on the tap and shows the receipt', async () => {
    stubBackend();
    await mount(paused());
    const card = host.querySelector('.fv-respond');
    expect(card?.querySelector('h3')?.textContent).toBe('The provider suggests another time');
    expect(card?.querySelector('ins')?.textContent).toContain('5:30');
    expect(card?.textContent).toContain('You pay the provider directly.');
    expect(card?.textContent).toContain('the provider may ask you to pay 50 % of the price');
    expect(card?.textContent).not.toMatch(/refund/i);

    await act(async () => button('Accept').click());
    await vi.waitFor(() => expect(host.querySelector('.fv-receipt')).not.toBeNull());
    expect(host.querySelector('.fv-respond')).toBeNull();
    expect(chatPosts().map((c) => c.body)).toEqual([
      { answer: { toolCallId: 'call-respond', action: 'accept', content: { answer: 'accept' } } },
    ]);
  });

  it('declines only after the second tap, and Not now answers nothing', async () => {
    stubBackend();
    await mount(paused());
    await act(async () => button('Decline').click());
    expect(chatPosts()).toHaveLength(0);
    await act(async () => button('Yes, decline').click());
    await vi.waitFor(() => expect(chatPosts()).toHaveLength(1));
    expect(chatPosts()[0]?.body).toEqual({
      answer: { toolCallId: 'call-respond', action: 'accept', content: { answer: 'decline' } },
    });
  });

  it('leaves the order waiting on Not now', async () => {
    stubBackend();
    await mount(paused());
    await act(async () => button('Not now').click());
    await vi.waitFor(() => expect(chatPosts()).toHaveLength(1));
    expect(chatPosts()[0]?.body).toEqual({
      answer: { toolCallId: 'call-respond', action: 'cancel' },
    });
  });
});
