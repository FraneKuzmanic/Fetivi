// @vitest-environment happy-dom
import { act, type ReactNode, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import type { Space } from '../api';
import { SpaceProvider, type SpaceState, useSpace } from '../space';
import { RecoverPage } from './RecoverPage';
import { RecoveryRequest } from './RecoveryRequest';
import { VerifyEmailPage } from './VerifyEmailPage';

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

const TOKEN = 'a'.repeat(43);
const SPACE: Space = {
  language: 'en',
  closedAt: '2026-10-24T22:00:00.000Z',
  closed: false,
  unitSlug: 'abc',
  keepForEvaluation: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers each path with `answers[path]` (default 204) and records every call. */
function server(answers: Record<string, () => Response>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answers[url]?.() ?? new Response(null, { status: 204 });
    }),
  );
  return calls;
}

function Where() {
  const { state } = useSpace();
  return <p data-testid="chat">{state.status === 'ready' ? `chat:${state.space.unitSlug}` : ''}</p>;
}

async function mount(node: ReactNode, path: string, initial: SpaceState = { status: 'none' }) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <SpaceProvider initial={initial}>
            <Routes>
              <Route path="/chat" element={<Where />} />
              <Route path="*" element={node} />
            </Routes>
          </SpaceProvider>
        </MemoryRouter>
      </StrictMode>,
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

describe('RecoveryRequest', () => {
  it('sends the email for the unit and always shows the same message', async () => {
    const calls = server({});
    await mount(<RecoveryRequest slug="abc" />, '/u/abc');
    await act(async () => button('Move your chat here')?.click());
    type(host.querySelector('input[name="email"]') as HTMLInputElement, 'ana@example.test');
    await act(async () => button('Send link')?.click());
    expect(calls).toEqual([
      { url: '/api/access/abc/recovery', method: 'POST', body: { email: 'ana@example.test' } },
    ]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "If this email is linked to a Fetivi here, I've sent a link. It works for 1 hour.",
    );
  });

  it.each([
    [400, 'Enter an email address, like name@example.com.'],
    [404, "This link doesn't work. Scan the QR code in the apartment again."],
    [500, 'No connection. Check your internet and try again.'],
  ])('says what went wrong on a %i', async (status, message) => {
    server({ '/api/access/abc/recovery': () => json({ error: 'x' }, status) });
    await mount(<RecoveryRequest slug="abc" />, '/u/abc');
    await act(async () => button('Move your chat here')?.click());
    type(host.querySelector('input[name="email"]') as HTMLInputElement, 'ana@example.test');
    await act(async () => button('Send link')?.click());
    expect(host.querySelector('.message')?.textContent).toBe(message);
  });
});

describe('RecoverPage', () => {
  it('does nothing until tapped, then opens the Space and lands on the chat', async () => {
    const calls = server({ '/api/recovery/restore': () => json(SPACE) });
    await mount(<RecoverPage />, `/recover?token=${TOKEN}`);
    expect(calls).toEqual([]);
    await act(async () => button('Open my Fetivi')?.click());
    expect(calls).toEqual([
      { url: '/api/recovery/restore', method: 'POST', body: { token: TOKEN } },
    ]);
    expect(host.querySelector('[data-testid="chat"]')?.textContent).toBe('chat:abc');
  });

  it('says the link expired on a 400', async () => {
    server({ '/api/recovery/restore': () => json({ error: 'invalid-token' }, 400) });
    await mount(<RecoverPage />, `/recover?token=${TOKEN}`);
    await act(async () => button('Open my Fetivi')?.click());
    expect(host.querySelector('h1')?.textContent).toBe('This link no longer works');
    expect(host.textContent).toContain('This link has expired or was already used.');
    expect(button('Open my Fetivi')).toBeUndefined();
    expect(host.querySelector('a[href="/chat"]')).toBeNull();
  });

  it('offers the way back to a Space this device still has', async () => {
    server({});
    await mount(<RecoverPage />, '/recover', { status: 'ready', space: SPACE });
    expect(host.querySelector('a[href="/chat"]')).not.toBeNull();
  });

  it('says the same without a token', async () => {
    server({});
    await mount(<RecoverPage />, '/recover');
    expect(host.textContent).toContain('This link has expired or was already used.');
  });
});

describe('VerifyEmailPage', () => {
  it('confirms once on load, also under StrictMode', async () => {
    const calls = server({});
    await mount(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`, {
      status: 'ready',
      space: SPACE,
    });
    expect(calls).toEqual([{ url: '/api/email/verify', method: 'POST', body: { token: TOKEN } }]);
    expect(host.textContent).toContain('your email is confirmed');
    expect(host.querySelector('a[href="/chat"]')).not.toBeNull();
  });

  it('says the link expired on a 400, with no way back without a Space', async () => {
    server({ '/api/email/verify': () => json({ error: 'invalid-token' }, 400) });
    await mount(<VerifyEmailPage />, `/verify-email?token=${TOKEN}`);
    expect(host.textContent).toContain('You can ask for a new one in Settings.');
    expect(host.querySelector('a[href="/chat"]')).toBeNull();
  });
});
