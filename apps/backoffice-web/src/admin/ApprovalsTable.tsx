import { type AdminPropertyRow, admin } from '../api';
import { formatDay } from '../forms/datetime';
import { useConfirm } from '../shell/ConfirmDialog';
import { useAction } from '../useAction';

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

/** The approvals table, shared by Approvals and admin Today, with Approve on the rows that wait. */
export function ApprovalsTable({
  rows,
  onChanged,
}: {
  rows: AdminPropertyRow[];
  onChanged: () => Promise<void> | void;
}) {
  const confirm = useConfirm();
  const { busy, error, run } = useAction();

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
      await onChanged();
    });
  }

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <div className="table-frame">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Property</th>
              <th scope="col" className="wide-only">
                Destination
              </th>
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
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                </td>
                <td className="wide-only">{p.city ?? '—'}</td>
                <td className="wide-only">{p.hostEmail}</td>
                <td className="nowrap wide-only">{unitsLine(p)}</td>
                <td className="nowrap wide-only">{formatDay(p.createdAt)}</td>
                <td>
                  {p.approvedAt ? (
                    <span className="chip ok">Approved</span>
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
    </>
  );
}
