import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { host } from '../../../api';
import { useAction } from '../../../useAction';
import { CopyButton } from '../StayPage';

/**
 * The one-time Booking.com step: approve Fetivi's guest domain, so Booking.com does not strip the
 * link from the hand-over message. The extranet's menu wording is not verified, so it stays loose.
 */
export function BookingLinksStep({
  domain,
  propertyId,
  propertyName,
  onDone,
}: {
  domain: string;
  propertyId: string;
  /** Shown when the host has several properties. */
  propertyName?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  const headingId = useId();
  const { busy, error, run } = useAction();
  return (
    <section className="panel booking-step" aria-labelledby={headingId}>
      <h2 id={headingId}>
        {propertyName
          ? t('stays.approveLinkFor', { property: propertyName })
          : t('stays.approveLink')}
      </h2>
      <p className="muted">{t('stays.approveWhy')}</p>
      <ol className="steps-list">
        <li>{t('stays.approveStep1')}</li>
        <li>
          <Trans
            t={t}
            i18nKey="stays.approveStep2"
            values={{ domain }}
            components={{ strong: <strong className="mono-text" /> }}
          />
          <CopyButton text={domain} label={t('stays.copyDomain')} />
        </li>
        <li>{t('stays.approveStep3')}</li>
      </ol>
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await host.approveBookingLinks(propertyId);
              onDone();
            })
          }
        >
          {t('stays.done')}
        </button>
      </div>
    </section>
  );
}
