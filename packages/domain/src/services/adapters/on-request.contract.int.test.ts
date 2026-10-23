import { eq } from 'drizzle-orm';
import { afterAll, beforeAll } from 'vitest';
import { orderProposals, orders } from '../../db/schema/orders';
import { createTestDatabase, type TestDatabase } from '../../testing';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../../testing/fixtures';
import { describeAdapterContract } from './contract';
import { onRequestAdapter } from './on-request';

let testDb: TestDatabase;
let unit: SeededGuestUnit;

const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-04';
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
async function confirmingOrder(offerId: string, quantity: number) {
  const [order] = await testDb.db
    .insert(orders)
    .values({
      spaceId: unit.spaceId,
      stayId: unit.stayId,
      offerId,
      availabilityMode: 'on_request',
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

describeAdapterContract('on request', async () => {
  const provider = await seedProvider(testDb.db);
  const { offerId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'on_request',
  });
  return {
    adapter: onRequestAdapter,
    ctx: { db: testDb.db, now: () => NOW },
    query: (quantity) => ({ offerId, date: DAY, quantity, zone: ZONE }),
    async newProposal(quantity) {
      const ref = await confirmingOrder(offerId, quantity);
      return { ...ref, slotId: null, quantity, expiresAt: HOLD_UNTIL };
    },
    capacityLeft: async () => null,
    async teardown() {},
  };
});
