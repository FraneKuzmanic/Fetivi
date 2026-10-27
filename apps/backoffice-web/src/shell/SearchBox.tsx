import { MagnifyingGlass } from '@phosphor-icons/react';
import { useId } from 'react';

/** A search over the list below, its label kept for screen readers. */
export function SearchBox({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="search search-field with-icon-left">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <MagnifyingGlass className="search-icon" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
