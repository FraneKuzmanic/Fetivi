import { LIMITS } from '@fetivi/domain/vocabulary';
import { type WizardLevel, type WizardPromptKey, wizardField } from '@fetivi/domain/wizard';
import { useEffect, useRef, useState } from 'react';
import { host, type SecretWarning, type UnitDetail } from '../../api';
import { TextField } from '../../forms/fields';
import { useAction } from '../../useAction';
import { SecretWarnings } from '../BlockEditor';
import { useWizardCopy } from './copy';
import { MarkdownField } from './MarkdownField';
import { promptBlock } from './targets';
import { WizardField } from './WizardField';

/**
 * A suggested Info block on this unit's setup. A new one is this unit's, carrying the prompt's key.
 * One the unit shows from the property is edited for all units or overridden for this one with a
 * replacing block; one of the unit's own is edited where it is.
 */
export function BlockPrompt({
  promptKey,
  level,
  detail,
  onSaved,
}: {
  promptKey: WizardPromptKey;
  level: WizardLevel;
  detail: UnitDetail;
  onSaved: () => Promise<void>;
}) {
  const copy = useWizardCopy();
  const { busy, error, run } = useAction();
  const existing = promptBlock(promptKey, detail);
  // 'shared' edits the property's block for every unit; 'own' writes this unit's version of it.
  const [open, setOpen] = useState<false | 'shared' | 'own'>(false);
  const fromProperty = existing?.source === 'property';
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const config = wizardField(promptKey).prompt;
  const editorRef = useRef<HTMLDivElement>(null);

  // Bring the whole editor, Save included, out from under the sticky footer.
  useEffect(() => {
    if (open) editorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  function start(mode: 'shared' | 'own') {
    setTitle(existing?.title ?? copy.prompts[promptKey].defaultTitle);
    setBody(existing?.body ?? '');
    setWarnings([]);
    setOpen(mode);
  }

  function save() {
    if (!config) return;
    void run(async () => {
      const input = { title: title ?? '', body };
      const own = {
        ...input,
        category: config.category,
        wizardKey: promptKey,
      };
      const result =
        existing && open === 'shared'
          ? await host.updateBlock(existing.id, input)
          : existing
            ? await host.createUnitBlock(detail.id, { ...own, replacesBlockId: existing.id })
            : await host.createUnitBlock(detail.id, own);
      await onSaved();
      setWarnings(result.warnings);
      setOpen(false);
    });
  }

  return (
    <WizardField id={promptKey} level={level} filled={existing !== null}>
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {open ? (
        <div className="prompt-editor" ref={editorRef}>
          <TextField
            label={copy.ui.blockTitle}
            value={title}
            maxLength={LIMITS.title}
            required
            onChange={setTitle}
          />
          <MarkdownField
            label={copy.ui.blockBody}
            value={body}
            placeholder={copy.prompts[promptKey].bodyPlaceholder}
            onChange={setBody}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || !title?.trim() || !body.trim()}
              onClick={save}
            >
              {copy.ui.save}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              {copy.ui.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="prompt-row">
          <span className={existing ? 'prompt-state' : 'prompt-state muted'}>
            {existing
              ? `${fromProperty ? copy.ui.fromPropertyEntry : copy.ui.added}: ${existing.title}`
              : copy.ui.notAdded}
          </span>
          {fromProperty ? (
            <span className="actions">
              <button type="button" onClick={() => start('shared')}>
                {copy.ui.editForAllUnits}
              </button>
              <button type="button" onClick={() => start('own')}>
                {copy.ui.ownVersion}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => start(existing ? 'shared' : 'own')}>
              {existing ? copy.ui.edit : copy.ui.add}
            </button>
          )}
        </div>
      )}
    </WizardField>
  );
}
