import type { WizardFieldId, WizardLevel } from '@fetivi/domain/wizard';
import { CheckCircle } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import { useWizardCopy } from './copy';

export function LevelBadge({ level }: { level: WizardLevel }) {
  const { levels } = useWizardCopy();
  return <span className={`level level-${level}`}>{levels[level]}</span>;
}

/**
 * One wizard question: its label and level, why guests need it, an example, and the inputs.
 * The anchor id lets Suggestions (44) and the go-live checklist link straight to it.
 */
export function WizardField({
  id,
  level,
  filled,
  hint,
  children,
}: {
  id: WizardFieldId;
  level: WizardLevel;
  filled: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const { fields, ui } = useWizardCopy();
  const copy = fields[id];
  const headingId = useId();
  return (
    <section className="wizard-field" id={`field-${id}`} aria-labelledby={headingId}>
      <div className="wizard-field-head">
        <h3 id={headingId}>{copy.label}</h3>
        <LevelBadge level={level} />
        {filled ? (
          <CheckCircle className="wizard-filled" weight="fill" aria-label={ui.stepDone} />
        ) : null}
      </div>
      <p className="wizard-why">
        <span className="visually-hidden">{ui.why}: </span>
        {copy.why}
      </p>
      <p className="wizard-example">
        {ui.example}: {copy.example}
      </p>
      {hint ? <p className="wizard-hint">{hint}</p> : null}
      <div className="fields">{children}</div>
    </section>
  );
}
