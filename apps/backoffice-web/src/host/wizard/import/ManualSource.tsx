import { LIMITS } from '@fetivi/domain/vocabulary';
import { ClipboardText, FileArrowUp } from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageFor } from '../../../messages';
import { useWizardCopy } from '../copy';

const ACCEPT = [
  '.pdf',
  '.docx',
  '.txt',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
].join(',');

export type ManualInput = { kind: 'paste'; text: string } | { kind: 'file'; file: File };

/** Paste the manual's text or pick its file, then start the import. */
export function ManualSource({
  busy,
  error,
  pendingDrafts,
  onStart,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  /** Drafts of the current import that a new one would replace. */
  pendingDrafts: number;
  onStart: (input: ManualInput) => void;
  onCancel?: () => void;
}) {
  const copy = useWizardCopy();
  const { t } = useTranslation('wizard');
  const mi = copy.manualImport;
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const textId = useId();
  const fileId = useId();
  const hintId = useId();

  function pick(picked: File | null) {
    setFile(picked);
    setFileError(
      picked && picked.size > LIMITS.manualBytes ? messageFor('manual-too-large') : null,
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'paste') onStart({ kind: 'paste', text });
    else if (file && !fileError) onStart({ kind: 'file', file });
  }

  const ready = mode === 'paste' ? text.trim() !== '' : file !== null && fileError === null;

  return (
    <form className="panel manual-source" onSubmit={submit}>
      <div className="segmented" role="tablist" aria-label={mi.title}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'paste'}
          onClick={() => setMode('paste')}
        >
          <ClipboardText aria-hidden="true" />
          {mi.pasteTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'file'}
          onClick={() => setMode('file')}
        >
          <FileArrowUp aria-hidden="true" />
          {mi.uploadTab}
        </button>
      </div>

      {mode === 'paste' ? (
        <div className="field">
          <label className="field-label" htmlFor={textId}>
            {mi.pasteLabel}
          </label>
          <textarea
            id={textId}
            rows={12}
            value={text}
            maxLength={LIMITS.manualText}
            onChange={(e) => setText(e.target.value)}
          />
          <small>{t('charactersLeft', { count: LIMITS.manualText - text.length })}</small>
        </div>
      ) : (
        <div className="field">
          <label className="field-label" htmlFor={fileId}>
            {mi.fileLabel}
          </label>
          <input
            id={fileId}
            type="file"
            accept={ACCEPT}
            aria-describedby={hintId}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <small id={hintId}>{mi.fileHint}</small>
          {fileError ? <p role="alert">{fileError}</p> : null}
        </div>
      )}

      {pendingDrafts > 0 ? <p className="muted">{mi.replaceWarning}</p> : null}
      {busy ? (
        <p className="muted" role="status">
          {mi.reading}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !ready}>
          {mi.start}
        </button>
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel}>
            {copy.ui.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
