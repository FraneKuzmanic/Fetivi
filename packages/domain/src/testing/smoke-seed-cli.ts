/**
 * Local rehearsal only (deploy/rehearse-local.sh): writes a throwaway Host, Property, Unit and
 * Stay through the test fixtures and prints the smoke check's SMOKE_UNIT_SLUG and SMOKE_PIN.
 * Never run it against production: there the smoke unit is a real one made in the back office
 * (deploy/RUNBOOK.md). It refuses unless ALLOW_SMOKE_SEED=1, and needs an explicit DATABASE_URL so
 * it never falls back to the dev database.
 */
import { createDb } from '../db/client';
import { seedGuestUnit } from './fixtures';

const url = process.env.DATABASE_URL;
if (process.env.ALLOW_SMOKE_SEED !== '1') {
  console.error('Refusing: smoke:seed writes test fixtures; set ALLOW_SMOKE_SEED=1 (local only).');
  process.exitCode = 1;
} else if (!url) {
  console.error('Refusing: smoke:seed needs DATABASE_URL.');
  process.exitCode = 1;
} else {
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
