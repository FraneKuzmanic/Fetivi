import { type ReactNode, useId } from 'react';

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  /** Keeps the label for screen readers only, where a heading above already shows it. */
  hideLabel?: boolean;
}

/** A labelled control; `children` renders the control with the id and description it is given. */
export function Field({
  label,
  hint,
  hideLabel,
  error,
  children,
}: FieldProps & {
  /** A problem with what was typed, shown under the control and read out with it. */
  error?: string | null;
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label className={hideLabel ? 'field-label visually-hidden' : 'field-label'} htmlFor={id}>
        {label}
      </label>
      {children(describedBy ? { id, describedBy } : { id })}
      {error ? (
        <small id={errorId} className="field-error">
          {error}
        </small>
      ) : null}
      {hint ? <small id={hintId}>{hint}</small> : null}
    </div>
  );
}
