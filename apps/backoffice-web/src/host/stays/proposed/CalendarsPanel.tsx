import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { Trash } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { type CalendarFeed, host, type UnitCalendars } from '../../../api';
import { TextField } from '../../../forms/fields';
import { useAction } from '../../../useAction';
import { agoLabel } from '../format';
import { BookingLinksStep } from './BookingLinksStep';

/** What went wrong on the last check, in plain words. */
export function feedErrorText(code: string): string {
  if (code === 'http-404' || code === 'http-410') {
    return 'The link no longer works. Copy a fresh export link.';
  }
  if (code === 'fetch-failed') return 'Fetivi could not reach the calendar.';
  if (code === 'not-a-calendar') return 'This is not a calendar file.';
  if (code === 'too-large') return 'The calendar file is too large.';
  return 'The calendar could not be read. Fetivi tries again in 30 minutes.';
}

function FeedStatus({ feed }: { feed: CalendarFeed }) {
  if (feed.lastError) return <span className="feed-error">{feedErrorText(feed.lastError)}</span>;
  if (feed.lastOkAt) return <span className="muted">Checked {agoLabel(feed.lastOkAt)}</span>;
  return <span className="muted">Waiting for the first check</span>;
}

/** The unit's Airbnb and Booking.com calendar links, read about every 30 minutes. */
export function CalendarsPanel({ unitId }: { unitId: string }) {
  const headingId = useId();
  const { busy, error, run } = useAction();
  const [data, setData] = useState<UnitCalendars | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const load = useCallback(
    () => run(async () => setData(await host.calendars(unitId))),
    [run, unitId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function add(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await host.addCalendar(unitId, url ?? '');
      setUrl(null);
      setData(await host.calendars(unitId));
    });
  }

  function remove(feed: CalendarFeed) {
    if (!window.confirm('Remove this calendar? Stays already registered stay as they are.')) return;
    void run(async () => {
      await host.removeCalendar(feed.id);
      setData(await host.calendars(unitId));
    });
  }

  return (
    <>
      <section className="panel" aria-labelledby={headingId}>
        <h2 id={headingId}>Calendars</h2>
        <p className="muted">
          Fetivi reads these calendars about every 30 minutes and shows each new booking on the
          Stays page for you to confirm.
        </p>
        {data && data.feeds.length > 0 ? (
          <ul className="rows">
            {data.feeds.map((feed) => (
              <li key={feed.id} className="feed-row">
                <span className="feed-main">
                  <span className="feed-title">
                    <span className="chip neutral">{CALENDAR_SOURCE_LABELS[feed.source]}</span>
                    <span className="mono-text feed-label">{feed.label}</span>
                  </span>
                  <FeedStatus feed={feed} />
                </span>
                <button
                  type="button"
                  className="icon-button ghost"
                  aria-label={`Remove the ${CALENDAR_SOURCE_LABELS[feed.source]} calendar`}
                  disabled={busy}
                  onClick={() => remove(feed)}
                >
                  <Trash aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={add} className="fields">
          <TextField
            label="Calendar export link"
            hint="From Airbnb or Booking.com. It starts with https://."
            value={url}
            maxLength={2048}
            required
            onChange={setUrl}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Add calendar
            </button>
          </div>
        </form>
        <details className="help">
          <summary>Where do I find the link?</summary>
          <p>
            <strong>Airbnb:</strong> Calendar → Availability → Connect calendars → Export calendar,
            then copy the link.
          </p>
          <p>
            <strong>Booking.com:</strong> Extranet → Rates & Availability → Sync calendars → Export
            calendar, then copy the link.
          </p>
        </details>
      </section>
      {data?.bookingLinks.needed ? (
        <BookingLinksStep
          domain={data.bookingLinks.domain}
          propertyId={data.bookingLinks.propertyId}
          onDone={() => void load()}
        />
      ) : null}
    </>
  );
}
