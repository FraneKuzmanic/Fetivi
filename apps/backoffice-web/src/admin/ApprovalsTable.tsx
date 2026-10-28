import { useTranslation } from 'react-i18next';
import { type AdminPropertyRow, admin } from '../api';
import { formatDay } from '../forms/datetime';
import { i18next } from '../i18n';
import { useConfirm } from '../shell/ConfirmDialog';
import { useAction } from '../useAction';

/** "1 of 2 ready": how many units go live the moment the property is approved. */
export function unitsLine(p: AdminPropertyRow): string {
  if (p.approvedAt) return i18next.t('admin:approvals.units', { count: p.unitCount });
  return i18next.t('admin:approvals.ready', { ready: p.readyUnitCount, total: p.unitCount });
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const confirm = useConfirm();
  const { busy, error, run } = useAction();

  async function approve(p: AdminPropertyRow) {
    const yes = await confirm({
      title: t('approvals.approveTitle', { name: p.name }),
      body:
        p.readyUnitCount === p.unitCount
          ? t('approvals.allReady')
          : t('approvals.someReady', { ready: p.readyUnitCount, total: p.unitCount }),
      action: t('approvals.approveProperty'),
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
              <th scope="col">{t('approvals.property')}</th>
              <th scope="col" className="wide-only">
                {t('approvals.destination')}
              </th>
              <th scope="col" className="wide-only">
                {t('approvals.host')}
              </th>
              <th scope="col" className="wide-only">
                {t('approvals.unitsColumn')}
              </th>
              <th scope="col" className="wide-only">
                {t('approvals.added')}
              </th>
              <th scope="col">{t('approvals.statusColumn')}</th>
              <th scope="col">
                <span className="visually-hidden">{t('common:table.actions')}</span>
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
                    <span className="chip ok">{t('approvals.approved')}</span>
                  ) : (
                    <span className="chip wait">{t('approvals.waiting')}</span>
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
                      {t('approvals.approve')}
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
