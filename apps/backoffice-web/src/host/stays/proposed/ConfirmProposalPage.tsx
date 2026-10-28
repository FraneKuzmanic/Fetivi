import { CALENDAR_SOURCE_LABELS } from '@fetivi/domain/calendar-vocabulary';
import { STAY_LIMITS } from '@fetivi/domain/stay-vocabulary';
import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { host, type StayProposal } from '../../../api';
import { NumberField, SelectField, TextField } from '../../../forms/fields';
import { LANGUAGE_LABELS } from '../../../forms/labels';
import { usePageTitle } from '../../../shell/PageTitle';
import { useAction } from '../../../useAction';
import { dateRange, nightsLabel } from '../format';

/** Confirm a calendar booking: the dates come from the calendar, the host adds the party. */
export function ConfirmProposalPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [proposal, setProposal] = useState<StayProposal | null | undefined>(undefined);
  const [partySize, setPartySize] = useState<number | null>(null);
  const [bookerName, setBookerName] = useState<string | null>(null);
  const [reservationNumber, setReservationNumber] = useState<string | null>(null);
  const [language, setLanguage] = useState<GuestLanguage>('en');

  useEffect(() => {
    void run(async () => {
      const { proposals } = await host.stayProposals();
      setProposal(proposals.find((p) => p.id === id) ?? null);
    });
  }, [run, id]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const stay = await host.confirmProposal(id, {
        partySize: partySize ?? 0,
        bookerName,
        reservationNumber,
        handoverLanguage: language,
      });
      navigate(`/stays/${stay.id}?new=1`, { replace: true });
    });
  }

  usePageTitle('Confirm booking');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/stays">Stays</Link>
      </nav>
      {proposal === undefined && !error ? <p className="muted">Loading…</p> : null}
      {proposal === undefined && error ? <p role="alert">{error}</p> : null}
      {proposal === null ? (
        <section className="panel narrow">
          <p>This booking was already handled.</p>
          <p>
            <Link to="/stays">Back to Stays</Link>
          </p>
        </section>
      ) : null}
      {proposal ? (
        <section className="panel narrow">
          <div>
            <p>
              <strong>{dateRange(proposal.checkIn, proposal.checkout)}</strong>
              <span className="muted"> · {nightsLabel(proposal.checkIn, proposal.checkout)}</span>
            </p>
            <p className="muted">
              {proposal.propertyName} · {proposal.unitName} · from the{' '}
              {proposal.sources.map((s) => CALENDAR_SOURCE_LABELS[s]).join(' and ')}{' '}
              {proposal.sources.length > 1 ? 'calendars' : 'calendar'}
            </p>
          </div>
          <form onSubmit={submit}>
            <div className="fields">
              <NumberField
                label="Guests"
                value={partySize}
                min={STAY_LIMITS.partySize.min}
                max={STAY_LIMITS.partySize.max}
                required
                onChange={setPartySize}
              />
              <div className="field-row">
                <TextField
                  label="Booker name"
                  hint="Optional. Only you see this."
                  value={bookerName}
                  maxLength={STAY_LIMITS.bookerName}
                  onChange={setBookerName}
                />
                <TextField
                  label="Reservation number"
                  hint="Optional. The number from Airbnb or Booking.com."
                  value={reservationNumber}
                  maxLength={STAY_LIMITS.reservationNumber}
                  onChange={setReservationNumber}
                />
              </div>
              <SelectField
                label="Message language"
                hint="The language of the message with the PIN. You can change it later."
                value={language}
                options={GUEST_LANGUAGES}
                labels={LANGUAGE_LABELS}
                onChange={(l) => l && setLanguage(l)}
              />
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <p className="muted">
              The dates come from the calendar. You can change them later on the Stay.
            </p>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                Confirm and get PIN
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
