import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from '../db/schema/catalog';
import { offers } from '../db/schema/offers';
import { stays } from '../db/schema/stays';
import { createTestDatabase, seedGuestUnit, type TestDatabase, TROGIR } from '../testing';
import { loadSituation } from './load';

let testDb: TestDatabase;
let destinationId: string;
const NOW = new Date('2026-10-19T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [d] = await testDb.db
    .insert(destinations)
    .values({ name: `Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 10_000 })
    .returning();
  if (!d) throw new Error('no destination');
  destinationId = d.id;
});

afterAll(async () => {
  await testDb?.drop();
});

async function addOwnOffer(hostId: string, active: boolean, published = true) {
  await testDb.db.insert(offers).values({
    hostId,
    title: 'Boat',
    description: 'A boat trip.',
    cancellationPolicy: 'Free until a day before.',
    category: 'boat_trip',
    orderKind: 'booking',
    availabilityMode: 'on_request',
    paymentMode: 'direct',
    priceMinor: 5000,
    active,
    publishedRevision: published ? 1 : null,
  });
}

describe('loadSituation', () => {
  it('finds the destination around the property and the ids behind the space', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: 'de' });
    const ctx = await loadSituation(testDb.db, seed.spaceId, NOW);
    expect(ctx).toEqual({
      phase: 'upcoming',
      insideDestination: true,
      hostHasOwnOffers: false,
      spaceId: seed.spaceId,
      stayId: seed.stayId,
      unitId: seed.unitId,
      propertyId: seed.propertyId,
      destinationId,
      language: 'de',
      timezone: 'Europe/Zagreb',
    });
  });

  it('is outside every destination when the property has no location', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW, location: null });
    const ctx = await loadSituation(testDb.db, seed.spaceId, NOW);
    expect(ctx).toMatchObject({ insideDestination: false, destinationId: null });
  });

  it('sees only active own Offers of the host', async () => {
    const inactive = await seedGuestUnit(testDb.db, { now: NOW });
    await addOwnOffer(inactive.hostId, false);
    expect((await loadSituation(testDb.db, inactive.spaceId, NOW))?.hostHasOwnOffers).toBe(false);

    const active = await seedGuestUnit(testDb.db, { now: NOW });
    await addOwnOffer(active.hostId, true);
    expect((await loadSituation(testDb.db, active.spaceId, NOW))?.hostHasOwnOffers).toBe(true);
  });

  it('ignores an active own Offer that is not yet published (AC 4, 38)', async () => {
    const draft = await seedGuestUnit(testDb.db, { now: NOW });
    await addOwnOffer(draft.hostId, true, false);
    expect((await loadSituation(testDb.db, draft.spaceId, NOW))?.hostHasOwnOffers).toBe(false);
  });

  it('is ended after checkout day', async () => {
    const seed = await seedGuestUnit(testDb.db, { now: NOW });
    const after = seed.stay.activeUntil;
    expect(await loadSituation(testDb.db, seed.spaceId, after)).toMatchObject({
      phase: 'ended',
    });
    const before = new Date(after.getTime() - 1);
    expect(await loadSituation(testDb.db, seed.spaceId, before)).toMatchObject({
      phase: 'in_stay',
    });
  });

  it('returns null for an unknown space or one whose Stay was deleted', async () => {
    expect(await loadSituation(testDb.db, randomUUID(), NOW)).toBeNull();
    const seed = await seedGuestUnit(testDb.db, { now: NOW });
    await testDb.db.delete(stays).where(eq(stays.id, seed.stayId));
    expect(await loadSituation(testDb.db, seed.spaceId, NOW)).toBeNull();
  });
});
