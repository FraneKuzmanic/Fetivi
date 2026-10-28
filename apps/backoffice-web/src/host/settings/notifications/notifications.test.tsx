// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HostNotificationSettings, Me } from '../../../api';
import { SessionProvider } from '../../../session';
import { NotificationsPage } from './NotificationsPage';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const HOST: Me = {
  account: {
    id: 'a1',
    email: 'host@example.test',
    role: 'host',
    language: 'en',
    languageChosen: false,
  },
  actingAs: null,
};
const ACTING: Me = {
  account: {
    id: 'ad',
    email: 'admin@example.test',
    role: 'admin',
    language: 'en',
    languageChosen: false,
  },
  actingAs: { id: 'a1', email: 'host@example.test' },
};

const DEFAULTS: HostNotificationSettings = {
  mode: 'immediate',
  digestTimes: ['09:00', '14:00', '19:00'],
  timezone: 'Europe/Zagreb',
  push: { publicKey: 'BKey', devices: 0 },
};

let root: Root | null = null;
let el: HTMLElement;
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

function stubApi(me: Me, settings: HostNotificationSettings = DEFAULTS) {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === '/api/auth/me') return json(me);
    if (url === '/api/host/notification-settings' && method === 'PUT') {
      return json({ ...settings, ...body });
    }
    if (url === '/api/host/notification-settings') return json(settings);
    if (url === '/api/host/push/subscription') return new Response(null, { status: 204 });
    return json({ error: 'not-found' }, 404);
  });
}

/** A phone or desktop browser: user agent, Home Screen mode and the push APIs. */
function device(options: {
  ua: string;
  installed?: boolean;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
}) {
  const subscription = {
    endpoint: 'https://web.push.apple.com/device',
    toJSON: () => ({
      endpoint: 'https://web.push.apple.com/device',
      keys: { p256dh: 'p', auth: 'a' },
    }),
    unsubscribe: async () => true,
  };
  const subscribe = vi.fn(async () => subscription);
  const registration = { pushManager: { getSubscription: async () => null, subscribe } };
  vi.stubGlobal('navigator', {
    userAgent: options.ua,
    maxTouchPoints: 0,
    serviceWorker: {
      ready: Promise.resolve(registration),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: Boolean(options.installed) && query === '(display-mode: standalone)',
  }));
  vi.stubGlobal('PushManager', class {});
  const requestPermission = vi.fn(async () => options.answer ?? 'granted');
  vi.stubGlobal('Notification', { permission: options.permission ?? 'default', requestPermission });
  return { requestPermission, subscribe };
}

async function mount() {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <SessionProvider>
          <NotificationsPage />
        </SessionProvider>
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(() => expect(el.textContent).toContain('Guest messages'));
}

const button = (name: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  );
const click = (name: string) => act(async () => button(name)?.click());
const radio = (name: string) =>
  [...el.querySelectorAll<HTMLLabelElement>('label')]
    .find((l) => l.textContent === name)
    ?.querySelector<HTMLInputElement>('input[type="radio"]');
const timeInputs = () => [...el.querySelectorAll<HTMLInputElement>('.picker.time input')];

describe('notification settings', () => {
  it('shows the three default times in Digest mode and hides them in Immediate', async () => {
    device({ ua: DESKTOP });
    stubApi(HOST);
    await mount();
    expect(radio('Immediate')?.checked).toBe(true);
    expect(timeInputs()).toHaveLength(0);
    expect(el.textContent).toContain('as soon as a guest sends a message');
    await act(async () => radio('Digest')?.click());
    expect(timeInputs().map((i) => i.value)).toEqual(['09:00', '14:00', '19:00']);
    expect(el.textContent).toContain('Urgent messages still come straight away');
    expect(el.textContent).toContain('Times are in Europe/Zagreb');
    await act(async () => radio('Immediate')?.click());
    expect(timeInputs()).toHaveLength(0);
  });

  it('adds up to six times and keeps at least one, then saves', async () => {
    device({ ua: DESKTOP });
    stubApi(HOST, { ...DEFAULTS, mode: 'digest' });
    await mount();
    await click('Add a time');
    await click('Add a time');
    await click('Add a time');
    expect(timeInputs()).toHaveLength(6);
    expect(button('Add a time')).toBeUndefined();
    for (const n of [6, 5, 4, 3, 2]) await click(`Remove time ${n}`);
    expect(timeInputs()).toHaveLength(1);
    expect(button('Remove time 1')).toBeUndefined();

    await act(async () => el.querySelector('form')?.requestSubmit());
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ mode: 'digest', digestTimes: ['09:00'] });
    await vi.waitFor(() => expect(el.textContent).toContain('Saved'));
  });

  it('has no separate Email section', async () => {
    device({ ua: DESKTOP });
    stubApi(HOST);
    await mount();
    expect(el.textContent).not.toContain('Emails go to');
  });
});

describe('phone alerts', () => {
  it('leaves phone alerts out of a desktop browser', async () => {
    device({ ua: DESKTOP });
    stubApi(HOST);
    await mount();
    expect(el.textContent).not.toContain('Phone alerts');
    expect(button('Turn on alerts')).toBeUndefined();
  });

  it('guides an iPhone and an Android phone to the Home Screen first', async () => {
    device({ ua: IPHONE });
    stubApi(HOST);
    await mount();
    expect(el.textContent).toContain('In Safari, tap Share');
    expect(el.textContent).toContain('Add to Home Screen');
    expect(button('Turn on alerts')).toBeUndefined();
    act(() => root?.unmount());

    device({ ua: ANDROID });
    stubApi(HOST);
    await mount();
    expect(el.textContent).toContain('In Chrome, open the menu');
    expect(el.textContent).toContain('Install app');
  });

  it('asks for permission only on the tap, then subscribes this phone', async () => {
    const { requestPermission, subscribe } = device({ ua: IPHONE, installed: true });
    stubApi(HOST);
    await mount();
    await vi.waitFor(() => expect(button('Turn on alerts')).toBeDefined());
    expect(requestPermission).not.toHaveBeenCalled();
    await click('Turn on alerts');
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(calls.find((c) => c.url === '/api/host/push/subscription')?.body).toEqual({
      endpoint: 'https://web.push.apple.com/device',
      keys: { p256dh: 'p', auth: 'a' },
    });
    await vi.waitFor(() => expect(el.textContent).toContain('Alerts are on for this phone.'));
  });

  it('says alerts are blocked when permission is denied', async () => {
    const { subscribe } = device({ ua: ANDROID, installed: true, answer: 'denied' });
    stubApi(HOST);
    await mount();
    await vi.waitFor(() => expect(button('Turn on alerts')).toBeDefined());
    await click('Turn on alerts');
    expect(subscribe).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Alerts are blocked in this browser's settings.");
  });

  it('offers no alerts to an admin acting as the host', async () => {
    device({ ua: IPHONE, installed: true });
    stubApi(ACTING);
    await mount();
    expect(el.textContent).not.toContain('Phone alerts');
    expect(button('Turn on alerts')).toBeUndefined();
  });
});
