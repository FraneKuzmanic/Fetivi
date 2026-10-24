import { type FieldTranslation, host } from '../../api';
import { TRANSLATION_ERROR_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { TranslationChip } from './TranslationChip';

// A field has no correction editor, so the block label's "Correct them below" does not apply.
const ERROR_LABELS = {
  ...TRANSLATION_ERROR_LABELS,
  'structure-mismatch':
    "Some languages did not keep the text's structure. Retry, or rephrase the text and save.",
};

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
  const { busy, error, run } = useAction();
  if (!translation) return null;
  return (
    <span className="field-translation">
      <TranslationChip status={translation.status} />
      {translation.status === 'failed' ? (
        <span className="translation-error">
          {translation.error ? ERROR_LABELS[translation.error] : null}{' '}
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
            Retry translation
          </button>
          {error ? <span role="alert"> {error}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
