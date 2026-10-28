import { MagnifyingGlass, Receipt } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { type AdminOrderRow, type AdminOrderView, adminOrders } from '../../api';
import { i18next } from '../../i18n';
import { EmptyState } from '../../shell/EmptyState';
import { Pager } from '../../shell/Pager';
import { usePageTitle } from '../../shell/PageTitle';
import { SearchBox } from '../../shell/SearchBox';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';
import { OrdersTable } from './OrdersTable';

const PAGE = 50;

const t = i18next.getFixedT(null, 'admin', 'orders');

const views = (): { id: AdminOrderView; label: string }[] => [
  { id: 'needs_action', label: t('needsYou') },
  { id: 'active', label: t('open') },
  { id: 'done', label: t('done') },
];

const empty = (view: AdminOrderView): [string, string] =>
  ({
    needs_action: [t('caughtUp'), t('caughtUpBody')] as [string, string],
    active: [t('noOpen'), t('noOpenBody')] as [string, string],
    done: [t('noDone'), t('noDoneBody')] as [string, string],
  })[view];

const isView = (v: string | null): v is AdminOrderView =>
  v === 'needs_action' || v === 'active' || v === 'done';

/** /admin/orders: every Order, filtered by what it needs, searchable by offer, seller or ID. */
export function OrdersPage() {
  useTranslation('admin');
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

  const [emptyTitle, emptyText] = empty(view);

  usePageTitle(t('title'));

  return (
    <>
      <Tabs
        label={t('status')}
        items={views()}
        value={view}
        onChange={(v) => setParams(v === 'active' ? {} : { view: v }, { replace: true })}
      />
      <div className="toolbar">
        <SearchBox
          label={t('search')}
          value={query}
          placeholder={t('searchPlaceholder')}
          onChange={setQuery}
        />
        {page && page.total > 0 ? (
          <span className="toolbar-note">{t('count', { count: page.total })}</span>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {page === null && !error ? <p className="muted">{i18next.t('common:loading')}</p> : null}
      {page && page.orders.length === 0 ? (
        search ? (
          <EmptyState
            icon={MagnifyingGlass}
            title={t('noMatch', { query: search })}
            action={
              <button type="button" onClick={() => setQuery('')}>
                {i18next.t('common:table.clearSearch')}
              </button>
            }
          >
            {t('searchHint')}
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
