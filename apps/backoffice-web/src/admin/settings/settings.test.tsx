// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../shell/ConfirmDialog';
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

type KeyStatus = {
  source: 'settings' | 'environment' | 'none';
  provider?: 'anthropic' | 'openai' | null;
  model?: string | null;
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

const ENV_KEY: KeyStatus = {
  source: 'environment',
  provider: 'anthropic',
  model: null,
  last4: 'wxyz',
  updatedAt: null,
  updatedBy: null,
};
const MODELS = {
  ok: true,
  provider: 'anthropic',
  models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
};
const OPENAI_MODELS = { ok: true, provider: 'openai', models: ['gpt-5', 'gpt-5-mini'] };
const CHANGED = { updatedAt: '2026-11-17T09:05:00.000Z', updatedBy: 'admin@example.test' };

async function mount(
  usage: unknown = USAGE,
  usageStatus = 200,
  options: { llmKey?: KeyStatus; check?: unknown; typed?: unknown } = {},
) {
  calls = [];
  let cap = 60;
  let llmKey = options.llmKey ?? ENV_KEY;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (url === '/api/admin/usage') return json(usage, usageStatus);
    calls.push({ url, method, body });
    if (url === '/api/admin/settings/llm-key/test') return json(options.check ?? MODELS);
    if (url === '/api/admin/settings/llm-key/check') return json(options.typed ?? OPENAI_MODELS);
    if (url === '/api/admin/settings/llm-key') {
      const saved = body as { key?: string; model: string } | undefined;
      llmKey =
        method === 'PUT' && saved
          ? {
              source: 'settings',
              provider: saved.key ? 'openai' : llmKey.provider,
              model: saved.model,
              last4: saved.key ? saved.key.slice(-4) : llmKey.last4,
              ...CHANGED,
            }
          : { ...ENV_KEY, ...CHANGED };
      return json(llmKey);
    }
    if (method === 'PUT') cap = (body as { dailyMessageCap: number }).dailyMessageCap;
    return json({ dailyMessageCap: cap, llmKey });
  });
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <ConfirmProvider>
        <SettingsPage />
      </ConfirmProvider>,
    );
  });
}

const keySection = () =>
  [...el.querySelectorAll('section')].find((s) =>
    s.querySelector('h2')?.textContent?.includes('Language model'),
  ) as HTMLElement;
