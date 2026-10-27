import { SealCheck } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { type AdminPropertyRow, admin } from '../api';
import { formatDay } from '../forms/datetime';
import { useConfirm } from '../shell/ConfirmDialog';
import { EmptyState } from '../shell/EmptyState';
import { Tabs } from '../shell/Tabs';
import { useAction } from '../useAction';

type Filter = 'all' | 'pending' | 'approved';

/** "1 of 2 ready": how many units go live the moment the property is approved. */
export function unitsLine(p: AdminPropertyRow): string {
  if (p.approvedAt) return p.unitCount === 1 ? '1 unit' : `${p.unitCount} units`;
  return `${p.readyUnitCount} of ${p.unitCount} ready`;
}

/** Waiting properties first, oldest first; then the approved, newest first. */
export function approvalOrder(a: AdminPropertyRow, b: AdminPropertyRow): number {
  if (!a.approvedAt !== !b.approvedAt) return a.approvedAt ? 1 : -1;
  if (!a.approvedAt) return a.createdAt.localeCompare(b.createdAt);
  return (b.approvedAt ?? '').localeCompare(a.approvedAt ?? '');
}

/** /admin/approvals: every property with its approval, and Approve on the ones that wait. */
export function ApprovalsPage() {
  const confirm = useConfirm();
  const { busy, error, run } = useAction();
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<AdminPropertyRow[] | null>(null);

  const load = useCallback(
    () => run(async () => setRows((await admin.properties('all')).properties)),
    [run],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(p: AdminPropertyRow) {
    const yes = await confirm({
      title: `Approve ${p.name}?`,
      body:
        p.readyUnitCount === p.unitCount
          ? 'All its units are ready and get their QR links now.'
          : `${p.readyUnitCount} of ${p.unitCount} units are ready and get their QR links now. The rest get theirs when they are ready.`,
      action: 'Approve property',
    });
    if (!yes) return;
    void run(async () => {
      await admin.approve(p.id);
      setRows((await admin.properties('all')).properties);
    });
  }

  const pending = rows?.filter((p) => !p.approvedAt).length ?? 0;
  const shown = (rows ?? [])
    .filter((p) => filter === 'all' || (filter === 'pending') === !p.approvedAt)
    .sort(approvalOrder);

  return (
    <>
      <div className="page-head">
        <h1>Approvals</h1>
      </div>
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
      {shown.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col" className="wide-only">
                  Host
                </th>
                <th scope="col" className="wide-only">
                  Units
                </th>
                <th scope="col" className="wide-only">
                  Added
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="cell-main">
                      <strong>{p.name}</strong>
                      {p.city ? <span className="cell-sub">{p.city}</span> : null}
                    </div>
                  </td>
                  <td className="wide-only">{p.hostEmail}</td>
                  <td className="nowrap wide-only">{unitsLine(p)}</td>
                  <td className="nowrap wide-only">{formatDay(p.createdAt)}</td>
                  <td>
                    {p.approvedAt ? (
                      <div className="cell-main">
                        <span className="chip ok">Approved</span>
                        <span className="cell-sub">{formatDay(p.approvedAt)}</span>
                      </div>
                    ) : (
                      <span className="chip wait">Waiting</span>
                    )}
                  </td>
                  <td className="cell-actions">
                    {p.approvedAt ? null : (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void approve(p)}
                      >
                        Approve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
