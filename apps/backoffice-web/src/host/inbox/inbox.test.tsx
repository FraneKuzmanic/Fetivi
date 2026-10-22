// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostMessage } from '../../api';
import { InboxPage } from './InboxPage';

const URGENT: HostMessage = {
  id: 'h1',
  unitName: 'Apartment 1',
  propertyName: 'Villa Mare',
  checkIn: '2026-10-24',
  checkout: '2026-10-27',
  bookerName: 'Anna Schmidt',
  guestLanguage: 'de',
  hostLanguage: 'en',
  reason: 'problem',
  urgency: 'urgent',
  text: 'Kein warmes Wasser in der Dusche.',
  translation: 'No hot water in the shower.',
  translationState: 'done',
  sentAt: '2026-10-25T08:05:00.000Z',
  readAt: null,
  reply: null,
};

const READ: HostMessage = {
  ...URGENT,
  id: 'h2',
  urgency: 'normal',
  reason: 'property_question',
  text: 'Is there a hair dryer?',
  translation: null,
  translationState: 'not_needed',
  guestLanguage: 'en',
  readAt: '2026-10-24T10:00:00.000Z',
  reply: {
    text: 'Yes, in the bathroom drawer.',
    repliedAt: '2026-10-24T10:05:00.000Z',
    translationState: 'not_needed',
    deliveredAt: '2026-10-24T10:05:00.000Z',
  },
};

let root: Root | null = null;
let host: HTMLElement;
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

function stubApi(messages: HostMessage[], reply?: () => Response) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === '/api/host/inbox') return json({ messages, unread: 1 });
    if (url.endsWith('/read')) return new Response(null, { status: 204 });
    if (url.endsWith('/reply') && reply) return reply();
    return json({ error: 'not-found' }, 404);
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    ),
  );
}

const rows = () => [...host.querySelectorAll<HTMLButtonElement>('.inbox-row')];
const textarea = () => {
  const el = host.querySelector('textarea');
  if (!el) throw new Error('no reply field');
  return el;
};
const type = (el: HTMLTextAreaElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('host inbox', () => {
  it('lists messages with urgency and state, the translation first', async () => {
    stubApi([URGENT, READ]);
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    const [first, second] = rows();
    expect(first?.textContent).toContain('No hot water in the shower.');
    expect(first?.textContent).toContain('Urgent');
    expect(first?.textContent).toContain('New');
    expect(first?.dataset.unread).toBe('true');
    expect(second?.textContent).toContain('Replied');
    expect(second?.dataset.unread).toBeUndefined();
  });

  it('opening a message marks it read once and shows the original on request', async () => {
    stubApi([URGENT]);
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await act(async () => rows()[0]?.click());
    expect(calls.filter((c) => c.url === '/api/host/inbox/h1/read')).toHaveLength(1);
    const detail = host.querySelector('.inbox-detail');
    expect(detail?.textContent).toContain('No hot water in the shower.');
    expect(detail?.textContent).toContain('Translated from German');
    expect(rows()[0]?.textContent).toContain('Read');
    const toggle = [...(detail?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Show original',
    );
    await act(async () => toggle?.click());
    expect(detail?.textContent).toContain('Kein warmes Wasser in der Dusche.');
  });

  it('sends a reply and shows it with its delivery', async () => {
    const replied: HostMessage = {
      ...URGENT,
      readAt: '2026-10-25T09:00:00.000Z',
      reply: {
        text: 'A plumber comes at 16:00.',
        repliedAt: '2026-10-25T09:00:00.000Z',
        translationState: 'pending',
        deliveredAt: null,
      },
    };
    stubApi([URGENT], () => json({ message: replied }));
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await type(textarea(), 'A plumber comes at 16:00.');
    await act(async () => {
      textarea().form?.requestSubmit();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('.inbox-detail')?.textContent).toContain(
        'Translating for the guest…',
      ),
    );
    expect(calls.find((c) => c.url === '/api/host/inbox/h1/reply')?.body).toEqual({
      text: 'A plumber comes at 16:00.',
    });
    expect(host.querySelector('textarea')).toBeNull();
    expect(rows()[0]?.textContent).toContain('Replied');
  });

  it('says so when the message was already answered', async () => {
    stubApi([URGENT], () => json({ error: 'already-replied' }, 409));
    await mount();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => rows()[0]?.click());
    await type(textarea(), 'Hello');
    await act(async () => {
      textarea().form?.requestSubmit();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        'You already replied to this message.',
      ),
    );
  });

  it('shows a short empty state', async () => {
    stubApi([]);
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain('No guest messages yet.'));
    expect(host.querySelector('.mascot, img')).toBeNull();
  });
});
