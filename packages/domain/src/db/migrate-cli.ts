import { runMigrations } from './migrate';

const url = process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi';

try {
  await runMigrations(url);
  console.log('migrations applied');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
