// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { Me } from '../api';
import { setLanguage } from '../i18n';

const me = (language: 'en' | 'hr', languageChosen = false): Me => ({
  account: { id: 'h1', email: 'host@example.test', role: 'host', language, languageChosen },
  actingAs: null,
});

let root: Root | null = null;
let el: HTMLElement;
let sent: { url: string; method: string; body: unknown }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  localStorage.clear();
  setLanguage('en');
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(path: string, signedIn: Me | null) {
  sent = [];
  let current = signedIn;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method && init.method !== 'GET') sent.push({ url, method: init.method, body });
    if (url === '/api/auth/me') return current ? json(current) : json({ error: 'x' }, 401);
    if (url === '/api/auth/me/language') {
      current = me(body.language, true);
      return json(current);
    }
    if (url === '/api/auth/login') return json({ error: 'invalid-credentials' }, 401);
    if (url === '/api/host/inbox')
      return json({ messages: [], unread: 0, orders: [], ordersWaiting: 0 });
    return new Response(null, { status: 404 });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
}

const navText = () => el.querySelector('#side-nav')?.textContent ?? '';

async function click(element: Element | null | undefined) {
  await act(async () => (element as HTMLElement | null)?.click());
}

async function type(selector: string, value: string) {
  await act(async () => {
    const input = el.querySelector<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('back-office language', () => {
  it("shows the account's language and sets <html lang>", async () => {
    await mount('/', me('hr'));
    await vi.waitFor(() => expect(navText()).toContain('Danas'));
    expect(document.documentElement.lang).toBe('hr');
  });

  it('saves a choice from the profile menu', async () => {
    await mount('/', me('hr'));
    await vi.waitFor(() => expect(navText()).toContain('Danas'));
    await click(el.querySelector('.profile-button'));
    const english = [...document.querySelectorAll('[role="menuitemradio"]')].find(
      (item) => item.textContent === 'English',
    );
    expect(english?.querySelector('[lang="en"]')).not.toBeNull();
    await click(english);
    await vi.waitFor(() => expect(navText()).toContain('Today'));
    expect(sent).toContainEqual({
      url: '/api/auth/me/language',
      method: 'PUT',
      body: { language: 'en' },
    });
    expect(document.documentElement.lang).toBe('en');
  });

  it('switches the signed-out pages and sends the language with the login', async () => {
    await mount('/login', null);
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('Log in'));
    const croatian = el.querySelector<HTMLButtonElement>('.language-switch [lang="hr"]');
    await click(croatian);
    expect(el.querySelector('h1')?.textContent).toBe('Prijava');
    expect(croatian?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('fetivi.language')).toBe('hr');
    expect(document.documentElement.lang).toBe('hr');

    await type('input[type="email"]', 'host@example.test');
    await type('input[type="password"]', 'a long enough password');
    await act(async () => el.querySelector('form')?.requestSubmit());
    await vi.waitFor(() =>
      expect(sent.at(-1)).toMatchObject({ url: '/api/auth/login', body: { language: 'hr' } }),
    );
    await vi.waitFor(() =>
      expect(el.querySelector('[role="alert"]')?.textContent).toBe(
        'E-adresa ili lozinka nisu točni.',
      ),
    );
  });
});
