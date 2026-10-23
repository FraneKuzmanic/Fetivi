import { CaretRight, Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatPrice } from '../../admin/providers/money';
import { OnlinePaymentsPanel } from '../../admin/providers/OnlinePaymentsPanel';
import { host, type OfferSummary, type PaymentsStatus } from '../../api';
import { OFFER_CATEGORY_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
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

/** /services: the host's own services (38), card payments into their Stripe, and the Providers link. */
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

  return (
    <>
      <div className="page-head">
        <h1>Your services</h1>
        <Link className="button primary" to="/services/new">
          <Plus aria-hidden="true" weight="bold" />
          Add a service
        </Link>
      </div>
      <p className="muted">
        A transfer, a boat trip, home-made goods: only your guests see these. Fetivi takes no
        commission on them.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {offers === null && !error ? <p className="muted">Loading…</p> : null}
      {offers?.length === 0 ? (
        <p className="muted">No services yet. Add one and your guests can order it in the chat.</p>
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

      {payments ? (
        <OnlinePaymentsPanel
          title="Card payments for your services"
          subject="host"
          status={payments}
          onLink={host.paymentsLink}
          onRefresh={host.paymentsRefresh}
          onChange={setPayments}
        />
      ) : null}

      <ul className="rows">
        <li>
          <Link to="/services/providers" className="row-link record-row">
            <span className="block-text record-text">
              <strong>Providers your guests see</strong>
              <span className="muted">Hide a Provider, or suggest one you trust.</span>
            </span>
            <span />
            <CaretRight className="record-caret" aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </>
  );
}
