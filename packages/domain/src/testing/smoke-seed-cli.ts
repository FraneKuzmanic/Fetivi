/**
 * Local rehearsal only (deploy/rehearse-local.sh): writes a throwaway host, property, unit and
 * Stay through the test fixtures and prints the smoke check's SMOKE_UNIT_SLUG and SMOKE_PIN.
 * Never run it against production: there the smoke unit is a real one made in the back office
 * (deploy/RUNBOOK.md). It refuses unless ALLOW_SMOKE_SEED=1.
 */
import { createDb } from '../db/client';
import { seedGuestUnit } from './fixtures';

if (process.env.ALLOW_SMOKE_SEED !== '1') {
  console.error('Refusing: smoke:seed writes test fixtures; set ALLOW_SMOKE_SEED=1 (local only).');
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi';
  const { db, pool } = createDb(url);
  try {
    const seed = await seedGuestUnit(db, { now: new Date(), checkInInDays: 0, nights: 14 });
    console.log(`SMOKE_UNIT_SLUG=${seed.private.qrSlug}`);
    console.log(`SMOKE_PIN=${seed.pin}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
