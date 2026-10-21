import {
  createAnthropicManualImportModel,
  createConsoleMailer,
  createDb,
  createJobQueue,
  createLocalMediaStore,
  ensureQueues,
} from '@fetivi/domain';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import { egress } from './egress';

const config = loadConfig();
if (!config.ANTHROPIC_API_KEY) {
  console.warn('ANTHROPIC_API_KEY is not set: house manual imports will fail as not configured');
}
const { db, pool } = createDb(config.DATABASE_URL);
// Only sends jobs; the jobs process works them.
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  supervise: false,
  schedule: false,
});
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await ensureQueues(boss);
const app = buildApp({
  db,
  mailer: createConsoleMailer(),
  queue: createJobQueue(boss),
  webOrigin: config.WEB_ORIGIN,
  guestOrigin: config.GUEST_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  media: createLocalMediaStore(config.MEDIA_DIR),
  manualImportModel: createAnthropicManualImportModel({
    apiKey: config.ANTHROPIC_API_KEY,
    fetch: egress.fetch,
  }),
});

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => boss.stop({ graceful: true }))
      .then(() => pool.end());
  });
}