const button = (scope: ParentNode, name: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent === name);
async function click(target: HTMLElement | undefined) {
  if (!target) throw new Error('no button');
  await act(async () => {
    target.click();
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
    expect(el.textContent).not.toContain('An estimate');
    expect(el.textContent).not.toContain('UTC');
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

describe('LlmKeySection (68, 71)', () => {
  const KEY = 'sk-proj-secret-key-material-abcd';

  it('says where the key in use comes from, by its last four characters', async () => {
    await mount(USAGE, 200, { llmKey: { source: 'none', last4: null, ...CHANGED } });
    expect(keySection().textContent).toContain(
      'No key: the guest chat, translations, drafting and manual import are off.',
    );
    // The last change was a removal: it says nothing about the key in use.
    expect(keySection().textContent).not.toContain('Last changed');
    act(() => root?.unmount());
    document.body.innerHTML = '';

    await mount();
    expect(keySection().textContent).toContain(
      'From the server environment (ANTHROPIC_API_KEY), ends in …wxyz',
    );
    expect(keySection().textContent).not.toContain('Last changed');
    // Remove only for a key saved in Settings.
    expect(button(keySection(), 'Remove')).toBeUndefined();
  });

  it('says who last changed the saved key, or a deleted account', async () => {
    await mount(USAGE, 200, { llmKey: { source: 'settings', last4: 'abcd', ...CHANGED } });
    expect(keySection().textContent).toMatch(
      /Last changed by admin@example\.test, 17\.11\.2026, \d\d:05/,
    );
    act(() => root?.unmount());
    document.body.innerHTML = '';

    await mount(USAGE, 200, {
      llmKey: { source: 'settings', last4: 'abcd', ...CHANGED, updatedBy: null },
    });
    expect(keySection().textContent).toContain('Last changed by a deleted account');
  });

  it('checks a pasted key, names its provider, saves it with the chosen model and never shows it', async () => {
    await mount();
    const input = keySection().querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error('no key input');
    expect([input.value, input.autocomplete]).toEqual(['', 'off']);
    await type(input, KEY);
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/settings/llm-key/check',
      method: 'POST',
      body: { key: KEY },
    });
    expect(keySection().textContent).toContain(
      'Provider: OpenAI. Choose the model for every task.',
    );
    const select = keySection().querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('no model picker');
    expect([...select.options].map((o) => o.value)).toEqual(['gpt-5', 'gpt-5-mini']);
    select.value = 'gpt-5-mini';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/settings/llm-key',
      method: 'PUT',
      body: { key: KEY, model: 'gpt-5-mini' },
    });
    expect(keySection().textContent).toContain('OpenAI · gpt-5-mini');
    expect(keySection().textContent).toContain('Set in Settings, ends in …abcd');
    expect(keySection().querySelector('select')).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('says when no known provider accepts the pasted key', async () => {
    await mount(USAGE, 200, { typed: { ok: false, error: 'unrecognised' } });
    const input = keySection().querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error('no key input');
    await type(input, 'zz-0123456789-0123456789');
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    expect(keySection().querySelector('[role="alert"]')?.textContent).toBe(
      'No known provider accepts this key.',
    );
    expect(keySection().querySelector('select')).toBeNull();
  });

  it('changes the model of the saved key after a test, without pasting the key again', async () => {
    await mount(USAGE, 200, {
      llmKey: {
        source: 'settings',
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        last4: 'abcd',
        ...CHANGED,
      },
    });
    expect(keySection().textContent).toContain('Anthropic · claude-haiku-5-5');
    await click(button(keySection(), 'Test the key in use'));
    const select = keySection().querySelector<HTMLSelectElement>('select');
    if (!select) throw new Error('no model picker');
    expect(select.value).toBe('claude-haiku-5-5');
    select.value = 'claude-sonnet-5-5';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/settings/llm-key',
      method: 'PUT',
      body: { model: 'claude-sonnet-5-5' },
    });
    expect(keySection().textContent).toContain('Anthropic · claude-sonnet-5-5');
  });

  it("shows the environment key as Anthropic's default model for each task", async () => {
    await mount();
    expect(keySection().textContent).toContain(
      "Anthropic · Anthropic's default model for each task",
    );
  });

  it('saves nothing when the key field is empty', async () => {
    await mount();
    await act(async () => {
      keySection()
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    // The required field normally stops the submit; past it, save() refuses.
    expect(keySection().querySelector('[role="alert"]')).not.toBeNull();
    expect(calls.map((c) => c.url)).toEqual(['/api/admin/settings']);
  });

  it('asks before removing the saved key and then sends DELETE', async () => {
    await mount(USAGE, 200, { llmKey: { source: 'settings', last4: 'abcd', ...CHANGED } });
    await click(button(keySection(), 'Remove'));
    const dialog = document.querySelector<HTMLElement>('dialog.confirm-dialog');
    if (!dialog) throw new Error('no confirm dialog');
    expect(dialog.textContent).toContain('Remove the saved key?');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await click(button(dialog, 'Remove key'));
    expect(calls.at(-1)).toEqual({
      url: '/api/admin/settings/llm-key',
      method: 'DELETE',
      body: undefined,
    });
    expect(keySection().textContent).toContain('From the server environment');
    expect(button(keySection(), 'Remove')).toBeUndefined();
  });

  it.each([
    [MODELS, 'output.saved', 'The key works.'],
    [{ ok: false, error: 'rejected' }, '[role="alert"]', 'The provider rejected the key.'],
    [{ ok: false, error: 'unreachable' }, '[role="alert"]', 'The provider could not be reached.'],
    [{ ok: false, error: 'not-configured' }, '[role="alert"]', 'No key to test.'],
  ])('tests the key in use: %o', async (check, selector, message) => {
    await mount(USAGE, 200, { check });
    await click(button(keySection(), 'Test the key in use'));
    expect(calls.at(-1)).toMatchObject({ url: '/api/admin/settings/llm-key/test', method: 'POST' });
    expect(keySection().querySelector(selector)?.textContent).toBe(message);
  });

  it('replaces "Saved" with the outcome of a later test', async () => {
    await mount(USAGE, 200, { check: { ok: false, error: 'rejected' } });
    const input = keySection().querySelector<HTMLInputElement>('input[type="password"]');
    if (!input) throw new Error('no key input');
    await type(input, KEY);
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    await act(async () => {
      keySection().querySelector('form')?.requestSubmit();
    });
    expect(keySection().querySelector('output.saved')?.textContent).toBe('Saved');

    await click(button(keySection(), 'Test the key in use'));
    expect(keySection().querySelector('output.saved')).toBeNull();
    expect(keySection().querySelector('[role="alert"]')?.textContent).toBe(
      'The provider rejected the key.',
    );
  });
});
