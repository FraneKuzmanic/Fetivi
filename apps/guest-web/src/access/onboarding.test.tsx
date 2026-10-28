// @vitest-environment happy-dom
import i18next from 'i18next';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { locales, setLanguage } from '../i18n';
import { SpaceProvider } from '../space';
import { AccessPage } from './AccessPage';

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
  vi.restoreAllMocks();
  localStorage.clear();
  setLanguage('en');
});

/** A phone set to German; the unit link works. `post` answers the PIN and recovery calls. */
async function mount(post = () => new Response(null, { status: 204 })) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? post() : new Response(null, { status: 204 }),
    ),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter initialEntries={['/u/abc']}>
        <SpaceProvider initial={{ status: 'none' }}>
          <Routes>
            <Route path="/u/:slug" element={<AccessPage />} />
          </Routes>
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

describe('onboarding language', () => {
  it('introduces Fetivi in English whatever the browser language', async () => {
    await mount();
    expect(host.querySelector('h1')?.textContent).toBe(locales.en.intro.title);
    expect(i18next.language).toBe('en');
  });

  it('still speaks a language chosen earlier on this device', async () => {
    localStorage.setItem('fetivi.language', 'hr');
    await mount();
    expect(host.querySelector('h1')?.textContent).toBe(locales.hr.intro.title);
  });

  it('marks the browser language as the suggested tile', async () => {
    await mount();
    await act(async () => host.querySelector<HTMLButtonElement>('.onboarding-button')?.click());
    const suggested = host.querySelector('[data-suggested="true"]');
    expect(suggested?.textContent).toContain('Deutsch');
    expect(host.querySelectorAll('[data-suggested="true"]')).toHaveLength(1);
  });
});

describe('onboarding PIN', () => {
  it('drops the wrong-PIN message once the guest opens recovery', async () => {
    await mount(
      () =>
        new Response(JSON.stringify({ error: 'wrong_pin' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('.onboarding-button')?.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button:has(> .language-name > [lang="en"])')?.click(),
    );
    const pin = host.querySelector('#pin') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        pin,
        '123456',
      );
      pin.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => (host.querySelector('.pin-form') as HTMLFormElement).requestSubmit());
    expect(host.querySelector('#pin-message')?.textContent).not.toBe('');
    await act(async () => host.querySelector<HTMLButtonElement>('.recovery-ask')?.click());
    expect(host.querySelector('#pin-message')?.textContent).toBe('');
    expect(host.querySelector('.pin-form [role="status"]')?.textContent).toBe('');
  });
});
