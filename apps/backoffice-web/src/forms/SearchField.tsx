import { MagnifyingGlass } from '@phosphor-icons/react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Field } from './Field';

export interface SearchOption {
  id: string;
  label: string;
  detail?: string;
}

/**
 * A text field that suggests as you type (a combobox). The caller owns the text and the options;
 * picking one calls `onPick`. Arrow keys move through the list, Enter picks, Escape closes it.
 */
export function SearchField<T extends SearchOption>({
  label,
  hint,
  value,
  onText,
  options,
  onPick,
  loading = false,
  message,
  placeholder,
  maxLength,
  required,
  icon = true,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onText: (text: string) => void;
  options: T[];
  onPick: (option: T) => void;
  loading?: boolean;
  /** Shown in the list instead of options, e.g. "Search is not available right now." */
  message?: string | null;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  /** A magnifying glass in the field: for a pure search, not a field that also takes free text. */
  icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  // A fresh list starts with nothing highlighted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `options` changing is the trigger.
  useEffect(() => setActive(-1), [options]);

  const pick = (option: T) => {
    setOpen(false);
    onPick(option);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + options.length) % options.length);
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault();
      const option = options[active];
      if (option) pick(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const showList = open && (options.length > 0 || loading || Boolean(message));
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <Field label={label} hint={hint}>
      {(ids) => (
        <div className={icon ? 'search-field with-icon-left' : 'search-field'} ref={root}>
          {icon ? <MagnifyingGlass className="search-icon" aria-hidden="true" /> : null}
          <input
            id={ids.id}
            aria-describedby={ids.describedBy}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            maxLength={maxLength}
            required={required}
            value={value}
            onChange={(e) => {
              onText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {showList ? (
            <div id={listId} role="listbox" aria-label={label} className="search-list">
              {loading && options.length === 0 ? <p className="search-note">Searching…</p> : null}
              {message && options.length === 0 && !loading ? (
                <p className="search-note">{message}</p>
              ) : null}
              {options.map((option, i) => (
                // The input owns the keyboard and points at the active option.
                // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the combobox input.
                <div
                  key={option.id}
                  id={optionId(i)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className={i === active ? 'search-option active' : 'search-option'}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(option)}
                >
                  <span>{option.label}</span>
                  {option.detail ? <small>{option.detail}</small> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}
