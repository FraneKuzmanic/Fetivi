import type { HostBlockCategory } from '@fetivi/domain/vocabulary';
import { useState } from 'react';
import { type Block, type BlockInput, type BlockResult, host, type SecretWarning } from '../api';
import { CATEGORY_LABELS, TRANSLATION_ERROR_LABELS, VISIBILITY_LABELS } from '../forms/labels';
import { useAction } from '../useAction';
import { BlockEditor, SecretWarnings } from './BlockEditor';
import { MediaPanel } from './media/MediaPanel';
import { TranslationChip } from './translations/TranslationChip';
import { TranslationsPanel } from './translations/TranslationsPanel';

/** The first line of a Markdown body, as a one-line preview. */
export function preview(body: string): string {
  const line = body.split('\n').find((l) => l.trim() !== '') ?? '';
  const text = line.replace(/[#*_>`[\]]/g, '').trim();
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}

/** Blocks owned by one property or one unit: list, add, edit, delete. */
export function BlockList({
  blocks,
  create,
  onChanged,
  emptyText,
}: {
  blocks: Block[];
  create: (input: BlockInput) => Promise<BlockResult>;
  onChanged: () => Promise<void>;
  emptyText: string;
}) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const [translating, setTranslating] = useState<string | null>(null);
  const [showingMedia, setShowingMedia] = useState<string | null>(null);

  const done = (found: SecretWarning[]) =>
    void run(async () => {
      await onChanged();
      setEditing(null);
      setWarnings(found);
    });

  return (
    <div className="blocks">
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {blocks.length === 0 && editing !== 'new' ? <p className="muted">{emptyText}</p> : null}
      <ul className="rows">
        {blocks.map((block) =>
          editing === block.id ? (
            <li key={block.id}>
              <BlockEditor
                heading="Edit block"
                initial={{ ...block, category: block.category as HostBlockCategory }}
                onSubmit={(input) => host.updateBlock(block.id, input)}
                onDone={done}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={block.id} className="block-row">
              <div className="block-text">
                <span className="eyebrow">
                  {CATEGORY_LABELS[block.category]}
                  {block.visibility === 'after_release'
                    ? ` · ${VISIBILITY_LABELS.after_release}`
                    : null}
                </span>
                <span className="block-title">
                  <strong>{block.title}</strong>
                  <TranslationChip status={block.translation.status} />
                </span>
                <span className="muted">{preview(block.body)}</span>
                {/* The open panel shows the error next to its Retry button. */}
                {block.translation.status === 'failed' &&
                block.translation.error &&
                translating !== block.id ? (
                  <span className="translation-error">
                    {TRANSLATION_ERROR_LABELS[block.translation.error]}
                  </span>
                ) : null}
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setWarnings([]);
                    setEditing(block.id);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-expanded={translating === block.id}
                  onClick={() => setTranslating(translating === block.id ? null : block.id)}
                >
                  {translating === block.id ? 'Hide translations' : 'Translations'}
                </button>
                <button
                  type="button"
                  aria-expanded={showingMedia === block.id}
                  onClick={() => setShowingMedia(showingMedia === block.id ? null : block.id)}
                >
                  {showingMedia === block.id
                    ? 'Hide photos & video'
                    : `Photos & video (${block.media.length})`}
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete the block "${block.title}"?`)) {
                      void run(async () => {
                        await host.deleteBlock(block.id);
                        await onChanged();
                      });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              {translating === block.id ? (
                <TranslationsPanel block={block} onChanged={onChanged} />
              ) : null}
              {showingMedia === block.id ? (
                <MediaPanel block={block} onChanged={onChanged} />
              ) : null}
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <BlockEditor
          heading="New block"
          onSubmit={create}
          onDone={done}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          disabled={busy || editing !== null}
          onClick={() => {
            setWarnings([]);
            setEditing('new');
          }}
        >
          Add block
        </button>
      )}
    </div>
  );
}
