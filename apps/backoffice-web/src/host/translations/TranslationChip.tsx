import type { TranslationStatus } from '@fetivi/domain/vocabulary';
import { TRANSLATION_STATUS_LABELS } from '../../forms/labels';

const TONE: Record<TranslationStatus, string> = {
  pending: 'wait',
  published: 'ok',
  failed: 'fail',
};

/** The translation status of a block's current revision. */
export function TranslationChip({ status }: { status: TranslationStatus }) {
  return <span className={`chip ${TONE[status]}`}>{TRANSLATION_STATUS_LABELS[status]}</span>;
}
