// @vitest-environment happy-dom
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { InboxProvider } from '../inbox/InboxProvider';
import { Shell } from '../shell/Shell';
import { SpaceProvider } from '../space';
import { ChatTab, ChatView } from './ChatTab';

const HOST_DRAFT = {
  pendingId: 'p-1',
  messageId: 'm-1',
  text: 'The shower has no hot water.',
  reason: 'problem',
  urgency: 'urgent',
  language: 'en',
};
const SENT = {
  id: 'm-1',
  text: 'No hot water since 8.',
  urgency: 'urgent',
  sentAt: '2026-10-22T12:05:00.000Z',
};

/** The stored history: the answer paused on send_host_message with its card. */
const paused = (): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'The shower has no hot water' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      { type: 'text', text: 'I can tell your host.' },
      {
        type: 'tool-send_host_message',
        toolCallId: 'call-send',
        state: 'input-available',
        input: { message: HOST_DRAFT.text, reason: 'problem', urgency: 'urgent' },
      },
      {
        type: 'data-elicitation',
        id: 'call-send',
        data: {
          toolCallId: 'call-send',
          toolName: 'send_host_message',
          key: 'confirm',
          message: 'Send this message to your host?',
          requestedSchema: {
            type: 'object',
            properties: { message: { type: 'string', maxLength: 1000, default: HOST_DRAFT.text } },
            required: ['message'],
          },
          requestState: 'sealed.state',
          draft: null,
          hostMessage: HOST_DRAFT,
        },
      },
    ] as UIMessage['parts'],
  },
];

/** A host reply as the history returns it: its own message, after the guest's. */
const reply = (id: string): UIMessage => ({
  id,
  role: 'assistant',
  parts: [
    {
      type: 'data-inbox',
      id: 'm-1',
      data: {
        kind: 'host-reply',
        handoffId: 'm-1',
        text: 'A plumber comes at 4 pm.',
        original: 'Majstor dolazi u 16h.',
        repliedAt: '2026-10-22T13:00:00.000Z',
      },
    },
  ] as UIMessage['parts'],
});

const resumeResponse = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: 'a1' });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'call-send',
          output: { outcome: 'sent', message: SENT },
        });
        writer.write({
          type: 'data-component',
          id: 'call-send',
          data: { name: 'host-message-sent', payload: { message: SENT } },
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

function stubBackend(opts: { history?: () => UIMessage[]; read?: boolean; unread?: number } = {}) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/saved-places') return json({ placeIds: [] });
    if (url === '/api/inbox') {
      return json({
        unread: opts.unread ?? 0,
        handoffs: [{ id: 'm-1', status: opts.read ? 'read' : 'sent' }],
      });
    }
    if (url === '/api/inbox/seen') return new Response(null, { status: 204 });
    if (url === '/api/chat' && method === 'POST') return resumeResponse();
    if (url === '/api/chat') return json({ messages: opts.history?.() ?? [] });
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
              keepForEvaluation: false,
            },
          }}
        >
          <InboxProvider>
            {initial === 'tab' ? <ChatTab /> : <ChatView initial={initial} />}
          </InboxProvider>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const area = () => {
  const el = host.querySelector<HTMLTextAreaElement>('.fv-host-draft textarea');
  if (!el) throw new Error('no host message field');
  return el;
};
const type = (el: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const chatPosts = () => calls.filter((c) => c.url === '/api/chat' && c.method === 'POST');

describe('host message in the guest app', () => {
  it('shows the stored draft editable, sends the edited text and then shows Sent', async () => {
    stubBackend();
    await mount(paused());
    expect(area().value).toBe(HOST_DRAFT.text);
    expect(host.querySelector('.fv-host-draft')?.textContent).toContain('Marked urgent');

    await type(area(), 'No hot water since 8.');
    await act(async () => {
      area().form?.requestSubmit();
    });

    await vi.waitFor(() => {
      expect(host.querySelector('.fv-host-sent')?.textContent).toContain('No hot water since 8.');
    });
    expect(host.querySelector('.fv-host-draft')).toBeNull();
    expect(host.querySelector('.fv-host-sent')?.textContent).toContain('Sent ·');
    expect(chatPosts().map((c) => c.body)).toEqual([
      {
        answer: {
          toolCallId: 'call-send',
          action: 'accept',
          content: { message: 'No hot water since 8.' },
        },
      },
    ]);
  });

  it('shows Read once the host opened it', async () => {
    stubBackend({ read: true });
    const sent: UIMessage[] = [
      paused()[0] as UIMessage,
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'data-component',
            id: 'call-send',
            data: { name: 'host-message-sent', payload: { message: SENT } },
          },
        ] as UIMessage['parts'],
      },
    ];
    await mount(sent);
    await vi.waitFor(() => {
      expect(host.querySelector('.fv-host-sent-status')?.textContent).toContain('Read');
    });
    expect(host.textContent?.toLowerCase()).not.toContain('seen');
  });

  it('shows the host reply in its own bubble with the original, and marks the chat seen', async () => {
    stubBackend({ history: () => [...paused(), reply('r1')], unread: 1 });
    await mount('tab');
    await vi.waitFor(() => {
      expect(host.querySelector('.bubble.host')?.textContent).toContain('A plumber comes at 4 pm.');
    });
    const bubble = host.querySelector('.bubble.host');
    expect(bubble?.textContent).toContain('From your host');
    expect(bubble?.querySelector('details summary')?.textContent).toContain('Show original');
    expect(bubble?.querySelector('details p')?.textContent).toBe('Majstor dolazi u 16h.');
    // No mascot on the host's bubble.
    expect(host.querySelector('.host-row .avatar')).toBeNull();
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url === '/api/inbox/seen' && c.method === 'POST')).toBe(true),
    );

    // The reply arrived after the open card: the card is still the newest answer and works.
    await type(area(), 'Thanks, still no water.');
    await act(async () => {
      area().form?.requestSubmit();
    });
    await vi.waitFor(() => expect(chatPosts()).toHaveLength(1));
    expect(chatPosts()[0]?.body).toMatchObject({
      answer: { toolCallId: 'call-send', action: 'accept' },
    });
  });
});

describe('Chat badge', () => {
  it('shows the inbox unread count on the Chat tab', async () => {
    stubBackend({ unread: 2 });
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
            <Shell>
              <p>page</p>
            </Shell>
          </SpaceProvider>
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(() => expect(host.querySelector('.tabbar .badge')?.textContent).toBe('2'));
    expect(host.querySelector('.tabbar')?.textContent).toContain('2 unread');
  });
});
