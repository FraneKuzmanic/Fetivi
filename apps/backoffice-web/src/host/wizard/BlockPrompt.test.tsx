// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block, UnitDetail } from '../../api';
import { BlockPrompt } from './BlockPrompt';

// The wizard runs per unit: what a host adds here is this unit's, and an entry the unit shows from
// the property is edited for every unit or overridden for this one, never silently moved.

const TIPS: Block & { source: 'property' } = {
  id: 'b1',
  propertyId: 'p1',
  unitId: null,
  category: 'host_picks',
  title: 'Savjeti za okolicu',
  body: 'Konoba Fontana for fish.',
  visibility: 'always',
  revision: 1,
  translation: { status: 'published', error: null, publishedRevision: 1, sourceLanguage: 'hr' },
  replacesBlockId: null,
  // Written on the Host picks page: no wizard key.
  wizardKey: null,
  position: 0,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  media: [],
  source: 'property',
} as Block & { source: 'property' };

const unit = (blocks: (Block & { source: 'property' | 'unit' })[]) =>
  ({
    id: 'u1',
    propertyId: 'p1',
    effective: { inherited: {}, blocks, amenities: [] },
  }) as unknown as UnitDetail;

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

function stubApi() {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ block: TIPS, warnings: [] }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function mount(detail: UnitDetail, promptKey: 'neighbourhood_tips' | 'rubbish_recycling') {
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <BlockPrompt
        promptKey={promptKey}
        level="recommended"
        detail={detail}
        onSaved={async () => {}}
      />,
    ),
  );
}

const button = (text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

async function typeBody(text: string) {
  const area = el.querySelector('textarea') as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, text);
  await act(async () => area.dispatchEvent(new Event('input', { bubbles: true })));
}

describe('BlockPrompt', () => {
  it('adds a new entry to this unit, not to the property', async () => {
    stubApi();
    await mount(unit([]), 'rubbish_recycling');
    await act(async () => button('Add').click());
    await typeBody('Bins are behind the building.');
    await act(async () => button('Save').click());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: '/api/host/units/u1/blocks',
      method: 'POST',
      body: { wizardKey: 'rubbish_recycling', body: 'Bins are behind the building.' },
    });
  });

  it("counts the property's tips as answered and offers both ways to change them", async () => {
    stubApi();
    await mount(unit([TIPS]), 'neighbourhood_tips');
    expect(el.textContent).toContain('From the property: Savjeti za okolicu');
    expect(el.textContent).not.toContain('Not added yet');

    await act(async () => button('Write a version for this unit').click());
    await act(async () => button('Save').click());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: '/api/host/units/u1/blocks',
      body: { replacesBlockId: 'b1', wizardKey: 'neighbourhood_tips', category: 'host_picks' },
    });
  });

  it("edits the property's entry for every unit when asked to", async () => {
    stubApi();
    await mount(unit([TIPS]), 'neighbourhood_tips');
    await act(async () => button('Edit for all units').click());
    await act(async () => button('Save').click());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: '/api/host/blocks/b1', method: 'PATCH' });
  });
});
