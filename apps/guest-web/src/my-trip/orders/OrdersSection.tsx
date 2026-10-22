import { isFinalOrderStatus } from '@fetivi/domain/order-vocabulary';
import { ReceiptCard } from '@fetivi/ui';
import type { OrderSummaryPayload } from '@fetivi/ui/payloads';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { receiptLabels } from '../../chat/render/labels';
import { AlertOffer } from '../../push/AlertOffer';
import { MascotSays } from '../../shell/Mascot';
import { getOrders } from './orders-api';

type Orders =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'ready'; orders: OrderSummaryPayload[] };

/** Reservations & orders: every Order of the space with both statuses, read-only. */
export function OrdersSection() {
  const { t, i18n } = useTranslation();
  const [orders, setOrders] = useState<Orders>({ status: 'loading' });

  const load = useCallback(() => {
    setOrders({ status: 'loading' });
    getOrders().then(
      // The server checks every Order against the receipt's schema before it answers.
      (body) => setOrders({ status: 'ready', orders: body.orders }),
      () => setOrders({ status: 'offline' }),
    );
  }, []);

  useEffect(load, [load]);

  return (
    <section className="trip-section" aria-labelledby="trip-orders">
      <h2 id="trip-orders">{t('trip.orders')}</h2>
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
          {orders.orders.some((o) => !isFinalOrderStatus(o.status)) && <AlertOffer />}
          <ul className="trip-orders">
            {orders.orders.map((order) => (
              <li key={order.id}>
                <ReceiptCard order={order} labels={receiptLabels(t, i18n.language)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
