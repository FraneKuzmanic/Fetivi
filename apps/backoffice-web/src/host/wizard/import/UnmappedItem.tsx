import { HOST_BLOCK_CATEGORIES, type HostBlockCategory, LIMITS } from '@fetivi/domain/vocabulary';
import { PencilSimple, X } from '@phosphor-icons/react';
import { useState } from 'react';
import type { ManualDraftItem, SecretWarning } from '../../../api';
import { SelectField, TextField } from '../../../forms/fields';
import { useAction } from '../../../useAction';
import { SecretWarnings } from '../../BlockEditor';
import { format, useWizardCopy } from '../copy';
import { MarkdownField } from '../MarkdownField';
import { type Confirm, DraftRow } from './DraftItem';

/** Text the import could not place: added as a block in a section the host picks, or dismissed. */
export function UnmappedItem({
  item,
  onConfirm,
  onDismiss,
}: {
  item: Extract<ManualDraftItem, { kind: 'unmapped' }>;
  onConfirm: Confirm;
  onDismiss: () => Promise<void>;
}) {
  const copy = useWizardCopy();
  const mi = copy.manualImport;
  const { busy, error, run } = useAction();
  const [placing, setPlacing] = useState(false);
  const [category, setCategory] = useState<HostBlockCategory | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState(item.text);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const categoryLabels = Object.fromEntries(
    HOST_BLOCK_CATEGORIES.map((c) => [c, copy.steps[c].title]),
  ) as Record<HostBlockCategory, string>;
  const valid =
    category !== null &&
    (title ?? '').trim() !== '' &&
    body.trim() !== '' &&
    body.length <= LIMITS.blockBody;

  function save() {
    if (!category) return;
    void run(async () => {
      setWarnings(await onConfirm({ category, title: title ?? '', body }));
      setPlacing(false);
    });
  }

  return (
    <DraftRow
      item={item}
      after={
        <>
          {error ? <p role="alert">{error}</p> : null}
          {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
        </>
      }
      title={
        item.fieldId ? format(mi.couldNotUse, { field: copy.fields[item.fieldId].label }) : null
      }
      actions={
        placing ? (
          <div className="actions manual-actions">
            <button type="button" className="primary" disabled={busy || !valid} onClick={save}>
              {mi.place}
            </button>
            <button type="button" disabled={busy} onClick={() => setPlacing(false)}>
              {copy.ui.cancel}
            </button>
          </div>
        ) : (
          <div className="actions manual-actions">
            <button type="button" disabled={busy} onClick={() => setPlacing(true)}>
              <PencilSimple aria-hidden="true" />
              {mi.place}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void run(onDismiss)}
            >
              <X aria-hidden="true" />
              {mi.dismiss}
            </button>
          </div>
        )
      }
    >
      {placing ? (
        <div className="manual-editor">
          <SelectField
            label={mi.placeIn}
            value={category}
            options={HOST_BLOCK_CATEGORIES}
            labels={categoryLabels}
            emptyLabel={copy.ui.notSet}
            required
            onChange={setCategory}
          />
          <TextField
            label={copy.ui.blockTitle}
            value={title}
            maxLength={LIMITS.title}
            required
            onChange={setTitle}
          />
          <MarkdownField label={copy.ui.blockBody} value={body} onChange={setBody} />
        </div>
      ) : (
        <p className="manual-text">{item.text}</p>
      )}
    </DraftRow>
  );
}
