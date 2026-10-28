import { CaretRight, CreditCard, Handshake, Plus, Storefront } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatPrice } from '../../admin/providers/money';
import { host, type OfferSummary, type PaymentsStatus } from '../../api';
import { i18next } from '../../i18n';
import { currentLabels } from '../../i18n/useLabels';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { paymentsState } from '../settings/PaymentsPage';
import { TranslationChip } from '../translations/TranslationChip';

const serviceLine = (o: OfferSummary, labels = currentLabels()) =>
  [
    labels.offerCategory[o.category],
    o.availabilityMode === 'live' ? null : labels.hostAvailabilityShort[o.availabilityMode],
    formatPrice(o.priceMinor, o.currency, o.priceUnit),
  ]
    .filter(Boolean)
    .join(' · ');

const paymentsLine = (state: ReturnType<typeof paymentsState>): { chip: string; tone: string } =>
  ({
    not_connected: { chip: i18next.t('host:services.notConnected'), tone: 'neutral' },
    action_needed: { chip: i18next.t('host:services.actionNeeded'), tone: 'wait' },
    verifying: { chip: i18next.t('host:services.verifying'), tone: 'wait' },
    connected: { chip: i18next.t('host:services.connected'), tone: 'ok' },
  })[state];

/**
 * /services: what guests can order through Fetivi. The host's own services (38) first, then the
 * local Providers guests see, which the host can hide or add to.
 */
export function ServicesPage() {
  const { t } = useTranslation(['host', 'common']);
  const { error, run } = useAction();
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);
  const [payments, setPayments] = useState<PaymentsStatus | null>(null);

  useEffect(() => {
    void run(async () => {
      const [list, status] = await Promise.all([host.offers(), host.payments()]);
      setOffers(list.offers);
      setPayments(status);
    });
  }, [run]);

  const line = payments ? paymentsLine(paymentsState(payments)) : null;

  usePageTitle(t('services.title'));

  return (
    <>
      <div className="page-head">
        <Link className="button primary" to="/services/new">
          <Plus aria-hidden="true" weight="bold" />
          {t('services.add')}
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <section className="today-section" aria-labelledby="own-services">
        <div className="section-head">
          <h2 id="own-services">{t('services.yours')}</h2>
          <p className="muted">{t('services.yoursIntro')}</p>
        </div>
        {offers === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
        {offers?.length === 0 ? (
          <EmptyState
            icon={Storefront}
            title={t('services.none')}
            action={
              <Link className="button" to="/services/new">
                <Plus aria-hidden="true" weight="bold" />
                {t('services.add')}
              </Link>
            }
          >
            {t('services.noneBody')}
          </EmptyState>
        ) : null}
        {offers && offers.length > 0 ? (
          <ul className="rows" aria-label={t('services.yours')}>
            {offers.map((o) => (
              <li key={o.id}>
                <Link to={`/services/${o.id}`} className="row-link record-row">
                  <span className="block-text record-text">
                    <strong>{o.title}</strong>
                    <span className="muted">{serviceLine(o)}</span>
                  </span>
                  <span className="record-chips">
                    {o.active ? null : <span className="chip neutral">{t('services.off')}</span>}
                    <TranslationChip status={o.translation.status} />
                  </span>
                  <CaretRight className="record-caret" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {line ? (
          <Link to="/settings/payments" className="payments-line">
            <CreditCard aria-hidden="true" />
            <span>{t('services.cardPayments')}</span>
            <span className={`chip ${line.tone}`}>{line.chip}</span>
            <span className="payments-line-action">{t('services.manage')}</span>
          </Link>
        ) : null}
      </section>

      <section className="today-section" aria-labelledby="local-providers">
        <div className="section-head">
          <h2 id="local-providers">{t('services.local')}</h2>
          <p className="muted">{t('services.localIntro')}</p>
        </div>
        <ul className="rows">
          <li>
            <Link to="/services/providers" className="row-link attention-row">
              <Handshake className="attention-icon" aria-hidden="true" />
              <span className="block-text">
                <strong>{t('services.providersSeen')}</strong>
                <span className="muted">{t('services.providersHint')}</span>
              </span>
              <CaretRight className="row-caret" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
