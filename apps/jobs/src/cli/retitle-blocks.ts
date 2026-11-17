import { pathToFileURL } from 'node:url';
import {
  createAnthropicTranslationModel,
  createDb,
  createJobQueue,
  createLlmKeySource,
  ensureQueues,
  retitleBlocks,
  usageRecorder,
} from '@fetivi/domain';
import { PgBoss } from 'pg-boss';
import { loadConfig } from '../config';
import { createJobsEgress } from '../egress';

/**
 * Ticket 56 one-off: translates the source-slot title of published wizard blocks whose title the
 * host left in another language than the text. Safe to rerun: fixed blocks are not selected again.
 * Run with `pnpm --filter @fetivi/jobs blocks:retitle`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const egress = createJobsEgress({ jadrolinija: false });
  const { db, pool } = createDb(config.DATABASE_URL);
  // The admin's key from Settings, else ANTHROPIC_API_KEY (68).
  const llmKeys = createLlmKeySource({
    db,
    envKey: config.ANTHROPIC_API_KEY,
    secret: config.LLM_KEY_SECRET,
    warn: console.warn,
  });
  let apiKey: string | undefined;
  try {
    apiKey = await llmKeys.get();
  } catch (error) {
    await pool.end();
    throw error;
  }
  if (!apiKey) {
    console.error(
      'No Anthropic key in the admin settings or ANTHROPIC_API_KEY: nothing to translate with',
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error) => console.error('pg-boss error', error));
  try {
    await boss.start();
    await ensureQueues(boss);
    const model = createAnthropicTranslationModel({
      apiKey: llmKeys.get,
      fetch: egress.fetch,
      onUsage: usageRecorder(db, 'translation'),
    });
    const result = await retitleBlocks({
      db,
      queue: createJobQueue(boss),
      now: () => new Date(),
      model,
    });
    console.log(JSON.stringify(result));
  } finally {
    await boss.stop({ graceful: false, timeout: 1000 });
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
