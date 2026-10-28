import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AdminOrderRow } from '../../api';
import { formatDate, formatDay } from '../../forms/datetime';
import { i18next } from '../../i18n';
import { useLabels } from '../../i18n/useLabels';
import { Chip, money, ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from './labels';

/** Who carries out the Order: the Provider, or the host for their own service. */
const sellerOf = (o: AdminOrderRow) =>
  o.providerName ??
  (o.hostEmail ? i18next.t('admin:orders.sellerHost', { email: o.hostEmail }) : '');

/** Orders as rows that open the Order; `compact` keeps only what the Today page needs. */
export function OrdersTable({
  orders,
  compact = false,
}: {
  orders: AdminOrderRow[];
  compact?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  return (
    <div className="table-frame">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{t('orders.order')}</th>
            <th scope="col" className="wide-only">
              {t('orders.date')}
            </th>
            <th scope="col">{t('orders.statusColumn')}</th>
            {compact ? null : (
              <th scope="col" className="wide-only">
                {t('orders.payment')}
              </th>
            )}
            <th scope="col" className="num wide-only">
              {t('orders.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const status = labels.orderStatus[o.status];
            const tone = ORDER_STATUS_TONE[o.status];
            const payment = labels.paymentStatus[o.paymentStatus];
            const paymentTone = PAYMENT_STATUS_TONE[o.paymentStatus];
            return (
              <tr key={o.id} className="linked">
                <td>
                  <div className="cell-main">
                    <Link className="row-target" to={`/admin/orders/${o.id}`}>
                      {o.offerTitle}
                    </Link>
                    <span className="cell-sub">
                      {[sellerOf(o), o.propertyName].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </td>
                <td className="nowrap wide-only">
                  {formatDate(o.date)}
                  <span className="cell-sub"> · {o.quantity}×</span>
                  {compact ? null : (
                    <div className="cell-sub">
                      {t('orders.ordered', { date: formatDay(o.createdAt) })}
                    </div>
                  )}
                </td>
                <td>
                  <span className="chip-stack">
                    <Chip text={status} tone={tone} />
                    {o.needsAction ? <Chip text={t('orders.needsYou')} tone="fail" /> : null}
                  </span>
                </td>
                {compact ? null : (
                  <td className="wide-only">
                    <Chip text={payment} tone={paymentTone} />
                  </td>
                )}
                <td className="num wide-only">
                  {o.priceMinor === null ? '—' : money(o.priceMinor, o.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
