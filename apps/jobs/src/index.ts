import { loadConfig } from './config';
import { jobs } from './jobs';
import { startJobRunner } from './runner';

const config = loadConfig();
const boss = await startJobRunner({ connectionString: config.DATABASE_URL, jobs });
console.log(`job runner started with ${jobs.length} job(s)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void boss.stop({ graceful: true });
  });
}
