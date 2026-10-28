import { CALENDAR_LIMITS, CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { Trash } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CalendarFeed, host, type UnitCalendars } from '../../../api';
import { TextField } from '../../../forms/fields';
import { i18next } from '../../../i18n';
import { useConfirm } from '../../../shell/ConfirmDialog';
import { useAction } from '../../../useAction';
import { agoLabel } from '../format';
import { BookingLinksStep } from './BookingLinksStep';

/** What went wrong on the last check, in plain words. */
export function feedErrorText(code: string): string {
  if (code === 'http-404' || code === 'http-410') {
    return i18next.t('host:stays.linkGone');
  }
  if (code === 'fetch-failed') return i18next.t('host:stays.fetchFailed');
  if (code === 'not-a-calendar') return i18next.t('host:stays.notCalendar');
  if (code === 'too-large') return i18next.t('host:stays.tooLarge');
  return i18next.t('host:stays.unreadable');
}

function FeedStatus({ feed }: { feed: CalendarFeed }) {
  const { t } = useTranslation(['host', 'common']);
  if (feed.lastError) return <span className="feed-error">{feedErrorText(feed.lastError)}</span>;
  if (feed.lastOkAt)
    return <span className="muted">{t('stays.checked', { ago: agoLabel(feed.lastOkAt) })}</span>;
  return <span className="muted">{t('stays.firstCheck')}</span>;
}

/** The unit's Airbnb and Booking.com calendar links, read about every 30 minutes. */
export function CalendarsPanel({ unitId }: { unitId: string }) {
  const { t } = useTranslation(['host', 'common']);
  const headingId = useId();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
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

  async function remove(feed: CalendarFeed) {
    if (
      !(await confirm({
        title: t('stays.removeTitle'),
        body: t('stays.removeBody'),
        action: t('stays.removeAction'),
        danger: true,
      }))
    )
      return;
    void run(async () => {
      await host.removeCalendar(feed.id);
      setData(await host.calendars(unitId));
    });
  }

  return (
    <>
      <section className="panel" aria-labelledby={headingId}>
        <h2 id={headingId}>{t('stays.calendars')}</h2>
        <p className="muted">{t('stays.calendarsIntro')}</p>
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
                  aria-label={t('stays.removeCalendar', {
                    source: CALENDAR_SOURCE_LABELS[feed.source],
                  })}
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
            label={t('stays.exportLink')}
            hint={t('stays.exportHint')}
            value={url}
            maxLength={CALENDAR_LIMITS.urlLength}
            required
            onChange={setUrl}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {t('stays.addCalendar')}
            </button>
          </div>
        </form>
        <details className="help">
          <summary>{t('stays.whereLink')}</summary>
          <p>
            <strong>Airbnb:</strong> {t('stays.airbnbSteps')}
          </p>
          <p>
            <strong>Booking.com:</strong> {t('stays.bookingSteps')}
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
