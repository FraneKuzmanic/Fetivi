import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { destinations } from '../db/schema/catalog';
import { createTestDatabase, type TestDatabase } from '../testing';
import { findDestinationAt } from './destination';

let testDb: TestDatabase;
const TROGIR = { lat: 43.5169, lng: 16.2513 };
const KM_PER_DEGREE_LAT = 111.32;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.db.insert(destinations).values([
    { name: 'Trogir', centre: { x: TROGIR.lng, y: TROGIR.lat }, radiusM: 15_000 },
    { name: 'Split', centre: { x: 16.4402, y: 43.5081 }, radiusM: 15_000 },
  ]);
});

afterAll(async () => {
  await testDb?.drop();
});

const nameAt = async (point: { lat: number; lng: number }) =>
  (await findDestinationAt(testDb.db, point))?.name ?? null;

describe('findDestinationAt', () => {
  it('finds Trogir for Okrug Gornji', async () => {
    expect(await nameAt({ lat: 43.4936, lng: 16.2669 })).toBe('Trogir');
  });

  it('finds nothing for Šibenik', async () => {
    expect(await nameAt({ lat: 43.735, lng: 15.8952 })).toBeNull();
  });

  it('holds the 15 km boundary within 100 m', async () => {
    expect(await nameAt({ lat: TROGIR.lat + 14.9 / KM_PER_DEGREE_LAT, lng: TROGIR.lng })).toBe(
      'Trogir',
    );
    expect(
      await nameAt({ lat: TROGIR.lat + 15.1 / KM_PER_DEGREE_LAT, lng: TROGIR.lng }),
    ).toBeNull();
  });

  it('picks the nearest centre when destinations overlap', async () => {
    // Between the two centres, nearer Split.
    expect(await nameAt({ lat: 43.511, lng: 16.37 })).toBe('Split');
    expect(await nameAt({ lat: 43.513, lng: 16.3 })).toBe('Trogir');
  });

  it('reads the centre back as { x: lng, y: lat }', async () => {
    const row = await findDestinationAt(testDb.db, TROGIR);
    expect(row?.centre.x).toBeCloseTo(TROGIR.lng, 6);
    expect(row?.centre.y).toBeCloseTo(TROGIR.lat, 6);
  });
});
