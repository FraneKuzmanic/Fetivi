import { LIMITS, MEDIA_CONTENT_TYPES } from '@fetivi/domain/vocabulary';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Block, type BlockMedia, host } from '../../api';
import { TextField } from '../../forms/fields';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';
import { fileProblem } from './PendingMedia';

const ACCEPT = MEDIA_CONTENT_TYPES.join(',');

/** The photos and short videos of one guide entry: add with a caption, edit captions, remove. */
export function MediaPanel({ block, onChanged }: { block: Block; onChanged: () => Promise<void> }) {
  const { t } = useTranslation(['host', 'common']);
  const full = block.media.length >= LIMITS.mediaPerBlock;
  return (
    <div className="media-panel">
      <p className="muted">{t('blocks.mediaIntro')}</p>
      {block.media.length > 0 ? (
        <ul className="media-list">
          {block.media.map((item) => (
            <MediaItem key={item.id} item={item} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="muted">{t('blocks.mediaFull')}</p>
      ) : (
        <UploadForm blockId={block.id} onChanged={onChanged} />
      )}
    </div>
  );
}

function MediaPreview({ item }: { item: BlockMedia }) {
  const src = host.mediaUrl(item.id);
  return item.kind === 'image' ? (
    <img className="media-preview" src={src} alt={item.caption} />
  ) : (
    // biome-ignore lint/a11y/useMediaCaption: host-uploaded clips carry no caption track; the caption field below describes them.
    <video className="media-preview" src={src} controls preload="metadata" />
  );
}

function MediaItem({ item, onChanged }: { item: BlockMedia; onChanged: () => Promise<void> }) {
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [caption, setCaption] = useState<string | null>(item.caption);

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await host.updateMediaCaption(item.id, caption ?? '');
      await onChanged();
    });
  }

  return (
    <li className="media-item">
      <MediaPreview item={item} />
      <form className="media-fields" onSubmit={save}>
        <TextField
          label={t('blocks.caption')}
          value={caption}
          maxLength={LIMITS.caption}
          required
          onChange={setCaption}
        />
        {error ? <p role="alert">{error}</p> : null}
        <div className="actions">
          <button type="submit" disabled={busy || caption === item.caption}>
            {t('blocks.saveCaption')}
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: t('blocks.removeTitle', { caption: item.caption }),
                  body: t('blocks.removeBody'),
                  action: t('blocks.removePhoto'),
                  danger: true,
                })
              ) {
                void run(async () => {
                  await host.deleteMedia(item.id);
                  await onChanged();
                });
              }
            }}
          >
            {t('common:remove')}
          </button>
        </div>
      </form>
    </li>
  );
}

function UploadForm({ blockId, onChanged }: { blockId: string; onChanged: () => Promise<void> }) {
  const { t } = useTranslation(['host', 'common']);
  const { busy, error, run } = useAction();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const fileId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    void run(async () => {
      await host.uploadMedia(blockId, file, caption ?? '');
      setFile(null);
      setCaption(null);
      // A new key clears the file input.
      setInputKey((k) => k + 1);
      await onChanged();
    });
  }

  return (
    <form className="media-upload fields" onSubmit={submit}>
      <h4>{t('blocks.addMedia')}</h4>
      <div className="field">
        <label className="field-label" htmlFor={fileId}>
          {t('blocks.file')}
        </label>
        <input
          key={inputKey}
          id={fileId}
          type="file"
          accept={ACCEPT}
          required
          aria-describedby={`${fileId}-hint`}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            setProblem(chosen ? fileProblem(chosen) : null);
          }}
        />
        <small id={`${fileId}-hint`}>{t('blocks.fileHint')}</small>
      </div>
      <TextField
        label={t('blocks.caption')}
        hint={t('blocks.captionHint')}
        value={caption}
        maxLength={LIMITS.caption}
        required
        onChange={setCaption}
      />
      {problem ? <p role="alert">{problem}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !file || problem !== null}>
          {busy ? t('blocks.uploading') : t('blocks.upload')}
        </button>
      </div>
    </form>
  );
}
