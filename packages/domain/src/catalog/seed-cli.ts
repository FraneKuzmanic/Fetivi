import { PgBoss } from 'pg-boss';
import { createDb } from '../db/client';
import { createJobQueue, ensureQueues } from '../jobs/queue';
import { seedTrogirServices } from '../offers/seed/trogir';
import { seedTrogir } from './seed/trogir';

const url = process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi';

const { db, pool } = createDb(url);
const boss = new PgBoss({ connectionString: url, supervise: false, schedule: false });
try {
  await boss.start();
  await ensureQueues(boss);
  const queue = createJobQueue(boss);
  const { created, destinationId } = await seedTrogir(db, queue, new Date());
  console.log(created ? 'seeded Trogir' : 'Trogir already seeded');
  const services = await seedTrogirServices(db, queue, new Date(), destinationId);
  console.log(services.created ? 'seeded services' : 'services already seeded');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await boss.stop({ graceful: false, timeout: 1000 });
  await pool.end();
}
