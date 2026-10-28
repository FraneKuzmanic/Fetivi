import { HOST_BLOCK_CATEGORIES, type HostBlockCategory, LIMITS } from '@fetivi/domain/vocabulary';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Block, type BlockInput, type BlockResult, host, type SecretWarning } from '../api';
import { SelectField, TextField } from '../forms/fields';
import { i18next } from '../i18n';
import { useLabels } from '../i18n/useLabels';
import { useAction } from '../useAction';
import { type PendingFile, PendingMedia } from './media/PendingMedia';
import { MarkdownField } from './wizard/MarkdownField';

const looksLike = (kind: SecretWarning['kind']): string =>
  kind === 'code'
    ? i18next.t('host:blocks.looksLikeCode')
    : kind === 'phone'
      ? i18next.t('host:blocks.looksLikePhone')
      : i18next.t('host:blocks.looksLikePassword');

/**
 * Shown after a save whose text looks like it holds a secret. The save itself succeeded. A draft
 * that is not saved yet passes its own lead.
 */
export function SecretWarnings({ warnings, lead }: { warnings: SecretWarning[]; lead?: string }) {
  const { t } = useTranslation(['host', 'common']);
  return (
    <div className="warning" role="status">
      <p>
        <strong>{lead ?? t('blocks.secretLead')}</strong> {t('blocks.secretBody')}
      </p>
      <ul>
        {warnings.map((w) => (
          <li key={`${w.kind}:${w.excerpt}`}>
            {looksLike(w.kind)} <q>{w.excerpt}</q>
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
  initial?: Partial<Pick<Block, 'title' | 'body' | 'revision'>> & {
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
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { busy, error, run } = useAction();
  const [category, setCategory] = useState<HostBlockCategory>(
    initial?.category ?? 'arrival_access',
  );
  const [title, setTitle] = useState<string | null>(initial?.title ?? null);
  const [body, setBody] = useState<string | null>(initial?.body ?? null);
  const [media, setMedia] = useState<PendingFile[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const result = await onSubmit({ category, title: title ?? '', body: body ?? '' });
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
        failed > 0 ? i18next.t('host:blocks.uploadFailed', { count: failed }) : undefined,
      );
    });
  }

  return (
    <form className="block-editor" onSubmit={submit}>
      <h3>{heading}</h3>
      <div className="fields">
        {categoryFixed ? null : (
          <SelectField
            label={t('blocks.section')}
            value={category}
            options={HOST_BLOCK_CATEGORIES}
            labels={labels.category}
            onChange={(v) => v && setCategory(v)}
          />
        )}
        <TextField
          label={t('blocks.title')}
          value={title}
          maxLength={LIMITS.title}
          required
          onChange={setTitle}
        />
        <MarkdownField
          label={t('blocks.text')}
          value={body ?? ''}
          onChange={(v) => setBody(v || null)}
        />
        {withMedia ? <PendingMedia files={media} onChange={setMedia} /> : null}
      </div>
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
