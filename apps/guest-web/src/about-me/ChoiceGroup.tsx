import { Check } from '@phosphor-icons/react';

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
  const toggle = (code: C) => {
    const on = selected.includes(code);
    if (multiple) onChange(on ? selected.filter((c) => c !== code) : [...selected, code]);
    // Tapping the chosen single option clears it.
    else onChange(on ? [] : [code]);
  };
  const options = codes.map((code) => {
    const on = selected.includes(code);
    return (
      <button
        key={code}
        type="button"
        className="choice"
        {...(multiple ? { 'aria-pressed': on } : { role: 'radio', 'aria-checked': on })}
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
    <div role="radiogroup" aria-labelledby={labelId} className="choice-group">
      {options}
    </div>
  );
}
