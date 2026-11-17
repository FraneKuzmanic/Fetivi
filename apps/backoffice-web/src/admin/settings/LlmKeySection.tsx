import { LLM_KEY_LIMITS } from '@fetivi/domain/settings-vocabulary';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, type LlmKeyCheckResult, type LlmKeyStatus } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { Section, TextField } from '../../forms/fields';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';

/**
 * The Anthropic key the processes use: where it comes from and its last four characters, never
 * the key itself. Saving or removing it here wins over ANTHROPIC_API_KEY (68).
 */
export function LlmKeySection({
  status,
  onChange,
}: {
  status: LlmKeyStatus;
  onChange: (status: LlmKeyStatus) => void;
}) {
  const { t } = useTranslation('admin');
  const confirm = useConfirm();
  const { busy, error, run } = useAction();
  const [key, setKey] = useState<string | null>(null);
  const [check, setCheck] = useState<LlmKeyCheckResult | null>(null);

  async function save() {
    if (!key?.trim()) throw new Error(t('settings.llmKeyMissing'));
    onChange(await admin.saveLlmKey(key));
    setKey(null);
    setCheck(null);
  }

  function test() {
    setCheck(null);
    void run(async () => setCheck(await admin.testLlmKey()));
  }

  async function remove() {
    const yes = await confirm({
      title: t('settings.llmKeyRemoveTitle'),
      body: t('settings.llmKeyRemoveBody'),
      action: t('settings.llmKeyRemoveAction'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      onChange(await admin.removeLlmKey());
      setCheck(null);
    });
  }

  const source =
    status.source === 'settings'
      ? t('settings.llmKeyFromSettings', { last4: status.last4 })
      : status.source === 'environment'
        ? t('settings.llmKeyFromEnvironment', { last4: status.last4 })
        : t('settings.llmKeyNone');

  const checkLine = !check
    ? null
    : check.ok
      ? t('settings.llmKeyWorks')
      : check.error === 'rejected'
        ? t('settings.llmKeyRejected')
        : check.error === 'unreachable'
          ? t('settings.llmKeyUnreachable')
          : t('settings.llmKeyNotConfigured');

  return (
    <Section
      title={t('settings.llmKey')}
      description={t('settings.llmKeyHint')}
      onSave={save}
      saveLabel={t('settings.llmKeySave')}
    >
      <div>
        <p>{source}</p>
        {status.updatedAt ? (
          <p className="muted">
            {t('settings.llmKeyChanged', {
              email: status.updatedBy ?? t('settings.llmKeyDeletedAccount'),
              moment: formatMoment(status.updatedAt),
            })}
          </p>
        ) : null}
      </div>
      <div className="actions">
        <button type="button" disabled={busy} onClick={test}>
          {t('settings.llmKeyTest')}
        </button>
        {status.source === 'settings' ? (
          <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
            {t('settings.llmKeyRemove')}
          </button>
        ) : null}
      </div>
      {checkLine ? (
        <output className={check?.ok ? 'saved' : undefined} aria-live="polite">
          {checkLine}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="field-narrow">
        <TextField
          type="password"
          label={t('settings.llmKeyNew')}
          value={key}
          onChange={setKey}
          maxLength={LLM_KEY_LIMITS.max}
          autoComplete="off"
          required
        />
      </div>
    </Section>
  );
}
