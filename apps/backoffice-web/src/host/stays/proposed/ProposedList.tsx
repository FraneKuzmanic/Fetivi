import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { host, type StayProposals } from '../../../api';
import { useConfirm } from '../../../shell/ConfirmDialog';
import { useAction } from '../../../useAction';
import { dateRange, nightsLabel } from '../format';
import { BookingLinksStep } from './BookingLinksStep';

/**
 * Bookings read from the unit calendars, waiting for Confirm or Not a booking. Renders nothing
 * when there are none, so the Stays page stays quiet. `onWarned` gets the number close to
 * check-in, which the Stays page counts in its one warning line.
 */
export function ProposedList({
  unitId,
  several,
  onWarned,
}: {
  unitId?: string;
  several: boolean;
  onWarned?: (count: number) => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  const headingId = useId();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [data, setData] = useState<StayProposals | null>(null);

  const load = useCallback(
    () => run(async () => setData(await host.stayProposals(unitId))),
    [run, unitId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const warned = data?.proposals.filter((p) => p.pinWarning).length ?? 0;
  useEffect(() => onWarned?.(warned), [onWarned, warned]);

  if (!data) return error ? <p role="alert">{error}</p> : null;
  const { proposals, bookingLinks } = data;

  async function dismiss(id: string) {
    if (
      !(await confirm({
        title: t('stays.notBookingTitle'),
        body: t('stays.notBookingBody'),
        action: t('stays.notBooking'),
      }))
    )
      return;
    void run(async () => {
      await host.dismissProposal(id);
      setData(await host.stayProposals(unitId));
    });
  }

  return (
    <>
      {proposals.length > 0 ? (
        <section className="proposals" aria-labelledby={headingId}>
          <h2 id={headingId}>{t('stays.toConfirm', { count: proposals.length })}</h2>
          {error ? <p role="alert">{error}</p> : null}
          <ul className="rows">
            {proposals.map((p) => (
              <li key={p.id} className="proposal-row">
                <span className="proposal-main">
                  <span>
                    <strong>{dateRange(p.checkIn, p.checkout)}</strong>
                    <span className="muted"> · {nightsLabel(p.checkIn, p.checkout)}</span>
                  </span>
                  <span className="muted">
                    {several ? `${p.propertyName} · ${p.unitName}` : p.unitName}
                  </span>
                  {p.summaries.length > 0 ? (
                    <span className="muted proposal-summary">
                      {p.summaries
                        // One source is already named by its chip.
                        .map((s) =>
                          p.sources.length > 1
                            ? `${CALENDAR_SOURCE_LABELS[s.source]}: ${s.summary}`
                            : s.summary,
                        )
                        .join(' · ')}
                    </span>
                  ) : null}
                </span>
                <span className="chips">
                  {p.sources.map((s) => (
                    <span key={s} className="chip neutral">
                      {CALENDAR_SOURCE_LABELS[s]}
                    </span>
                  ))}
                  {p.pinWarning ? (
                    <span className="chip wait">{t('stays.checkInSoon')}</span>
                  ) : null}
                </span>
                <span className="actions">
                  <Link className="button primary" to={`/stays/proposed/${p.id}`}>
                    {t('stays.confirm')}
                  </Link>
                  <button type="button" disabled={busy} onClick={() => dismiss(p.id)}>
                    {t('stays.notBooking')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {bookingLinks.pending.map((p) => (
        <BookingLinksStep
          key={p.propertyId}
          domain={bookingLinks.domain}
          propertyId={p.propertyId}
          propertyName={bookingLinks.pending.length > 1 || several ? p.propertyName : undefined}
          onDone={() => void load()}
        />
      ))}
    </>
  );
}
