import { SealCheck } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { type AdminPropertyRow, admin } from '../api';
import { EmptyState } from '../shell/EmptyState';
import { usePageTitle } from '../shell/PageTitle';
import { Tabs } from '../shell/Tabs';
import { useAction } from '../useAction';
import { ApprovalsTable, approvalOrder } from './ApprovalsTable';

type Filter = 'all' | 'pending' | 'approved';

/** /admin/approvals: every property with its approval, and Approve on the ones that wait. */
export function ApprovalsPage() {
  const { error, run } = useAction();
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<AdminPropertyRow[] | null>(null);

  const load = useCallback(
    () => run(async () => setRows((await admin.properties('all')).properties)),
    [run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const pending = rows?.filter((p) => !p.approvedAt).length ?? 0;
  const shown = (rows ?? [])
    .filter((p) => filter === 'all' || (filter === 'pending') === !p.approvedAt)
    .sort(approvalOrder);

  usePageTitle('Approvals');

  return (
    <>
      <Tabs
        label="Approval status"
        items={[
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Waiting', count: pending },
          { id: 'approved', label: 'Approved' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <p role="alert">{error}</p> : null}
      {rows === null && !error ? <p className="muted">Loading…</p> : null}
      {rows && shown.length === 0 ? (
        filter === 'approved' ? (
          <EmptyState icon={SealCheck} title="Nothing approved yet">
            Properties you approve are listed here.
          </EmptyState>
        ) : (
          <EmptyState icon={SealCheck} title="All caught up">
            New properties show up here until you approve them.
          </EmptyState>
        )
      ) : null}
      {shown.length > 0 ? <ApprovalsTable rows={shown} onChanged={load} /> : null}
    </>
  );
}
