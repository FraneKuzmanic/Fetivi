import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { curationItems } from '../db/schema/curation';
import {
  createTestDatabase,
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
      { kind: 'host_provider_suggestion', hostId: guest.hostId, destinationId, payload },
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
      {
        kind: 'host_provider_suggestion',
        payload: { kind: 'host_provider_suggestion', name: 'X', contact: null, note: null },
      },
      NOW,
    );
    const [row] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, id));
    expect(row).toMatchObject({ hostId: null, destinationId: null });
  });
});
