import { handOverMessages } from '@fetivi/domain/handover';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { Copy } from '@phosphor-icons/react';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { host, type Stay } from '../../api';
import { CheckboxField, Section, SelectField } from '../../forms/fields';
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { calendarNames, dateRange, guestsLabel, nightsLabel, releaseText } from './format';
import { type StayDraft, StayFields, stayBody } from './StayFields';
import { StayChips } from './StaysPage';

const draftOf = (stay: Stay): StayDraft => ({
  checkIn: stay.checkIn,
  checkout: stay.checkout,
  partySize: stay.partySize,
  bookerName: stay.bookerName,
  reservationNumber: stay.reservationNumber,
});

export function StayPage() {
  const { t } = useTranslation(['host', 'common']);
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [stay, setStay] = useState<Stay | null>(null);
  const [draft, setDraft] = useState<StayDraft | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        const fresh = await host.stay(id);
        setStay(fresh);
        setDraft(draftOf(fresh));
      }),
    [id, run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePageTitle(stay ? dateRange(stay.checkIn, stay.checkout) : undefined);

  if (!stay || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  const change = (body: Parameters<typeof host.updateStay>[1]) =>
    run(async () => setStay(await host.updateStay(id, body)));

  const ended = stay.phase === 'ended';

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/stays">{t('stays.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${stay.unitId}`}>{stay.unitName}</Link>
      </nav>
      <div className="page-head">
        <StayChips stay={stay} />
      </div>
      <p className="muted">
        {stay.propertyName} · {stay.unitName} · {nightsLabel(stay.checkIn, stay.checkout)} ·{' '}
        {guestsLabel(stay.partySize)}
      </p>
      {stay.calendarSources.length > 0 ? (
        <p className="muted">
          {t('stays.fromCalendars', {
            count: stay.calendarSources.length,
            names: calendarNames(stay.calendarSources),
          })}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        {stay.possiblyCancelled ? (
          <section className="warning" aria-labelledby="cancelled-heading">
            <h2 id="cancelled-heading">{t('stays.possiblyCancelled')}</h2>
            <p>
              {stay.calendarSources.length > 0
                ? t('stays.disappeared', {
                    count: stay.calendarSources.length,
                    names: calendarNames(stay.calendarSources),
                  })
                : t('stays.disappearedUnlinked')}
            </p>
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirm({
                      title: t('stays.cancelTitle'),
                      body: t('stays.cancelBody'),
                      action: t('stays.cancelAction'),
                      danger: true,
                    })
                  ) {
                    void run(async () => {
                      await host.deleteStay(id);
                      navigate('/stays', { replace: true });
                    });
                  }
                }}
              >
                {t('stays.cancelStay')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setStay(await host.keepStay(id)))}
              >
                {t('stays.keepStay')}
              </button>
            </div>
          </section>
        ) : null}
        <section className="panel" aria-labelledby="pin-heading">
          <h2 id="pin-heading">{params.get('new') ? t('stays.registered') : t('stays.pin')}</h2>
          <p className="muted">{t('stays.sendPin')}</p>
          <div className="pin-row">
            <output
              className="pin-display"
              aria-label={t('stays.pinAria', { digits: stay.pin.split('').join(' ') })}
            >
              {stay.pin}
            </output>
            <CopyButton text={stay.pin} label={t('stays.copyPin')} />
          </div>
          <CheckboxField
            label={t('stays.pinSentCheck')}
            checked={stay.pinSentAt !== null}
            disabled={busy || ended}
            onChange={(pinSent) => void change({ pinSent })}
          />
        </section>

        {ended ? null : (
          <HandOver stay={stay} onLanguage={(l) => change({ handoverLanguage: l })} />
        )}

        {ended ? (
          <Section title={t('stays.details')}>
            <p>
              {nightsLabel(stay.checkIn, stay.checkout)}, {guestsLabel(stay.partySize)}
            </p>
            {stay.bookerName ? <p>{t('stays.booker', { name: stay.bookerName })}</p> : null}
            {stay.reservationNumber ? (
              <p>{t('stays.reservation', { number: stay.reservationNumber })}</p>
            ) : null}
            <p className="muted">{t('stays.ended')}</p>
          </Section>
        ) : (
          <Section
            title={t('stays.details')}
            description={t('stays.detailsHint', {
              release: releaseText(stay.arrivalReleaseLocal),
              zone: stay.timezone,
            })}
            onSave={async () => {
              const saved = await host.updateStay(id, stayBody(draft));
              setStay(saved);
              setDraft(draftOf(saved));
            }}
          >
            <StayFields value={draft} onChange={setDraft} />
          </Section>
        )}

        <section className="panel danger-zone">
          <h2>{t('stays.deleteTitle')}</h2>
          <p className="muted">{t('stays.deleteBody')}</p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: t('stays.deleteAsk'),
                  body: t('stays.deleteAskBody'),
                  action: t('stays.deleteTitle'),
                  danger: true,
                })
              ) {
                void run(async () => {
                  await host.deleteStay(id);
                  navigate('/stays', { replace: true });
                });
              }
            }}
          >
            {t('stays.deleteTitle')}
          </button>
        </section>
      </div>
    </>
  );
}

