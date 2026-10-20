import { useCallback, useEffect, useState } from 'react';
import { type Offer, type OfferTranslationsView, providers } from '../../api';
import {
  LANGUAGE_LABELS,
  TRANSLATION_ERROR_LABELS,
  TRANSLATION_ORIGIN_LABELS,
} from '../../forms/labels';
import { useAction } from '../../useAction';

// No corrections here, so a structure mismatch is fixed by retrying or editing the source.
const errorText = (view: OfferTranslationsView) =>
  view.error === 'structure-mismatch'
    ? "Some languages did not keep the text's structure (headings, lists or links). Retry, or simplify the description or policy text."
    : view.error
      ? TRANSLATION_ERROR_LABELS[view.error]
      : null;

function sourceLine(view: OfferTranslationsView): string {
  const { sourceLanguage } = view;
  if (sourceLanguage === null) return 'Source language not detected yet.';
  if (sourceLanguage === 'other') return 'Written in a language other than the seven guest ones.';
  return `Written in ${LANGUAGE_LABELS[sourceLanguage]}.`;
}

function guestsLine(view: OfferTranslationsView): string | null {
  if (view.publishedRevision === view.revision) return null;
  if (view.publishedRevision === null) return "Guests don't see this Offer until it is translated.";
  return 'Guests see the previously published version until this one is published.';
}

/** The seven guest languages of an Offer, read-only; the admin corrects by editing the source. */
export function OfferTranslations({
  offer,
  onChanged,
}: {
  offer: Offer;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [view, setView] = useState<OfferTranslationsView | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        setView(await providers.translations(offer.id));
      }),
    [offer.id, run],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the reload triggers.
  useEffect(() => {
    void load();
  }, [load, offer.translation.revision, offer.translation.status]);

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
                setView((await providers.retryTranslation(offer.id)).view);
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
                <p className="muted translation-label">Cancellation policy</p>
                <pre className="translation-body">{current.cancellationPolicy}</pre>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
