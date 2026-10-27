import { CalendarBlank, CaretLeft, CaretRight, Clock } from '@phosphor-icons/react';
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  addDays,
  addMonths,
  formatDate,
  HALF_HOURS,
  monthGrid,
  parseDate,
  parseTime,
  todayIso,
} from './datetime';
import { Field, type FieldProps } from './Field';

// The back office's own date and time fields. Native pickers follow the browser's locale (10/27
// and 03:00 PM on an English browser); hosts read days first and a 24-hour clock everywhere.

const LOCALE = 'en-GB';
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const weekdayShort = (iso: string) =>
  utc(iso).toLocaleDateString(LOCALE, { weekday: 'short', timeZone: 'UTC' });
const longDay = (iso: string) =>
  utc(iso).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const monthTitle = (iso: string) =>
  utc(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAYS = monthGrid(2026, 6)[0]?.map((d) => (d ? weekdayShort(d).slice(0, 2) : '')) ?? [];

/** Closes a popup on a click outside `root`. */
function useOutside(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, root, close]);
}

/** Puts `error` on the input for the browser's own form check, so a bad value blocks a submit. */
function useValidity(input: RefObject<HTMLInputElement | null>, error: string | null) {
  useEffect(() => {
    input.current?.setCustomValidity(error ?? '');
  }, [input, error]);
}

function rangeError(iso: string, min?: string, max?: string): string | null {
  if (min && iso < min) return `Pick ${formatDate(min)} or later.`;
  if (max && iso > max) return `Pick ${formatDate(max)} or earlier.`;
  return null;
}

