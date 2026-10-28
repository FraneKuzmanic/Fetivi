import {
  type AboutMe,
  BUDGETS,
  type Budget,
  INTERESTS,
  type Interest,
  NEEDS,
  type Need,
  PACES,
  PARTY_SHAPES,
  type Pace,
  type PartyShape,
  TRANSPORTS,
  type Transport,
} from '@fetivi/domain/about-me-vocabulary';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MascotSays } from '../shell/Mascot';
import { getAboutMe, saveAboutMe } from './about-me-api';
import { ChoiceGroup } from './ChoiceGroup';

type Field = keyof AboutMe;

/** The About me fields in display order: the flow's six questions and the page's sections. */
export const STEPS = [
  { field: 'party', title: 'aboutMe.partyTitle', labels: 'party', codes: PARTY_SHAPES },
  { field: 'interests', title: 'aboutMe.interestsTitle', labels: 'interest', codes: INTERESTS },
  { field: 'pace', title: 'aboutMe.paceTitle', labels: 'pace', codes: PACES },
  { field: 'budget', title: 'aboutMe.budgetTitle', labels: 'budget', codes: BUDGETS },
  { field: 'transport', title: 'aboutMe.transportTitle', labels: 'transport', codes: TRANSPORTS },
  { field: 'needs', title: 'aboutMe.needsTitle', labels: 'need', codes: NEEDS },
] as const satisfies readonly {
  field: Field;
  title: string;
  labels: string;
  codes: readonly string[];
}[];
export type Step = (typeof STEPS)[number];

type LabelKey =
  | `party.${PartyShape}`
  | `interest.${Interest}`
  | `pace.${Pace}`
  | `budget.${Budget}`
  | `transport.${Transport}`
  | `need.${Need}`;

/** The i18n key of one code's label; the locale sections are keyed by the vocabulary codes. */
export const labelKey = (step: Step, code: string) => `${step.labels}.${code}` as LabelKey;

export const isMultiple = (field: Field) => field === 'interests' || field === 'needs';

/** A field's saved codes as a list (a single value becomes a one-item list). */
export function valuesOf(aboutMe: AboutMe, field: Field): string[] {
  const value = aboutMe[field];
  if (Array.isArray(value)) return value;
  return value === null ? [] : [value];
}

/** `aboutMe` with one field set from a list of codes. */
export function withValues(aboutMe: AboutMe, field: Field, codes: string[]): AboutMe {
  return {
    ...aboutMe,
    [field]: isMultiple(field) ? codes : (codes[0] ?? null),
  } as AboutMe;
}

type Load = { status: 'loading' } | { status: 'offline' } | { status: 'ready'; saved: AboutMe };

/** The tap-only "Tell me about your trip" flow: six questions, each skippable; saves after every step. */
export function TripFlow({
  onFinish,
  initial,
  startStep = 0,
}: {
  /** Called once after the last question with the saved value. */
  onFinish: (aboutMe: AboutMe) => void;
  /** Tests start from a known value; the app loads it. */
  initial?: AboutMe;
  /** Tests open a given question (0–5). */
  startStep?: number;
}) {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>(
    initial ? { status: 'ready', saved: initial } : { status: 'loading' },
  );
  const [index, setIndex] = useState(startStep);
  const [selection, setSelection] = useState<string[]>(() =>
    initial ? valuesOf(initial, STEPS[startStep]?.field ?? 'party') : [],
  );
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const question = useRef<HTMLElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const fetchSaved = useCallback(() => {
    setLoad({ status: 'loading' });
    getAboutMe().then(
      (saved) => {
        setLoad({ status: 'ready', saved });
        setSelection(valuesOf(saved, STEPS[0].field));
      },
      () => setLoad({ status: 'offline' }),
    );
  }, []);

  useEffect(() => {
    if (!initial) fetchSaved();
  }, [initial, fetchSaved]);

  // The flow opens on a tap, and each new question (and the thanks) starts the reading position
  // at its heading. The whole question is then brought into view, so its options and buttons are
  // not left below the screen (or under the composer).
  const ready = load.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    if (index < STEPS.length) {
      heading.current?.focus();
      question.current?.scrollIntoView({ block: 'nearest' });
    } else thanks.current?.focus();
  }, [index, ready]);

  if (load.status === 'loading') return <p className="status">{t('common.loading')}</p>;
  if (load.status === 'offline') {
    return (
      <div className="trip-flow">
        <p role="alert">{t('error.network')}</p>
        <button type="button" className="button" onClick={fetchSaved}>
          {t('chat.retry')}
        </button>
      </div>
    );
  }

  const { saved } = load;
  const step = STEPS[index];
  if (!step) {
    return (
      <div className="trip-flow" ref={thanks} tabIndex={-1}>
        <MascotSays>{t('aboutMe.thanks')}</MascotSays>
        <Link to="/about-me" className="text-button">
          {t('aboutMe.openAboutMe')}
        </Link>
      </div>
    );
  }

  const go = (to: number, from: AboutMe) => {
    setIndex(to);
    const next = STEPS[to];
    if (next) setSelection(valuesOf(from, next.field));
    else onFinish(from);
  };

  /** Skip keeps the field as saved; Next writes the selection. Either way the whole value is saved. */
  const advance = async (write: boolean) => {
    setSaving(true);
    setFailed(false);
    try {
      const result = await saveAboutMe(write ? withValues(saved, step.field, selection) : saved);
      setLoad({ status: 'ready', saved: result });
      go(index + 1, result);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const last = index === STEPS.length - 1;
  const multiple = isMultiple(step.field);
  return (
    <section className="trip-flow" aria-labelledby={titleId} ref={question}>
      <p className="trip-flow-progress" aria-live="polite">
        {t('aboutMe.step', { current: index + 1, total: STEPS.length })}
      </p>
      <h2 id={titleId} ref={heading} tabIndex={-1}>
        {t(step.title)}
      </h2>
      <p className="trip-flow-hint">{t(multiple ? 'aboutMe.pickAny' : 'aboutMe.pickOne')}</p>
      <ChoiceGroup
        labelId={titleId}
        codes={step.codes as readonly string[]}
        labelOf={(code) => t(labelKey(step, code))}
        selected={selection}
        multiple={multiple}
        onChange={setSelection}
      />
      {failed && (
        <p className="save-error" role="alert">
          {t('aboutMe.saveError')}
        </p>
      )}
      <div className="trip-flow-actions">
        {index > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={saving}
            onClick={() => go(index - 1, saved)}
          >
            {t('aboutMe.back')}
          </button>
        )}
        <button
          type="button"
          className="text-button"
          disabled={saving}
          onClick={() => void advance(false)}
        >
          {t('aboutMe.skip')}
        </button>
        <button
          type="button"
          className="button"
          disabled={saving}
          onClick={() => void advance(true)}
        >
          {t(last ? 'aboutMe.finish' : 'aboutMe.next')}
        </button>
      </div>
    </section>
  );
}
