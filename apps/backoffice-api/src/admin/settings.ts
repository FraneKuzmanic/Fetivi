import {
  type Db,
  getLlmKeyStatus,
  getPlatformSettings,
  LLM_KEY_LIMITS,
  type LlmKeyCheckResult,
  type LlmKeySourceHandle,
  MESSAGE_CAP_LIMITS,
  removeLlmKey,
  setDailyMessageCap,
  setLlmKey,
  setLlmModel,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';

export interface PlatformSettingsDeps {
  db: Db;
  now: () => Date;
  llmKeys: LlmKeySourceHandle;
  llmEnvKey: string | undefined;
  llmKeySecret: string;
  checkLlmKey: (key: string | undefined) => Promise<LlmKeyCheckResult>;
}

const settingsBody = z.strictObject({
  dailyMessageCap: z.number().int().min(MESSAGE_CAP_LIMITS.min).max(MESSAGE_CAP_LIMITS.max),
});

const keyField = z.string().trim().min(LLM_KEY_LIMITS.min).max(LLM_KEY_LIMITS.max).regex(/^\S+$/);
const checkBody = z.strictObject({ key: keyField });
/** A new key with its model, or only a new model for the saved key. */
const llmKeyBody = z.strictObject({ key: keyField.optional(), model: z.string().min(1).max(200) });

/**
 * The admin's platform-wide settings: the soft daily message cap per Space (45 AC 5) and the
 * model setting, one provider, key and model for every task (68, 71). The key is only ever
 * returned as its source and last four characters.
 */
export async function platformSettingsRoutes(
  app: FastifyInstance,
  deps: PlatformSettingsDeps,
): Promise<void> {
  const admin = { config: { access: 'admin' } } as const;
  const llmKeyStatus = () => getLlmKeyStatus(deps.db, deps.llmEnvKey, deps.llmKeySecret);

  app.get('/api/admin/settings', admin, async () => ({
    ...(await getPlatformSettings(deps.db)),
    llmKey: await llmKeyStatus(),
  }));

  app.put('/api/admin/settings', admin, async (request) => {
    const { dailyMessageCap } = settingsBody.parse(request.body);
    return {
      ...(await setDailyMessageCap(deps.db, dailyMessageCap, deps.now())),
      llmKey: await llmKeyStatus(),
    };
  });

  // A typed key, before it is saved: its provider and models, for the model picker.
  app.post('/api/admin/settings/llm-key/check', admin, async (request) =>
    deps.checkLlmKey(checkBody.parse(request.body).key),
  );

  // The key is checked again on save, so the stored provider and model are always the provider's.
  app.put('/api/admin/settings/llm-key', admin, async (request, reply) => {
    const { key, model } = llmKeyBody.parse(request.body);
    const accountId = principalOf(request).account.id;
    if (key === undefined) {
      const current = await llmKeyStatus();
      if (current.source !== 'settings') {
        return reply.code(409).send({ error: 'no-saved-key' });
      }
      const checked = await deps.checkLlmKey((await deps.llmKeys.get())?.key);
      if (!checked.ok) return reply.code(422).send({ error: checked.error });
      if (!checked.models.includes(model)) return reply.code(422).send({ error: 'unknown-model' });
      await setLlmModel(deps.db, { model, accountId, now: deps.now() });
    } else {
      const checked = await deps.checkLlmKey(key);
      if (!checked.ok) return reply.code(422).send({ error: checked.error });
      if (!checked.models.includes(model)) return reply.code(422).send({ error: 'unknown-model' });
      await setLlmKey(deps.db, {
        key,
        provider: checked.provider,
        model,
        secret: deps.llmKeySecret,
        accountId,
        now: deps.now(),
      });
    }
    deps.llmKeys.invalidate();
    return llmKeyStatus();
  });

  app.delete('/api/admin/settings/llm-key', admin, async (request) => {
    await removeLlmKey(deps.db, { accountId: principalOf(request).account.id, now: deps.now() });
    deps.llmKeys.invalidate();
    return llmKeyStatus();
  });

  app.post('/api/admin/settings/llm-key/test', admin, async () =>
    deps.checkLlmKey((await deps.llmKeys.get())?.key),
  );
}
