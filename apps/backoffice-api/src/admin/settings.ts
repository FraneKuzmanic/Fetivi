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

const llmKeyBody = z.strictObject({
  key: z.string().trim().min(LLM_KEY_LIMITS.min).max(LLM_KEY_LIMITS.max).regex(/^\S+$/),
});

/**
 * The admin's platform-wide settings: the soft daily message cap per Space (45 AC 5) and the
 * Anthropic key, which is only ever returned as its source and last four characters (68).
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

  app.put('/api/admin/settings/llm-key', admin, async (request) => {
    const { key } = llmKeyBody.parse(request.body);
    await setLlmKey(deps.db, {
      key,
      secret: deps.llmKeySecret,
      accountId: principalOf(request).account.id,
      now: deps.now(),
    });
    deps.llmKeys.invalidate();
    return llmKeyStatus();
  });

  app.delete('/api/admin/settings/llm-key', admin, async (request) => {
    await removeLlmKey(deps.db, { accountId: principalOf(request).account.id, now: deps.now() });
    deps.llmKeys.invalidate();
    return llmKeyStatus();
  });

  app.post('/api/admin/settings/llm-key/test', admin, async () =>
    deps.checkLlmKey(await deps.llmKeys.get()),
  );
}
