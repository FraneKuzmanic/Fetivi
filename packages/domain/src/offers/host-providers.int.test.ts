import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from '../db/schema/catalog';
import { offers, providers } from '../db/schema/offers';
import {
  createTestDatabase,
  publishOffer,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
  TROGIR,
} from '../testing';
import { hostDestinations, listHostProviders, setProviderHidden } from './host-providers';
import { OfferRuleError } from './store';

const NOW = new Date('2027-05-01T10:00:00Z');

let testDb: TestDatabase;
let host: SeededGuestUnit;
let neighbour: SeededGuestUnit;
let near: string;
let far: string;
let shown: string;
let elsewhere: string;

async function publishedOffer(providerId: string, destinationId: string, publish = true) {
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId,
    destinationId,
    availabilityMode: 'on_request',
  });
  if (publish) await publishOffer(testDb.db, offerId);
  return offerId;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  host = await seedGuestUnit(db, { now: NOW });
  neighbour = await seedGuestUnit(db, { now: NOW });
  // Exactly one destination around Trogir in this database, and one far away.
  const [n] = await db
    .insert(destinations)
    .values({ name: `A Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 15_000 })
    .returning();
  const [f] = await db
    .insert(destinations)
    .values({ name: `Z Far ${randomUUID()}`, centre: { x: 15.98, y: 45.81 }, radiusM: 10_000 })
    .returning();
  if (!n || !f) throw new Error('no destinations');
  near = n.id;
  far = f.id;

  const a = await seedProvider(db);
  await publishedOffer(a.id, near);
  await publishedOffer(a.id, near);
  await publishedOffer(a.id, near, false);
  shown = a.id;
  const b = await seedProvider(db);
  await publishedOffer(b.id, far);
  elsewhere = b.id;
  const sleepy = await seedProvider(db);
  await publishedOffer(sleepy.id, near);
  await db.update(providers).set({ active: false }).where(eq(providers.id, sleepy.id));
  const off = await seedProvider(db);
  const offerId = await publishedOffer(off.id, near);
  await db.update(offers).set({ active: false }).where(eq(offers.id, offerId));
});

afterAll(async () => {
  await testDb?.drop();
});

describe('listHostProviders', () => {
  it('lists active Providers with active, published Offers in the host’s destinations', async () => {
    expect(await hostDestinations(testDb.db, host.hostId)).toEqual([
      { id: near, name: expect.stringMatching(/^A Trogir/) },
    ]);
    const list = await listHostProviders(testDb.db, host.hostId);
    expect(list).toEqual([
      {
        id: shown,
        name: expect.any(String),
        offerCount: 2,
        destinations: [expect.stringMatching(/^A Trogir/)],
        hidden: false,
      },
    ]);
  });

  it('is empty for a host without a located property', async () => {
    const nowhere = await seedGuestUnit(testDb.db, { now: NOW, location: null });
    expect(await listHostProviders(testDb.db, nowhere.hostId)).toEqual([]);
    expect(await hostDestinations(testDb.db, nowhere.hostId)).toEqual([]);
  });
});

describe('setProviderHidden', () => {
  it('hides and shows per host, idempotently', async () => {
    const db = testDb.db;
    expect((await setProviderHidden(db, host.hostId, shown, true, NOW)).hidden).toBe(true);
    expect((await setProviderHidden(db, host.hostId, shown, true, NOW)).hidden).toBe(true);
    expect((await listHostProviders(db, host.hostId))[0]?.hidden).toBe(true);
    expect((await listHostProviders(db, neighbour.hostId))[0]?.hidden).toBe(false);

    await setProviderHidden(db, host.hostId, shown, false, NOW);
    await setProviderHidden(db, host.hostId, shown, false, NOW);
    expect((await listHostProviders(db, host.hostId))[0]?.hidden).toBe(false);
  });

  it('refuses a Provider the host’s guests cannot see', async () => {
    for (const id of [elsewhere, randomUUID(), 'nope']) {
      await expect(setProviderHidden(testDb.db, host.hostId, id, true, NOW)).rejects.toEqual(
        new OfferRuleError('not-found'),
      );
    }
  });
});
