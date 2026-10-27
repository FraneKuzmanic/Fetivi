import { Link } from 'react-router';
import type { AdminOrderRow } from '../../api';
import { formatDate, formatDay } from '../../forms/datetime';
import { Chip, money, ORDER_STATUS, PAYMENT_STATUS } from './labels';

/** Who carries out the Order: the Provider, or the host for their own service. */
const sellerOf = (o: AdminOrderRow) =>
  o.providerName ?? (o.hostEmail ? `${o.hostEmail} (host)` : '');

/** Orders as rows that open the Order; `compact` keeps only what the Today page needs. */
export function OrdersTable({
  orders,
  compact = false,
}: {
  orders: AdminOrderRow[];
  compact?: boolean;
}) {
  return (
    <div className="table-frame">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col" className="wide-only">
              Date
            </th>
            <th scope="col">Status</th>
            {compact ? null : (
              <th scope="col" className="wide-only">
                Payment
              </th>
            )}
            <th scope="col" className="num wide-only">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const [status, tone] = ORDER_STATUS[o.status];
            const [payment, paymentTone] = PAYMENT_STATUS[o.paymentStatus];
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
                    <div className="cell-sub">Ordered {formatDay(o.createdAt)}</div>
                  )}
                </td>
                <td>
                  <span className="chip-stack">
                    <Chip text={status} tone={tone} />
                    {o.needsAction ? <Chip text="Needs you" tone="fail" /> : null}
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
