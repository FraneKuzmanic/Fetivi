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

const CANCEL = {
  pendingId: 'p-1',
  orderId: 'f2b1c3d4-0000-4000-8000-000000000001',
  proposalId: 'f2b1c3d4-0000-4000-8000-000000000002',
  offerTitle: 'Blue Lagoon boat trip',
  language: 'en',
  date: '2026-10-22',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  paymentMode: 'online',
  paymentStatus: 'captured',
  priceMinor: 9000,
  currency: 'EUR',
  cancellationPolicy: 'Free cancellation up to 24 hours before the start, then 50 % back.',
  refundMinor: 4500,
  refundPercent: 50,
  freeUntil: '2026-10-21T07:00:00.000Z',
  freeUntilLocal: '2026-10-21T09:00',
};
const CANCELLED = {
  id: CANCEL.orderId,
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  status: 'cancelled',
  paymentStatus: 'refund_pending',
  paymentMode: 'online',
  date: '2026-10-22',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-20T10:00:00.000Z',
  payBy: null,
  refundMinor: 4500,
};

/** The stored history: the answer paused on cancel_order with its card. */
const paused = (): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Cancel my boat trip' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'text', text: 'Here is what cancelling gives back.' },
      {
        type: 'tool-cancel_order',
        toolCallId: 'call-cancel',
        state: 'input-available',
        input: { orderId: CANCEL.orderId },
      },
      {
        type: 'data-elicitation',
        id: 'call-cancel',
        data: {
          toolCallId: 'call-cancel',
          toolName: 'cancel_order',
          key: 'confirm',
          message: 'Cancel Blue Lagoon boat trip?',
          requestedSchema: { type: 'object', properties: {} },
          requestState: 'sealed.state',
          draft: null,
          hostMessage: null,
          cancelOrder: CANCEL,
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
          toolCallId: 'call-cancel',
          output: { outcome: 'cancelled', order: CANCELLED },
        });
        writer.write({
          type: 'data-component',
          id: 'call-cancel',
          data: { name: 'receipt-card', payload: { order: CANCELLED } },
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

describe('cancel card in the guest app', () => {
  it('shows the refund and the policy, cancels on the tap and the receipt shows the refund', async () => {
    stubBackend();
    await mount(paused());
    const card = host.querySelector('.fv-cancel');
    expect(card?.querySelector('.fv-cancel-amount')?.textContent).toBe(
      'You get back €45.00 (50 %)',
    );
    expect(card?.textContent).toContain(CANCEL.cancellationPolicy);

    await act(async () => button('Cancel booking').click());
    await vi.waitFor(() => {
      expect(host.querySelector('.fv-receipt')?.textContent).toContain(
        'Refund on its way · €45.00',
      );
    });
    expect(host.querySelector('.fv-cancel')).toBeNull();
    expect(chatPosts().map((c) => c.body)).toEqual([
      { answer: { toolCallId: 'call-cancel', action: 'accept', content: {} } },
    ]);
  });

  it('keeps the booking on Keep it', async () => {
    stubBackend();
    await mount(paused());
    await act(async () => button('Keep it').click());
    await vi.waitFor(() => expect(chatPosts()).toHaveLength(1));
    expect(chatPosts()[0]?.body).toEqual({
      answer: { toolCallId: 'call-cancel', action: 'cancel' },
    });
  });
});
