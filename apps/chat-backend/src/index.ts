import { createDb, createJobQueue, createLocalMediaStore, ensureQueues } from '@fetivi/domain';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { createChatModel } from './chat/model';
import { loadConfig } from './config';
import { egress, mcpEgress } from './egress';
import { loadSigningKey } from './tokens/keys';
import { inProcessBinding } from './tools/inprocess';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const key = await loadSigningKey(config.GUEST_TOKEN_PRIVATE_KEY);

// V0 only: the in-process tools enqueue the Order machine's jobs themselves, so this process then
// sends jobs as the MCP servers do; the jobs process works them.
let boss: PgBoss | null = null;
if (config.TOOL_TRANSPORT === 'inprocess') {
  boss = new PgBoss({ connectionString: config.DATABASE_URL, supervise: false, schedule: false });
  boss.on('error', (error) => console.error('pg-boss error', error));
  await boss.start();
  await ensureQueues(boss);
}

const app = buildApp({
  db,
  appOrigin: config.APP_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  media: createLocalMediaStore(config.MEDIA_DIR),
  push: { publicKey: config.VAPID_PUBLIC_KEY ?? null },
  tokens: { key, issuer: config.GUEST_TOKEN_ISSUER, mcpBaseUrl: config.MCP_PUBLIC_URL },
  chat: {
    model: createChatModel({ apiKey: config.ANTHROPIC_API_KEY, fetch: egress.fetch }),
    mcpFetch: mcpEgress(new URL(config.MCP_PUBLIC_URL)).fetch,
    ...(boss
      ? {
          tools: inProcessBinding({
            db,
            now: () => new Date(),
            queue: createJobQueue(boss),
            requestStateSecret: config.REQUEST_STATE_SECRET,
          }),
        }
      : {}),
  },
});
if (!config.ANTHROPIC_API_KEY) {
  app.log.warn('ANTHROPIC_API_KEY is not set: the guest chat answers 503');
}
if (key.ephemeral) {
  app.log.warn('GUEST_TOKEN_PRIVATE_KEY is not set: guest tokens use a key made for this process');
}
if (boss) {
  app.log.warn('TOOL_TRANSPORT=inprocess: guest tools run in process (V0), not over MCP');
}

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => boss?.stop({ graceful: true }))
      .then(() => pool.end());
  });
}
