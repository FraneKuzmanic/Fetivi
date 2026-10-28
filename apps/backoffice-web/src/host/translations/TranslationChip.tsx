import type { TranslationStatus } from '@fetivi/domain/vocabulary';
import { useLabels } from '../../i18n/useLabels';

const TONE: Record<TranslationStatus, string> = {
  pending: 'wait',
  published: 'ok',
  failed: 'fail',
};

/**
 * The translation status of a block's current revision, shown only when it failed: translating
 * runs on its own after every save, and a host has nothing to do until something goes wrong.
 */
export function TranslationChip({ status }: { status: TranslationStatus }) {
  const labels = useLabels();
  if (status !== 'failed') return null;
  return <span className={`chip ${TONE[status]}`}>{labels.translationStatus[status]}</span>;
}
