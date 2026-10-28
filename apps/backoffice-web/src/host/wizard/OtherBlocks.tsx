import type { HostBlockCategory } from '@fetivi/domain/vocabulary';
import type { WizardStepId } from '@fetivi/domain/wizard';
import { PencilSimple, Trash } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { host, type SecretWarning, type UnitDetail } from '../../api';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';
import { BlockEditor, SecretWarnings } from '../BlockEditor';
import { preview } from '../BlockList';
import { useWizardCopy } from './copy';
import { otherStepBlocks } from './targets';

/**
 * The step's other guide entries, e.g. ones confirmed from the house manual, so the host edits or
 * deletes them instead of adding a twin through a prompt. Each is changed where it lives.
 */
export function OtherBlocks({
  stepId,
  detail,
  onChanged,
}: {
  stepId: WizardStepId;
  detail: UnitDetail;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation(['host', 'common']);
  const copy = useWizardCopy();
  const confirm = useConfirm();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const headingId = useId();
  const blocks = otherStepBlocks(stepId, detail);
  if (blocks.length === 0) return null;

  return (
    <section className="wizard-other" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('blocks.otherInStep')}</h3>
      <p className="muted">{t('blocks.otherInStepHint')}</p>
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul className="rows">
        {blocks.map((block) =>
          editing === block.id ? (
            <li key={block.id}>
              <BlockEditor
                heading={t('blocks.editEntry')}
                initial={{ ...block, category: block.category as HostBlockCategory }}
                categoryFixed
                onSubmit={(input) => host.updateBlock(block.id, input)}
                onDone={(found) =>
                  void run(async () => {
                    await onChanged();
                    setEditing(null);
                    setWarnings(found);
                  })
                }
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={block.id} className="block-row entry-row">
              <div className="block-text">
                <span className="block-title">
                  <strong>{block.title}</strong>
                </span>
                <span className="muted entry-preview">{preview(block.body)}</span>
                {block.source === 'property' ? (
                  <span className="entry-meta">{copy.ui.fromPropertyEntry}</span>
                ) : null}
              </div>
              <div className="entry-actions">
                <button
                  type="button"
                  aria-label={t('blocks.editFor', { title: block.title })}
                  disabled={busy || editing !== null}
                  onClick={() => {
                    setWarnings([]);
                    setEditing(block.id);
                  }}
                >
                  <PencilSimple aria-hidden="true" />
                  {t('common:edit')}
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={t('blocks.deleteFor', { title: block.title })}
                  disabled={busy || editing !== null}
                  onClick={async () => {
                    const yes = await confirm({
                      title: t('blocks.deleteTitle', { title: block.title }),
                      body:
                        block.source === 'property'
                          ? `${t('blocks.deleteBody')} ${t('blocks.deleteForAllUnits')}`
                          : t('blocks.deleteBody'),
                      action: t('blocks.deleteEntry'),
                      danger: true,
                    });
                    if (!yes) return;
                    void run(async () => {
                      await host.deleteBlock(block.id);
                      await onChanged();
                    });
                  }}
                >
                  <Trash aria-hidden="true" />
                  {t('common:delete')}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
