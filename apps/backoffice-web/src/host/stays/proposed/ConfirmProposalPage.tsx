import { STAY_LIMITS } from '@fetivi/domain/stay-vocabulary';
import { GUEST_LANGUAGES, type GuestLanguage } from '@fetivi/domain/vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { host, type StayProposal } from '../../../api';
import { NumberField, SelectField, TextField } from '../../../forms/fields';
import { useLabels } from '../../../i18n/useLabels';
import { usePageTitle } from '../../../shell/PageTitle';
import { useAction } from '../../../useAction';
import { calendarNames, dateRange, nightsLabel } from '../format';

/** Confirm a calendar booking: the dates come from the calendar, the host adds the party. */
export function ConfirmProposalPage() {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
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

  usePageTitle(t('stays.confirmTitle'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/stays">{t('stays.title')}</Link>
      </nav>
      {proposal === undefined && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {proposal === undefined && error ? <p role="alert">{error}</p> : null}
      {proposal === null ? (
        <section className="panel narrow">
          <p>{t('stays.handled')}</p>
          <p>
            <Link to="/stays">{t('stays.backToStays')}</Link>
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
              {proposal.propertyName} · {proposal.unitName} ·{' '}
              {t('stays.fromCalendarsLower', {
                count: proposal.sources.length,
                names: calendarNames(proposal.sources),
              })}
            </p>
          </div>
          <form onSubmit={submit}>
            <div className="fields">
              <NumberField
                label={t('stays.guests')}
                value={partySize}
                min={STAY_LIMITS.partySize.min}
                max={STAY_LIMITS.partySize.max}
                required
                onChange={setPartySize}
              />
              <div className="field-row">
                <TextField
                  label={t('stays.bookerName')}
                  hint={t('common:page.optional')}
                  value={bookerName}
                  maxLength={STAY_LIMITS.bookerName}
                  onChange={setBookerName}
                />
                <TextField
                  label={t('stays.reservationNumber')}
                  hint={t('stays.reservationHint')}
                  value={reservationNumber}
                  maxLength={STAY_LIMITS.reservationNumber}
                  onChange={setReservationNumber}
                />
              </div>
              <SelectField
                label={t('stays.messageLanguage')}
                hint={t('stays.messageLanguageHint')}
                value={language}
                options={GUEST_LANGUAGES}
                labels={labels.language}
                onChange={(l) => l && setLanguage(l)}
              />
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <p className="muted">{t('stays.datesFromCalendar')}</p>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                {t('stays.confirmAndPin')}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
