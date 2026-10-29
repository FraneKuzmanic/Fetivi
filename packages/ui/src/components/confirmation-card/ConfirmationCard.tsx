import type { PaymentMode, PriceUnit } from '@fetivi/domain/offer-vocabulary';
import type { WarningLevel } from '@fetivi/domain/weather-vocabulary';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { OrderDraft, OrderWarningPayload } from '../../payloads';
import { type CancellationTermsLabels, cancellationTermsText } from '../cancellation-terms';

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
  terms: CancellationTermsLabels;
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
  /** The guest's note: what the provider should know. */
  detailsField: string;
  detailsHint: string;
  /** Shown near the limit only. */
  detailsCount: (length: number, max: number) => string;
  /** The wished time of an Offer whose start has no time. */
  timeField: string;
  timeHint: string;
  invalidTime: string;
  warnings: {
    heading: string;
    /** 'HH:mm', or null when the host set no checkout time. */
    checkoutDay: (checkoutTime: string | null) => string;
    weather: (level: WarningLevel, event: string) => string;
  };
}

/** Which editable details the server's form has. */
export interface ConfirmationDetails {
  note: boolean;
  time: boolean;
}

const NOTE_MAX = 500;
/** The count shows from here on, so a short note stays uncluttered. */
const NOTE_COUNT_FROM = 400;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

type FieldName = ContactField | 'time';

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
  details = { note: false, time: false },
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
  /** The note and wished time, prefilled from the draft; the guest may change or clear them. */
  details?: ConfirmationDetails;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...initialValues }));
  const [note, setNote] = useState(draft.note ?? '');
  const [time, setTime] = useState(draft.requestedTime ?? '');
  const [errors, setErrors] = useState<readonly FieldName[]>([]);

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
    const invalid: FieldName[] = [];
    if (details.time) {
      const value = time.trim();
      if (value !== '' && !HHMM.test(value)) invalid.push('time');
      else if (value !== '') content.time = value;
    }
    // A cleared detail is not sent: the order then has none.
    if (details.note && note.trim() !== '') content.note = note.trim();
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

  // Nothing is paid before the guest confirms, so no refund wording yet.
  const terms = cancellationTermsText(draft.cancellation, draft.paymentMode, false, labels.terms);
  const facts: [string, string][] = [
    [labels.offer, draft.offerTitle],
    [labels.when, labels.dateTime(draft.date, draft.startsAtLocal)],
    [labels.quantity(draft.priceUnit), String(draft.quantity)],
    [labels.total, labels.price(draft.priceMinor, draft.currency)],
    [labels.payment, labels.paymentMode(draft.paymentMode)],
    ...(terms ? [[labels.cancellation, terms] as [string, string]] : []),
  ];

  return (
    <section className="fv-confirm" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-confirm-heading">
        {labels.heading}
      </h3>
      {draft.warnings.length > 0 && (
        <div className="fv-confirm-warnings" role="note" aria-label={labels.warnings.heading}>
          <p className="fv-confirm-warnings-heading">{labels.warnings.heading}</p>
          <ul>
            {draft.warnings.map((warning) => (
              <li key={warningKey(warning)} data-level={warningLevel(warning)}>
                {warning.kind === 'checkout_day'
                  ? labels.warnings.checkoutDay(warning.checkoutTime)
                  : labels.warnings.weather(warning.level, warning.event)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <dl className="fv-confirm-facts">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <form ref={form} noValidate aria-labelledby={headingId} onSubmit={submit}>
        {details.time && (
          <div className="fv-field">
            <label htmlFor={`${id}-time`}>{labels.timeField}</label>
            <input
              id={`${id}-time`}
              name="time"
              type="time"
              disabled={sending}
              value={time}
              aria-invalid={errors.includes('time') || undefined}
              aria-describedby={
                errors.includes('time') ? `${id}-time-error ${id}-time-hint` : `${id}-time-hint`
              }
              onChange={(e) => setTime(e.target.value)}
            />
            <p id={`${id}-time-hint`} className="fv-confirm-note">
              {labels.timeHint}
            </p>
            {errors.includes('time') && (
              <p id={`${id}-time-error`} className="fv-field-error">
                {labels.invalidTime}
              </p>
            )}
          </div>
        )}
        {details.note && (
          <div className="fv-field">
            <label htmlFor={`${id}-note`}>{labels.detailsField}</label>
            <textarea
              id={`${id}-note`}
              name="note"
              rows={3}
              maxLength={NOTE_MAX}
              disabled={sending}
              value={note}
              aria-describedby={`${id}-note-hint`}
              onChange={(e) => setNote(e.target.value)}
            />
            <p id={`${id}-note-hint`} className="fv-confirm-note">
              {labels.detailsHint}
            </p>
            {note.length >= NOTE_COUNT_FROM && (
              <p className="fv-field-hint">{labels.detailsCount(note.length, NOTE_MAX)}</p>
            )}
          </div>
        )}
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

const warningKey = (w: OrderWarningPayload) =>
  w.kind === 'checkout_day' ? 'checkout' : `${w.type}-${w.level}-${w.onset}`;

/** A checkout clash reads as a yellow heads-up; a weather warning keeps its DHMZ level. */
const warningLevel = (w: OrderWarningPayload): WarningLevel =>
  w.kind === 'checkout_day' ? 'yellow' : w.level;
