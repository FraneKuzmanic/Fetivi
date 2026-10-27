// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ConfirmOptions, ConfirmProvider, useConfirm } from './ConfirmDialog';

let root: Root | null = null;
let answers: boolean[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function Asker({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      id="ask"
      onClick={async () => {
        answers.push(await confirm(options));
      }}
    >
      Delete
    </button>
  );
}

const DELETE: ConfirmOptions = {
  title: 'Delete Trogir?',
  body: 'Its records go with it.',
  action: 'Delete destination',
  danger: true,
};

async function mount(options: ConfirmOptions = DELETE) {
  answers = [];
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <ConfirmProvider>
        <Asker options={options} />
      </ConfirmProvider>,
    ),
  );
}

const dialog = () => document.querySelector<HTMLDialogElement>('dialog.confirm-dialog');
const dialogButton = (name: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent === name);
const asker = () => document.querySelector<HTMLButtonElement>('#ask');

async function ask() {
  const button = asker();
  if (!button) throw new Error('no asker');
  button.focus();
  await act(async () => button.click());
}

async function click(button: HTMLButtonElement | undefined) {
  if (!button) throw new Error('no such button');
  await act(async () => button.click());
}

describe('ConfirmProvider', () => {
  it('asks in an open dialog and answers yes on the action button', async () => {
    await mount();
    expect(dialog()).toBeNull();
    await ask();
    const open = dialog();
    expect(open?.open).toBe(true);
    expect(open?.querySelector('h2')?.textContent).toBe('Delete Trogir?');
    expect(open?.textContent).toContain('Its records go with it.');
    expect(open?.getAttribute('aria-labelledby')).toBe(open?.querySelector('h2')?.id);
    expect(dialogButton('Delete destination')?.className).toBe('danger-solid');
    await click(dialogButton('Delete destination'));
    expect(answers).toEqual([true]);
    expect(dialog()).toBeNull();
  });

  it('answers no on Cancel', async () => {
    await mount();
    await ask();
    await click(dialogButton('Cancel'));
    expect(answers).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it('answers no on Escape', async () => {
    await mount();
    await ask();
    await act(async () => {
      dialog()?.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(answers).toEqual([false]);
    expect(dialog()).toBeNull();
  });

  it('starts on Cancel for what cannot be undone, and returns focus afterwards', async () => {
    await mount();
    await ask();
    expect(document.activeElement).toBe(dialogButton('Cancel'));
    await click(dialogButton('Cancel'));
    expect(document.activeElement).toBe(asker());
  });

  it('starts on the action when it can be undone', async () => {
    await mount({ title: 'Send the new terms?', action: 'Send new terms' });
    await ask();
    expect(dialog()?.hasAttribute('aria-describedby')).toBe(false);
    expect(dialogButton('Send new terms')?.className).toBe('primary');
    expect(document.activeElement).toBe(dialogButton('Send new terms'));
    await click(dialogButton('Send new terms'));
    expect(answers).toEqual([true]);
    expect(document.activeElement).toBe(asker());
  });
});
