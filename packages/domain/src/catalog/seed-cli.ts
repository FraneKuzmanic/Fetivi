import { PgBoss } from 'pg-boss';
import { createDb } from '../db/client';
import { createJobQueue, ensureQueues } from '../jobs/queue';
import { seedTrogir } from './seed/trogir';

const url = process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi';

const { db, pool } = createDb(url);
const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false });
try {
  await boss.start();
  await ensureQueues(boss);
  const { created } = await seedTrogir(db, createJobQueue(boss), new Date());
  console.log(created ? 'seeded Trogir' : 'Trogir already seeded');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: false, timeout: 1000 });
  await pool.end();
}
