// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import type { Space } from '../api';
import { EmailProvider } from '../email/EmailProvider';
import type { EmailState } from '../email/email-api';
import { SpaceProvider } from '../space';
import { SettingsPage } from './SettingsPage';

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

const SPACE: Space = {
  language: 'en',
  closedAt: '2026-10-24T22:00:00.000Z',
  closed: false,
  unitSlug: 'abc',
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function server(state: EmailState) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/email' && method === 'GET') return json(state);
      if (url === '/api/email' && method === 'PATCH') return json({ ...state, ...body });
      return new Response(null, { status: 202 });
    }),
  );
  return calls;
}

async function mount(space: Space = SPACE) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <SpaceProvider initial={{ status: 'ready', space }}>
          <EmailProvider>
            <SettingsPage />
          </EmailProvider>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const button = (text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('SettingsPage', () => {
  it('without an email: explains when it is asked, offers no input and no link', async () => {
    server({ email: null, verified: false, tips: false });
    await mount();
    expect(host.textContent).toContain(
      "I'll ask for your email when you book something or ask for updates.",
    );
    expect(host.querySelector('input[type="email"]')).toBeNull();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(button('Email me a link')?.disabled).toBe(true);
  });

  it('waiting: resends the confirmation link', async () => {
    const calls = server({ email: 'ana@example.test', verified: false, tips: false });
    await mount();
    expect(host.textContent).toContain('ana@example.test');
    expect(host.textContent).toContain('Waiting for you to confirm');
    await act(async () => button('Send the confirmation link again')?.click());
    expect(calls.some((c) => c.url === '/api/email/verification' && c.method === 'POST')).toBe(
      true,
    );
    expect(host.textContent).toContain('Sent. Check your inbox.');
  });

  it('confirmed: no resend; the tips box starts unticked and saves', async () => {
    const calls = server({ email: 'ana@example.test', verified: true, tips: false });
    await mount();
    expect(host.textContent).toContain('Confirmed');
    expect(button('Send the confirmation link again')).toBeUndefined();
    const tips = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(tips?.checked).toBe(false);
    await act(async () => tips?.click());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ tips: true });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  });

  it('emails a link for another device', async () => {
    const calls = server({ email: 'ana@example.test', verified: true, tips: false });
    await mount();
    await act(async () => button('Email me a link')?.click());
    expect(calls.some((c) => c.url === '/api/recovery' && c.method === 'POST')).toBe(true);
    expect(host.textContent).toContain('the link works for 1 hour');
  });

  it('closed: still offers the link, but not tips or a resend', async () => {
    server({ email: 'ana@example.test', verified: false, tips: false });
    await mount({ ...SPACE, closed: true });
    expect(button('Email me a link')?.disabled).toBe(false);
    expect(button('Send the confirmation link again')).toBeUndefined();
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});
