import type { HostBlockCategory } from '@fetivi/domain/vocabulary';
import { DotsThree, Image, PencilSimple, Plus, Translate, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Block, type BlockInput, type BlockResult, host, type SecretWarning } from '../api';
import { i18next } from '../i18n';
import { currentLabels, useLabels } from '../i18n/useLabels';
import { useConfirm } from '../shell/ConfirmDialog';
import { Menu } from '../shell/Menu';
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

/** "Arrival and access · After the arrival release · 2 photos": what a row needs besides its text. */
function entryMeta(block: Block, withCategory: boolean): string {
  const labels = currentLabels();
  const photos = block.media.filter((m) => m.kind !== 'video').length;
  const videos = block.media.length - photos;
  return [
    withCategory ? labels.category[block.category] : null,
    block.visibility === 'after_release' ? labels.visibility.after_release : null,
    photos ? i18next.t('host:blocks.photos', { count: photos }) : null,
    videos ? i18next.t('host:blocks.videos', { count: videos }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Guide entries (info blocks) owned by one property or one unit: list, add, edit, delete. */
export function BlockList({
  blocks,
  create,
  onChanged,
  emptyText,
  category,
}: {
  blocks: Block[];
  create: (input: BlockInput) => Promise<BlockResult>;
  onChanged: () => Promise<void>;
  emptyText: string;
  /** Every block here is in this category: new ones are created in it and none can leave it. */
  category?: HostBlockCategory;
}) {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [translating, setTranslating] = useState<string | null>(null);
  const [showingMedia, setShowingMedia] = useState<string | null>(null);

  const done = (found: SecretWarning[], uploadProblem?: string) =>
    void run(async () => {
      await onChanged();
      setEditing(null);
      setWarnings(found);
      setNotice(uploadProblem ?? null);
    });

  return (
    <div className="blocks">
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {notice ? <p role="alert">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {blocks.length === 0 && editing !== 'new' ? (
        <p className="entries-empty muted">{emptyText}</p>
      ) : null}
      {blocks.length > 0 ? (
        <ul className="rows">
          {blocks.map((block) =>
            editing === block.id ? (
              <li key={block.id}>
                <BlockEditor
                  heading={t('blocks.editEntry')}
                  initial={{ ...block, category: block.category as HostBlockCategory }}
                  categoryFixed={category !== undefined}
                  onSubmit={(input) => host.updateBlock(block.id, input)}
                  onDone={done}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={block.id} className="block-row entry-row">
                <div className="block-text">
                  <span className="block-title">
                    <strong>{block.title}</strong>
                    <TranslationChip status={block.translation.status} />
                  </span>
                  <span className="muted entry-preview">{preview(block.body)}</span>
                  <span className="entry-meta">{entryMeta(block, category === undefined)}</span>
                  {/* The open panel shows the error next to its Retry button. */}
                  {block.translation.status === 'failed' &&
                  block.translation.error &&
                  translating !== block.id ? (
                    <span className="translation-error">
                      {labels.translationError[block.translation.error]}
                    </span>
                  ) : null}
                </div>
                <div className="entry-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setWarnings([]);
                      setEditing(block.id);
                    }}
                  >
                    <PencilSimple aria-hidden="true" />
                    {t('common:edit')}
                  </button>
                  <Menu
                    label={t('blocks.moreFor', { title: block.title })}
                    trigger={<DotsThree aria-hidden="true" weight="bold" />}
                    items={[
                      {
                        label:
                          translating === block.id
                            ? t('blocks.hideTranslations')
                            : t('blocks.translations'),
                        icon: <Translate aria-hidden="true" />,
                        onSelect: () => setTranslating(translating === block.id ? null : block.id),
                      },
                      {
                        label:
                          showingMedia === block.id ? t('blocks.hideMedia') : t('blocks.media'),
                        icon: <Image aria-hidden="true" />,
                        onSelect: () =>
                          setShowingMedia(showingMedia === block.id ? null : block.id),
                      },
                      {
                        label: t('common:delete'),
                        icon: <Trash aria-hidden="true" />,
                        danger: true,
                        onSelect: async () => {
                          if (
                            await confirm({
                              title: t('blocks.deleteTitle', { title: block.title }),
                              body: t('blocks.deleteBody'),
                              action: t('blocks.deleteEntry'),
                              danger: true,
                            })
                          ) {
                            void run(async () => {
                              await host.deleteBlock(block.id);
                              await onChanged();
                            });
                          }
                        },
                      },
                    ]}
                  />
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
      ) : null}
      {editing === 'new' ? (
        <BlockEditor
          heading={t('blocks.newEntry')}
          initial={category ? { category } : undefined}
          categoryFixed={category !== undefined}
          withMedia
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
          <Plus aria-hidden="true" weight="bold" />
          {t('blocks.addEntry')}
        </button>
      )}
    </div>
  );
}
