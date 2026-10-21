import { createDb } from '@fetivi/domain';
import { buildApp } from './app';
import { createChatModel } from './chat/model';
import { loadConfig } from './config';
import { egress, mcpEgress } from './egress';
import { loadSigningKey } from './tokens/keys';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const key = await loadSigningKey(config.GUEST_TOKEN_PRIVATE_KEY);
const app = buildApp({
  db,
  appOrigin: config.APP_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  tokens: { key, issuer: config.GUEST_TOKEN_ISSUER, mcpBaseUrl: config.MCP_PUBLIC_URL },
  chat: {
    model: createChatModel({ apiKey: config.ANTHROPIC_API_KEY, fetch: egress.fetch }),
    mcpFetch: mcpEgress(new URL(config.MCP_PUBLIC_URL)).fetch,
  },
});
if (!config.ANTHROPIC_API_KEY) {
  app.log.warn('ANTHROPIC_API_KEY is not set: the guest chat answers 503');
}
if (key.ephemeral) {
  app.log.warn('GUEST_TOKEN_PRIVATE_KEY is not set: guest tokens use a key made for this process');
}

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
