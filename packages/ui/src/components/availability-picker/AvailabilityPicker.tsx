import { useId, useRef, useState } from 'react';
import type { AvailabilityPickerPayload } from '../../payloads';
import { radioMove } from '../choice-card/radio';

type Start = AvailabilityPickerPayload['starts'][number];

export interface AvailabilityPickerLabels {
  heading: (date: string) => string;
  /** The local start time, or the "any time" text when the Offer has none. */
  time: (startsAtLocal: string | null) => string;
  placesLeft: (remaining: number) => string;
}

/**
 * The starts of one day. Active: a radio group like ChoiceCard's single mode (arrows move focus,
 * a tap, Enter or Space picks and tells Fetivi). Inactive: a read-only list.
 */
export function AvailabilityPicker({
  date,
  starts,
  active,
  onPick,
  labels,
}: {
  date: string;
  starts: readonly Start[];
  active: boolean;
  onPick: (start: Start) => void;
  labels: AvailabilityPickerLabels;
}) {
  const headingId = useId();
  const group = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const text = (start: Start) =>
    start.remaining === null
      ? labels.time(start.startsAtLocal)
      : `${labels.time(start.startsAtLocal)} · ${labels.placesLeft(start.remaining)}`;

  const heading = (
    <h3 id={headingId} className="fv-choice-question">
      {labels.heading(date)}
    </h3>
  );
  if (!active) {
    return (
      <div className="fv-choice">
        {heading}
        <ul className="fv-choice-past">
          {starts.map((start, i) => (
            <li key={start.slotId ?? i}>{text(start)}</li>
          ))}
        </ul>
      </div>
    );
  }

  const move = (key: string, index: number) => {
    const to = radioMove(key, index, starts.length);
    if (to === null) return false;
    setFocus(to);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus();
    return true;
  };
  return (
    <div className="fv-choice">
      {heading}
      <div ref={group} role="radiogroup" aria-labelledby={headingId} className="fv-choice-options">
        {starts.map((start, index) => (
          // As in ChoiceCard: a pick sends a message, so arrows only move focus.
          // biome-ignore lint/a11y/useSemanticElements: see above.
          <button
            key={start.slotId ?? index}
            type="button"
            role="radio"
            aria-checked={false}
            tabIndex={index === focus ? 0 : -1}
            className="fv-option"
            onKeyDown={(e) => {
              if (move(e.key, index)) e.preventDefault();
            }}
            onFocus={() => setFocus(index)}
            onClick={() => onPick(start)}
          >
            {text(start)}
          </button>
        ))}
      </div>
    </div>
  );
}
