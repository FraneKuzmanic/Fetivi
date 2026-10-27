// @vitest-environment happy-dom
import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DateField, TimeField } from './DateTimeFields';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

/** Sets an input's value the way React notices, then fires input. */
function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const values: (string | null)[] = [];

function DateProbe({ min }: { min?: string }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <DateField
      label="Check-in"
      value={value}
      min={min}
      onChange={(v) => {
        values.push(v);
        setValue(v);
      }}
    />
  );
}

function TimeProbe() {
  const [value, setValue] = useState<string | null>('15:00');
  return (
    <TimeField
      label="Check-in from"
      value={value}
      onChange={(v) => {
        values.push(v);
        setValue(v);
      }}
    />
  );
}

describe('DateField', () => {
  it('reads a day typed day first and shows its weekday', () => {
    values.length = 0;
    const el = mount(<DateProbe />);
    const input = el.querySelector('input') as HTMLInputElement;
    type(input, '27.10.2026');
    expect(values.at(-1)).toBe('2026-10-27');
    expect(el.querySelector('.picker-suffix')?.textContent).toBe('Tue');
  });

  it('explains a day it cannot read and blocks the form', () => {
    values.length = 0;
    const el = mount(<DateProbe />);
    const input = el.querySelector('input') as HTMLInputElement;
    type(input, '10/27/2026');
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(values).toEqual([]);
    expect(el.querySelector('.field-error')?.textContent).toContain('27.10.2026');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('picks a day on the calendar', () => {
    values.length = 0;
    const el = mount(<DateProbe min="2026-11-03" />);
    act(() => (el.querySelector('.picker-button') as HTMLButtonElement).click());
    const early = el.querySelector('[data-day="2026-11-02"]') as HTMLButtonElement;
    expect(early.disabled).toBe(true);
    act(() => (el.querySelector('[data-day="2026-11-05"]') as HTMLButtonElement).click());
    expect(values.at(-1)).toBe('2026-11-05');
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('05.11.2026');
    expect(el.querySelector('.calendar')).toBeNull();
  });
});

describe('TimeField', () => {
  it('narrows the half hours to what was typed and picks one', () => {
    values.length = 0;
    const el = mount(<TimeProbe />);
    const input = el.querySelector('input') as HTMLInputElement;
    type(input, '16');
    const options = [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['16:00', '16:30']);
    act(() => (el.querySelectorAll('[role="option"]')[1] as HTMLElement).click());
    expect(values.at(-1)).toBe('16:30');
    expect(input.value).toBe('16:30');
  });

  it('accepts a time typed without a colon', () => {
    values.length = 0;
    const el = mount(<TimeProbe />);
    const input = el.querySelector('input') as HTMLInputElement;
    type(input, '0930');
    expect(values.at(-1)).toBe('09:30');
  });
});
