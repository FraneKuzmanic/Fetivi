// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Menu, submenuSide } from './Menu';

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

  it('focuses the first item only once the list is visible, since a browser skips a hidden one', async () => {
    await mount();
    const seen: string[] = [];
    const focus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
      this: HTMLElement,
    ) {
      seen.push(this.closest<HTMLElement>('[role="menu"]')?.style.visibility ?? 'outside');
    });
    await open();
    focus.mockRestore();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain('hidden');
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

async function mountWithSubmenu(current: 'English' | 'Hrvatski' = 'English') {
  picked = [];
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const pick = (label: string) => () => picked.push(label);
  await act(async () =>
    root?.render(
      <Menu
        label="Account"
        trigger="Me"
        items={[
          { label: 'Settings', onSelect: pick('Settings') },
          {
            label: 'English',
            name: 'Language: English',
            icon: <span />,
            submenu: [
              { label: 'English', current: current === 'English', onSelect: pick('English') },
              {
                label: 'Hrvatski',
                lang: 'hr',
                current: current === 'Hrvatski',
                onSelect: pick('Hrvatski'),
              },
            ],
          },
          { label: 'Sign out', onSelect: pick('Sign out') },
        ]}
      />,
    ),
  );
}

const menuButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Account"]');
const parentItem = () =>
  document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-haspopup="menu"]');
const submenu = () => document.querySelector('[data-submenu]');
const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];

async function openToParent() {
  await act(async () => menuButton()?.click());
  await vi.waitFor(() => expect(focused()).toBe('Settings'));
  await key('ArrowDown');
  expect(document.activeElement).toBe(parentItem());
}

describe('Menu submenu', () => {
  it('shows a closed parent item named for what it changes', async () => {
    await mountWithSubmenu();
    await act(async () => menuButton()?.click());
    expect(parentItem()?.getAttribute('aria-expanded')).toBe('false');
    expect(parentItem()?.getAttribute('aria-label')).toBe('Language: English');
    expect(submenu()).toBeNull();
  });

  it('opens on ArrowRight and focuses the first option', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    expect(submenu()).not.toBeNull();
    expect(parentItem()?.getAttribute('aria-expanded')).toBe('true');
    expect(parentItem()?.getAttribute('aria-controls')).toBe(submenu()?.id);
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('focuses the checked option when it is not the first', async () => {
    await mountWithSubmenu('Hrvatski');
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[1]));
  });

  it('moves into an already open submenu on ArrowRight from its parent', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    act(() => parentItem()?.focus());
    await key('ArrowRight');
    expect(submenu()).not.toBeNull();
    expect(document.activeElement).toBe(radios()[0]);
  });

  it('keeps the arrows, Home and End inside the submenu', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    await key('ArrowDown');
    expect(document.activeElement).toBe(radios()[1]);
    await key('ArrowDown');
    expect(document.activeElement).toBe(radios()[0]);
    await key('ArrowUp');
    expect(document.activeElement).toBe(radios()[1]);
    await key('Home');
    expect(document.activeElement).toBe(radios()[0]);
    await key('End');
    expect(document.activeElement).toBe(radios()[1]);
  });

  it('goes back to the parent on ArrowLeft and Escape; a second Escape closes the menu', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    await key('ArrowLeft');
    expect(submenu()).toBeNull();
    expect(document.activeElement).toBe(parentItem());
    expect(list()).not.toBeNull();
    // Enter on a button is a click.
    await act(async () => parentItem()?.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    await key('Escape');
    expect(submenu()).toBeNull();
    expect(list()).not.toBeNull();
    expect(document.activeElement).toBe(parentItem());
    await key('Escape');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('closes everything on Tab, back on its button', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    await key('Tab');
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('leaves the submenu options out of the main list order', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowDown');
    expect(focused()).toBe('Sign out');
  });

  it('runs the chosen option, closes everything and returns to the button', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await vi.waitFor(() => expect(document.activeElement).toBe(radios()[0]));
    await act(async () => radios()[1]?.click());
    expect(picked).toEqual(['Hrvatski']);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });

  it('stays open on a press inside the submenu', async () => {
    await mountWithSubmenu();
    await openToParent();
    await key('ArrowRight');
    await pointerDown(radios()[1] ?? null);
    expect(submenu()).not.toBeNull();
    expect(list()).not.toBeNull();
  });

  it('opens beside the list where it fits, right first, else in place', () => {
    expect(submenuSide({ left: 1000, right: 1208 }, 176, 1440)).toBe('right');
    expect(submenuSide({ left: 1224, right: 1432 }, 176, 1440)).toBe('left');
    expect(submenuSide({ left: 174, right: 382 }, 176, 390)).toBe('inline');
  });
});
