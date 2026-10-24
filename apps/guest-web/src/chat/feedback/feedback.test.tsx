// @vitest-environment happy-dom
import type { UIMessage } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { SpaceProvider } from '../../space';
import { ChatView } from '../ChatTab';
import { AnswerFeedback } from './AnswerFeedback';
import type { AnswerRating } from './feedback-api';

const SPACE = {
  status: 'ready' as const,
  space: {
    language: 'en' as const,
    closedAt: '2099-01-01T00:00:00.000Z',
    closed: false,
    unitSlug: 'qrabc',
  },
};

const view = (initial: UIMessage[], feedback: Record<string, AnswerRating> = {}) => (
  <MemoryRouter>
    <SpaceProvider initial={SPACE}>
      <ChatView initial={initial} feedback={feedback} />
    </SpaceProvider>
  </MemoryRouter>
);

const answer: UIMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Any beaches nearby?' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Try Pantan beach.' }] },
];

const thumbs = (out: string) => [...out.matchAll(/class="answer-feedback-thumb"/g)].length;

describe('answer feedback in the chat', () => {
  it('shows unpressed thumbs under a finished answer only', () => {
    const out = renderToString(view(answer));
    expect(thumbs(out)).toBe(2);
    expect(out).toContain('aria-pressed="false" aria-label="Helpful"');
    expect(out).toContain('aria-pressed="false" aria-label="Not helpful"');
    expect(out).not.toContain('What was off?');
  });

  it('shows nothing under an assistant message without text', () => {
    const out = renderToString(
      view([
        answer[0] as UIMessage,
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'step-start' }, { type: 'text', text: ' ' }],
        },
      ]),
    );
    expect(thumbs(out)).toBe(0);
  });

  it('shows a stored thumbs down with its reason pressed', () => {
    const out = renderToString(view(answer, { a1: { thumb: 'down', reason: 'outdated' } }));
    expect(out).toContain('aria-pressed="true" aria-label="Not helpful"');
    expect(out).toContain('What was off?');
    expect(out).toMatch(/aria-pressed="true"[^>]*>Outdated</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Wrong</);
  });
});

describe('AnswerFeedback taps', () => {
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

  const stub = (ok: boolean) =>
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(input), method: init?.method ?? 'GET', body });
      return ok
        ? new Response(JSON.stringify({ feedback: body }), {
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ error: 'internal' }), { status: 500 });
    });

  const mount = async (initial?: AnswerRating) => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<AnswerFeedback messageId="a/1" initial={initial} />));
  };

  const button = (name: string) => {
    const el = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === name || b.textContent === name,
    );
    if (!el) throw new Error(`no ${name} button`);
    return el;
  };
  const tap = (name: string) => act(async () => button(name).click());

  it('saves a thumbs down, then the reason, and thanks the guest', async () => {
    stub(true);
    await mount();
    await tap('Not helpful');
    await tap('Outdated');
    expect(calls).toEqual([
      {
        url: '/api/chat/messages/a%2F1/feedback',
        method: 'PUT',
        body: { thumb: 'down', reason: null },
      },
      {
        url: '/api/chat/messages/a%2F1/feedback',
        method: 'PUT',
        body: { thumb: 'down', reason: 'outdated' },
      },
    ]);
    expect(button('Outdated').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Thanks, that helps me get better.',
    );
  });

  it('clears the rating when the pressed thumb is tapped again', async () => {
    stub(true);
    await mount({ thumb: 'up', reason: null });
    await tap('Helpful');
    expect(calls.map((c) => c.body)).toEqual([{ thumb: null, reason: null }]);
    expect(button('Helpful').getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('puts the previous rating back and says so when the save fails', async () => {
    stub(false);
    await mount({ thumb: 'up', reason: null });
    await tap('Not helpful');
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(
        "That didn't save. Try again?",
      ),
    );
    expect(button('Helpful').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.answer-feedback-reasons')).toBeNull();
  });
});
