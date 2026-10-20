import { useCallback, useEffect, useState } from 'react';
import { type CatalogRecord, type CatalogTranslationsView, catalog } from '../../api';
import {
  LANGUAGE_LABELS,
  TRANSLATION_ERROR_LABELS,
  TRANSLATION_ORIGIN_LABELS,
} from '../../forms/labels';
import { useAction } from '../../useAction';

// No corrections here, so a structure mismatch is fixed by retrying or editing the source.
const errorText = (view: CatalogTranslationsView) =>
  view.error === 'structure-mismatch'
    ? "Some languages did not keep the text's structure (headings, lists or links). Retry, or simplify the description."
    : view.error
      ? TRANSLATION_ERROR_LABELS[view.error]
      : null;

function sourceLine(view: CatalogTranslationsView): string {
  const { sourceLanguage } = view;
  if (sourceLanguage === null) return 'Source language not detected yet.';
  if (sourceLanguage === 'other') return 'Written in a language other than the seven guest ones.';
  return `Written in ${LANGUAGE_LABELS[sourceLanguage]}.`;
}

function guestsLine(view: CatalogTranslationsView): string | null {
  if (view.publishedRevision === view.revision) return null;
  if (view.publishedRevision === null)
    return "Guests don't see this record until it is translated.";
  return 'Guests see the previously published version until this one is published.';
}

/** The seven guest languages of a record, read-only; the admin corrects by editing the source. */
export function CatalogTranslations({
  record,
  onChanged,
}: {
  record: CatalogRecord;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [view, setView] = useState<CatalogTranslationsView | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        setView(await catalog.translations(record.id));
      }),
    [record.id, run],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the reload triggers.
  useEffect(() => {
    void load();
  }, [load, record.translation.revision, record.translation.status]);

  if (!view) return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;

  const guests = guestsLine(view);

  return (
    <div className="translations">
      <p className="muted">
        {sourceLine(view)}
        {guests ? ` ${guests}` : null}
      </p>
      {view.status === 'failed' && view.error ? (
        <div className="translation-failed">
          <p className="translation-error">{errorText(view)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setView((await catalog.retryTranslation(record.id)).view);
                await onChanged();
              })
            }
          >
            Retry translation
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="translation-list">
        {view.languages.map(({ language, current }) => (
          <li key={language} className="translation-row">
            <div className="translation-head">
              <strong>{LANGUAGE_LABELS[language]}</strong>
              <span className="muted">
                {current ? TRANSLATION_ORIGIN_LABELS[current.origin] : 'Not translated yet'}
              </span>
            </div>
            {current ? (
              <>
                <p className="translation-title">{current.title}</p>
                <pre className="translation-body">{current.body}</pre>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
