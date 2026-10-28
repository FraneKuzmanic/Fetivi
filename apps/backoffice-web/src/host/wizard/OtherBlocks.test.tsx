// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Block, UnitDetail } from '../../api';
import { ConfirmProvider } from '../../shell/ConfirmDialog';
import { OtherBlocks } from './OtherBlocks';

// Ticket 56: a wizard step shows the section's entries no prompt answers, such as one confirmed
// from the house manual, so the host edits or deletes it instead of adding a twin.

const entry = (id: string, title: string, wizardKey: Block['wizardKey']) =>
  ({
    id,
    propertyId: 'p1',
    unitId: null,
    category: 'how_tos',
    title,
    body: 'Perilica je u kupaonici.',
    visibility: 'always',
    revision: 1,
    translation: { status: 'published', error: null, publishedRevision: 1, sourceLanguage: 'hr' },
    replacesBlockId: null,
    wizardKey,
    position: 0,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    media: [],
    source: 'property',
  }) as Block & { source: 'property' };

const KEYED = entry('keyed', 'Laundry', 'laundry');
const IMPORT = entry('import', 'Kako koristiti uređaje', null);

const unit = (blocks: (Block & { source: 'property' | 'unit' })[]) =>
  ({
    id: 'u1',
    propertyId: 'p1',
    effective: { inherited: {}, blocks, amenities: [] },
  }) as unknown as UnitDetail;

let root: Root | null = null;
let el: HTMLElement;
let calls: { url: string; method: string }[] = [];
let changed = 0;

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
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ block: IMPORT, warnings: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

async function mount(detail: UnitDetail) {
  changed = 0;
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () =>
    root?.render(
      <ConfirmProvider>
        <OtherBlocks
          stepId="how_tos"
          detail={detail}
          onChanged={async () => {
            changed += 1;
          }}
        />
      </ConfirmProvider>,
    ),
  );
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text) as
    | HTMLButtonElement
    | undefined;

async function click(text: string) {
  const b = button(text);
  if (!b) throw new Error(`no button ${text}`);
  await act(async () => b.click());
}

describe('OtherBlocks', () => {
  it("lists the section's other entry and not the prompt's own", async () => {
    stubApi();
    await mount(unit([KEYED, IMPORT]));
    expect(el.textContent).toContain('Other entries in this section');
    expect(el.textContent).toContain('Kako koristiti uređaje');
    expect(el.textContent).toContain('From the property');
    expect(el.textContent).not.toContain('Laundry');
  });

  it("names each action after its entry's title", async () => {
    stubApi();
    await mount(unit([KEYED, IMPORT]));
    expect(button('Edit')?.getAttribute('aria-label')).toBe('Edit Kako koristiti uređaje');
    expect(button('Delete')?.getAttribute('aria-label')).toBe('Delete Kako koristiti uređaje');
  });

  it('edits the entry where it lives', async () => {
    stubApi();
    await mount(unit([KEYED, IMPORT]));
    await click('Edit');
    expect(el.textContent).toContain('Edit guide entry');
    const form = el.querySelector('form');
    if (!form) throw new Error('no editor form');
    await act(async () => form.requestSubmit());
    await vi.waitFor(() =>
      expect(calls).toContainEqual({ url: '/api/host/blocks/import', method: 'PATCH' }),
    );
    await vi.waitFor(() => expect(changed).toBe(1));
  });

  it('deletes the entry after the confirm, which says it goes for every unit', async () => {
    stubApi();
    await mount(unit([KEYED, IMPORT]));
    await click('Delete');
    expect(document.querySelector('dialog')?.textContent).toContain('it disappears for every unit');
    expect(calls).toHaveLength(0);
    await click('Delete entry');
    await vi.waitFor(() =>
      expect(calls).toContainEqual({ url: '/api/host/blocks/import', method: 'DELETE' }),
    );
    await vi.waitFor(() => expect(changed).toBe(1));
  });

  it('renders nothing when the section has no other entries', async () => {
    stubApi();
    await mount(unit([KEYED]));
    expect(el.innerHTML).toBe('');
  });
});
