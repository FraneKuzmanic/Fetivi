import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { propertyAmenities, unitAmenities } from '../db/schema/amenities';
import { infoBlocks, unitHiddenBlocks } from '../db/schema/info-blocks';
import { properties, type sharedCoreColumns, units } from '../db/schema/properties';
import { createTestDatabase, type TestDatabase } from '../testing';
import { loadEffectiveUnit } from './load';
import type { SharedCoreField } from './vocabulary';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

let seq = 0;
async function fixture() {
  seq += 1;
  const { db } = testDb;
  const [host] = await db
    .insert(accounts)
    .values({ email: `host${seq}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa Mare', location: { x: 16.2514, y: 43.517 } })
    .returning();
  if (!property) throw new Error('no property');
  const [unit] = await db
    .insert(units)
    .values({ propertyId: property.id, name: 'Apartment 1' })
    .returning();
  if (!unit) throw new Error('no unit');
  return { host, property, unit };
}

/** The Postgres error code of a rejected statement (drizzle wraps the driver error). */
async function errorCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
  return undefined;
}

describe('property schema', () => {
  it('keeps SHARED_CORE_FIELDS in step with the shared columns', () => {
    expectTypeOf<SharedCoreField>().toEqualTypeOf<keyof ReturnType<typeof sharedCoreColumns>>();
  });

  it('stores the location as a WGS 84 point and reads it back', async () => {
    const { property } = await fixture();
    const [row] = await testDb.db
      .select({ location: properties.location })
      .from(properties)
      .where(eq(properties.id, property.id));
    expect(row?.location).toEqual({ x: 16.2514, y: 43.517 });
    const srid = await testDb.db.execute<{ srid: number }>(
      sql`select ST_SRID(location) as srid from properties where id = ${property.id}`,
    );
    expect(srid.rows[0]?.srid).toBe(4326);
  });

  it('defaults the release offset to 1 and refuses more than 7 days', async () => {
    const { unit } = await fixture();
    expect(unit.arrivalReleaseDaysBefore).toBe(1);
    const code = await errorCode(() =>
      testDb.db.update(units).set({ arrivalReleaseDaysBefore: 8 }).where(eq(units.id, unit.id)),
    );
    expect(code).toBe('23514');
  });

  it('refuses a block with no owner, and a replacing block owned by a property', async () => {
    const { property } = await fixture();
    expect(
      await errorCode(() =>
        testDb.db.insert(infoBlocks).values({ category: 'how_tos', title: 't', body: 'b' }),
      ),
    ).toBe('23514');
    const [base] = await testDb.db
      .insert(infoBlocks)
      .values({ propertyId: property.id, category: 'how_tos', title: 't', body: 'b' })
      .returning();
    expect(
      await errorCode(() =>
        testDb.db.insert(infoBlocks).values({
          propertyId: property.id,
          category: 'how_tos',
          title: 't',
          body: 'b',
          replacesBlockId: base?.id,
        }),
      ),
    ).toBe('23514');
  });
});

describe('loadEffectiveUnit', () => {
  it('returns null for an unknown unit', async () => {
    expect(await loadEffectiveUnit(testDb.db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('merges fields, blocks and amenities', async () => {
    const { db } = testDb;
    const { property, unit } = await fixture();
    await db
      .update(properties)
      .set({ checkInTime: '15:00', petsAllowed: true, checkoutTime: '10:00' })
      .where(eq(properties.id, property.id));
    await db
      .update(units)
      .set({ checkInTime: '16:00', petsAllowed: false })
      .where(eq(units.id, unit.id));
    const [keep, hidden, replaced] = await db
      .insert(infoBlocks)
      .values([
        { propertyId: property.id, category: 'how_tos', title: 'Keep', body: 'b' },
        { propertyId: property.id, category: 'how_tos', title: 'Hidden', body: 'b' },
        { propertyId: property.id, category: 'arrival_access', title: 'Replaced', body: 'b' },
      ])
      .returning();
    if (!keep || !hidden || !replaced) throw new Error('blocks not inserted');
    const [replacement] = await db
      .insert(infoBlocks)
      .values({
        unitId: unit.id,
        category: 'arrival_access',
        title: 'Replacement',
        body: 'b',
        replacesBlockId: replaced.id,
      })
      .returning();
    await db.insert(unitHiddenBlocks).values({ unitId: unit.id, blockId: hidden.id });
    await db.insert(propertyAmenities).values({ propertyId: property.id, amenity: 'pool' });
    await db.insert(unitAmenities).values({ unitId: unit.id, amenity: 'balcony', note: 'Sea' });

    const e = await loadEffectiveUnit(db, unit.id);
    expect(e).toMatchObject({
      checkInTime: '16:00:00',
      checkoutTime: '10:00:00',
      petsAllowed: false,
      inherited: { checkInTime: false, checkoutTime: true, petsAllowed: false },
      amenities: [
        { amenity: 'balcony', note: 'Sea' },
        { amenity: 'pool', note: null },
      ],
    });
    expect(e?.blocks.map((b) => b.title)).toEqual(['Replacement', 'Keep']);

    // Deleting the replaced block clears the link; the unit block simply stays.
    await db.delete(infoBlocks).where(eq(infoBlocks.id, replaced.id));
    const [after] = await db
      .select({ replacesBlockId: infoBlocks.replacesBlockId })
      .from(infoBlocks)
      .where(eq(infoBlocks.id, replacement?.id ?? ''));
    expect(after?.replacesBlockId).toBeNull();
    expect((await loadEffectiveUnit(db, unit.id))?.blocks.map((b) => b.title)).toEqual([
      'Replacement',
      'Keep',
    ]);
  });

  it('cascades a deleted host to properties, units and blocks', async () => {
    const { db } = testDb;
    const { host, property, unit } = await fixture();
    await db
      .insert(infoBlocks)
      .values({ unitId: unit.id, category: 'how_tos', title: 't', body: 'b' });
    await db.delete(accounts).where(eq(accounts.id, host.id));
    expect(await db.select().from(properties).where(eq(properties.id, property.id))).toEqual([]);
    expect(await db.select().from(units).where(eq(units.id, unit.id))).toEqual([]);
    expect(await db.select().from(infoBlocks).where(eq(infoBlocks.unitId, unit.id))).toEqual([]);
  });
});
