// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

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

async function mount() {
  calls = [];
  let cap = 60;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(input), method, body });
    if (method === 'PUT') cap = (body as { dailyMessageCap: number }).dailyMessageCap;
    return json({ dailyMessageCap: cap });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(<SettingsPage />);
  });
}

async function type(element: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(element) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('SettingsPage', () => {
  it('loads the daily message limit and saves a new one', async () => {
    await mount();
    const input = el.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('no input');
    expect(input.value).toBe('60');
    expect([input.min, input.max]).toEqual(['1', '1000']);
    expect(el.textContent).toContain('Daily message limit per guest device');

    await type(input, '25');
    await act(async () => {
      el.querySelector('form')?.requestSubmit();
    });
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/settings',
      method: 'PUT',
      body: { dailyMessageCap: 25 },
    });
    expect(input.value).toBe('25');
    expect(el.querySelector('output.saved')?.textContent).toBe('Saved');
  });
});
