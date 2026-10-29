// @vitest-environment happy-dom

import i18next from 'i18next';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Space } from '../../api';
import { setLanguage } from '../../i18n';
import { SpaceProvider } from '../../space';
import { ComponentPart } from './ComponentPart';

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
  setLanguage('en');
});

const SPACE: Space = {
  language: 'en',
  closedAt: '2026-10-24T22:00:00.000Z',
  closed: false,
  unitSlug: 'abc',
  keepForEvaluation: false,
};

function server() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/space' && method === 'PATCH') {
        return new Response(JSON.stringify({ ...SPACE, ...body }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 202 });
    }),
  );
  return calls;
}

const chips = (switchLanguage?: string) => ({
  name: 'follow-up-chips',
  payload: { replies: ['Gdje je pošta?'], ...(switchLanguage ? { switchLanguage } : {}) },
});

async function mount(data: unknown, { latest = true, onSend = vi.fn() } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <MemoryRouter>
        <SpaceProvider initial={{ status: 'ready', space: SPACE }}>
          <ComponentPart data={data} latest={latest} onSend={onSend} onSomethingElse={() => {}} />
        </SpaceProvider>
      </MemoryRouter>,
    ),
  );
}

const switchChip = () => host.querySelector<HTMLButtonElement>('button[lang]');

describe('language switch chip (ticket 63)', () => {
  it("is labelled in the guest's written language and switches Fetivi through the settings path", async () => {
    const calls = server();
    const onSend = vi.fn();
    await mount(chips('hr'), { onSend });
    expect(switchChip()?.textContent).toBe('Fetivi na hrvatskom');
    expect(switchChip()?.lang).toBe('hr');

    await act(async () => switchChip()?.click());
    expect(calls.find((c) => c.url === '/api/space')).toEqual({
      url: '/api/space',
      method: 'PATCH',
      body: { language: 'hr' },
    });
    expect(i18next.language).toBe('hr');
    expect(onSend).not.toHaveBeenCalled();
    expect(switchChip()).toBeNull();
  });

  it('is not shown for the language Fetivi already speaks', async () => {
    server();
    await mount(chips('en'));
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(switchChip()).toBeNull();
  });

  it('is not shown on an older answer', async () => {
    server();
    await mount(chips('hr'), { latest: false });
    expect(host.querySelector('button')).toBeNull();
  });
});
