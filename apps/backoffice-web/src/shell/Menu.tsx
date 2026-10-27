import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

/**
 * A button that opens a short list of actions (the profile menu, a row's "⋯"). Arrow keys move
 * between items, Escape and a click outside close it, and focus returns to the button.
 */
export function Menu({
  label,
  trigger,
  items,
  header,
  className = 'icon-button',
  align = 'end',
  up = false,
}: {
  /** The button's accessible name, e.g. "More actions for Wi-Fi". */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  /** Non-interactive lines above the items, such as the signed-in email. */
  header?: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  /** Opens above the button, for one at the bottom of the screen. */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const itemsOf = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ];

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    const all = itemsOf();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      all[(at + 1) % all.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      all[(at - 1 + all.length) % all.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      all[all.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className={`menu-list ${align}${up ? ' up' : ''}`}
          onKeyDown={onKeyDown}
        >
          {header ? <div className="menu-header">{header}</div> : null}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
