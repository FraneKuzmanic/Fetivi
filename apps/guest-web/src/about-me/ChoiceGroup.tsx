import { Check } from '@phosphor-icons/react';
import { useRef } from 'react';

const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Where an arrow key moves within a radio group of `count` options (wrapping), or null for other keys. */
export function radioMove(key: string, index: number, count: number): number | null {
  const by = ARROWS[key];
  return by === undefined ? null : (index + by + count) % count;
}

/** Tappable options for one About me field. Single: a radio group; multi: toggle buttons in a fieldset. */
export function ChoiceGroup<C extends string>({
  labelId,
  codes,
  labelOf,
  selected,
  multiple,
  onChange,
}: {
  /** Id of the visible question heading. */
  labelId: string;
  codes: readonly C[];
  labelOf: (code: C) => string;
  selected: readonly C[];
  multiple: boolean;
  onChange: (next: C[]) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const toggle = (code: C) => {
    const on = selected.includes(code);
    if (multiple) onChange(on ? selected.filter((c) => c !== code) : [...selected, code]);
    // Tapping the chosen single option clears it.
    else onChange(on ? [] : [code]);
  };
  // A radio group is one Tab stop (the chosen option, else the first); arrow keys move and choose.
  const tabStop = Math.max(
    0,
    codes.findIndex((c) => selected.includes(c)),
  );
  const arrow = (key: string, index: number) => {
    const to = radioMove(key, index, codes.length);
    const code = to === null ? undefined : codes[to];
    if (to === null || code === undefined) return false;
    onChange([code]);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
    return true;
  };
  const options = codes.map((code, index) => {
    const on = selected.includes(code);
    return (
      <button
        key={code}
        type="button"
        className="choice"
        {...(multiple
          ? { 'aria-pressed': on }
          : { role: 'radio', 'aria-checked': on, tabIndex: index === tabStop ? 0 : -1 })}
        onKeyDown={(e) => {
          if (!multiple && arrow(e.key, index)) e.preventDefault();
        }}
        onClick={() => toggle(code)}
      >
        {on && <Check aria-hidden="true" weight="bold" />}
        {labelOf(code)}
      </button>
    );
  });
  return multiple ? (
    <fieldset aria-labelledby={labelId} className="choice-group">
      {options}
    </fieldset>
  ) : (
    <div ref={group} role="radiogroup" aria-labelledby={labelId} className="choice-group">
      {options}
    </div>
  );
}
