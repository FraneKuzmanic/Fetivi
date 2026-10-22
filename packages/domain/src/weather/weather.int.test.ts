import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seedGuestUnit, type TestDatabase, TROGIR } from '../testing';
import { weatherPlaceOf } from './place';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('weatherPlaceOf', () => {
  it("gives the property's point and zone", async () => {
    const seeded = await seedGuestUnit(testDb.db);
    expect(await weatherPlaceOf(testDb.db, seeded.propertyId)).toEqual({
      lat: TROGIR.y,
      lng: TROGIR.x,
      timezone: 'Europe/Zagreb',
    });
  });

  it('gives null for a property without a location', async () => {
    const seeded = await seedGuestUnit(testDb.db, { location: null });
    expect(await weatherPlaceOf(testDb.db, seeded.propertyId)).toBeNull();
  });

  it('gives null for an unknown property', async () => {
    expect(await weatherPlaceOf(testDb.db, randomUUID())).toBeNull();
  });
});
