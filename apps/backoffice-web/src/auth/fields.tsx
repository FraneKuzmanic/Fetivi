import { Eye, EyeSlash } from '@phosphor-icons/react';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** A password input with a show/hide toggle; `aside` sits at the end of the label row. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  aside,
  invalid,
  errorId,
  isNew = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  aside?: ReactNode;
  invalid?: boolean;
  errorId?: string;
  /** A new password: 10 to 128 characters. */
  isNew?: boolean;
}) {
  const id = useId();
  const { t } = useTranslation('auth');
  const [shown, setShown] = useState(false);
  const describedBy = [hint ? `${id}-hint` : null, invalid && errorId ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="field-block">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="password-input">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={isNew ? 10 : undefined}
          maxLength={isNew ? 128 : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="reveal"
          aria-pressed={shown}
          aria-label={t('showPassword')}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
    </div>
  );
}

/** The email input of the signed-out pages. */
export function EmailField({
  value,
  onChange,
  invalid,
  errorId,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  errorId?: string;
}) {
  const { t } = useTranslation('auth');
  const id = useId();
  return (
    <div className="field-block">
      <label htmlFor={id}>{t('email')}</label>
      <input
        id={id}
        type="email"
        autoComplete="email"
        required
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && errorId ? errorId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
