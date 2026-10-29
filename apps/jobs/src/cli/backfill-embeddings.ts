import { pathToFileURL } from 'node:url';
import { backfillEmbeddings, createDb, createVoyageEmbedder } from '@fetivi/domain';
import { loadConfig } from '../config';
import { createJobsEgress } from '../egress';

/**
 * Ticket 61: embeds every published catalog and host-added place translation that has no vector
 * of the current model yet, and prints the count and Voyage tokens spent. Safe to rerun: embedded
 * rows are not selected again. Run with `pnpm --filter @fetivi/jobs embeddings:backfill`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.VOYAGE_API_KEY) {
    console.error('VOYAGE_API_KEY is not set: nothing to embed with');
    process.exitCode = 1;
    return;
  }
  const egress = createJobsEgress({ jadrolinija: false });
  const { db, pool } = createDb(config.DATABASE_URL);
  try {
    const embedder = createVoyageEmbedder({ fetch: egress.fetch, apiKey: config.VOYAGE_API_KEY });
    const result = await backfillEmbeddings({ db, embedder });
    console.log(JSON.stringify({ ...result, model: embedder.model }));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
