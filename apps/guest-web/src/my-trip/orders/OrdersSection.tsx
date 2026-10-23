import { isFinalOrderStatus } from '@fetivi/domain/order-vocabulary';
import { ReceiptCard } from '@fetivi/ui';
import type { OrderSummaryPayload } from '@fetivi/ui/payloads';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { receiptLabels } from '../../chat/render/labels';
import { EmailOffer } from '../../email/EmailOffer';
import { AlertOffer } from '../../push/AlertOffer';
import { MascotSays } from '../../shell/Mascot';
import { getOrders, usePay } from './orders-api';

type Orders =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'ready'; orders: OrderSummaryPayload[] };

const POLL_MS = 2000;
const POLL_LIMIT_MS = 60_000;

/** Back from Stripe, the payment is still on its way: the webhook, confirm or capture/void. */
const settling = (o: OrderSummaryPayload) =>
  o.paymentStatus === 'authorized' || (o.status === 'confirming' && o.paymentStatus === 'none');

/**
 * Reservations & orders: every Order of the space with both statuses. A pay-online Order the
 * guest can still pay has Pay now. Back from Stripe (`?checkout=<id>`), the list is re-read every
 * 2 s for up to a minute until that Order's payment settles.
 */
export function OrdersSection() {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState<Orders>({ status: 'loading' });
  const [params, setParams] = useSearchParams();
  // Read once: the query is removed straight away, so a reload doesn't wait again.
  const [returned] = useState(() => params.get('checkout'));
  const [waiting, setWaiting] = useState(returned !== null);
  const startedAt = useRef(Date.now());

  const refresh = useCallback(
    () =>
      getOrders().then(
        // The server checks every Order against the receipt's schema before it answers.
        (body) => setOrders({ status: 'ready', orders: body.orders }),
        () => setOrders({ status: 'offline' }),
      ),
    [],
  );
  const load = useCallback(() => {
    setOrders({ status: 'loading' });
    void refresh();
  }, [refresh]);
  const { paying, notice, pay } = usePay(load);

  useEffect(load, [load]);

  useEffect(() => {
    if (!params.has('checkout') && !params.has('order')) return;
    setParams(
      (p) => {
        p.delete('checkout');
        p.delete('order');
        return p;
      },
      { replace: true },
    );
  }, [params, setParams]);

  useEffect(() => {
    if (!waiting || orders.status === 'loading') return;
    const target =
      orders.status === 'ready' ? orders.orders.find((o) => o.id === returned) : undefined;
    if (!target || !settling(target) || Date.now() - startedAt.current > POLL_LIMIT_MS) {
      setWaiting(false);
      return;
    }
    const timer = setTimeout(() => void refresh(), POLL_MS);
    return () => clearTimeout(timer);
  }, [orders, waiting, returned, refresh]);

  const noticeFor = (order: OrderSummaryPayload) => {
    if (notice?.orderId === order.id) return t(notice.key);
    // Paid after the booking had closed: the authorization was released.
    if (order.id === returned && !waiting && order.paymentStatus === 'voided') {
      return t('trip.checkoutLate');
    }
    return null;
  };

  return (
    <section className="trip-section" aria-labelledby="trip-orders">
      <h2 id="trip-orders">{t('trip.orders')}</h2>
      {waiting && <MascotSays>{t('trip.checkoutConfirming')}</MascotSays>}
      {orders.status === 'loading' ? (
        <p className="status">{t('common.loading')}</p>
      ) : orders.status === 'offline' ? (
        <div className="trip-offline">
          <MascotSays>{t('error.network')}</MascotSays>
          <button type="button" className="button" onClick={load}>
            {t('chat.retry')}
          </button>
        </div>
      ) : orders.orders.length === 0 ? (
        <MascotSays>{t('trip.noOrders')}</MascotSays>
      ) : (
        <>
          {orders.orders.some((o) => !isFinalOrderStatus(o.status)) && (
            <>
              <AlertOffer />
              <EmailOffer />
            </>
          )}
          <ul className="trip-orders">
            {orders.orders.map((order) => (
              <li key={order.id}>
                <ReceiptCard
                  order={order}
                  labels={receiptLabels(t, i18n.language)}
                  // While the return waits on this Order's payment, Pay now would invite paying twice.
                  onPay={waiting && order.id === returned ? undefined : (id) => void pay(id)}
                  paying={paying === order.id}
                  notice={noticeFor(order)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
