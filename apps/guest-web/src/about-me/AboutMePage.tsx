import { type AboutMe, isAboutMeEmpty } from '@fetivi/domain/about-me-vocabulary';
import { X } from '@phosphor-icons/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { getAboutMe, saveAboutMe } from './about-me-api';
import { ChoiceGroup } from './ChoiceGroup';
import { isMultiple, labelKey, STEPS, type Step, TripFlow, valuesOf, withValues } from './TripFlow';

type Load = { status: 'loading' } | { status: 'offline' } | { status: 'ready'; value: AboutMe };

/**
 * Saves whole About me values one after another, in tap order. Every save carries all earlier
 * changes, so only the newest one decides what the screen shows once it settles: the server's value,
 * or the last confirmed one if it failed. An older failure followed by a newer save changes nothing.
 */
export function saveQueue(
  send: (value: AboutMe) => Promise<AboutMe>,
  settle: (shown: AboutMe | null, failed: boolean) => void,
) {
  let chain = Promise.resolve();
  let latest = 0;
  let confirmed: AboutMe | null = null;
  return {
    /** Records a value the server is known to hold (a load, or the flow's own saves). */
    confirm(value: AboutMe) {
      confirmed = value;
    },
    save(next: AboutMe): Promise<void> {
      latest += 1;
      const id = latest;
      chain = chain.then(() =>
        send(next).then(
          (value) => {
            confirmed = value;
            if (id === latest) settle(value, false);
          },
          () => {
            if (id === latest) settle(confirmed, true);
          },
        ),
      );
      return chain;
    },
  };
}

/** Everything kept about this Space's guests, each item changeable and removable. */
export function AboutMePage({ initial }: { initial?: AboutMe }) {
  const { t } = useTranslation();
  const { state } = useSpace();
  const closed = state.status === 'ready' ? state.space.closed : true;
  const heading = useRef<HTMLHeadingElement>(null);
  const [load, setLoad] = useState<Load>(
    initial ? { status: 'ready', value: initial } : { status: 'loading' },
  );
  const [editing, setEditing] = useState<Step['field'] | null>(null);
  const [flow, setFlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const [queue] = useState(() => {
    const q = saveQueue(saveAboutMe, (shown, failed) => {
      if (shown) setLoad({ status: 'ready', value: shown });
      setFailed(failed);
    });
    if (initial) q.confirm(initial);
    return q;
  });

  const fetchValue = useCallback(() => {
    setLoad({ status: 'loading' });
    getAboutMe().then(
      (value) => {
        queue.confirm(value);
        setLoad({ status: 'ready', value });
      },
      () => setLoad({ status: 'offline' }),
    );
  }, [queue]);

  useEffect(() => {
    if (!initial) fetchValue();
    // Landing on the page starts reading at its heading.
    heading.current?.focus();
  }, [initial, fetchValue]);

  /** Shows the change at once and saves it; puts the saved value back if the save fails. */
  const save = (next: AboutMe) => {
    setFailed(false);
    setLoad({ status: 'ready', value: next });
    void queue.save(next);
  };

  let body: ReactNode;
  if (load.status === 'loading') body = <p className="status">{t('common.loading')}</p>;
  else if (load.status === 'offline') {
    body = (
      <div className="chat-offline">
        <MascotSays>{t('error.network')}</MascotSays>
        <button type="button" className="button" onClick={fetchValue}>
          {t('chat.retry')}
        </button>
      </div>
    );
  } else if (flow) {
    body = (
      <TripFlow
        initial={load.value}
        onFinish={(value) => {
          queue.confirm(value);
          setLoad({ status: 'ready', value });
          setFlow(false);
          heading.current?.focus();
        }}
      />
    );
  } else {
    const { value } = load;
    const empty = isAboutMeEmpty(value);
    body = (
      <>
        <MascotSays>{t(empty ? 'aboutMe.empty' : 'aboutMe.intro')}</MascotSays>
        {closed && <p className="about-me-closed">{t('aboutMe.closedNote')}</p>}
        {empty && !closed && (
          <button type="button" className="button about-me-start" onClick={() => setFlow(true)}>
            {t('aboutMe.start')}
          </button>
        )}
        {failed && (
          <p className="save-error" role="alert">
            {t('aboutMe.saveError')}
          </p>
        )}
        {STEPS.map((step) => (
          <FieldSection
            key={step.field}
            step={step}
            value={value}
            closed={closed}
            editing={editing === step.field}
            onEdit={(on) => setEditing(on ? step.field : null)}
            onSave={save}
          />
        ))}
      </>
    );
  }

  return (
    <section className="about-me" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1} className="visually-hidden">
        {t('aboutMe.title')}
      </h1>
      {body}
    </section>
  );
}

function FieldSection({
  step,
  value,
  closed,
  editing,
  onEdit,
  onSave,
}: {
  step: Step;
  value: AboutMe;
  closed: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onSave: (next: AboutMe) => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const codes = valuesOf(value, step.field);
  // After the stay nothing can be added, so an empty field has nothing to show.
  if (closed && codes.length === 0) return null;
  const titleId = `about-me-${step.field}`;
  const labelOf = (code: string) => t(labelKey(step, code));
  const set = (next: string[]) => onSave(withValues(value, step.field, next));

  return (
    <section className="about-me-field" aria-labelledby={titleId}>
      <div className="about-me-field-header">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {t(step.title)}
        </h2>
        {!closed && (
          <button
            type="button"
            className="text-button"
            aria-expanded={editing}
            onClick={() => onEdit(!editing)}
          >
            {t(editing ? 'aboutMe.done' : 'aboutMe.change')}
          </button>
        )}
      </div>
      {editing ? (
        <ChoiceGroup
          labelId={titleId}
          codes={step.codes as readonly string[]}
          labelOf={labelOf}
          selected={codes}
          multiple={isMultiple(step.field)}
          onChange={set}
        />
      ) : codes.length === 0 ? (
        <p className="about-me-not-set">{t('aboutMe.notSet')}</p>
      ) : (
        <ul className="about-me-items">
          {codes.map((code) => (
            <li key={code}>
              <span>{labelOf(code)}</span>
              <button
                type="button"
                className="icon-button about-me-remove"
                aria-label={t('aboutMe.remove', { item: labelOf(code) })}
                onClick={() => {
                  set(codes.filter((c) => c !== code));
                  // The button is about to go: keep the reading position in this section.
                  heading.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
