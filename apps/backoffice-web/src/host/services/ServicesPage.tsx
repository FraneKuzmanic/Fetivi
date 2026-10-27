import { CaretRight, CreditCard, Handshake, Plus, Storefront } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatPrice } from '../../admin/providers/money';
import { host, type OfferSummary, type PaymentsStatus } from '../../api';
import { OFFER_CATEGORY_LABELS } from '../../forms/labels';
import { EmptyState } from '../../shell/EmptyState';
import { useAction } from '../../useAction';
import { paymentsState } from '../settings/PaymentsPage';
import { TranslationChip } from '../translations/TranslationChip';
import { HOST_AVAILABILITY_SHORT } from './labels';

const serviceLine = (o: OfferSummary) =>
  [
    OFFER_CATEGORY_LABELS[o.category],
    o.availabilityMode === 'live' ? null : HOST_AVAILABILITY_SHORT[o.availabilityMode],
    formatPrice(o.priceMinor, o.currency, o.priceUnit),
  ]
    .filter(Boolean)
    .join(' · ');

const PAYMENTS_LINE: Record<ReturnType<typeof paymentsState>, { chip: string; tone: string }> = {
  not_connected: { chip: 'Not connected', tone: 'neutral' },
  action_needed: { chip: 'Action needed', tone: 'wait' },
  verifying: { chip: 'Being verified', tone: 'wait' },
  connected: { chip: 'Connected', tone: 'ok' },
};

/**
 * /services: what guests can order through Fetivi. The host's own services (38) first, then the
 * local Providers guests see, which the host can hide or add to.
 */
export function ServicesPage() {
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

  const line = payments ? PAYMENTS_LINE[paymentsState(payments)] : null;

  return (
    <>
      <div className="page-head">
        <h1>Services</h1>
        <Link className="button primary" to="/services/new">
          <Plus aria-hidden="true" weight="bold" />
          Add a service
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <section className="today-section" aria-labelledby="own-services">
        <div className="section-head">
          <h2 id="own-services">Your services</h2>
          <p className="muted">
            A transfer, a boat trip, home-made goods: only your guests see these, and Fetivi takes
            no commission on them.
          </p>
        </div>
        {offers === null && !error ? <p className="muted">Loading…</p> : null}
        {offers?.length === 0 ? (
          <EmptyState
            icon={Storefront}
            title="No services yet"
            action={
              <Link className="button" to="/services/new">
                <Plus aria-hidden="true" weight="bold" />
                Add a service
              </Link>
            }
          >
            Add one and your guests can order it in the chat.
          </EmptyState>
        ) : null}
        {offers && offers.length > 0 ? (
          <ul className="rows" aria-label="Your services">
            {offers.map((o) => (
              <li key={o.id}>
                <Link to={`/services/${o.id}`} className="row-link record-row">
                  <span className="block-text record-text">
                    <strong>{o.title}</strong>
                    <span className="muted">{serviceLine(o)}</span>
                  </span>
                  <span className="record-chips">
                    {o.active ? null : <span className="chip neutral">Off</span>}
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
            <span>Card payments</span>
            <span className={`chip ${line.tone}`}>{line.chip}</span>
            <span className="payments-line-action">Manage in Settings</span>
          </Link>
        ) : null}
      </section>

      <section className="today-section" aria-labelledby="local-providers">
        <div className="section-head">
          <h2 id="local-providers">Local providers</h2>
          <p className="muted">
            Approved businesses near your property that your guests can book through Fetivi.
          </p>
        </div>
        <ul className="rows">
          <li>
            <Link to="/services/providers" className="row-link attention-row">
              <Handshake className="attention-icon" aria-hidden="true" />
              <span className="block-text">
                <strong>Providers your guests see</strong>
                <span className="muted">Hide a Provider, or suggest one you trust.</span>
              </span>
              <CaretRight className="row-caret" aria-hidden="true" />
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
