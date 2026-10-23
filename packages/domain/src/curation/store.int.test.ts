import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCatalogRecord } from '../catalog/store';
import { curationItems } from '../db/schema/curation';
import {
  createTestDatabase,
  noopQueue,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import { enqueueCurationItem } from './store';

const NOW = new Date('2027-07-10T09:00:00Z');

let testDb: TestDatabase;
let guest: SeededGuestUnit;
let destinationId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  guest = await seedGuestUnit(testDb.db, { now: NOW });
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await testDb?.drop();
});

describe('enqueueCurationItem', () => {
  it('writes one open item with its host, destination and payload', async () => {
    const payload = {
      kind: 'host_provider_suggestion' as const,
      name: 'Blue Boat',
      contact: '+385 91 000',
      note: null,
    };
    const { id } = await enqueueCurationItem(
      testDb.db,
      { hostId: guest.hostId, destinationId, payload },
      NOW,
    );
    const [row] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, id));
    expect(row).toMatchObject({
      kind: 'host_provider_suggestion',
      status: 'open',
      hostId: guest.hostId,
      destinationId,
      payload,
      createdAt: NOW,
    });
  });

  it('allows an item without host or destination', async () => {
    const { id } = await enqueueCurationItem(
      testDb.db,
      { payload: { kind: 'host_provider_suggestion', name: 'X', contact: null, note: null } },
      NOW,
    );
    const [row] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, id));
    expect(row).toMatchObject({ hostId: null, destinationId: null });
  });

  it('stores the record it is about', async () => {
    const record = await createCatalogRecord(
      testDb.db,
      noopQueue,
      { destinationId, kind: 'day_trip', title: 'Krka', description: 'Falls.', travelMinutes: 60 },
      NOW,
    );
    const { id } = await enqueueCurationItem(
      testDb.db,
      {
        destinationId,
        recordId: record.id,
        payload: { kind: 'guest_flagged', reason: 'wrong', count: 1 },
      },
      NOW,
    );
    const [row] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, id));
    expect(row).toMatchObject({ kind: 'guest_flagged', recordId: record.id, dedupeKey: null });
  });

  it('gives one item per dedupe key', async () => {
    const payload = {
      kind: 'host_provider_suggestion' as const,
      name: 'Y',
      contact: null,
      note: null,
    };
    const first = await enqueueCurationItem(testDb.db, { dedupeKey: 'k:1', payload }, NOW);
    const second = await enqueueCurationItem(testDb.db, { dedupeKey: 'k:1', payload }, NOW);
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    const rows = await testDb.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.dedupeKey, 'k:1'));
    expect(rows).toHaveLength(1);
  });
});
