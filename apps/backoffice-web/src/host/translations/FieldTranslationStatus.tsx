import { useTranslation } from 'react-i18next';
import { type FieldTranslation, host } from '../../api';
import { useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';
import { TranslationChip } from './TranslationChip';

/**
 * Ticket 50: the translation state of one free-text field or amenity note, with the reason and
 * Retry when it failed. No correction editor: the host edits the source text instead.
 */
export function FieldTranslationStatus({
  translation,
  onChanged,
}: {
  translation: FieldTranslation | undefined;
  onChanged: () => Promise<void>;
}) {
  const labels = useLabels();
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  // Translating runs by itself after a save; only a failure needs the host.
  if (translation?.status !== 'failed') return null;
  return (
    <span className="field-translation">
      <TranslationChip status={translation.status} />
      {translation.status === 'failed' ? (
        <span className="translation-error">
          {translation.error === 'structure-mismatch'
            ? t('blocks.fieldStructure')
            : translation.error
              ? labels.translationError[translation.error]
              : null}{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await host.retryFieldTranslation(translation.id);
                await onChanged();
              })
            }
          >
            {t('blocks.retryTranslation')}
          </button>
          {error ? <span role="alert"> {error}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