/** The two copy-ready hand-over messages in the language the host picks. */
function HandOver({
  stay,
  onLanguage,
}: {
  stay: Stay;
  onLanguage: (language: Stay['handoverLanguage']) => Promise<void>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const withLinkRef = useRef<HTMLTextAreaElement>(null);
  const withoutLinkRef = useRef<HTMLTextAreaElement>(null);
  const messages = handOverMessages({
    language: stay.handoverLanguage,
    unitName: stay.unitName,
    checkIn: stay.checkIn,
    checkout: stay.checkout,
    pin: stay.pin,
    // The unit's permanent link as the API built it; the PIN is never added to it.
    unitLink: stay.unitLink ?? '',
  });

  return (
    <Section title={t('stays.message')} description={t('stays.messageHint')}>
      <SelectField
        label={t('stays.language')}
        value={stay.handoverLanguage}
        options={GUEST_LANGUAGES}
        labels={labels.language}
        onChange={(language) => language && void onLanguage(language)}
      />
      {stay.unitLink ? (
        <MessageBox title={t('stays.withLink')} text={messages.withLink} boxRef={withLinkRef} />
      ) : null}
      <MessageBox
        title={t('stays.withoutLink')}
        text={messages.withoutLink}
        boxRef={withoutLinkRef}
      />
    </Section>
  );
}

function MessageBox({
  title,
  text,
  boxRef,
}: {
  title: string;
  text: string;
  boxRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const id = title.replace(/\W+/g, '-').toLowerCase();
  // Grow the box to its text, so the link and the PIN are visible without scrolling inside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text is the re-fit trigger.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [boxRef, text]);
  return (
    <div className="handover">
      <label className="field-label" htmlFor={id}>
        {title}
      </label>
      <textarea id={id} ref={boxRef} value={text} readOnly rows={9} />
      <CopyButton text={text} label={t('stays.copyMessage')} box={boxRef} />
    </div>
  );
}

/** Copies to the clipboard; if the browser refuses, selects the text for Ctrl+C instead. */
export function CopyButton({
  text,
  label,
  box,
}: {
  text: string;
  label: string;
  box?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const [status, setStatus] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t('common:page.copied'));
    } catch {
      box?.current?.select();
      setStatus(t('common:page.pressCtrlC'));
    }
  }

  return (
    <div className="copy-row">
      <button type="button" onClick={() => void copy()}>
        <Copy aria-hidden="true" />
        {label}
      </button>
      <output className="saved" aria-live="polite">
        {status}
      </output>
    </div>
  );
}
