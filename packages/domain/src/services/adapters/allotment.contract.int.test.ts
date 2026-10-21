import { eq } from 'drizzle-orm';
import { afterAll, beforeAll } from 'vitest';
import { allotmentSlots } from '../../db/schema/offers';
import { orderProposals, orders } from '../../db/schema/orders';
import { createTestDatabase, type TestDatabase } from '../../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../../testing/fixtures';
import { allotmentAdapter } from './allotment';
import { describeAdapterContract } from './contract';

let testDb: TestDatabase;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
const SLOT_AT = new Date('2027-05-04T07:00:00Z');
const HOLD_UNTIL = new Date('2027-05-01T10:30:00Z');
const ZONE = 'Europe/Zagreb';

beforeAll(async () => {
  testDb = await createTestDatabase();
  unit = await seedGuestUnit(testDb.db, { now: NOW });
});

afterAll(async () => {
  await testDb?.drop();
});

/** An Order and its first proposal written directly in `confirming`, without the machine. */
async function confirmingOrder(offerId: string, slotId: string, quantity: number) {
  const [order] = await testDb.db
    .insert(orders)
    .values({
      spaceId: unit.spaceId,
      stayId: unit.stayId,
      offerId,
      availabilityMode: 'allotment',
      paymentMode: 'direct',
      status: 'confirming',
      date: DAY,
      quantity,
      guestEmail: 'guest@example.test',
      cancellationPolicy: 'Free until 24 hours before.',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      currency: 'EUR',
      priceUnit: 'person',
      commissionBp: 0,
    })
    .returning();
  if (!order) throw new Error('no order');
  const [proposal] = await testDb.db
    .insert(orderProposals)
    .values({
      orderId: order.id,
      version: 1,
      date: DAY,
      startsAt: SLOT_AT,
      slotId,
      quantity,
      priceMinor: 2500 * quantity,
      currency: 'EUR',
      proposer: 'offer',
    })
    .returning();
  if (!proposal) throw new Error('no proposal');
  await testDb.db
    .update(orders)
    .set({ currentProposalId: proposal.id })
    .where(eq(orders.id, order.id));
  return { orderId: order.id, proposalId: proposal.id };
}

describeAdapterContract('allotment', async () => {
  const provider = await seedProvider(testDb.db);
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    capacity: 3,
    startsAt: SLOT_AT,
  });
  if (!slotId) throw new Error('no slot');
  return {
    adapter: allotmentAdapter,
    ctx: { db: testDb.db, now: () => NOW },
    query: (quantity) => ({ offerId, date: DAY, quantity, zone: ZONE }),
    async newProposal(quantity) {
      const ref = await confirmingOrder(offerId, slotId, quantity);
      return { ...ref, slotId, quantity, expiresAt: HOLD_UNTIL };
    },
    async capacityLeft() {
      const [slot] = await testDb.db
        .select({ remaining: allotmentSlots.remaining })
        .from(allotmentSlots)
        .where(eq(allotmentSlots.id, slotId));
      return slot?.remaining ?? null;
    },
    async teardown() {},
  };
});
