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

const use = (name: string, costUsd: number) => ({
  use: name,
  calls: costUsd > 0 ? 1 : 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
});

const USAGE = {
  pricesCheckedOn: '2026-10-28',
  today: {
    totalUsd: 0.504,
    byUse: [
      use('chat', 0.5),
      use('translation', 0.004),
      use('handoff_translation', 0),
      use('drafting', 0),
      use('manual_import', 0),
    ],
  },
  month: {
    totalUsd: 12.36,
    byUse: [
      use('chat', 8),
      use('translation', 4),
      use('handoff_translation', 0.2),
      use('drafting', 0.1),
      use('manual_import', 0.06),
    ],
  },
  unpricedCalls: 0,
};

async function mount(usage: unknown = USAGE, usageStatus = 200) {
  calls = [];
  let cap = 60;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (String(input) === '/api/admin/usage') return json(usage, usageStatus);
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
  it('loads the daily message cap and saves a new one', async () => {
    await mount();
    const input = el.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('no input');
    expect(input.value).toBe('60');
    expect([input.min, input.max]).toEqual(['1', '1000']);
    expect(el.textContent).toContain('Daily chat limit per guest device');

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

  it('saves nothing when the field is empty', async () => {
    await mount();
    const input = el.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) throw new Error('no input');
    await type(input, '');
    await act(async () => {
      el.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });
    // The required field normally stops the submit; past it, save() refuses.
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('shows the Anthropic usage estimate by use, today and this month', async () => {
    await mount();
    const rows = [...el.querySelectorAll('table tr')].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ['Use', 'Today', 'This month'],
      ['Guest chat', '$0.50', '$8.00'],
      ['Guide and catalog translation', '< $0.01', '$4.00'],
      ['Host message translation', '$0.00', '$0.20'],
      ['Catalog drafting (seeding)', '$0.00', '$0.10'],
      ['House manual import', '$0.00', '$0.06'],
      ['Total', '$0.50', '$12.36'],
    ]);
    expect(el.textContent).toContain('An estimate');
    expect(el.textContent).toContain('checked 28 Oct 2026');
    expect(el.textContent).not.toMatch(/budget|remaining|credits/i);
  });

  it('says how many calls had no price', async () => {
    await mount({ ...USAGE, unpricedCalls: 3 });
    expect(el.textContent).toContain('3 calls used a model without a price in the table');
  });

  it('keeps the chat limit working when the usage fails to load', async () => {
    await mount({ error: 'internal' }, 500);
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('60');
  });
});
