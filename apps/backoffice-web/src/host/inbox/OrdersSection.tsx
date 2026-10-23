import type { HostOrder } from '../../api';
import { OrderCard } from './OrderCard';

/** "Orders for your services" (38): the Orders on the host's own Offers, waiting ones first. */
export function OrdersSection({
  orders,
  onChanged,
}: {
  orders: HostOrder[];
  onChanged: () => Promise<void>;
}) {
  // Stable: the API's newest-first order is kept within each group.
  const sorted = [...orders.filter((o) => o.waiting), ...orders.filter((o) => !o.waiting)];
  return (
    <section className="inbox-orders" aria-labelledby="inbox-orders">
      <h2 id="inbox-orders">Orders for your services</h2>
      <ul className="rows">
        {sorted.map((o) => (
          <OrderCard key={o.orderId} order={o} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}
