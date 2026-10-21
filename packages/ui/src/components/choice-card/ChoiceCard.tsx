import { Check } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { radioMove } from './radio';

export interface ChoiceCardLabels {
  send: string;
  somethingElse: string;
}

/**
 * A question with tappable options. Single: a radio group where arrow keys only move focus and a
 * tap, Enter or Space answers at once (unlike About me's ChoiceGroup, where arrows choose: here a
 * choice sends a message). Multiple: toggle buttons and Send. Inactive: read-only text.
 */
export function ChoiceCard({
  question,
  options,
  multiple,
  active,
  onAnswer,
  onSomethingElse,
  labels,
}: {
  question: string;
  options: readonly string[];
  multiple: boolean;
  /** False on older messages: the question stays readable but is no longer a control. */
  active: boolean;
  onAnswer: (text: string) => void;
  onSomethingElse: () => void;
  labels: ChoiceCardLabels;
}) {
  const questionId = useId();
  const group = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const [picked, setPicked] = useState<readonly string[]>([]);

  const heading = (
    <h3 id={questionId} className="fv-choice-question">
      {question}
    </h3>
  );
  if (!active) {
    return (
      <div className="fv-choice">
        {heading}
        <ul className="fv-choice-past">
          {options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      </div>
    );
  }

  const somethingElse = (
    <button type="button" className="fv-choice-else" onClick={onSomethingElse}>
      {labels.somethingElse}
    </button>
  );

  if (multiple) {
    const toggle = (option: string) =>
      setPicked((p) => (p.includes(option) ? p.filter((o) => o !== option) : [...p, option]));
    return (
      <div className="fv-choice">
        {heading}
        <fieldset aria-labelledby={questionId} className="fv-choice-options">
          {options.map((option) => {
            const on = picked.includes(option);
            return (
              <button
                key={option}
                type="button"
                className="fv-option"
                aria-pressed={on}
                onClick={() => toggle(option)}
              >
                {on && <Check aria-hidden="true" weight="bold" />}
                {option}
              </button>
            );
          })}
        </fieldset>
        <div className="fv-choice-actions">
          <button
            type="button"
            className="fv-choice-send"
            disabled={picked.length === 0}
            onClick={() => onAnswer(options.filter((o) => picked.includes(o)).join(', '))}
          >
            {labels.send}
          </button>
          {somethingElse}
        </div>
      </div>
    );
  }

  const move = (key: string, index: number) => {
    const to = radioMove(key, index, options.length);
    if (to === null) return false;
    setFocus(to);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
    return true;
  };
  return (
    <div className="fv-choice">
      {heading}
      <div ref={group} role="radiogroup" aria-labelledby={questionId} className="fv-choice-options">
        {options.map((option, index) => (
          // A native radio is chosen by arrow keys; here a choice sends a message, so only a tap,
          // Enter or Space may answer.
          // biome-ignore lint/a11y/useSemanticElements: see above.
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={false}
            tabIndex={index === focus ? 0 : -1}
            className="fv-option"
            onKeyDown={(e) => {
              if (move(e.key, index)) e.preventDefault();
            }}
            onFocus={() => setFocus(index)}
            onClick={() => onAnswer(option)}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="fv-choice-actions">{somethingElse}</div>
    </div>
  );
}
