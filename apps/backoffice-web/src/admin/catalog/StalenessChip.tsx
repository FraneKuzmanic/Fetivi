import type { StalenessStatus } from '@fetivi/domain/catalog-vocabulary';
import { useTranslation } from 'react-i18next';
import type { Staleness } from '../../api';
import { formatDay } from '../../forms/datetime';
import { useLabels } from '../../i18n/useLabels';

const TONE: Record<StalenessStatus, string> = {
  fresh: 'ok',
  stale: 'fail',
  never_verified: 'wait',
  expired: 'neutral',
};

/** An ISO instant as a day-first date. */
export const day = (iso: string) => formatDay(iso);

/** Whether a record was checked recently enough, or is due for a re-check. */
export function StalenessChip({ staleness }: { staleness: Staleness }) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { status, staleAt } = staleness;
  const title =
    staleAt === null
      ? undefined
      : status === 'stale'
        ? t('catalog.dueSince', { day: day(staleAt) })
        : t('catalog.nextDue', { day: day(staleAt) });
  return (
    <span className={`chip ${TONE[status]}`} title={title}>
      {labels.staleness[status]}
    </span>
  );
}
