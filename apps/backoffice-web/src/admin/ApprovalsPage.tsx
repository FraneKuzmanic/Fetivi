import { SealCheck } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AdminPropertyRow, admin } from '../api';
import { EmptyState } from '../shell/EmptyState';
import { usePageTitle } from '../shell/PageTitle';
import { Tabs } from '../shell/Tabs';
import { useAction } from '../useAction';
import { ApprovalsTable, approvalOrder } from './ApprovalsTable';

type Filter = 'all' | 'pending' | 'approved';

/** /admin/approvals: every property with its approval, and Approve on the ones that wait. */
export function ApprovalsPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
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

  usePageTitle(t('approvals.title'));

  return (
    <>
      <Tabs
        label={t('approvals.status')}
        items={[
          { id: 'all', label: t('approvals.all') },
          { id: 'pending', label: t('approvals.waiting'), count: pending },
          { id: 'approved', label: t('approvals.approved') },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <p role="alert">{error}</p> : null}
      {rows === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {rows && shown.length === 0 ? (
        filter === 'approved' ? (
          <EmptyState icon={SealCheck} title={t('approvals.noneApproved')}>
            {t('approvals.noneApprovedBody')}
          </EmptyState>
        ) : (
          <EmptyState icon={SealCheck} title={t('today.caughtUp')}>
            {t('today.newProperties')}
          </EmptyState>
        )
      ) : null}
      {shown.length > 0 ? <ApprovalsTable rows={shown} onChanged={load} /> : null}
    </>
  );
}
