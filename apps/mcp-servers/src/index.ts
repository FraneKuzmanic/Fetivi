import { createDb } from '@fetivi/domain';
import { createRemoteJWKSet, customFetch } from 'jose';
import { buildApp } from './app';
import { loadConfig } from './config';
import { jwksEgress } from './egress';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const jwksUrl = new URL(config.GUEST_TOKEN_JWKS_URL);
// Re-fetched on an unknown `kid`, so a chat-backend restart with a new key needs no restart here.
const keys = createRemoteJWKSet(jwksUrl, { [customFetch]: jwksEgress(jwksUrl).fetch });
const app = buildApp({ config, db, keys });

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
