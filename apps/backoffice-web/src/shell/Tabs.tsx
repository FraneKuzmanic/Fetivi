import type { KeyboardEvent } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A count after the label, such as how many wait. */
  count?: number;
}

/**
 * A row of underlined tabs that filter the list below. Left and right arrows move between
 * them (and choose), so only the current tab is in the Tab order.
 */
export function Tabs<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  /** Names the row for screen readers, e.g. "Order status". */
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = items.findIndex((t) => t.id === value);
    const n = items.length;
    const targets: Record<string, number> = {
      ArrowRight: (at + 1) % n,
      ArrowLeft: (at - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    const to = targets[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = items[to];
    if (!next) return;
    onChange(next.id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="tab-link"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
