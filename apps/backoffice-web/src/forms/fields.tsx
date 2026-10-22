import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useAction } from '../useAction';

// Controlled inputs for the host forms. Empty text means null: the API clears the field, and on a
// unit null means "use the property's value".

interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** Keeps the label for screen readers only, where a heading above already shows it. */
  hideLabel?: boolean;
}

/** A labelled control; `children` renders the control with the id and description it is given. */
function Field({
  label,
  hint,
  hideLabel,
  children,
}: FieldProps & { children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label className={hideLabel ? 'field-label visually-hidden' : 'field-label'} htmlFor={id}>
        {label}
      </label>
      {children(hint ? { id, describedBy: hintId } : { id })}
      {hint ? <small id={hintId}>{hint}</small> : null}
    </div>
  );
}

export function TextField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  maxLength,
  placeholder,
  required,
  type = 'text',
  autoComplete = 'off',
}: FieldProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength: number;
  placeholder?: string | undefined;
  required?: boolean;
  type?: 'text' | 'tel' | 'email' | 'date';
  autoComplete?: string;
}) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <input
          id={ids.id}
          aria-describedby={ids.describedBy}
          type={type}
          value={value ?? ''}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  maxLength,
  placeholder,
  rows = 4,
  required,
  monospace,
}: FieldProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  maxLength: number;
  placeholder?: string | undefined;
  rows?: number;
  required?: boolean;
  monospace?: boolean;
}) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <textarea
          id={ids.id}
          aria-describedby={ids.describedBy}
          className={monospace ? 'mono' : undefined}
          value={value ?? ''}
          maxLength={maxLength}
          placeholder={placeholder}
          rows={rows}
          required={required}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )}
    </Field>
  );
}

export function NumberField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  min,
  max,
  step = 1,
  placeholder,
  required,
}: FieldProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  min: number;
  max: number;
  step?: number | 'any';
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <input
          id={ids.id}
          aria-describedby={ids.describedBy}
          type="number"
          inputMode={step === 'any' ? 'decimal' : 'numeric'}
          value={value ?? ''}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          required={required}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      )}
    </Field>
  );
}

export function TimeField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
}: FieldProps & { value: string | null; onChange: (value: string | null) => void }) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <input
          id={ids.id}
          aria-describedby={ids.describedBy}
          type="time"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  options,
  labels,
  emptyLabel,
  required,
}: FieldProps & {
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly T[];
  labels: Record<T, string>;
  /** The label of the null choice; leave out when a value is required. */
  emptyLabel?: string;
  /** With an `emptyLabel`: the browser refuses to submit the null choice. */
  required?: boolean;
}) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <select
          id={ids.id}
          aria-describedby={ids.describedBy}
          value={value ?? ''}
          required={required}
          onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as T))}
        >
          {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {labels[o]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Yes, No, or not set (on a unit: use the property's value). */
export function TriStateField({
  label,
  hint,
  hideLabel,
  value,
  onChange,
  nullLabel = 'Not set',
  yesLabel = 'Yes',
  noLabel = 'No',
}: FieldProps & {
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  nullLabel?: string;
  yesLabel?: string;
  noLabel?: string;
}) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(ids) => (
        <select
          id={ids.id}
          aria-describedby={ids.describedBy}
          value={value === null ? '' : value ? 'yes' : 'no'}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
        >
          <option value="">{nullLabel}</option>
          <option value="yes">{yesLabel}</option>
          <option value="no">{noLabel}</option>
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * One titled part of an editor, saved on its own. Small saves keep a PATCH to the fields the host
 * is looking at, so an untouched section is never cleared by accident.
 */
export function Section({
  id,
  title,
  description,
  onSave,
  saveLabel = 'Save',
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  onSave?: () => Promise<void>;
  saveLabel?: string;
  children: ReactNode;
}) {
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  const headingId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!onSave) return;
    setSaved(false);
    void run(async () => {
      await onSave();
      setSaved(true);
    });
  }

  const body = (
    <>
      <div className="fields">{children}</div>
      {onSave ? (
        <div className="section-foot">
          {error ? <p role="alert">{error}</p> : null}
          {saved && !error ? (
            <output className="saved" aria-live="polite">
              Saved
            </output>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>
            {saveLabel}
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <section id={id} className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {onSave ? <form onSubmit={submit}>{body}</form> : body}
    </section>
  );
}
