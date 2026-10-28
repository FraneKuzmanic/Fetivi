import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CatalogRecord, type CatalogTranslationsView, catalog } from '../../api';
import { i18next } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';

// No corrections here, so a structure mismatch is fixed by retrying or editing the source.
const errorText = (view: CatalogTranslationsView) =>
  view.error === 'structure-mismatch'
    ? i18next.t('admin:catalog.structure')
    : view.error
      ? currentLabels().translationError[view.error]
      : null;

function sourceLine(view: CatalogTranslationsView): string {
  const { sourceLanguage } = view;
  if (sourceLanguage === null) return i18next.t('host:blocks.sourceUnknown');
  if (sourceLanguage === 'other') return i18next.t('host:blocks.sourceOther');
  return i18next.t('host:blocks.writtenIn', {
    language: currentLabels().language[sourceLanguage],
  });
}

function guestsLine(view: CatalogTranslationsView): string | null {
  if (view.publishedRevision === view.revision) return null;
  if (view.publishedRevision === null) return i18next.t('admin:catalog.notYetTranslated');
  return i18next.t('host:blocks.previousVersion');
}

/** The seven guest languages of a record, read-only; the admin corrects by editing the source. */
export function CatalogTranslations({
  record,
  onChanged,
}: {
  record: CatalogRecord;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
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

  if (!view)
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;

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
            {t('host:blocks.retryTranslation')}
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="translation-list">
        {view.languages.map(({ language, current }) => (
          <li key={language} className="translation-row">
            <div className="translation-head">
              <strong>{labels.language[language]}</strong>
              <span className="muted">
                {current ? labels.translationOrigin[current.origin] : t('catalog.notTranslated')}
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
