import {
  type Db,
  getPlatformSettings,
  MESSAGE_CAP_LIMITS,
  setDailyMessageCap,
} from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export interface PlatformSettingsDeps {
  db: Db;
  now: () => Date;
}

const settingsBody = z.strictObject({
  dailyMessageCap: z.number().int().min(MESSAGE_CAP_LIMITS.min).max(MESSAGE_CAP_LIMITS.max),
});

/** The admin's platform-wide settings: the soft daily message cap per Space (45 AC 5). */
export async function platformSettingsRoutes(
  app: FastifyInstance,
  deps: PlatformSettingsDeps,
): Promise<void> {
  app.get('/api/admin/settings', { config: { access: 'admin' } }, async () =>
    getPlatformSettings(deps.db),
  );

  app.put('/api/admin/settings', { config: { access: 'admin' } }, async (request) => {
    const { dailyMessageCap } = settingsBody.parse(request.body);
    await setDailyMessageCap(deps.db, dailyMessageCap, deps.now());
    return getPlatformSettings(deps.db);
  });
}
