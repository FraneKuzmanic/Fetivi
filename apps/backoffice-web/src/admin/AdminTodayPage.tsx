import {
  BellSimple,
  CheckCircle,
  ClockCounterClockwise,
  type Icon,
  ListChecks,
  Receipt,
  Scales,
  SealCheck,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  type AdminOrderRow,
  type AdminOverview,
  type AdminPropertyRow,
  admin,
  adminOrders,
} from '../api';
import { EmptyState } from '../shell/EmptyState';
import { usePageTitle } from '../shell/PageTitle';
import { useAction } from '../useAction';
import { ApprovalsTable, approvalOrder } from './ApprovalsTable';
import { OrdersTable } from './orders/OrdersTable';

interface Attention {
  key: string;
  icon: Icon;
  text: string;
  to: string;
  action: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything that waits on the admin, money first. */
export function adminAttention(o: AdminOverview): Attention[] {
  const items: Attention[] = [];
  if (o.ordersNeedAction > 0) {
    items.push({
      key: 'orders',
      icon: Receipt,
      text: `${count(o.ordersNeedAction, 'order needs', 'orders need')} you`,
      to: '/admin/orders?view=needs_action',
      action: 'Open orders',
    });
  }
  if (o.paymentProblems > 0) {
    items.push({
      key: 'payments',
      icon: Scales,
      text: `${count(o.paymentProblems, 'payment check needs', 'payment checks need')} a look`,
      to: '/admin/reconciliation',
      action: 'Review',
    });
  }
  if (o.approvalsPending > 0) {
    items.push({
      key: 'approvals',
      icon: SealCheck,
      text: `${count(o.approvalsPending, 'property waits', 'properties wait')} for approval`,
      to: '/admin/approvals',
      action: 'Review',
    });
  }
  if (o.curationOpen > 0) {
    items.push({
      key: 'curation',
      icon: ListChecks,
      text: `${count(o.curationOpen, 'draft', 'drafts')} to review before guests see them`,
      to: '/admin/curation',
      action: 'Review',
    });
  }
  if (o.recordsDue > 0) {
    items.push({
      key: 'due',
      icon: ClockCounterClockwise,
      text: `${count(o.recordsDue, 'place is', 'places are')} due for a re-check`,
      to: '/admin/curation/staleness',
      action: 'Check',
    });
  }
  return items;
}

/** `/` for an admin: what waits, the properties waiting for approval, then the newest orders. */
export function AdminTodayPage() {
  const { error, run } = useAction();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [orders, setOrders] = useState<AdminOrderRow[] | null>(null);
  const [waiting, setWaiting] = useState<AdminPropertyRow[]>([]);

  const load = useCallback(
    () =>
      run(async () => {
        const [o, list, pending] = await Promise.all([
          admin.overview(),
          adminOrders.list('active'),
          admin.properties('pending'),
        ]);
        setOverview(o);
        setOrders(list.orders.slice(0, 5));
        setWaiting(pending.properties.sort(approvalOrder).slice(0, 5));
      }),
    [run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const attention = overview ? adminAttention(overview) : [];

  usePageTitle('Today');

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {overview === null && !error ? <p className="muted">Loading…</p> : null}

      {overview ? (
        <div className="today-main">
          <section className="today-section" aria-labelledby="attention">
            <h2 id="attention" className="section-title">
              <BellSimple className="section-icon" aria-hidden="true" />
              Needs your attention
            </h2>
            {attention.length > 0 ? (
              <ul className="rows">
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link to={a.to} className="row-link attention-row">
                      <a.icon className="attention-icon" aria-hidden="true" />
                      <span>{a.text}</span>
                      <span className="attention-action">{a.action}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="all-clear">
                <CheckCircle className="all-clear-icon" aria-hidden="true" weight="fill" />
                All caught up. Nothing waits for you.
              </p>
            )}
          </section>

          <section className="today-section" aria-labelledby="waiting-approvals">
            <div className="section-title-row">
              <h2 id="waiting-approvals" className="section-title">
                <SealCheck className="section-icon" aria-hidden="true" />
                Waiting for approval
              </h2>
              <Link to="/admin/approvals">All approvals</Link>
            </div>
            {waiting.length > 0 ? (
              <ApprovalsTable rows={waiting} onChanged={load} />
            ) : (
              <EmptyState icon={SealCheck} title="All caught up">
                New properties show up here until you approve them.
              </EmptyState>
            )}
          </section>

          <section className="today-section" aria-labelledby="recent-orders">
            <div className="section-title-row">
              <h2 id="recent-orders" className="section-title">
                <Receipt className="section-icon" aria-hidden="true" />
                Latest orders
              </h2>
              <Link to="/admin/orders">All orders</Link>
            </div>
            {orders && orders.length > 0 ? (
              <OrdersTable orders={orders} compact />
            ) : (
              <EmptyState icon={Receipt} title="No open orders">
                Orders guests place in the chat show up here until they are done.
              </EmptyState>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
