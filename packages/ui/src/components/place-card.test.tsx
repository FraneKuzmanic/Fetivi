// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LABELS, place } from './fixtures';
import { PlaceCard } from './place-carousel/PlaceCard';

// Ticket 56: a clamped description gets a More toggle that opens the card in place, and a
// host-added card shows the host's whole note with no call-ahead hint.

let root: Root | null = null;
let host: HTMLElement;
let restore: (() => void) | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  restore?.();
  restore = null;
});

/** happy-dom lays nothing out: make every element report text taller than its box. */
function clampEverything() {
  const proto = HTMLElement.prototype;
  const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
  const client = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 120 });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 40 });
  restore = () => {
    // The real getters may live further up the chain: then the own stub is simply removed.
    if (scroll) Object.defineProperty(proto, 'scrollHeight', scroll);
    else delete (proto as { scrollHeight?: number }).scrollHeight;
    if (client) Object.defineProperty(proto, 'clientHeight', client);
    else delete (proto as { clientHeight?: number }).clientHeight;
  };
}

function mount(card: ReturnType<typeof place>) {
  host = document.createElement('ul');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<PlaceCard place={card} saved={false} labels={LABELS} />));
}

const toggle = () => host.querySelector<HTMLButtonElement>('button.fv-more');

describe('PlaceCard', () => {
  it('opens a clamped description in place and folds it again', () => {
    clampEverything();
    mount(place({ hostPick: { note: 'Ask for Ante.' } }));
    const button = toggle();
    expect(button?.textContent).toBe('More');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const text = host.querySelector(`#${CSS.escape(button?.getAttribute('aria-controls') ?? '')}`);
    expect(text?.getAttribute('data-expanded')).toBe('false');

    act(() => button?.click());
    expect(toggle()?.textContent).toBe('Less');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(text?.getAttribute('data-expanded')).toBe('true');

    act(() => toggle()?.click());
    expect(toggle()?.textContent).toBe('More');
    expect(text?.getAttribute('data-expanded')).toBe('false');
  });

  it('has no toggle when nothing is cut', () => {
    mount(place());
    expect(toggle()).toBeNull();
  });

  it("shows a host-added place's whole note and no call-ahead hint", () => {
    const note = `${'Brown Beach is a quiet pebble cove under the pines. '.repeat(8)}Bring shoes.`;
    expect(note.length).toBeGreaterThan(280);
    mount(
      place({
        title: 'Brown Beach',
        summary: note.slice(0, 279),
        hostAdded: true,
        hostPick: { note },
        staleness: { status: 'never_verified' },
      }),
    );
    expect(host.querySelector('.fv-card-summary')?.textContent).toBe(note);
    expect(host.textContent).not.toContain(LABELS.unverified);
  });
});
