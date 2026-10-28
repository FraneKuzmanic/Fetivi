import { MagnifyingGlass, Receipt } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { type AdminOrderRow, type AdminOrderView, adminOrders } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { Pager } from '../../shell/Pager';
import { usePageTitle } from '../../shell/PageTitle';
import { SearchBox } from '../../shell/SearchBox';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';
import { OrdersTable } from './OrdersTable';

const PAGE = 50;

const VIEWS: { id: AdminOrderView; label: string }[] = [
  { id: 'needs_action', label: 'Needs you' },
  { id: 'active', label: 'Open' },
  { id: 'done', label: 'Done' },
];

const EMPTY: Record<AdminOrderView, [string, string]> = {
  needs_action: [
    'All caught up',
    'Orders show up here when a Provider misses their answer window.',
  ],
  active: ['No open orders', 'Orders guests place in the chat show up here until they are done.'],
  done: ['No finished orders yet', 'Completed, cancelled and declined orders end up here.'],
};

const isView = (v: string | null): v is AdminOrderView => VIEWS.some((x) => x.id === v);

/** /admin/orders: every Order, filtered by what it needs, searchable by offer, seller or ID. */
export function OrdersPage() {
  const { error, run } = useAction();
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const view: AdminOrderView = isView(asked) ? asked : 'active';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ orders: AdminOrderRow[]; total: number } | null>(null);

  // Typing settles for a moment before the list asks again.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new view or search starts at page one.
  useEffect(() => {
    setOffset(0);
  }, [view, search]);

  useEffect(() => {
    // Only the newest request may fill the list; an older answer arriving late is dropped.
    let live = true;
    setPage(null);
    void run(async () => {
      const next = await adminOrders.list(view, search, offset);
      if (live) setPage(next);
    });
    return () => {
      live = false;
    };
  }, [run, view, search, offset]);

  const [emptyTitle, emptyText] = EMPTY[view];

  usePageTitle('Orders');

  return (
    <>
      <Tabs
        label="Order status"
        items={VIEWS}
        value={view}
        onChange={(v) => setParams(v === 'active' ? {} : { view: v }, { replace: true })}
      />
      <div className="toolbar">
        <SearchBox
          label="Search orders"
          value={query}
          placeholder="Offer, Provider, host or order ID"
          onChange={setQuery}
        />
        {page && page.total > 0 ? (
          <span className="toolbar-note">
            {page.total === 1 ? '1 order' : `${page.total} orders`}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {page === null && !error ? <p className="muted">Loading…</p> : null}
      {page && page.orders.length === 0 ? (
        search ? (
          <EmptyState
            icon={MagnifyingGlass}
            title={`No orders match “${search}”`}
            action={
              <button type="button" onClick={() => setQuery('')}>
                Clear search
              </button>
            }
          >
            Search looks at the offer, the Provider, the host’s email and the order ID.
          </EmptyState>
        ) : (
          <EmptyState icon={Receipt} title={emptyTitle}>
            {emptyText}
          </EmptyState>
        )
      ) : null}
      {page && page.orders.length > 0 ? (
        <>
          <OrdersTable orders={page.orders} />
          {page.total > PAGE ? (
            <Pager offset={offset} total={page.total} size={PAGE} onChange={setOffset} />
          ) : null}
        </>
      ) : null}
    </>
  );
}
