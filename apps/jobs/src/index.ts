import {
  createAnthropicTranslationModel,
  createConsoleMailer,
  createDb,
  createJobQueue,
} from '@fetivi/domain';
import { loadConfig } from './config';
import { egress } from './egress';
import { createJobs } from './jobs';
import { startJobRunner } from './runner';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const model = createAnthropicTranslationModel({
  apiKey: config.ANTHROPIC_API_KEY,
  fetch: egress.fetch,
});
if (!config.ANTHROPIC_API_KEY) {
  console.warn('ANTHROPIC_API_KEY is not set: translations will fail as not-configured');
}
const boss = await startJobRunner({
  connectionString: config.DATABASE_URL,
  jobs: (boss) =>
    createJobs({
      db,
      queue: createJobQueue(boss),
      model,
      now: () => new Date(),
      mailer: createConsoleMailer(),
      providerLink: {
        secret: config.PROVIDER_LINK_SECRET,
        baseUrl: config.PROVIDER_LINK_BASE_URL,
      },
      fetch: egress.fetch,
      webOrigin: config.WEB_ORIGIN,
    }),
});
console.log('job runner started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void boss.stop({ graceful: true }).then(() => pool.end());
  });
}
