import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { handOverMessages } from '@fetivi/domain/handover';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { Copy } from '@phosphor-icons/react';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { host, type Stay } from '../../api';
import { CheckboxField, Section, SelectField } from '../../forms/fields';
import { LANGUAGE_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { dateRange, guestsLabel, nightsLabel, releaseText } from './format';
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
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
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

  if (!stay || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const change = (body: Parameters<typeof host.updateStay>[1]) =>
    run(async () => setStay(await host.updateStay(id, body)));

  const ended = stay.phase === 'ended';

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/stays">Stays</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${stay.unitId}`}>{stay.unitName}</Link>
      </nav>
      <div className="page-head">
        <h1>{dateRange(stay.checkIn, stay.checkout)}</h1>
        <StayChips stay={stay} />
      </div>
      <p className="muted">
        {stay.propertyName} · {stay.unitName} · {nightsLabel(stay.checkIn, stay.checkout)} ·{' '}
        {guestsLabel(stay.partySize)}
      </p>
      {stay.calendarSources.length > 0 ? (
        <p className="muted">From the {calendarsText(stay.calendarSources)}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        {stay.possiblyCancelled ? (
          <section className="panel" aria-labelledby="cancelled-heading">
            <h2 id="cancelled-heading">Possibly cancelled</h2>
            <p className="warning">
              This booking disappeared from the {calendarsText(stay.calendarSources)}. It may be
              cancelled. The PIN keeps working until you decide.
            </p>
            <div className="actions">
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Cancel this Stay? Its PIN stops working.')) {
                    void run(async () => {
                      await host.deleteStay(id);
                      navigate('/stays', { replace: true });
                    });
                  }
                }}
              >
                Cancel the Stay
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(async () => setStay(await host.keepStay(id)))}
              >
                Keep the Stay
              </button>
            </div>
          </section>
        ) : null}
        <section className="panel" aria-labelledby="pin-heading">
          <h2 id="pin-heading">{params.get('new') ? 'Stay registered' : 'PIN'}</h2>
          <p className="muted">
            Send the PIN to the guests. It works until the end of checkout day.
          </p>
          <div className="pin-row">
            <output className="pin-display" aria-label={`PIN ${stay.pin.split('').join(' ')}`}>
              {stay.pin}
            </output>
            <CopyButton text={stay.pin} label="Copy PIN" />
          </div>
          <CheckboxField
            label="PIN sent to the guests"
            checked={stay.pinSentAt !== null}
            disabled={busy || ended}
            onChange={(pinSent) => void change({ pinSent })}
          />
        </section>

        {ended ? null : (
          <HandOver stay={stay} onLanguage={(l) => change({ handoverLanguage: l })} />
        )}

        {ended ? (
          <Section title="Details">
            <p>
              {nightsLabel(stay.checkIn, stay.checkout)}, {guestsLabel(stay.partySize)}
            </p>
            {stay.bookerName ? <p>Booker: {stay.bookerName}</p> : null}
            {stay.reservationNumber ? <p>Reservation number: {stay.reservationNumber}</p> : null}
            <p className="muted">This Stay has ended and can no longer be changed.</p>
          </Section>
        ) : (
          <Section
            title="Details"
            description={`${releaseText(stay.arrivalReleaseLocal)} (${stay.timezone} time). Changing the dates keeps the PIN.`}
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
          <h2>Delete Stay</h2>
          <p className="muted">The PIN stops working. This cannot be undone.</p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Delete this Stay? Its PIN stops working.')) {
                void run(async () => {
                  await host.deleteStay(id);
                  navigate('/stays', { replace: true });
                });
              }
            }}
          >
            Delete Stay
          </button>
        </section>
      </div>
    </>
  );
}

/** "Airbnb calendar", "Airbnb and Booking.com calendars"; "calendar" when none is linked any more. */
function calendarsText(sources: Stay['calendarSources']): string {
  if (sources.length === 0) return 'calendar';
  const names = sources.map((s) => CALENDAR_SOURCE_LABELS[s]).join(' and ');
  return `${names} ${sources.length > 1 ? 'calendars' : 'calendar'}`;
}

/** The two copy-ready hand-over messages in the language the host picks. */
function HandOver({
  stay,
  onLanguage,
}: {
  stay: Stay;
  onLanguage: (language: Stay['handoverLanguage']) => Promise<void>;
}) {
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
    <Section
      title="Message for the guests"
      description="Copy it into your chat with the guests. Pick the language they are most likely to read."
    >
      <SelectField
        label="Language"
        value={stay.handoverLanguage}
        options={GUEST_LANGUAGES}
        labels={LANGUAGE_LABELS}
        onChange={(language) => language && void onLanguage(language)}
      />
      {stay.unitLink ? (
        <MessageBox title="Message with link" text={messages.withLink} boxRef={withLinkRef} />
      ) : null}
      <MessageBox
        title="Without link (if Airbnb or Booking.com blocks links)"
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
      <CopyButton text={text} label="Copy message" box={boxRef} />
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
  const [status, setStatus] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      box?.current?.select();
      setStatus('Press Ctrl+C to copy');
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
