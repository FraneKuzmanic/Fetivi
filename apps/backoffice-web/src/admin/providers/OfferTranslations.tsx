import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Offer, OfferTranslationsClient, OfferTranslationsView } from '../../api';
import { i18next } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';

// No corrections here, so a structure mismatch is fixed by retrying or editing the source.
const errorText = (view: OfferTranslationsView) =>
  view.error === 'structure-mismatch'
    ? i18next.t('admin:providers.structure')
    : view.error
      ? currentLabels().translationError[view.error]
      : null;

function sourceLine(view: OfferTranslationsView): string {
  const { sourceLanguage } = view;
  if (sourceLanguage === null) return i18next.t('host:blocks.sourceUnknown');
  if (sourceLanguage === 'other') return i18next.t('host:blocks.sourceOther');
  return i18next.t('host:blocks.writtenIn', {
    language: currentLabels().language[sourceLanguage],
  });
}

function guestsLine(view: OfferTranslationsView, noun: 'offer' | 'service'): string | null {
  if (view.publishedRevision === view.revision) return null;
  if (view.publishedRevision === null)
    return noun === 'service'
      ? i18next.t('admin:providers.notTranslatedService')
      : i18next.t('admin:providers.notTranslatedOffer');
  return i18next.t('host:blocks.previousVersion');
}

/** The seven guest languages of an Offer, read-only; the admin corrects by editing the source. */
export function OfferTranslations({
  offer,
  client,
  onChanged,
  noun = 'offer',
}: {
  offer: Offer;
  /** The admin's Offer routes or the host's own-service routes (38). */
  client: OfferTranslationsClient;
  onChanged: () => Promise<void>;
  /** What the page calls the Offer: a host reads "service". */
  noun?: 'offer' | 'service';
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { busy, error, run } = useAction();
  const [view, setView] = useState<OfferTranslationsView | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        setView(await client.translations(offer.id));
      }),
    [offer.id, run, client],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the reload triggers.
  useEffect(() => {
    void load();
  }, [load, offer.translation.revision, offer.translation.status]);

  if (!view)
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;

  const guests = guestsLine(view, noun);

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
                setView((await client.retryTranslation(offer.id)).view);
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
                <p className="muted translation-label">{t('providers.policy')}</p>
                <pre className="translation-body">{current.cancellationPolicy}</pre>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
