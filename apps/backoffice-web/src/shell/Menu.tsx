import { CaretRight } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface MenuItemBase {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** The label's language when it differs from the page's, e.g. a language under its own name. */
  lang?: string;
  /** The chosen one of a group of options, announced as checked. */
  current?: boolean;
  /** The accessible name when the visible label alone is unclear, e.g. "Language: Hrvatski". */
  name?: string;
}

/** An action, or a parent item whose chevron opens a submenu of actions. */
export type MenuItem =
  | (MenuItemBase & { onSelect: () => void; submenu?: never })
  | (MenuItemBase & { submenu: MenuItem[]; onSelect?: never });

/** Where a submenu opens: beside the list where it fits (right first), else in place below its item. */
export function submenuSide(
  list: { left: number; right: number },
  width: number,
  viewport: number,
): 'left' | 'right' | 'inline' {
  if (viewport - list.right - 8 >= width) return 'right';
  if (list.left - 8 >= width) return 'left';
  return 'inline';
}

const HIDDEN: CSSProperties = { visibility: 'hidden' };

/**
 * A button that opens a short list of actions (the profile menu, a row's "⋯"). Arrow keys move
 * between items, Escape and a click outside close it, and focus returns to the button.
 *
 * An item can open a submenu (Enter, Space or ArrowRight; ArrowLeft or Escape goes back to it). The
 * submenu floats beside the list where there is room, else opens in place below its item.
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
  const subId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Hidden until placed, so the list never flashes at the corner of the screen.
  const [pos, setPos] = useState<CSSProperties>(HIDDEN);
  // The open submenu's parent label, and where its list sits.
  const [sub, setSub] = useState<string | null>(null);
  const [subPos, setSubPos] = useState<CSSProperties | 'inline'>(HIDDEN);

  const itemsOf = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>(':scope > [role^="menuitem"]') ?? []),
  ];
  const subItemsOf = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>('[data-submenu] [role^="menuitem"]') ??
      []),
  ];
  const parentOf = () =>
    list.current?.querySelector<HTMLButtonElement>(':scope > [aria-expanded="true"]');

  const close = (refocus: boolean) => {
    setOpen(false);
    setSub(null);
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
      setPos(HIDDEN);
    };
  }, [open, up, align]);

  // The submenu first renders hidden as a flyout so its width can be measured, then floats beside
  // the list, or opens in place when neither side has room.
  useLayoutEffect(() => {
    if (!sub) return;
    const element = document.getElementById(subId);
    const width = element?.offsetWidth ?? 0;
    const place = () => {
      const box = list.current?.getBoundingClientRect();
      const item = document.querySelector(`[aria-controls="${subId}"]`)?.getBoundingClientRect();
      if (!box || !item) return;
      const viewport = document.documentElement.clientWidth;
      const side = submenuSide(box, width, viewport);
      if (side === 'inline') return setSubPos('inline');
      const height = element?.offsetHeight ?? 0;
      const top = Math.max(8, Math.min(item.top - 6, window.innerHeight - 8 - height));
      setSubPos(
        side === 'right' ? { top, left: box.right + 4 } : { top, right: viewport - box.left + 4 },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, { capture: true });
      setSubPos(HIDDEN);
    };
  }, [sub, subId]);

  // A browser does not focus a hidden element, so the first item takes focus once it is placed.
  const placed = pos.visibility !== 'hidden';
  useEffect(() => {
    if (open && placed)
      list.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
  }, [open, placed]);

  const subPlaced = subPos === 'inline' || subPos.visibility !== 'hidden';
  useEffect(() => {
    if (sub && subPlaced)
      list.current?.querySelector<HTMLButtonElement>('[data-submenu] [role^="menuitem"]')?.focus();
  }, [sub, subPlaced]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !list.current?.contains(target)) {
        setOpen(false);
        setSub(null);
      }
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLButtonElement | null;
    const inSub = Boolean(active?.closest('[data-submenu]'));
    const all = inSub ? subItemsOf() : itemsOf();
    const at = all.indexOf(active as HTMLButtonElement);
    if (inSub && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
      event.preventDefault();
      const parent = parentOf();
      setSub(null);
      parent?.focus();
    } else if (!inSub && event.key === 'ArrowRight' && items[at]?.submenu) {
      event.preventDefault();
      setSub(items[at].label);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      // Moving on from a parent item closes its submenu.
      if (!inSub) setSub(null);
      const next = {
        ArrowDown: (at + 1) % all.length,
        ArrowUp: (at - 1 + all.length) % all.length,
        Home: 0,
        End: all.length - 1,
      }[event.key];
      if (next !== undefined) all[next]?.focus();
    } else if (event.key === 'Tab') {
      // Back on the button first, so Tab moves on from it rather than from the end of the body.
      close(true);
    }
  };

  const action = (item: MenuItem) => (
    <button
      key={item.label}
      type="button"
      {...(item.current === undefined
        ? { role: 'menuitem' }
        : { role: 'menuitemradio', 'aria-checked': item.current })}
      tabIndex={-1}
      aria-label={item.name}
      className={item.danger ? 'menu-item danger' : 'menu-item'}
      onClick={() => {
        close(true);
        item.onSelect?.();
      }}
    >
      {item.icon}
      <span lang={item.lang}>{item.label}</span>
    </button>
  );

  const parent = (item: MenuItem & { submenu: MenuItem[] }) => {
    const expanded = sub === item.label;
    return [
      <button
        key={item.label}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-label={item.name}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? subId : undefined}
        className="menu-item"
        onClick={() => setSub(expanded ? null : item.label)}
      >
        {item.icon}
        <span lang={item.lang}>{item.label}</span>
        <CaretRight className="menu-chevron" aria-hidden="true" />
      </button>,
      expanded ? (
        <div
          key={`${item.label}-submenu`}
          id={subId}
          role="menu"
          aria-label={item.name ?? item.label}
          data-submenu=""
          className={subPos === 'inline' ? 'menu-sub inline' : 'menu-sub'}
          style={subPos === 'inline' ? undefined : subPos}
        >
          {item.submenu.map(action)}
        </div>
      ) : null,
    ];
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
              {items.map((item) => (item.submenu ? parent(item) : action(item)))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
