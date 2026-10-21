import { PROPERTY_TYPES, type PropertyType } from '@fetivi/domain/vocabulary';
import {
  fieldsOfStep,
  WIZARD_STEP_IDS,
  type WizardStepId,
  wizardStepPath,
} from '@fetivi/domain/wizard';
import { CaretRight, CheckCircle } from '@phosphor-icons/react';
import { type ReactNode, useId } from 'react';
import { Link } from 'react-router';
import type { WizardStatus } from '../../api';
import { CompletenessBar } from './CompletenessBar';
import { format, useWizardCopy } from './copy';

/** The status of one step as a short chip text: Done, or what is left. */
export function useStepState() {
  const { ui } = useWizardCopy();
  return (status: WizardStatus, stepId: WizardStepId) => {
    // A step with no questions (Saved places) is not "Done": the host filled nothing in.
    if (fieldsOfStep(stepId).length === 0) return { tone: 'neutral', text: ui.noFields };
    const step = status.progress.steps[stepId];
    if (step.missingRequired.length > 0) {
      return { tone: 'wait', text: format(ui.requiredLeft, { n: step.missingRequired.length }) };
    }
    if (step.missingRecommended.length > 0) {
      return {
        tone: 'neutral',
        text: format(ui.recommendedLeft, { n: step.missingRecommended.length }),
      };
    }
    return { tone: 'ok', text: ui.stepDone };
  };
}

export function PropertyTypeChooser({
  value,
  disabled,
  onChange,
}: {
  value: PropertyType | null;
  disabled: boolean;
  onChange: (type: PropertyType) => void;
}) {
  const { ui, propertyTypes } = useWizardCopy();
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{ui.chooseType}</h2>
      <p className="muted">{ui.typeIntro}</p>
      <div className="type-options" role="radiogroup" aria-labelledby={headingId}>
        {PROPERTY_TYPES.map((type) => (
          <label key={type} className={value === type ? 'type-option selected' : 'type-option'}>
            <input
              type="radio"
              name="property-type"
              value={type}
              checked={value === type}
              disabled={disabled}
              onChange={() => onChange(type)}
            />
            <span>
              <strong>{propertyTypes[type].label}</strong>
              <small>{propertyTypes[type].hint}</small>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

/** The wizard's start page: type, completeness, the steps and the go-live checklist. */
export function WizardOverview({
  status,
  busy,
  onTypeChange,
  goLivePanel,
}: {
  status: WizardStatus;
  busy: boolean;
  onTypeChange: (type: PropertyType) => void;
  goLivePanel: ReactNode;
}) {
  const { ui, steps } = useWizardCopy();
  const stepState = useStepState();
  const stepsId = useId();
  const next = status.resumeStep;
  const typeChooser = (
    <PropertyTypeChooser value={status.propertyType} disabled={busy} onChange={onTypeChange} />
  );

  return (
    <div className="wizard-overview">
      <div className="wizard-main">
        {status.propertyType === null ? typeChooser : null}
        <section className="panel">
          <CompletenessBar {...status.progress} />
          <div className="actions">
            <Link
              className="button primary"
              to={wizardStepPath(status.unitId, next ?? WIZARD_STEP_IDS[0])}
            >
              {next ? ui.continueSetup : ui.review}
              <CaretRight aria-hidden="true" />
            </Link>
          </div>
        </section>
        <section className="panel" aria-labelledby={stepsId}>
          <h2 id={stepsId}>{ui.steps}</h2>
          <ol className="rows step-list">
            {WIZARD_STEP_IDS.map((stepId, i) => {
              const state = stepState(status, stepId);
              return (
                <li key={stepId}>
                  <Link className="row-link step-row" to={wizardStepPath(status.unitId, stepId)}>
                    <span className={`step-number ${state.tone}`} aria-hidden="true">
                      {state.tone === 'ok' ? <CheckCircle weight="fill" /> : i + 1}
                    </span>
                    <span className="step-title">{steps[stepId].title}</span>
                    <span className={`chip ${state.tone}`}>{state.text}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
        {status.propertyType === null ? null : typeChooser}
      </div>
      <div className="wizard-aside">{goLivePanel}</div>
    </div>
  );
}
