import type { StalenessStatus } from '@fetivi/domain/catalog-vocabulary';
import type { Staleness } from '../../api';
import { STALENESS_LABELS } from '../../forms/labels';

const TONE: Record<StalenessStatus, string> = {
  fresh: 'ok',
  stale: 'fail',
  never_verified: 'wait',
  expired: 'neutral',
};

/** An ISO instant as a date in the viewer's locale. */
export const day = (iso: string) => new Date(iso).toLocaleDateString();

/** Whether a record is still within its staleness budget. */
export function StalenessChip({ staleness }: { staleness: Staleness }) {
  const { status, staleAt } = staleness;
  const title =
    staleAt === null
      ? undefined
      : status === 'stale'
        ? `Went past its budget on ${day(staleAt)}`
        : `Goes past its budget on ${day(staleAt)}`;
  return (
    <span className={`chip ${TONE[status]}`} title={title}>
      {STALENESS_LABELS[status]}
    </span>
  );
}
