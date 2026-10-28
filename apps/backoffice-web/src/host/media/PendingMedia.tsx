import { LIMITS, MEDIA_CONTENT_TYPES, MEDIA_TYPES } from '@fetivi/domain/vocabulary';
import { ImageSquare, X } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../forms/fields';
import { i18next } from '../../i18n';

export interface PendingFile {
  /** Only for React: the same file can be picked twice. */
  id: string;
  file: File;
  caption: string | null;
}

const ACCEPT = MEDIA_CONTENT_TYPES.join(',');

/** Why the server would refuse a file, said before the upload; the server stays the authority. */
export function fileProblem(file: File): string | null {
  const type = MEDIA_TYPES[file.type as keyof typeof MEDIA_TYPES];
  if (!type) return i18next.t('errors:unsupported-media');
  const limit = type.kind === 'image' ? LIMITS.imageBytes : LIMITS.videoBytes;
  if (file.size > limit) return i18next.t('errors:media-too-large');
  return null;
}

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  if (!url) return null;
  return file.type.startsWith('image/') ? (
    <img className="media-preview" src={url} alt="" />
  ) : (
    <video className="media-preview" src={url} preload="metadata" muted />
  );
}

/**
 * Photos and videos picked while a guide entry is being written; they upload once it is saved.
 * Each needs a caption: guests see it, and it is read aloud to blind guests.
 */
export function PendingMedia({
  files,
  onChange,
}: {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
}) {
  const { t } = useTranslation(['host', 'common']);
  const inputId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const room = LIMITS.mediaPerBlock - files.length;

  return (
    <fieldset className="pending-media">
      <legend className="field-label">{t('blocks.mediaOptional')}</legend>
      {files.length > 0 ? (
        <ul className="media-list">
          {files.map((item, i) => (
            <li key={item.id} className="media-item">
              <Preview file={item.file} />
              <div className="media-fields">
                <TextField
                  label={t('blocks.captionFor', { file: item.file.name })}
                  hint={t('blocks.captionShortHint')}
                  value={item.caption}
                  maxLength={LIMITS.caption}
                  required
                  onChange={(caption) =>
                    onChange(files.map((f, j) => (j === i ? { ...f, caption } : f)))
                  }
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                >
                  <X aria-hidden="true" />
                  {t('common:remove')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {room > 0 ? (
        <label className="button file-button" htmlFor={inputId}>
          <ImageSquare aria-hidden="true" />
          {t('blocks.addPhotos')}
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            className="visually-hidden"
            onChange={(e) => {
              const picked = [...(e.target.files ?? [])];
              e.target.value = '';
              const bad = picked.map(fileProblem).find(Boolean) ?? null;
              setProblem(bad);
              const good = picked.filter((f) => !fileProblem(f)).slice(0, room);
              onChange([
                ...files,
                ...good.map((file) => ({ id: crypto.randomUUID(), file, caption: null })),
              ]);
            }}
          />
        </label>
      ) : (
        <p className="muted">Up to {LIMITS.mediaPerBlock} photos or videos per entry.</p>
      )}
      {problem ? <p role="alert">{problem}</p> : null}
    </fieldset>
  );
}
