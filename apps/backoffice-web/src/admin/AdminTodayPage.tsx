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
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  type AdminOrderRow,
  type AdminOverview,
  type AdminPropertyRow,
  admin,
  adminOrders,
} from '../api';
import { i18next } from '../i18n';
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

const t = i18next.getFixedT(null, 'admin', 'today');

/** Everything that waits on the admin, money first. */
export function adminAttention(o: AdminOverview): Attention[] {
  const items: Attention[] = [];
  if (o.ordersNeedAction > 0) {
    items.push({
      key: 'orders',
      icon: Receipt,
      text: t('orders', { count: o.ordersNeedAction }),
      to: '/admin/orders?view=needs_action',
      action: t('openOrders'),
    });
  }
  if (o.paymentProblems > 0) {
    items.push({
      key: 'payments',
      icon: Scales,
      text: t('payments', { count: o.paymentProblems }),
      to: '/admin/reconciliation',
      action: t('review'),
    });
  }
  if (o.approvalsPending > 0) {
    items.push({
      key: 'approvals',
      icon: SealCheck,
      text: t('approvals', { count: o.approvalsPending }),
      to: '/admin/approvals',
      action: t('review'),
    });
  }
  if (o.curationOpen > 0) {
    items.push({
      key: 'curation',
      icon: ListChecks,
      text: t('drafts', { count: o.curationOpen }),
      to: '/admin/curation',
      action: t('review'),
    });
  }
  if (o.recordsDue > 0) {
    items.push({
      key: 'due',
      icon: ClockCounterClockwise,
      text: t('due', { count: o.recordsDue }),
      to: '/admin/curation/staleness',
      action: t('check'),
    });
  }
  return items;
}

/** `/` for an admin: what waits, the properties waiting for approval, then the newest orders. */
export function AdminTodayPage() {
  useTranslation('admin');
  const { t: tc } = useTranslation();
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

  usePageTitle(t('title'));

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {overview === null && !error ? <p className="muted">{tc('loading')}</p> : null}

      {overview ? (
        <div className="today-main">
          <section className="today-section" aria-labelledby="attention">
            <h2 id="attention" className="section-title">
              <BellSimple className="section-icon" aria-hidden="true" />
              {t('attention')}
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
                {t('allClear')}
              </p>
            )}
          </section>

          <section className="today-section" aria-labelledby="waiting-approvals">
            <div className="section-title-row">
              <h2 id="waiting-approvals" className="section-title">
                <SealCheck className="section-icon" aria-hidden="true" />
                {t('waiting')}
              </h2>
              <Link to="/admin/approvals">{t('allApprovals')}</Link>
            </div>
            {waiting.length > 0 ? (
              <ApprovalsTable rows={waiting} onChanged={load} />
            ) : (
              <EmptyState icon={SealCheck} title={t('caughtUp')}>
                {t('newProperties')}
              </EmptyState>
            )}
          </section>

          <section className="today-section" aria-labelledby="recent-orders">
            <div className="section-title-row">
              <h2 id="recent-orders" className="section-title">
                <Receipt className="section-icon" aria-hidden="true" />
                {t('latestOrders')}
              </h2>
              <Link to="/admin/orders">{t('allOrders')}</Link>
            </div>
            {orders && orders.length > 0 ? (
              <OrdersTable orders={orders} compact />
            ) : (
              <EmptyState icon={Receipt} title={t('noOrders')}>
                {t('noOrdersBody')}
              </EmptyState>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
