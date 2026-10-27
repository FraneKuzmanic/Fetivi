import { OFFER_DEFAULTS, OFFER_LIMITS } from '@fetivi/domain/offer-vocabulary';
import { Fragment, useId } from 'react';
import { refundLine } from '../../admin/providers/OfferPage';
import { NumberField } from '../../forms/fields';

export type CancellationKind = 'free' | 'until' | 'none';

export interface CancellationRules {
  freeCancelHoursBefore: number | null;
  refundPercentAfter: number | null;
}

/** Which of the three choices a pair of stored rules is. */
export function cancellationKind(rules: CancellationRules): CancellationKind {
  if (rules.refundPercentAfter === 100) return 'free';
  if (rules.freeCancelHoursBefore) return 'until';
  return 'none';
}

const CHOICES: { kind: CancellationKind; label: string; help: string }[] = [
  {
    kind: 'free',
    label: 'Free cancellation',
    help: 'Guests can cancel at any time and get all their money back.',
  },
  {
    kind: 'until',
    label: 'Free until shortly before',
    help: 'Free up to a number of hours before the start, a partial refund or none after that.',
  },
  { kind: 'none', label: 'No refunds', help: 'Once confirmed, the order is paid in full.' },
];

/** The rules each choice sets when picked; "until" starts from the usual 24 hours. */
function rulesFor(kind: CancellationKind, current: CancellationRules): CancellationRules {
  if (kind === 'free') return { freeCancelHoursBefore: 0, refundPercentAfter: 100 };
  if (kind === 'none') return { freeCancelHoursBefore: 0, refundPercentAfter: 0 };
  return {
    freeCancelHoursBefore: current.freeCancelHoursBefore || OFFER_DEFAULTS.freeCancelHoursBefore,
    refundPercentAfter:
      current.refundPercentAfter === 100
        ? OFFER_DEFAULTS.refundPercentAfter
        : (current.refundPercentAfter ?? 0),
  };
}

/** What happens when a guest cancels: three plain choices instead of two bare numbers. */
export function CancellationRulesField({
  value,
  onChange,
}: {
  value: CancellationRules;
  onChange: (rules: CancellationRules) => void;
}) {
  const name = useId();
  const kind = cancellationKind(value);
  return (
    <fieldset className="choice-list">
      <legend className="field-label">When a guest cancels</legend>
      {CHOICES.map((choice) => (
        <Fragment key={choice.kind}>
          <label className="choice-option">
            <input
              type="radio"
              name={name}
              checked={kind === choice.kind}
              onChange={() => onChange(rulesFor(choice.kind, value))}
            />
            <span>
              <strong>{choice.label}</strong>
              <small>{choice.help}</small>
            </span>
          </label>
          {choice.kind === 'until' && kind === 'until' ? (
            <div className="field-row choice-detail">
              <NumberField
                label="Free until (hours before the start)"
                value={value.freeCancelHoursBefore}
                min={1}
                max={OFFER_LIMITS.freeCancelHoursMax}
                onChange={(h) => onChange({ ...value, freeCancelHoursBefore: h })}
              />
              <NumberField
                label="Refund after that (%)"
                value={value.refundPercentAfter}
                min={0}
                max={99}
                onChange={(p) => onChange({ ...value, refundPercentAfter: p })}
              />
            </div>
          ) : null}
        </Fragment>
      ))}
      <p className="muted">{refundLine(value.freeCancelHoursBefore, value.refundPercentAfter)}</p>
    </fieldset>
  );
}

/** A first draft of the policy text from the rules, for the host to adjust. */
export function policyFromRules(rules: CancellationRules): string {
  return refundLine(rules.freeCancelHoursBefore, rules.refundPercentAfter);
}
