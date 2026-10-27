import {
  BLOCK_VISIBILITY,
  HOST_BLOCK_CATEGORIES,
  type HostBlockCategory,
  LIMITS,
} from '@fetivi/domain/vocabulary';
import { type FormEvent, useState } from 'react';
import { type Block, type BlockInput, type BlockResult, host, type SecretWarning } from '../api';
import { SelectField, TextField } from '../forms/fields';
import { CATEGORY_LABELS, VISIBILITY_LABELS } from '../forms/labels';
import { useAction } from '../useAction';
import { type PendingFile, PendingMedia } from './media/PendingMedia';
import { MarkdownField } from './wizard/MarkdownField';

const WARNING_KIND: Record<SecretWarning['kind'], string> = {
  code: 'a door or key code',
  phone: 'a phone number',
  password: 'a password',
};

/**
 * Shown after a save whose text looks like it holds a secret. The save itself succeeded. A draft
 * that is not saved yet passes its own lead.
 */
export function SecretWarnings({
  warnings,
  lead = 'Saved, but check this.',
}: {
  warnings: SecretWarning[];
  lead?: string;
}) {
  return (
    <div className="warning" role="status">
      <p>
        <strong>{lead}</strong> Parts of the text look like a secret. Put secrets in the typed
        fields (Wi-Fi, door codes, phone numbers) so guests only see them when they should.
      </p>
      <ul>
        {warnings.map((w) => (
          <li key={`${w.kind}:${w.excerpt}`}>
            Looks like {WARNING_KIND[w.kind]}: <q>{w.excerpt}</q>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Creates or edits one guide entry (an info block). */
export function BlockEditor({
  initial,
  heading,
  onSubmit,
  onDone,
  onCancel,
  categoryFixed = false,
  withMedia = false,
}: {
  initial?: Partial<Pick<Block, 'title' | 'body' | 'visibility' | 'revision'>> & {
    category?: HostBlockCategory;
  };
  /** Hides the Guide section field: the block stays in `initial.category`. */
  categoryFixed?: boolean;
  /** A new entry: photos and video can be picked now and upload once it is saved. */
  withMedia?: boolean;
  heading: string;
  onSubmit: (input: BlockInput) => Promise<BlockResult>;
  /** Called after a save; the warnings and an upload problem, if any, are shown by the caller. */
  onDone: (warnings: SecretWarning[], uploadProblem?: string) => void;
  onCancel: () => void;
}) {
  const { busy, error, run } = useAction();
  const [category, setCategory] = useState<HostBlockCategory>(
    initial?.category ?? 'arrival_access',
  );
  const [title, setTitle] = useState<string | null>(initial?.title ?? null);
  const [body, setBody] = useState<string | null>(initial?.body ?? null);
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'always');
  const [media, setMedia] = useState<PendingFile[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await onSubmit({ category, title: title ?? '', body: body ?? '', visibility });
      // The entry is saved; a failed upload is reported, never a reason to save it twice.
      let failed = 0;
      for (const item of media) {
        try {
          await host.uploadMedia(result.block.id, item.file, item.caption ?? '');
        } catch {
          failed += 1;
        }
      }
      onDone(
        result.warnings,
        failed > 0
          ? `Saved, but ${failed === 1 ? 'one photo or video' : `${failed} photos or videos`} did not upload. Add ${failed === 1 ? 'it' : 'them'} again from the entry's menu.`
          : undefined,
      );
    });
  }

  return (
    <form className="block-editor" onSubmit={submit}>
      <h3>{heading}</h3>
      <div className="fields">
        {categoryFixed ? null : (
          <SelectField
            label="Guide section"
            value={category}
            options={HOST_BLOCK_CATEGORIES}
            labels={CATEGORY_LABELS}
            onChange={(v) => v && setCategory(v)}
          />
        )}
        <SelectField
          label="Visibility"
          hint="Arrival details can wait until the arrival release before check-in."
          value={visibility}
          options={BLOCK_VISIBILITY}
          labels={VISIBILITY_LABELS}
          onChange={(v) => v && setVisibility(v)}
        />
        <TextField
          label="Title"
          value={title}
          maxLength={LIMITS.title}
          required
          onChange={setTitle}
        />
        <MarkdownField label="Text" value={body ?? ''} onChange={(v) => setBody(v || null)} />
        {withMedia ? <PendingMedia files={media} onChange={setMedia} /> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          Save
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
