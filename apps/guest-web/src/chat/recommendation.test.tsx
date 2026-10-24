// @vitest-environment happy-dom
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { SpaceProvider } from '../space';
import { ChatView } from './ChatTab';

const card = (id: string, title: string) => ({
  id,
  kind: 'place',
  category: 'restaurant',
  title,
  summary: `${title} serves grilled fish.`,
  location: { lat: 43.517, lng: 16.251 },
  distanceKm: 0.4,
  travelMinutes: null,
  image: null,
  verifiedAt: null,
  staleness: { status: 'fresh' },
});
const PLACES = [card('p1', 'Konoba Mala'), card('p2', 'Konoba Velika')];

/** The chunk sequence the chat backend streams for this turn (see chat.int.test.ts). */
const turnResponse = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: 'start', messageId: 'a1' });
        writer.write({
          type: 'tool-input-available',
          toolCallId: 'call-search_places',
          toolName: 'search_places',
          input: { category: 'restaurant' },
        });
        writer.write({
          type: 'tool-output-available',
          toolCallId: 'call-search_places',
          output: { results: PLACES },
        });
        writer.write({
          type: 'data-component',
          id: 'call-search_places',
          data: { name: 'place-carousel', payload: { places: PLACES } },
        });
        writer.write({ type: 'text-start', id: 't1' });
        writer.write({ type: 'text-delta', id: 't1', delta: 'Try Konoba Mala tonight.' });
        writer.write({ type: 'text-end', id: 't1' });
        writer.write({
          type: 'data-component',
          id: 'call-suggest_replies',
          data: {
            name: 'follow-up-chips',
            payload: { replies: ['Show me on a map', 'Something cheaper'] },
          },
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
    if (url.startsWith('/api/saved-places/')) return json({ placeIds: ['p1'] });
    if (url === '/api/chat' && method === 'POST') return turnResponse();
    return new Response(null, { status: 404 });
  });
}

const buttonNamed = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text);

describe('"where should we eat tonight" in the guest app', () => {
  it('sends the question, renders the carousel and chips, and a chip or Save acts', async () => {
    stubBackend();
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
            <ChatView initial={[]} />
          </SpaceProvider>
        </MemoryRouter>,
      ),
    );

    const input = host.querySelector<HTMLTextAreaElement>('#chat-input');
    if (!input) throw new Error('no composer');
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setValue?.call(input, 'Where should we eat tonight?');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.form?.requestSubmit();
    });

    await vi.waitFor(() => {
      expect(host.querySelector('.fv-carousel')?.textContent).toContain('Konoba Velika');
      expect(buttonNamed('Show me on a map')).toBeDefined();
    });
    const titles = [...host.querySelectorAll('.fv-carousel h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Konoba Mala', 'Konoba Velika']);
    expect(calls.find((c) => c.url === '/api/chat')?.body).toEqual({
      text: 'Where should we eat tonight?',
    });

    const save = host.querySelector<HTMLButtonElement>('.fv-save');
    await act(async () => save?.click());
    expect(calls).toContainEqual({ url: '/api/saved-places/p1', method: 'PUT', body: undefined });
    await vi.waitFor(() => expect(save?.getAttribute('aria-pressed')).toBe('true'));

    await act(async () => buttonNamed('Show me on a map')?.click());
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.url === '/api/chat').at(-1)?.body).toEqual({
        text: 'Show me on a map',
      }),
    );
    expect(calls.filter((c) => c.url === '/api/chat')).toHaveLength(2);
  });
});
