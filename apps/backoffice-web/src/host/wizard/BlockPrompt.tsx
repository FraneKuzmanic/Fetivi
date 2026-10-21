import { LIMITS } from '@fetivi/domain/vocabulary';
import { type WizardLevel, type WizardPromptKey, wizardField } from '@fetivi/domain/wizard';
import { useState } from 'react';
import { host, type SecretWarning, type UnitDetail } from '../../api';
import { TextField } from '../../forms/fields';
import { useAction } from '../../useAction';
import { SecretWarnings } from '../BlockEditor';
import { useWizardCopy } from './copy';
import { MarkdownField } from './MarkdownField';
import { promptBlock } from './targets';
import { WizardField } from './WizardField';

/**
 * A suggested Info block. A new one is a property block carrying the prompt's key; an existing
 * one is edited where it lives, so a unit's replacement stays the unit's.
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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);
  const config = wizardField(promptKey).prompt;

  function start() {
    setTitle(existing?.title ?? copy.prompts[promptKey].defaultTitle);
    setBody(existing?.body ?? '');
    setWarnings([]);
    setOpen(true);
  }

  function save() {
    if (!config) return;
    void run(async () => {
      const input = { title: title ?? '', body };
      const result = existing
        ? await host.updateBlock(existing.id, input)
        : await host.createPropertyBlock(detail.propertyId, {
            ...input,
            category: config.category,
            visibility: config.visibility,
            wizardKey: promptKey,
          });
      await onSaved();
      setWarnings(result.warnings);
      setOpen(false);
    });
  }

  return (
    <WizardField id={promptKey} level={level} filled={existing !== null}>
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
      {open ? (
        <div className="prompt-editor">
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
            {existing ? `${copy.ui.added}: ${existing.title}` : copy.ui.notAdded}
          </span>
          <button type="button" onClick={start}>
            {existing ? copy.ui.edit : copy.ui.add}
          </button>
        </div>
      )}
    </WizardField>
  );
}
