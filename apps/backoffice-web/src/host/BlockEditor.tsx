import {
  BLOCK_VISIBILITY,
  HOST_BLOCK_CATEGORIES,
  type HostBlockCategory,
  LIMITS,
} from '@fetivi/domain/vocabulary';
import { type FormEvent, useState } from 'react';
import type { Block, BlockInput, BlockResult, SecretWarning } from '../api';
import { SelectField, TextArea, TextField } from '../forms/fields';
import { CATEGORY_LABELS, VISIBILITY_LABELS } from '../forms/labels';
import { useAction } from '../useAction';

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

/** Creates or edits one info block. */
export function BlockEditor({
  initial,
  heading,
  onSubmit,
  onDone,
  onCancel,
}: {
  initial?: Partial<Pick<Block, 'title' | 'body' | 'visibility' | 'revision'>> & {
    category?: HostBlockCategory;
  };
  heading: string;
  onSubmit: (input: BlockInput) => Promise<BlockResult>;
  /** Called after a save; the warnings, if any, are shown by the caller. */
  onDone: (warnings: SecretWarning[]) => void;
  onCancel: () => void;
}) {
  const { busy, error, run } = useAction();
  const [category, setCategory] = useState<HostBlockCategory>(
    initial?.category ?? 'arrival_access',
  );
  const [title, setTitle] = useState<string | null>(initial?.title ?? null);
  const [body, setBody] = useState<string | null>(initial?.body ?? null);
  const [visibility, setVisibility] = useState(initial?.visibility ?? 'always');

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await onSubmit({ category, title: title ?? '', body: body ?? '', visibility });
      onDone(result.warnings);
    });
  }

  return (
    <form className="block-editor" onSubmit={submit}>
      <h3>{heading}</h3>
      <div className="fields">
        <SelectField
          label="Guide section"
          value={category}
          options={HOST_BLOCK_CATEGORIES}
          labels={CATEGORY_LABELS}
          onChange={(v) => v && setCategory(v)}
        />
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
        <TextArea
          label="Text"
          hint={
            <>
              Markdown supported: **bold**, - lists, [links](https://…).
              {initial?.revision ? ` Revision ${initial.revision}.` : null}
            </>
          }
          value={body}
          maxLength={LIMITS.blockBody}
          rows={8}
          required
          monospace
          onChange={setBody}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          Save block
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
