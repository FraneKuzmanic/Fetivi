// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '../i18n';
import type { Space } from '../api';
import { SpaceProvider, type SpaceState } from '../space';
import { UnsubscribeTipsPage } from './UnsubscribeTipsPage';

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

const SPACE_ID = '0b6f8e0e-6a3c-4c1e-9a55-2f1f3c1d2e4f';
const TOKEN = 'a'.repeat(43);
const SPACE: Space = {
  language: 'en',
  closedAt: '2026-10-24T22:00:00.000Z',
  closed: false,
  unitSlug: 'abc',
  keepForEvaluation: false,
};

function server(status: number) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify({ error: 'invalid-link' }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
    }),
  );
  return calls;
}

async function mount(path: string, initial: SpaceState = { status: 'none' }) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <SpaceProvider initial={initial}>
            <UnsubscribeTipsPage />
          </SpaceProvider>
        </MemoryRouter>
      </StrictMode>,
    ),
  );
}

describe('UnsubscribeTipsPage', () => {
  it('unsubscribes once on load, also under StrictMode', async () => {
    const calls = server(204);
    await mount(`/unsubscribe-tips?space=${SPACE_ID}&token=${TOKEN}`, {
      status: 'ready',
      space: SPACE,
    });
    expect(calls).toEqual([
      {
        url: '/api/email/tips/unsubscribe',
        method: 'POST',
        body: { space: SPACE_ID, token: TOKEN },
      },
    ]);
    expect(host.textContent).toContain('Done. No more daily tips by email.');
    expect(host.querySelector('a[href="/chat"]')).not.toBeNull();
  });

  it('says the link does not work on a 400, with no way back without a Space', async () => {
    server(400);
    await mount(`/unsubscribe-tips?space=${SPACE_ID}&token=${TOKEN}`);
    expect(host.textContent).toContain("This link doesn't work.");
    expect(host.querySelector('a[href="/chat"]')).toBeNull();
  });

  it('sends nothing for a link missing its token', async () => {
    const calls = server(204);
    await mount(`/unsubscribe-tips?space=${SPACE_ID}`);
    expect(calls).toEqual([]);
    expect(host.textContent).toContain("This link doesn't work.");
  });
});
