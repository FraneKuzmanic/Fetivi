import { DotsThree } from '@phosphor-icons/react';
import { Menu, type MenuItem } from './Menu';

/** A page head's rarer actions: one is shown as its own button, two or more go under "⋯". */
export function MoreActions({ label, items }: { label: string; items: MenuItem[] }) {
  const [only] = items;
  if (items.length === 1 && only) {
    return (
      <button type="button" className={only.danger ? 'danger' : undefined} onClick={only.onSelect}>
        {only.icon}
        {only.label}
      </button>
    );
  }
  return (
    <Menu label={label} trigger={<DotsThree aria-hidden="true" weight="bold" />} items={items} />
  );
}
