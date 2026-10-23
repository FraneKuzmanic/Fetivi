import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalogRecords } from '../db/schema/catalog';
import { hostHiddenProviders, offers, providers } from '../db/schema/offers';
import {
  createTestDatabase,
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
  TROGIR,
} from '../testing';
import { type GuestOfferScope, getGuestOffer, listGuestOffers, offerIdsByPlace } from './guest';

let testDb: TestDatabase;
let guest: SeededGuestUnit;
let otherHost: SeededGuestUnit;
let destA: string;
let destB: string;
let placeId: string;
const ids: Record<string, string> = {};

async function offer(
  name: string,
  options: Parameters<typeof seedOrderableOffer>[1],
  publish = true,
) {
  const { offerId } = await seedOrderableOffer(testDb.db, { ...options, title: name });
  if (publish) await publishOffer(testDb.db, offerId);
  ids[name] = offerId;
  return offerId;
}

const scope = (over: Partial<GuestOfferScope> = {}): GuestOfferScope => ({
  destinationId: destA,
  propertyId: guest.propertyId,
  language: 'de',
  ...over,
});
const titles = (list: { title: string }[]) => list.map((o) => o.title.replace(/^\[de\] /, ''));

beforeAll(async () => {
  testDb = await createTestDatabase();
  const db = testDb.db;
  guest = await seedGuestUnit(db);
  otherHost = await seedGuestUnit(db);
  destA = await seedDestination(db);
  destB = await seedDestination(db);
  const [place] = await db
    .insert(catalogRecords)
    .values({
      destinationId: destA,
      kind: 'place',
      placeCategory: 'beach',
      title: 'Cove',
      description: 'A beach.',
      location: TROGIR,
    })
    .returning();
  if (!place) throw new Error('no place');
  placeId = place.id;

  const provider = await seedProvider(db, { commissionBp: 2000 });
  const sleepy = await seedProvider(db);
  await db.update(providers).set({ active: false }).where(eq(providers.id, sleepy.id));
  const base = { availabilityMode: 'on_request' as const, orderKind: 'booking' as const };
  await offer('A boat', { ...base, providerId: provider.id, destinationId: destA, placeId });
  await offer('B boat', { ...base, providerId: provider.id, destinationId: destB });
  await offer('Own bike', { ...base, hostId: guest.hostId, category: 'rental' });
  await offer('Other host bike', { ...base, hostId: otherHost.hostId });
  await offer('Draft', { ...base, providerId: provider.id, destinationId: destA }, false);
  const inactive = await offer('Inactive', {
    ...base,
    providerId: provider.id,
    destinationId: destA,
  });
  await db.update(offers).set({ active: false }).where(eq(offers.id, inactive));
  await offer('Sleepy', { ...base, providerId: sleepy.id, destinationId: destA, placeId });
});

afterAll(async () => {
  await testDb?.drop();
});

describe('listGuestOffers', () => {
  it('inside a destination: its Provider Offers plus the host’s own, by title', async () => {
    const list = await listGuestOffers(testDb.db, scope());
    expect(titles(list)).toEqual(['A boat', 'Own bike']);
    expect(list.map((o) => o.owner)).toEqual(['provider', 'host']);
  });

  it('outside a destination: only the host’s own', async () => {
    expect(titles(await listGuestOffers(testDb.db, scope({ destinationId: null })))).toEqual([
      'Own bike',
    ]);
  });

  it('another host’s guest sees their own Offers, never this host’s', async () => {
    const list = await listGuestOffers(testDb.db, scope({ propertyId: otherHost.propertyId }));
    expect(titles(list)).toEqual(['A boat', 'Other host bike']);
  });

  it('the text is in the guest’s language', async () => {
    const [first] = await listGuestOffers(testDb.db, scope({ language: 'fr' }));
    expect(first?.title).toBe('[fr] A boat');
  });

  it('filters by category and place', async () => {
    expect(titles(await listGuestOffers(testDb.db, scope(), { category: 'rental' }))).toEqual([
      'Own bike',
    ]);
    expect(titles(await listGuestOffers(testDb.db, scope(), { placeId }))).toEqual(['A boat']);
    expect(await listGuestOffers(testDb.db, scope(), { placeId: 'nope' })).toEqual([]);
  });
});

describe('getGuestOffer', () => {
  it('returns a visible Offer and null otherwise', async () => {
    expect((await getGuestOffer(testDb.db, scope(), ids['A boat'] ?? ''))?.id).toBe(ids['A boat']);
    for (const name of ['B boat', 'Other host bike', 'Draft', 'Inactive', 'Sleepy']) {
      expect(await getGuestOffer(testDb.db, scope(), ids[name] ?? '')).toBeNull();
    }
    expect(await getGuestOffer(testDb.db, scope(), 'not-a-uuid')).toBeNull();
  });
});

describe('offerIdsByPlace', () => {
  it('maps places to their visible Offers', async () => {
    const map = await offerIdsByPlace(testDb.db, scope(), [placeId]);
    expect(map.get(placeId)).toEqual([ids['A boat']]);
    expect((await offerIdsByPlace(testDb.db, scope({ destinationId: null }), [placeId])).size).toBe(
      0,
    );
    expect((await offerIdsByPlace(testDb.db, scope(), [])).size).toBe(0);
  });
});

describe('a Provider hidden by the host (38)', () => {
  it('is gone for this host’s guests in list, get and the place boost, and stays for others', async () => {
    const db = testDb.db;
    const hidden = await seedProvider(db);
    const base = { availabilityMode: 'on_request' as const, orderKind: 'booking' as const };
    const hiddenOffer = await offer('Hidden boat', {
      ...base,
      providerId: hidden.id,
      destinationId: destA,
      placeId,
    });
    await db.insert(hostHiddenProviders).values({ hostId: guest.hostId, providerId: hidden.id });

    const mine = await listGuestOffers(db, scope());
    expect(titles(mine)).toEqual(['A boat', 'Own bike']);
    expect(await getGuestOffer(db, scope(), hiddenOffer)).toBeNull();
    expect((await offerIdsByPlace(db, scope(), [placeId])).get(placeId)).toEqual([ids['A boat']]);

    const other = scope({ propertyId: otherHost.propertyId });
    expect(titles(await listGuestOffers(db, other))).toEqual([
      'A boat',
      'Hidden boat',
      'Other host bike',
    ]);
    expect((await getGuestOffer(db, other, hiddenOffer))?.id).toBe(hiddenOffer);
    expect((await offerIdsByPlace(db, other, [placeId])).get(placeId)?.sort()).toEqual(
      [ids['A boat'] ?? '', hiddenOffer].sort(),
    );
    expect(titles(await listGuestOffers(db, scope({ destinationId: null })))).toEqual(['Own bike']);
  });
});
