import { pathToFileURL } from 'node:url';
import {
  createAnthropicTranslationModel,
  createDb,
  createJobQueue,
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
  if (!config.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set: nothing to translate with');
    process.exitCode = 1;
    return;
  }
  const egress = createJobsEgress({ jadrolinija: false });
  const { db, pool } = createDb(config.DATABASE_URL);
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
      apiKey: config.ANTHROPIC_API_KEY,
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
