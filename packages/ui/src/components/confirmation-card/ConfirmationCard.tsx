import type { PaymentMode, PriceUnit } from '@fetivi/domain/offer-vocabulary';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { OrderDraft } from '../../payloads';

export type ContactField = 'email' | 'name' | 'phone';

export interface ConfirmationCardLabels {
  heading: string;
  offer: string;
  when: string;
  /** The quantity's heading, named by its unit. */
  quantity: (unit: PriceUnit) => string;
  total: string;
  payment: string;
  cancellation: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
  /** null: the provider sets the price. */
  price: (priceMinor: number | null, currency: string) => string;
  paymentMode: (mode: PaymentMode) => string;
  field: Record<ContactField, string>;
  invalid: Record<ContactField, string>;
  /** Who gets the details, and that the confirmation goes to the email. */
  note: string;
  /** Pay-online only: the guest pays on Stripe's page next; charged only once confirmed. */
  noteOnline: string;
  confirm: string;
  /** The confirm button of a pay-online draft. */
  confirmOnline: string;
  cancel: string;
  sending: string;
}

const RULES: Record<ContactField, (value: string) => boolean> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254,
  name: (v) => v.length >= 1 && v.length <= 100,
  // The server's rule: 6–20 characters of digits, spaces, brackets and dashes, an optional +.
  phone: (v) => v.length >= 6 && v.length <= 20 && /^\+?[0-9 ()-]+$/.test(v),
};

const INPUT: Record<ContactField, { type: string; autoComplete: string; inputMode?: 'tel' }> = {
  email: { type: 'email', autoComplete: 'email' },
  name: { type: 'text', autoComplete: 'name' },
  phone: { type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
};

/**
 * The Order confirmation: every fact comes from the stored draft, never from model text, and
 * nothing is sent before Confirm. Errors show on submit, tied to their field; the first invalid
 * field takes focus. The card never takes focus on its own.
 */
export function ConfirmationCard({
  draft,
  fields,
  state,
  onConfirm,
  onCancel,
  labels,
  initialValues,
}: {
  draft: OrderDraft;
  /** The form the server asked for, in order. */
  fields: readonly { name: ContactField; required: boolean }[];
  state: 'open' | 'sending';
  onConfirm: (content: Record<string, string>) => void;
  onCancel: () => void;
  labels: ConfirmationCardLabels;
  /**
   * Values the form starts with, such as the email the guest already gave; still editable. One
   * that arrives later fills its field only while the field is empty, so typing is never lost.
   */
  initialValues?: Partial<Record<ContactField, string>>;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initialValues }));
  const [errors, setErrors] = useState<readonly ContactField[]>([]);

  useEffect(() => {
    if (!initialValues) return;
    setValues((current) => {
      const filled = { ...current };
      for (const [name, value] of Object.entries(initialValues)) {
        if (value && !current[name]) filled[name] = value;
      }
      return filled;
    });
  }, [initialValues]);
  const sending = state === 'sending';
  const online = draft.paymentMode === 'online';
  const headingId = `${id}-heading`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const content: Record<string, string> = {};
    const invalid: ContactField[] = [];
    for (const { name, required } of fields) {
      const value = (values[name] ?? '').trim();
      if (value === '' && !required) continue;
      if (!RULES[name](value)) invalid.push(name);
      else content[name] = value;
    }
    setErrors(invalid);
    if (invalid.length > 0) {
      form.current?.querySelector<HTMLInputElement>(`[name="${invalid[0]}"]`)?.focus();
      return;
    }
    onConfirm(content);
  };

  const facts: [string, string][] = [
    [labels.offer, draft.offerTitle],
    [labels.when, labels.dateTime(draft.date, draft.startsAtLocal)],
    [labels.quantity(draft.priceUnit), String(draft.quantity)],
    [labels.total, labels.price(draft.priceMinor, draft.currency)],
    [labels.payment, labels.paymentMode(draft.paymentMode)],
    [labels.cancellation, draft.cancellationPolicy],
  ];

  return (
    <section className="fv-confirm" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-confirm-heading">
        {labels.heading}
      </h3>
      <dl className="fv-confirm-facts">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <form ref={form} noValidate aria-labelledby={headingId} onSubmit={submit}>
        {fields.map(({ name, required }) => {
          const inputId = `${id}-${name}`;
          const errorId = `${inputId}-error`;
          const invalid = errors.includes(name);
          return (
            <div key={name} className="fv-field">
              <label htmlFor={inputId}>{labels.field[name]}</label>
              <input
                id={inputId}
                name={name}
                {...INPUT[name]}
                required={required}
                disabled={sending}
                value={values[name] ?? ''}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              />
              {invalid && (
                <p id={errorId} className="fv-field-error">
                  {labels.invalid[name]}
                </p>
              )}
            </div>
          );
        })}
        <p className="fv-confirm-note">{labels.note}</p>
        {online && <p className="fv-confirm-note">{labels.noteOnline}</p>}
        <div className="fv-confirm-actions">
          <button type="submit" className="fv-confirm-yes" disabled={sending}>
            {online ? labels.confirmOnline : labels.confirm}
          </button>
          <button type="button" className="fv-confirm-no" disabled={sending} onClick={onCancel}>
            {labels.cancel}
          </button>
        </div>
        {sending && (
          <p role="status" className="fv-confirm-sending">
            {labels.sending}
          </p>
        )}
      </form>
    </section>
  );
}
