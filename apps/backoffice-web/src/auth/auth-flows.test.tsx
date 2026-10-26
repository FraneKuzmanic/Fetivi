// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '../App';

let root: Root | null = null;
let el: HTMLElement;
let posts: { url: string; body: unknown }[] = [];

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

/** Logged out at `path`; `login` answers the login request. */
async function open(path: string, login: () => Response = () => json({}, 500)) {
  posts = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) posts.push({ url, body: JSON.parse(String(init.body)) });
    if (url === '/api/auth/me') return json({ error: 'unauthenticated' }, 401);
    if (url === '/api/auth/login') return login();
    if (url === '/api/auth/sign-up' || url === '/api/auth/resend-verification')
      return json({}, 202);
    return json({ error: 'not-found' }, 404);
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    ),
  );
}

async function type(selector: string, value: string) {
  await act(async () => {
    const input = el.querySelector<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === text);

const click = (text: string) => act(async () => button(text)?.click());

describe('signed-out pages', () => {
  it('turns sign-up into a check-your-email screen that names the address and can go back', async () => {
    await open('/sign-up');
    await type('input[type="email"]', 'host@example.test');
    await type('input[type="password"]', 'a long enough password');
    await act(async () => el.querySelector('form')?.requestSubmit());

    const heading = el.querySelector('h1');
    await vi.waitFor(() => expect(heading?.textContent).toBe('Check your email'));
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe('Check your email · Fetivi');
    expect(el.textContent).toContain('host@example.test');
    expect(el.textContent).toContain('What happens next');

    await click('Send it again');
    await vi.waitFor(() =>
      expect(el.querySelector('[role="status"]')?.textContent).toBe(
        'We sent a new link to host@example.test.',
      ),
    );
    expect(posts.at(-1)).toEqual({
      url: '/api/auth/resend-verification',
      body: { email: 'host@example.test' },
    });

    await click('Use a different email');
    expect(el.querySelector('h1')?.textContent).toBe('Create a host account');
    expect(el.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe(
      'host@example.test',
    );
  });

  it('offers a new confirmation link when login says the email is not confirmed', async () => {
    await open('/login', () => json({ error: 'email-not-verified' }, 403));
    await type('input[type="email"]', 'new@example.test');
    await type('input[type="password"]', 'whatever password');
    await act(async () => el.querySelector('form')?.requestSubmit());

    await vi.waitFor(() => expect(button('Send a new confirmation link')).toBeDefined());
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('confirm your email address first');
    expect(el.querySelector('input[type="email"]')?.getAttribute('aria-describedby')).toBe(
      alert?.id,
    );

    await click('Send a new confirmation link');
    await vi.waitFor(() =>
      expect(posts.at(-1)).toEqual({
        url: '/api/auth/resend-verification',
        body: { email: 'new@example.test' },
      }),
    );
  });

  it('shows and hides the password', async () => {
    await open('/login');
    const input = () => el.querySelector<HTMLInputElement>('.password-input input');
    const reveal = el.querySelector<HTMLButtonElement>('.reveal');
    expect(input()?.type).toBe('password');
    await act(async () => reveal?.click());
    expect(input()?.type).toBe('text');
    expect(reveal?.getAttribute('aria-pressed')).toBe('true');
  });
});