function Calendar({
  value,
  min,
  max,
  onPick,
  onClose,
}: {
  value: string | null;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const start = value ?? (min && todayIso() < min ? min : todayIso());
  const [focus, setFocus] = useState(start);
  const grid = useRef<HTMLTableElement>(null);
  const year = Number(focus.slice(0, 4));
  const month = Number(focus.slice(5, 7));
  const title = monthTitle(focus);
  const allowed = (iso: string) => !rangeError(iso, min, max);

  useLayoutEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1),
      PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, -((utc(focus).getUTCDay() + 6) % 7)),
      End: () => addDays(focus, 6 - ((utc(focus).getUTCDay() + 6) % 7)),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setFocus(move());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const today = todayIso();
  return (
    <div className="calendar" role="dialog" aria-label="Choose a day" onKeyDown={onKeyDown}>
      <div className="calendar-head">
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Previous month"
          onClick={() => setFocus(addMonths(focus, -1))}
        >
          <CaretLeft aria-hidden="true" />
        </button>
        <span className="calendar-title" aria-live="polite">
          {title}
        </span>
        <button
          type="button"
          className="ghost icon-button"
          aria-label="Next month"
          onClick={() => setFocus(addMonths(focus, 1))}
        >
          <CaretRight aria-hidden="true" />
        </button>
      </div>
      <table ref={grid} className="calendar-grid" aria-label={title}>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" abbr={d}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(year, month).map((week) => (
            <tr key={week.find(Boolean)}>
              {week.map((day, i) =>
                day ? (
                  <td key={day}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focus ? 0 : -1}
                      aria-label={longDay(day)}
                      aria-pressed={day === value}
                      aria-current={day === today ? 'date' : undefined}
                      disabled={!allowed(day)}
                      onClick={() => onPick(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </td>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: padding cells have no identity.
                  <td key={`pad-${i}`} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-foot">
        <button
          type="button"
          className="ghost"
          disabled={!allowed(today)}
          onClick={() => onPick(today)}
        >
          Today
        </button>
      </div>
    </div>
  );
}

/** A day, typed as 27.10.2026 or picked on a calendar. The value is ISO, or null when empty. */
export function DateField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  required,
  min,
  max,
}: FieldProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
  /** The earliest and latest day that can be picked, ISO. */
  min?: string;
  max?: string;
}) {
  const [text, setText] = useState(formatDate(value));
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutside(open, root, () => setOpen(false));
  useValidity(input, error);

  // A new value from outside (a reset, a loaded record) replaces the text unless it means the same.
  useEffect(() => {
    setText((current) => (parseDate(current, 2000) === value ? current : formatDate(value)));
  }, [value]);

  const year = new Date().getFullYear();
  const typed = (next: string) => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      onChange(null);
      return;
    }
    const iso = parseDate(next, year);
    if (iso && !rangeError(iso, min, max)) {
      setError(null);
      onChange(iso);
    }
  };

  const check = () => {
    if (text.trim() === '') return;
    const iso = parseDate(text, year);
    if (!iso) setError('Use day.month.year, for example 27.10.2026.');
    else {
      setError(rangeError(iso, min, max));
      setText(formatDate(iso));
    }
  };

  const pick = (iso: string) => {
    setText(formatDate(iso));
    setError(null);
    onChange(iso);
    setOpen(false);
    input.current?.focus();
  };

  const weekday = value && !error ? weekdayShort(value) : null;

  return (
    <Field label={label} hint={hint} hideLabel={hideLabel} error={error}>
      {(ids) => (
        <div className="picker date" ref={root}>
          <div className="picker-control">
            <input
              ref={input}
              id={ids.id}
              aria-describedby={ids.describedBy}
              aria-invalid={error ? true : undefined}
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="dd.mm.yyyy"
              value={text}
              required={required}
              onChange={(e) => typed(e.target.value)}
              onBlur={check}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && e.altKey) {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
            />
            {weekday ? (
              <span className="picker-suffix" aria-hidden="true">
                {weekday}
              </span>
            ) : null}
            <button
              ref={button}
              type="button"
              className="picker-button"
              aria-label={`Choose ${label.toLowerCase()} on a calendar`}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <CalendarBlank aria-hidden="true" />
            </button>
          </div>
          {open ? (
            <Calendar
              value={value}
              min={min}
              max={max}
              onPick={pick}
              onClose={() => {
                setOpen(false);
                button.current?.focus();
              }}
            />
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** A time of day on the 24-hour clock, typed as 15:00 or 1500, or picked from half hours. */
export function TimeField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  required,
}: FieldProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  const [text, setText] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOutside(open, root, () => setOpen(false));
  useValidity(input, error);

  useEffect(() => {
    setText((current) => (parseTime(current) === value ? current : (value ?? '')));
  }, [value]);

  // Typing "1" offers 01:00 and 10:00–19:30, "15" offers 15:00 and 15:30. A full time, or
  // nothing typed, shows the whole day so the list scrolls to it.
  const digits = text.replace(/\D/g, '');
  const narrowed = HALF_HOURS.filter((t) =>
    digits.length === 1
      ? t.startsWith(digits) || t.startsWith(`0${digits}`)
      : t.replace(':', '').startsWith(digits),
  );
  const options =
    digits.length === 0 || digits.length > 2 || narrowed.length === 0 ? HALF_HOURS : narrowed;

  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const target = active ?? parseTime(text) ?? '12:00';
    const nearest = options.find((t) => t >= target) ?? options[options.length - 1];
    list.current
      .querySelector<HTMLElement>(`[data-time="${active ?? nearest}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active, options, text]);

  const commit = (time: string | null) => {
    setText(time ?? '');
    setError(null);
    onChange(time);
    setOpen(false);
    setActive(null);
  };

  const typed = (next: string) => {
    setText(next);
    setOpen(true);
    setActive(null);
    if (next.trim() === '') {
      setError(null);
      onChange(null);
      return;
    }
    const time = parseTime(next);
    if (time && /^\d{1,2}[:.h ]\d{2}$|^\d{4}$/.test(next.trim())) {
      setError(null);
      onChange(time);
    }
  };

  const check = () => {
    if (text.trim() === '') return;
    const time = parseTime(text);
    if (!time) setError('Use the 24-hour clock, for example 15:00.');
    else {
      setError(null);
      setText(time);
      if (time !== value) onChange(time);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const at = active ? options.indexOf(active) : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = at === -1 ? options.findIndex((t) => t >= (parseTime(text) ?? '12:00')) : at;
      const next = Math.min(
        Math.max((from === -1 ? 0 : from) + (at === -1 ? 0 : step), 0),
        options.length - 1,
      );
      setActive(options[next] ?? null);
    } else if (event.key === 'Enter' && open && active) {
      event.preventDefault();
      commit(active);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActive(null);
    }
  };

  const optionId = (t: string) => `${listId}-${t.replace(':', '')}`;

  return (
    <Field label={label} hint={hint} hideLabel={hideLabel} error={error}>
      {(ids) => (
        <div className="picker time" ref={root}>
          <div className="picker-control">
            <input
              ref={input}
              id={ids.id}
              aria-describedby={ids.describedBy}
              aria-invalid={error ? true : undefined}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && active ? optionId(active) : undefined}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="hh:mm"
              value={text}
              required={required}
              onChange={(e) => typed(e.target.value)}
              onBlur={check}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="picker-button"
              tabIndex={-1}
              aria-label={`Show times for ${label.toLowerCase()}`}
              onClick={() => {
                setOpen(!open);
                input.current?.focus();
              }}
            >
              <Clock aria-hidden="true" />
            </button>
          </div>
          {open ? (
            <div ref={list} id={listId} role="listbox" aria-label={label} className="time-list">
              {options.map((t) => (
                // The input owns the keyboard (arrows, Enter) and points at the active option.
                // biome-ignore lint/a11y/useKeyWithClickEvents: keys are handled on the combobox input.
                <div
                  key={t}
                  id={optionId(t)}
                  data-time={t}
                  role="option"
                  tabIndex={-1}
                  aria-selected={t === value}
                  className={t === active ? 'active' : undefined}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => commit(t)}
                >
                  {t}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** A day and a time together, as one ISO local value "2026-10-27T15:00" (or null). */
export function DateTimeField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  required?: boolean;
}) {
  const [day, setDay] = useState<string | null>(value?.slice(0, 10) ?? null);
  const [time, setTime] = useState<string | null>(value?.slice(11, 16) ?? null);
  const update = (d: string | null, t: string | null) => {
    setDay(d);
    setTime(t);
    onChange(d && t ? `${d}T${t}` : null);
  };
  return (
    <fieldset className="datetime">
      <legend className="field-label">{label}</legend>
      <div className="datetime-row">
        <DateField
          label={`${label}, day`}
          hideLabel
          value={day}
          required={required}
          onChange={(d) => update(d, time)}
        />
        <TimeField
          label={`${label}, time`}
          hideLabel
          value={time}
          required={required}
          onChange={(t) => update(day, t)}
        />
      </div>
    </fieldset>
  );
}
