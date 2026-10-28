// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Menu } from './Menu';

let root: Root | null = null;
let picked: string[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function mount() {
  picked = [];
  const container = document.createElement('div');
  container.id = 'row';
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <>
        <Menu
          label="More for Trogir"
          trigger="⋯"
          items={['Edit', 'Archive', 'Delete'].map((label) => ({
            label,
            onSelect: () => picked.push(label),
          }))}
        />
        <button type="button" id="elsewhere">
          Act as
        </button>
      </>,
    ),
  );
}

const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
const list = () => document.querySelector('[role="menu"]');
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const focused = () => document.activeElement?.textContent;

async function open() {
  await act(async () => trigger()?.click());
}

async function key(name: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
  });
}

async function pointerDown(target: Element | null) {
  await act(async () => {
    target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
}

describe('Menu', () => {
  it('opens in the body, so the row it sits in keeps its layout', async () => {
    await mount();
    const wrapper = trigger()?.parentElement;
    await open();
    expect(list()?.parentElement).toBe(document.body);
    expect(document.getElementById('row')?.contains(list())).toBe(false);
    expect(wrapper?.childElementCount).toBe(1);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger()?.getAttribute('aria-controls')).toBe(list()?.id);
  });

  it('moves between items with the arrows, Home and End; Escape returns to the button', async () => {
    await mount();
    await open();
    await vi.waitFor(() => expect(focused()).toBe('Edit'));
    await key('ArrowDown');
    expect(focused()).toBe('Archive');
    await key('ArrowUp');
    await key('ArrowUp');
    expect(focused()).toBe('Delete');
    await key('Home');
    expect(focused()).toBe('Edit');
    await key('End');
    expect(focused()).toBe('Delete');
    await key('Escape');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Tab, back on its button', async () => {
    await mount();
    await open();
    await vi.waitFor(() => expect(focused()).toBe('Edit'));
    await key('Tab');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a press outside, not on one inside the list', async () => {
    await mount();
    await open();
    await pointerDown(list());
    expect(list()).not.toBeNull();
    await pointerDown(document.getElementById('elsewhere'));
    expect(list()).toBeNull();
  });

  it('runs the chosen item and closes', async () => {
    await mount();
    await open();
    await act(async () => items()[1]?.click());
    expect(picked).toEqual(['Archive']);
    expect(list()).toBeNull();
  });
});
