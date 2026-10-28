import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  /** The label's language when it differs from the page's, e.g. a language under its own name. */
  lang?: string;
  /** A non-interactive line above the item that names the group it starts, e.g. "Language". */
  caption?: string;
  /** The chosen one of a group of options, announced as checked. */
  current?: boolean;
}

/**
 * A button that opens a short list of actions (the profile menu, a row's "⋯"). Arrow keys move
 * between items, Escape and a click outside close it, and focus returns to the button.
 *
 * The list floats in the body above everything, so a table row or a sticky bar can never cover it
 * and opening it never moves the page. A Menu inside a modal `<dialog>` would sit under the
 * dialog's top layer; none is placed there.
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
  // Hidden until placed, so the list never flashes at the corner of the screen.
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });

  const itemsOf = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []),
  ];

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Placed from the button's box, again on every scroll (a table's too) and resize; it opens
  // upward when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const height = list.current?.offsetHeight ?? 0;
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const openUp = up || (height > below && above > below);
      const width = document.documentElement.clientWidth;
      setPos({
        ...(openUp ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
        ...(align === 'end'
          ? { right: Math.max(8, width - r.right) }
          : { left: Math.max(8, r.left) }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, { capture: true });
      setPos({ visibility: 'hidden' });
    };
  }, [open, up, align]);

  // A browser does not focus a hidden element, so the first item takes focus once it is placed.
  const placed = pos.visibility !== 'hidden';
  useEffect(() => {
    if (open && placed)
      list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !list.current?.contains(target)) setOpen(false);
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
      // Back on the button first, so Tab moves on from it rather than from the end of the body.
      close(true);
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
      {open
        ? createPortal(
            <div
              ref={list}
              id={id}
              role="menu"
              aria-label={label}
              className="menu-list"
              style={pos}
              onKeyDown={onKeyDown}
            >
              {header ? <div className="menu-header">{header}</div> : null}
              {items.map((item) => (
                <Fragment key={item.label}>
                  {item.caption ? (
                    <span className="menu-caption menu-group" aria-hidden="true">
                      {item.caption}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    {...(item.current === undefined
                      ? { role: 'menuitem' }
                      : { role: 'menuitemradio', 'aria-checked': item.current })}
                    tabIndex={-1}
                    className={item.danger ? 'menu-item danger' : 'menu-item'}
                    onClick={() => {
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {item.icon}
                    <span lang={item.lang}>{item.label}</span>
                  </button>
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
