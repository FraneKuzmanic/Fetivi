// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { Me } from '../api';

const HOST: Me = {
  account: { id: 'a1', email: 'host@example.test', role: 'host', language: 'en' },
  actingAs: null,
};

let root: Root | null = null;
let el: HTMLElement;
let path = '';
let visited: string[] = [];

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

function Where() {
  const location = useLocation();
  path = location.pathname + location.search;
  visited.push(path);
  return null;
}

const splitPath = (start: string) => {
  const [pathname = '/', search] = start.split('?');
  return { pathname, search: search ? `?${search}` : '' };
};

/** Logged out at `start`, then logs in through the form. */
async function logInFrom(start: string, state?: unknown) {
  let me: Me | null = null;
  visited = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/auth/me') return me ? json(me) : json({ error: 'unauthenticated' }, 401);
    if (url === '/api/auth/login') {
      me = HOST;
      return json(HOST);
    }
    if (url === '/api/host/inbox') return json({ messages: [], unread: 0 });
    return json({ error: 'not-found' }, 404);
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[{ ...splitPath(start), state }]}>
        <App />
        <Where />
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(() => expect(path).toBe('/login'));
  await vi.waitFor(() => expect(el.querySelector('input[type="password"]')).not.toBeNull());
  await act(async () => {
    for (const [selector, value] of [
      ['input[type="email"]', 'host@example.test'],
      ['input[type="password"]', 'correct horse battery'],
    ] as const) {
      const input = el.querySelector<HTMLInputElement>(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await act(async () => el.querySelector('form')?.requestSubmit());
}

describe('login return path', () => {
  it('returns a logged-out host to the email link after login', async () => {
    await logInFrom('/inbox?message=x');
    // The Inbox then drops the param of a message it does not list.
    await vi.waitFor(() => expect(visited).toContain('/inbox?message=x'));
  });

  it('never leaves the app for a protocol-relative path', async () => {
    await logInFrom('/login', { from: '//evil.com' });
    await vi.waitFor(() => expect(path).toBe('/'));
    expect(visited.some((p) => p.startsWith('//'))).toBe(false);
  });
});
