import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { PIN_WARNING_DAYS } from '@fetivi/domain/stay-vocabulary';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { host, type StayProposals } from '../../../api';
import { useAction } from '../../../useAction';
import { dateRange, nightsLabel } from '../format';
import { BookingLinksStep } from './BookingLinksStep';

/**
 * Bookings read from the unit calendars, waiting for Confirm or Not a booking. Renders nothing
 * when there are none, so the Stays page stays quiet.
 */
export function ProposedList({ unitId, several }: { unitId?: string; several: boolean }) {
  const headingId = useId();
  const { busy, error, run } = useAction();
  const [data, setData] = useState<StayProposals | null>(null);

  const load = useCallback(
    () => run(async () => setData(await host.stayProposals(unitId))),
    [run, unitId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return error ? <p role="alert">{error}</p> : null;
  const { proposals, bookingLinks } = data;
  const warned = proposals.filter((p) => p.pinWarning).length;

  function dismiss(id: string) {
    if (!window.confirm('Not a booking? Fetivi will not propose these dates again.')) return;
    void run(async () => {
      await host.dismissProposal(id);
      setData(await host.stayProposals(unitId));
    });
  }

  return (
    <>
      {proposals.length > 0 ? (
        <section className="proposals" aria-labelledby={headingId}>
          <h2 id={headingId}>To confirm ({proposals.length})</h2>
          {warned > 0 ? (
            <p className="warning">
              {warned === 1
                ? `1 booking starts within ${PIN_WARNING_DAYS} days and has no PIN yet.`
                : `${warned} bookings start within ${PIN_WARNING_DAYS} days and have no PIN yet.`}
            </p>
          ) : null}
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
                        .map((s) => `${CALENDAR_SOURCE_LABELS[s.source]}: ${s.summary}`)
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
                  {p.pinWarning ? <span className="chip wait">Check-in soon</span> : null}
                </span>
                <span className="actions">
                  <Link className="button primary" to={`/stays/proposed/${p.id}`}>
                    Confirm
                  </Link>
                  <button type="button" disabled={busy} onClick={() => dismiss(p.id)}>
                    Not a booking
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
