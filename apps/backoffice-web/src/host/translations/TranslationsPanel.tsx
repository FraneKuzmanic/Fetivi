import { type GuestLanguage, LIMITS } from '@fetivi/domain/vocabulary';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Block, host, type TranslationsView } from '../../api';
import { TextArea, TextField } from '../../forms/fields';
import { i18next } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';

function sourceLine(view: TranslationsView): string {
  const { sourceLanguage } = view;
  if (sourceLanguage === null) return i18next.t('host:blocks.sourceUnknown');
  if (sourceLanguage === 'other') return i18next.t('host:blocks.sourceOther');
  return i18next.t('host:blocks.writtenIn', {
    language: currentLabels().language[sourceLanguage],
  });
}

function guestsLine(view: TranslationsView): string | null {
  if (view.publishedRevision === view.revision) return null;
  if (view.publishedRevision === null) return i18next.t('host:blocks.notYetTranslated');
  return i18next.t('host:blocks.previousVersion');
}

/** Every guest language of one block: read, correct, and retry a failed translation. */
export function TranslationsPanel({
  block,
  onChanged,
}: {
  block: Block;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { busy, error, run } = useAction();
  const [view, setView] = useState<TranslationsView | null>(null);
  const [correcting, setCorrecting] = useState<GuestLanguage | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(
    () =>
      run(async () => {
        setView(await host.translations(block.id));
      }),
    [block.id, run],
  );

  // Reload when the block moves on (a new revision, or the job finished).
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the reload triggers.
  useEffect(() => {
    void load();
  }, [load, block.revision, block.translation.status]);

  if (!view)
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;

  const retry = () =>
    void run(async () => {
      setView((await host.retryTranslation(block.id)).view);
      await onChanged();
    });

  const guests = guestsLine(view);

  return (
    <div className="translations">
      <p className="muted">
        {sourceLine(view)}
        {guests ? ` ${guests}` : null}
      </p>
      {view.status === 'failed' && view.error ? (
        <div className="translation-failed">
          <p className="translation-error">{labels.translationError[view.error]}</p>
          <button type="button" disabled={busy} onClick={retry}>
            {t('blocks.retryTranslation')}
          </button>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="translation-warnings" role="status">
          <p>
            <strong>{t('blocks.checkThese')}</strong>
          </p>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="translation-list">
        {view.languages.map(({ language, current }) => {
          const isSource = language === view.sourceLanguage;
          return (
            <li key={language} className="translation-row">
              <div className="translation-head">
                <strong>{labels.language[language]}</strong>
                <span className="muted">
                  {current ? labels.translationOrigin[current.origin] : t('blocks.missing')}
                </span>
                {isSource || correcting === language ? null : (
                  <button
                    type="button"
                    disabled={busy || correcting !== null}
                    onClick={() => {
                      setWarnings([]);
                      setCorrecting(language);
                    }}
                  >
                    {t('common:edit')}
                  </button>
                )}
              </div>
              {correcting === language ? (
                <CorrectionForm
                  initial={current ?? { title: block.title, body: block.body }}
                  onSave={async (text) => {
                    const result = await host.correctTranslation(block.id, language, {
                      revision: view.revision,
                      ...text,
                    });
                    setView(result.view);
                    setWarnings(result.structureWarnings);
                    setCorrecting(null);
                    await onChanged();
                  }}
                  onCancel={() => setCorrecting(null)}
                />
              ) : current ? (
                <>
                  <p className="translation-title">{current.title}</p>
                  <pre className="translation-body">{current.body}</pre>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CorrectionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { title: string; body: string };
  onSave: (text: { title: string; body: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState<string | null>(initial.title);
  const [body, setBody] = useState<string | null>(initial.body);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => onSave({ title: title ?? '', body: body ?? '' }));
  }

  return (
    <form className="fields" onSubmit={submit}>
      <TextField
        label={t('blocks.title')}
        value={title}
        maxLength={LIMITS.title}
        required
        onChange={setTitle}
      />
      <TextArea
        label={t('blocks.text')}
        value={body}
        maxLength={LIMITS.blockBody}
        rows={8}
        required
        monospace
        onChange={setBody}
      />
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {t('common:save')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {t('common:cancel')}
        </button>
      </div>
    </form>
  );
}
