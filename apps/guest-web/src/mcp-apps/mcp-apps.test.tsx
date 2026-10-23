// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import type { UIMessage } from 'ai';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import { MessageList } from '../chat/MessageList';
import { SANDBOX_URL } from './sandbox';

const PICKER = 'ui://widgets/ferry-trips-picker.html';
const CSP = { connectDomains: ['https://www.ferryhopper.com'] };

const answer = (data: unknown): UIMessage[] => [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Ferry from Split to Hvar tomorrow?' }] },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Ferryhopper shows four sailings.' },
      { type: 'data-mcp-app', id: 'call-1', data },
    ] as UIMessage['parts'],
  },
];

const PART = {
  server: 'ferryhopper',
  toolName: 'search_ferry_trips',
  resourceUri: PICKER,
  pinHash: 'hash-1',
  input: { legs: [] },
  result: { content: [{ type: 'text', text: '{}' }] },
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeAll(() => {
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom has no scrollIntoView.
  (Element.prototype as any).scrollIntoView ??= () => {};
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
});

async function show(messages: UIMessage[]) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MessageList
        messages={messages}
        status="ready"
        interactive
        onSend={() => {}}
        onSomethingElse={() => {}}
        onAnswer={() => {}}
      />,
    );
  });
}

describe('MCP App parts', () => {
  it("shows Ferryhopper's widget in a sandboxed frame on the sandbox origin", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ html: '<p>picker</p>', csp: CSP, pinHash: 'hash-1' }),
    );
    vi.stubGlobal('fetch', fetch);
    await show(answer(PART));

    expect(container.textContent).toContain('From Ferryhopper');
    const iframe = container.querySelector('iframe');
    expect(iframe?.title).toBe('Ferry results from Ferryhopper');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms');
    expect(iframe?.style.height).toBe('480px');

    await vi.waitFor(() => expect(iframe?.getAttribute('src')).toBeTruthy());
    const src = new URL(iframe?.getAttribute('src') ?? '');
    expect(src.href.startsWith(SANDBOX_URL)).toBe(true);
    expect(JSON.parse(src.searchParams.get('csp') ?? '')).toEqual(CSP);
    expect(fetch).toHaveBeenCalledWith(
      `/api/mcp-apps/ferryhopper/widget?uri=${encodeURIComponent(PICKER)}&pin=hash-1`,
      expect.anything(),
    );
  });

  it('says so in one line when the widget cannot load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'widget-unavailable' }, { status: 502 })),
    );
    await show(answer({ ...PART, pinHash: 'hash-down' }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Ferryhopper's results couldn't load here."),
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('renders nothing for an invalid part', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await show(answer({ ...PART, resourceUri: 'https://evil.example/x.html' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).not.toContain('From Ferryhopper');
    expect(container.textContent).toContain('Ferryhopper shows four sailings.');
  });
});
