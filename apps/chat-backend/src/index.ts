import { createDb } from '@fetivi/domain';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const app = buildApp({ db, appOrigin: config.APP_ORIGIN, trustProxy: config.TRUST_PROXY });

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}
