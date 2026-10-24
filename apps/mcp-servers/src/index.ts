import { createDb, createJobQueue, ensureQueues } from '@fetivi/domain';
import { W3CTraceContextPropagator } from '@fetivi/telemetry';
import { createRemoteJWKSet, customFetch } from 'jose';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import { jwksEgress } from './egress';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const jwksUrl = new URL(config.GUEST_TOKEN_JWKS_URL);
// Re-fetched on an unknown `kid`, so a chat-backend restart with a new key needs no restart here.
const keys = createRemoteJWKSet(jwksUrl, { [customFetch]: jwksEgress(jwksUrl).fetch });
// Only sends jobs; the jobs process works them.
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  supervise: false,
  schedule: false,
  openTelemetry: { propagateContext: true, propagator: new W3CTraceContextPropagator() },
});
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await ensureQueues(boss);
const app = buildApp({ config, db, keys, queue: createJobQueue(boss) });

if (!config.BRAVE_SEARCH_API_KEY) {
  app.log.warn('BRAVE_SEARCH_API_KEY is not set: web_fallback_search answers "not available"');
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
