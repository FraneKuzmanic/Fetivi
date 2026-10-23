import {
  createBraveSearch,
  createDb,
  createJobQueue,
  createLocalMediaStore,
  createWeatherSource,
  ensureQueues,
} from '@fetivi/domain';
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

// The guest app's email and recovery requests, and in V0 the in-process tools, enqueue jobs here;
// the jobs process works them.
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  supervise: false,
  schedule: false,
});
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await ensureQueues(boss);
const queue = createJobQueue(boss);
const inProcess = config.TOOL_TRANSPORT === 'inprocess';
// One weather source per process (the turn's weather note and V0's get_weather), so one cache.
const weather = createWeatherSource({ fetch: egress.fetch, userAgent: config.WEATHER_USER_AGENT });

const app = buildApp({
  db,
  appOrigin: config.APP_ORIGIN,
  guestLinkSecret: config.GUEST_LINK_SECRET,
  trustProxy: config.TRUST_PROXY,
  queue,
  media: createLocalMediaStore(config.MEDIA_DIR),
  push: { publicKey: config.VAPID_PUBLIC_KEY ?? null },
  tokens: { key, issuer: config.GUEST_TOKEN_ISSUER, mcpBaseUrl: config.MCP_PUBLIC_URL },
  chat: {
    model: createChatModel({ apiKey: config.ANTHROPIC_API_KEY, fetch: egress.fetch }),
    mcpFetch: mcpEgress(new URL(config.MCP_PUBLIC_URL)).fetch,
    weather,
    ...(inProcess
      ? {
          tools: inProcessBinding({
            db,
            now: () => new Date(),
            queue,
            requestStateSecret: config.REQUEST_STATE_SECRET,
            weather,
            webSearch: createBraveSearch({
              fetch: egress.fetch,
              apiKey: config.BRAVE_SEARCH_API_KEY,
            }),
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
if (inProcess) {
  app.log.warn('TOOL_TRANSPORT=inprocess: guest tools run in process (V0), not over MCP');
}

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => boss.stop({ graceful: true }))
      .then(() => pool.end());
  });
}
