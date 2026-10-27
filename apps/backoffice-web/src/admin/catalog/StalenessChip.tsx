import type { StalenessStatus } from '@fetivi/domain/catalog-vocabulary';
import type { Staleness } from '../../api';
import { formatDay } from '../../forms/datetime';
import { STALENESS_LABELS } from '../../forms/labels';

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
  const { status, staleAt } = staleness;
  const title =
    staleAt === null
      ? undefined
      : status === 'stale'
        ? `Re-check due since ${day(staleAt)}`
        : `Next re-check due ${day(staleAt)}`;
  return (
    <span className={`chip ${TONE[status]}`} title={title}>
      {STALENESS_LABELS[status]}
    </span>
  );
}
