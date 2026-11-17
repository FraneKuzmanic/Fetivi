import { LLM_KEY_LIMITS, type LlmKeyCheckError } from '@fetivi/domain/settings-vocabulary';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, type LlmKeyStatus } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { Section, TextField } from '../../forms/fields';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';

const CHECK_FAILED = {
  rejected: 'settings.llmKeyRejected',
  unreachable: 'settings.llmKeyUnreachable',
  'not-configured': 'settings.llmKeyNotConfigured',
} as const satisfies Record<LlmKeyCheckError, string>;

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
  const { t: tc } = useTranslation();
  const confirm = useConfirm();
  const { busy, error, run } = useAction();
  const [key, setKey] = useState<string | null>(null);
  // The outcome of the last action (save or test), so a later one replaces it.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    void run(async () => {
      if (!key?.trim()) throw new Error(t('settings.llmKeyMissing'));
      onChange(await admin.saveLlmKey(key));
      setKey(null);
      setNotice({ ok: true, text: tc('field.saved') });
    });
  }

  function test() {
    setNotice(null);
    void run(async () => {
      const check = await admin.testLlmKey();
      setNotice(
        check.ok
          ? { ok: true, text: t('settings.llmKeyWorks') }
          : { ok: false, text: t(CHECK_FAILED[check.error]) },
      );
    });
  }

  async function remove() {
    const yes = await confirm({
      title: t('settings.llmKeyRemoveTitle'),
      body: t('settings.llmKeyRemoveBody'),
      action: t('settings.llmKeyRemoveAction'),
      danger: true,
    });
    if (!yes) return;
    setNotice(null);
    void run(async () => onChange(await admin.removeLlmKey()));
  }

  const source =
    status.source === 'settings'
      ? t('settings.llmKeyFromSettings', { last4: status.last4 })
      : status.source === 'environment'
        ? t('settings.llmKeyFromEnvironment', { last4: status.last4 })
        : t('settings.llmKeyNone');

  return (
    <Section title={t('settings.llmKey')} description={t('settings.llmKeyHint')}>
      <div>
        <p>{source}</p>
        {/* Who changed the saved key; an env key or none has no such change to show. */}
        {status.source === 'settings' && status.updatedAt ? (
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
      {notice?.ok ? (
        <output className="saved" aria-live="polite">
          {notice.text}
        </output>
      ) : null}
      {notice && !notice.ok ? <p role="alert">{notice.text}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <form className="llm-key-form" onSubmit={save}>
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
        <div className="section-foot">
          <button type="submit" className="primary" disabled={busy}>
            {t('settings.llmKeySave')}
          </button>
        </div>
      </form>
    </Section>
  );
}
