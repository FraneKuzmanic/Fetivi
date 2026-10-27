import { LIMITS, MEDIA_CONTENT_TYPES } from '@fetivi/domain/vocabulary';
import { type FormEvent, useId, useState } from 'react';
import { type Block, type BlockMedia, host } from '../../api';
import { TextField } from '../../forms/fields';
import { useAction } from '../../useAction';
import { fileProblem } from './PendingMedia';

const ACCEPT = MEDIA_CONTENT_TYPES.join(',');

/** The photos and short videos of one guide entry: add with a caption, edit captions, remove. */
export function MediaPanel({ block, onChanged }: { block: Block; onChanged: () => Promise<void> }) {
  const full = block.media.length >= LIMITS.mediaPerBlock;
  return (
    <div className="media-panel">
      <p className="muted">
        Guests see a new photo once the entry's translations are published. The caption is shown to
        guests and read aloud to blind guests; it is translated with the entry.
      </p>
      {block.media.length > 0 ? (
        <ul className="media-list">
          {block.media.map((item) => (
            <MediaItem key={item.id} item={item} onChanged={onChanged} />
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="muted">This entry has the maximum of 6 photos or videos.</p>
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
  const { busy, error, run } = useAction();
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
          label="Caption"
          value={caption}
          maxLength={LIMITS.caption}
          required
          onChange={setCaption}
        />
        {error ? <p role="alert">{error}</p> : null}
        <div className="actions">
          <button type="submit" disabled={busy || caption === item.caption}>
            Save caption
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove "${item.caption}"?`)) {
                void run(async () => {
                  await host.deleteMedia(item.id);
                  await onChanged();
                });
              }
            }}
          >
            Remove
          </button>
        </div>
      </form>
    </li>
  );
}

function UploadForm({ blockId, onChanged }: { blockId: string; onChanged: () => Promise<void> }) {
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
      <h4>Add a photo or video</h4>
      <div className="field">
        <label className="field-label" htmlFor={fileId}>
          File
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
        <small id={`${fileId}-hint`}>
          JPEG, PNG or WebP up to 10 MB; MP4 or WebM up to 50 MB; up to 6 per entry.
        </small>
      </div>
      <TextField
        label="Caption"
        hint="Say what it shows, e.g. “The washing machine dial, set to program 3”."
        value={caption}
        maxLength={LIMITS.caption}
        required
        onChange={setCaption}
      />
      {problem ? <p role="alert">{problem}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy || !file || problem !== null}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </form>
  );
}
