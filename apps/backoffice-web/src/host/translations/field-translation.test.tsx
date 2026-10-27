// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FieldTranslation } from '../../api';
import { FieldTranslationStatus } from './FieldTranslationStatus';

const FAILED: FieldTranslation = {
  id: 'ft1',
  field: 'accessInstructions',
  amenity: null,
  status: 'failed',
  error: 'model-error',
};

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function stubApi() {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function mount(translation: FieldTranslation | undefined, onChanged = async () => {}) {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(<FieldTranslationStatus translation={translation} onChanged={onChanged} />),
  );
}

const retryButton = () =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Retry translation');

describe('field translation status', () => {
  it('shows a failed translation with its reason and retries it', async () => {
    stubApi();
    const onChanged = vi.fn(async () => {});
    await mount(FAILED, onChanged);
    expect(el.querySelector('.chip.fail')?.textContent).toBe('Translation failed');
    expect(el.textContent).toContain('The translation service did not answer.');

    await act(async () => retryButton()?.click());

    expect(calls).toEqual([
      { url: '/api/host/field-texts/ft1/translations/retry', method: 'POST' },
    ]);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('offers no correction for a structure mismatch, only retry or rephrase', async () => {
    await mount({ ...FAILED, error: 'structure-mismatch' });
    expect(el.textContent).toContain('rephrase the text');
    expect(el.textContent).not.toContain('Correct them below');
    expect(retryButton()).toBeDefined();
  });

  it('shows nothing while translating or once published', async () => {
    await mount({ ...FAILED, status: 'pending', error: null });
    expect(el.innerHTML).toBe('');
    await mount({ ...FAILED, status: 'published', error: null });
    expect(el.innerHTML).toBe('');
  });

  it('renders nothing for a field without a translation', async () => {
    await mount(undefined);
    expect(el.innerHTML).toBe('');
  });
});
