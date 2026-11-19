import {
  LLM_KEY_LIMITS,
  type LlmKeyCheckError,
  type LlmProvider,
} from '@fetivi/domain/settings-vocabulary';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, admin, type LlmKeyStatus } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { Section, SelectField, TextField } from '../../forms/fields';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';

const CHECK_FAILED = {
  rejected: 'settings.llmKeyRejected',
  unreachable: 'settings.llmKeyUnreachable',
  'not-configured': 'settings.llmKeyNotConfigured',
  unrecognised: 'settings.llmKeyUnrecognised',
} as const satisfies Record<LlmKeyCheckError, string>;

const PROVIDER_NAMES: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  mistral: 'Mistral',
};

/** A checked key and its provider's models; `key` null = the key already saved. */
type Checked = { key: string | null; provider: LlmProvider; models: string[] };

/**
 * The one language model every task uses (71): the admin pastes any provider's key, Fetivi
 * recognises the provider and lists its models, and the admin picks one. Only the source and the
 * last four characters of the key are ever shown. Saving here wins over ANTHROPIC_API_KEY (68).
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
  const [checked, setChecked] = useState<Checked | null>(null);
  const [model, setModel] = useState<string | null>(null);
  // The outcome of the last action (check, save or test), so a later one replaces it.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  function pick(next: Checked) {
    setChecked(next);
    setModel(
      status.model && next.models.includes(status.model) ? status.model : (next.models[0] ?? null),
    );
  }

  function check(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    void run(async () => {
      if (!key?.trim()) throw new Error(t('settings.llmKeyMissing'));
      const result = await admin.checkLlmKey(key.trim());
      if (!result.ok) {
        setChecked(null);
        setNotice({ ok: false, text: t(CHECK_FAILED[result.error]) });
        return;
      }
      pick({ key: key.trim(), provider: result.provider, models: result.models });
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!checked || !model) return;
    setNotice(null);
    void run(async () => {
      try {
        onChange(
          await admin.saveLlmKey(checked.key === null ? { model } : { key: checked.key, model }),
        );
      } catch (thrown) {
        const code = thrown instanceof ApiError ? thrown.code : '';
        if (code in CHECK_FAILED) {
          setNotice({ ok: false, text: t(CHECK_FAILED[code as LlmKeyCheckError]) });
          return;
        }
        throw thrown;
      }
      setKey(null);
      setChecked(null);
      setNotice({ ok: true, text: tc('field.saved') });
    });
  }

  function test() {
    setNotice(null);
    void run(async () => {
      const result = await admin.testLlmKey();
      if (!result.ok) {
        setNotice({ ok: false, text: t(CHECK_FAILED[result.error]) });
        return;
      }
      setNotice({ ok: true, text: t('settings.llmKeyWorks') });
      // A saved key can change its model without being pasted again.
      if (status.source === 'settings') {
        pick({ key: null, provider: result.provider, models: result.models });
      }
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
    setChecked(null);
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
        {status.provider ? (
          <p>
            <strong>{PROVIDER_NAMES[status.provider]}</strong>
            {' · '}
            {status.model ?? t('settings.llmDefaultModels')}
          </p>
        ) : null}
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
      {checked ? (
        <form className="llm-key-form" onSubmit={save}>
          <p>{t('settings.llmDetected', { provider: PROVIDER_NAMES[checked.provider] })}</p>
          {checked.models.length > 0 ? (
            <div className="field-narrow">
              <SelectField
                label={t('settings.llmModel')}
                value={model}
                onChange={setModel}
                options={checked.models}
                labels={Object.fromEntries(checked.models.map((m) => [m, m]))}
              />
            </div>
          ) : (
            <p role="alert">{t('settings.llmNoModels')}</p>
          )}
          <div className="section-foot">
            <button type="button" disabled={busy} onClick={() => setChecked(null)}>
              {tc('cancel')}
            </button>
            <button type="submit" className="primary" disabled={busy || !model}>
              {t('settings.llmKeySave')}
            </button>
          </div>
        </form>
      ) : (
        <form className="llm-key-form" onSubmit={check}>
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
              {t('settings.llmKeyCheck')}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
