import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orders } from '../db/schema/orders';
import {
  createTestDatabase,
  noopQueue,
  scriptedHandoffTranslator,
  seedGuestUnit,
  seedOrderableOffer,
  type TestDatabase,
} from '../testing';
import { cleanGuestNote, ensureNoteTranslation } from './guest-note';
import { createOrder } from './machine';

// The guest note's translation for the Provider or host: once, stored, never blocking.

let testDb: TestDatabase;
const NOW = new Date('2027-05-01T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

async function orderWithNote(spaceLanguage: 'en' | 'hr', note?: string) {
  const unit = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage });
  const { offerId } = await seedOrderableOffer(testDb.db, {
    hostId: unit.hostId,
    availabilityMode: 'on_request',
    category: 'transfer',
  });
  const { order } = await createOrder(
    { db: testDb.db, queue: noopQueue, now: () => NOW },
    {
      spaceId: unit.spaceId,
      offerId,
      date: unit.stay.checkIn,
      quantity: 4,
      contact: { email: 'guest@example.test' },
      guestNote: note,
    },
  );
  return order.id;
}

const stored = async (orderId: string) => {
  const [row] = await testDb.db.select().from(orders).where(eq(orders.id, orderId));
  return row;
};

describe('ensureNoteTranslation', () => {
  it('translates once and serves the stored translation after', async () => {
    const orderId = await orderWithNote('en', 'Split airport, 4 big suitcases');
    const translator = scriptedHandoffTranslator(['Zračna luka Split, 4 velika kofera']);
    const deps = { db: testDb.db, translator };

    const first = await ensureNoteTranslation(deps, { orderId, to: 'hr' });
    const second = await ensureNoteTranslation(deps, { orderId, to: 'hr' });

    expect(first).toEqual({
      text: 'Split airport, 4 big suitcases',
      translation: 'Zračna luka Split, 4 velika kofera',
    });
    expect(second).toEqual(first);
    expect(translator.calls).toEqual([{ text: 'Split airport, 4 big suitcases', to: 'hr' }]);
    expect(await stored(orderId)).toMatchObject({
      guestNoteTranslation: 'Zračna luka Split, 4 velika kofera',
      guestNoteTranslatedTo: 'hr',
    });
  });

  it('makes no call when the guest wrote in the same language', async () => {
    const orderId = await orderWithNote('hr', 'Zračna luka Split');
    const translator = scriptedHandoffTranslator(['unused']);
    expect(
      await ensureNoteTranslation({ db: testDb.db, translator }, { orderId, to: 'hr' }),
    ).toEqual({ text: 'Zračna luka Split', translation: null });
    expect(translator.calls).toHaveLength(0);
  });

  it('falls back to the original and stores nothing when translation fails', async () => {
    const orderId = await orderWithNote('en', 'Two child seats');
    const translator = scriptedHandoffTranslator([null]);
    expect(
      await ensureNoteTranslation({ db: testDb.db, translator }, { orderId, to: 'hr' }),
    ).toEqual({ text: 'Two child seats', translation: null });
    expect(await stored(orderId)).toMatchObject({
      guestNoteTranslation: null,
      guestNoteTranslatedTo: null,
    });
  });

  it('is null for an Order without a note', async () => {
    const orderId = await orderWithNote('en');
    const translator = scriptedHandoffTranslator(['unused']);
    expect(
      await ensureNoteTranslation({ db: testDb.db, translator }, { orderId, to: 'hr' }),
    ).toBeNull();
    expect(translator.calls).toHaveLength(0);
  });
});

describe('cleanGuestNote', () => {
  it('trims, keeps Unix line ends and drops an empty note', () => {
    expect(cleanGuestNote('  a\r\nb  ')).toBe('a\nb');
    expect(cleanGuestNote('   ')).toBeNull();
    expect(cleanGuestNote(undefined)).toBeNull();
  });
});
