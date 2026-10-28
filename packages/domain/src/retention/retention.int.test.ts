import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client';
import { aboutMe } from '../db/schema/about-me';
import { conversations, messages } from '../db/schema/conversations';
import { answerFeedback } from '../db/schema/feedback';
import { handoffMessages } from '../db/schema/handoff';
import { turnMetrics } from '../db/schema/metrics';
import { pushSubscriptions } from '../db/schema/notifications';
import { inventoryHolds, orderEvents, orderProposals, orders } from '../db/schema/orders';
import { planItems } from '../db/schema/plan';
import { keptConversations, orderLedger } from '../db/schema/retention';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { OrderStatus, PaymentStatus } from '../orders/vocabulary';
import { readOnlyEndsAt } from '../spaces/vocabulary';
import { createTestDatabase, type TestDatabase } from '../testing/database';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '../testing/fixtures';
import { runRetention } from './run';

const SEED = new Date('2027-07-01T10:00:00Z');

let testDb: TestDatabase;
let db: Db;

beforeEach(async () => {
  testDb = await createTestDatabase();
  db = testDb.db;
});

afterEach(async () => {
  await testDb?.drop();
});

interface SeedOrder {
  offerId: string;
  status: OrderStatus;
  paymentStatus?: PaymentStatus;
  paymentMode?: 'direct' | 'online';
  slotId?: string;
  startsAt?: Date;
}

async function seedOrder(unit: SeededGuestUnit, o: SeedOrder): Promise<string> {
  const [order] = await db
    .insert(orders)
    .values({
      spaceId: unit.spaceId,
      stayId: unit.stayId,
      offerId: o.offerId,
      availabilityMode: o.slotId ? 'allotment' : 'on_request',
      paymentMode: o.paymentMode ?? 'direct',
      status: o.status,
      paymentStatus: o.paymentStatus ?? 'none',
      date: unit.stay.checkIn,
      quantity: 2,
      guestEmail: 'guest@example.test',
      guestName: 'Ana Guest',
      cancellationPolicy: 'Free until 24 hours before.',
      freeCancelHoursBefore: 24,
      refundPercentAfter: 0,
      currency: 'EUR',
      priceUnit: 'person',
      commissionBp: 1250,
      createdAt: SEED,
    })
    .returning();
  if (!order) throw new Error('no order');
  const [proposal] = await db
    .insert(orderProposals)
    .values({
      orderId: order.id,
      version: 1,
      date: unit.stay.checkIn,
      startsAt: o.startsAt ?? null,
      slotId: o.slotId ?? null,
      quantity: 2,
      priceMinor: 5000,
      currency: 'EUR',
      proposer: 'offer',
    })
    .returning();
  if (!proposal) throw new Error('no proposal');
  await db.update(orders).set({ currentProposalId: proposal.id }).where(eq(orders.id, order.id));
  await db.insert(orderEvents).values({
    orderId: order.id,
    proposalId: proposal.id,
    toStatus: o.status,
    toPaymentStatus: o.paymentStatus ?? 'none',
    trigger: 'guest',
    createdAt: SEED,
  });
  if (o.slotId) {
    await db.insert(inventoryHolds).values({
      orderId: order.id,
      proposalId: proposal.id,
      slotId: o.slotId,
      quantity: 2,
      expiresAt: SEED,
      state: 'committed',
      resolvedAt: SEED,
    });
  }
  return order.id;
}

/** A conversation with a user and an assistant chat message, a system note and an inbox item. */
async function seedConversation(unit: SeededGuestUnit): Promise<string> {
  const [conversation] = await db
    .insert(conversations)
    .values({
      spaceId: unit.spaceId,
      systemPrompt: 'You are Fetivi.',
      projection: {} as never,
      createdAt: SEED,
      updatedAt: SEED,
    })
    .returning();
  if (!conversation) throw new Error('no conversation');
  const at = (minutes: number) => new Date(SEED.getTime() + minutes * 60_000);
  await db.insert(messages).values([
    {
      id: `${conversation.id}-1`,
      conversationId: conversation.id,
      seq: 1,
      role: 'system',
      parts: [{ type: 'text', text: 'About me: vegetarian' }],
      createdAt: at(1),
    },
    {
      id: `${conversation.id}-2`,
      conversationId: conversation.id,
      seq: 2,
      role: 'user',
      parts: [{ type: 'text', text: 'Where is the beach?' }],
      createdAt: at(2),
    },
    {
      id: `${conversation.id}-3`,
      conversationId: conversation.id,
      seq: 3,
      role: 'assistant',
      parts: [
        {
          type: 'tool-get_about_me',
          toolCallId: 'about',
          state: 'output-available',
          output: { diet: 'vegetarian' },
        },
        { type: 'text', text: 'Five minutes west.' },
        {
          type: 'tool-book_offer',
          toolCallId: 'book',
          state: 'output-available',
          output: { email: 'guest@example.com', name: 'Ana', phone: '+385 91 000' },
        },
      ],
      createdAt: at(3),
    },
    {
      id: `${conversation.id}-5`,
      conversationId: conversation.id,
      seq: 5,
      role: 'user',
      parts: [
        {
          type: 'data-elicitation-answer',
          data: { email: 'guest@example.com', phone: '+385 91 000' },
        },
      ],
      createdAt: at(5),
    },
    {
      id: `${conversation.id}-4`,
      conversationId: conversation.id,
      seq: 4,
      role: 'assistant',
      kind: 'inbox',
      parts: [{ type: 'text', text: 'Host reply' }],
      createdAt: at(4),
    },
  ]);
  return conversation.id;
}

async function seedPersonalData(unit: SeededGuestUnit): Promise<void> {
  await db.insert(aboutMe).values({ spaceId: unit.spaceId, interests: ['food'], updatedAt: SEED });
  await db.insert(planItems).values({
    spaceId: unit.spaceId,
    date: unit.stay.checkIn,
    title: 'Beach day',
    createdAt: SEED,
    updatedAt: SEED,
  });
  await db.insert(handoffMessages).values({
    spaceId: unit.spaceId,
    stayId: unit.stayId,
    unitId: unit.unitId,
    reason: 'request',
    urgency: 'normal',
    guestLanguage: 'en',
    text: 'Extra towels please',
    hostLanguage: 'en',
    translationState: 'not_needed',
    sentAt: SEED,
  });
  await db.insert(pushSubscriptions).values({
    spaceId: unit.spaceId,
    endpoint: `https://push.example.test/${unit.spaceId}`,
    p256dh: 'k',
    auth: 'a',
    createdAt: SEED,
  });
}

async function spaceExists(spaceId: string): Promise<boolean> {
  return (await db.select().from(spaces).where(eq(spaces.id, spaceId))).length > 0;
}

const dueAt = (unit: SeededGuestUnit) => readOnlyEndsAt(unit.stay.activeUntil);

describe('runRetention', () => {
  it('deletes the Space with its personal data and leaves the ledger intact', async () => {
    const unit = await seedGuestUnit(db, { now: SEED });
    const provider = await seedProvider(db);
    const { offerId: providerOffer } = await seedOrderableOffer(db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
      title: 'Island kayak',
    });
    const slotStart = new Date(`${unit.stay.checkIn}T08:00:00Z`);
    const { offerId: hostOffer, slotId } = await seedOrderableOffer(db, {
      hostId: unit.hostId,
      availabilityMode: 'allotment',
      startsAt: slotStart,
      title: 'Cooking class',
    });
    const completed = await seedOrder(unit, { offerId: providerOffer, status: 'completed' });
    const cancelled = await seedOrder(unit, {
      offerId: hostOffer,
      status: 'cancelled',
      slotId,
      startsAt: slotStart,
    });
    const conversationId = await seedConversation(unit);
    await seedPersonalData(unit);
    await db.insert(answerFeedback).values({
      messageId: `${conversationId}-3`,
      conversationId,
      stayId: unit.stayId,
      topics: ['wifi'],
      thumb: 'up',
      createdAt: SEED,
      updatedAt: SEED,
    });
    await db.insert(turnMetrics).values({
      conversationId,
      model: 'm',
      startedAt: SEED,
      wallMs: 1,
      mcpMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      steps: 1,
      toolCalls: 0,
      toolNames: [],
    });

    const now = new Date(dueAt(unit).getTime() + 1);
    const counts = await runRetention(db, now);

    expect(counts).toEqual({ deleted: 1, kept: 0, held: 0, ledger: 2, purged: 0 });
    expect(await spaceExists(unit.spaceId)).toBe(false);
    expect(await db.select().from(conversations)).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(aboutMe)).toHaveLength(0);
    expect(await db.select().from(planItems)).toHaveLength(0);
    expect(await db.select().from(handoffMessages)).toHaveLength(0);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    expect(await db.select().from(orders)).toHaveLength(0);
    expect(await db.select().from(orderEvents)).toHaveLength(0);
    expect(await db.select().from(inventoryHolds)).toHaveLength(0);
    expect(await db.select().from(keptConversations)).toHaveLength(0);
    // The Stay is the host's record and stays.
    expect(await db.select().from(stays).where(eq(stays.id, unit.stayId))).toHaveLength(1);

    const ledger = await db.select().from(orderLedger);
    expect(ledger).toHaveLength(2);
    const keepUntil = new Date(unit.stay.activeUntil);
    keepUntil.setUTCFullYear(keepUntil.getUTCFullYear() + 11);
    expect(ledger.find((r) => r.orderId === completed)).toMatchObject({
      offerId: providerOffer,
      offerTitle: 'Island kayak',
      providerId: provider.id,
      providerName: provider.name,
      hostId: null,
      date: unit.stay.checkIn,
      startsAt: null,
      quantity: 2,
      priceMinor: 5000,
      currency: 'EUR',
      paymentMode: 'direct',
      commissionBp: 1250,
      status: 'completed',
      paymentStatus: 'none',
      guestEmail: 'guest@example.test',
      orderCreatedAt: SEED,
      recordedAt: now,
      keepUntil,
    });
    expect(ledger.find((r) => r.orderId === cancelled)).toMatchObject({
      offerId: hostOffer,
      offerTitle: 'Cooking class',
      providerId: null,
      providerName: null,
      hostId: unit.hostId,
      startsAt: slotStart,
      status: 'cancelled',
    });

    // Counts outlive the conversation.
    const [feedback] = await db.select().from(answerFeedback);
    expect(feedback).toMatchObject({ conversationId, messageId: null });
    expect(await db.select().from(turnMetrics)).toHaveLength(1);
  });

  it('deletes exactly at the end of the read-only period, not 1 ms before', async () => {
    const unit = await seedGuestUnit(db, { now: SEED });
    const end = dueAt(unit);
    expect((await runRetention(db, new Date(end.getTime() - 1))).deleted).toBe(0);
    expect(await spaceExists(unit.spaceId)).toBe(true);
    expect((await runRetention(db, end)).deleted).toBe(1);
    expect(await spaceExists(unit.spaceId)).toBe(false);
  });

  it("keeps only the text of an opted-in conversation's chat messages", async () => {
    const optedIn = await seedGuestUnit(db, { now: SEED, spaceLanguage: 'de' });
    const optedOut = await seedGuestUnit(db, { now: SEED });
    await db.update(spaces).set({ evaluationOptInAt: SEED }).where(eq(spaces.id, optedIn.spaceId));
    const keptId = await seedConversation(optedIn);
    await seedConversation(optedOut);

    const counts = await runRetention(db, dueAt(optedIn));

    expect(counts).toMatchObject({ deleted: 2, kept: 1 });
    const kept = await db.select().from(keptConversations);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ conversationId: keptId, language: 'de', startedAt: SEED });
    expect(kept[0]?.messages).toEqual([
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Where is the beach?' }],
        createdAt: new Date(SEED.getTime() + 2 * 60_000).toISOString(),
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Five minutes west.' }],
        createdAt: new Date(SEED.getTime() + 3 * 60_000).toISOString(),
      },
    ]);
  });

  it('keeps cited sources as their hosts, not raw markers', async () => {
    const unit = await seedGuestUnit(db, { now: SEED });
    await db.update(spaces).set({ evaluationOptInAt: SEED }).where(eq(spaces.id, unit.spaceId));
    const [conversation] = await db
      .insert(conversations)
      .values({
        spaceId: unit.spaceId,
        systemPrompt: 'You are Fetivi.',
        projection: {} as never,
        createdAt: SEED,
        updatedAt: SEED,
      })
      .returning();
    if (!conversation) throw new Error('no conversation');
    const result = (host: string) => ({
      title: host,
      snippet: '',
      url: `https://${host}/`,
      source: { host, kind: 'tourist_board' },
    });
    await db.insert(messages).values({
      id: `${conversation.id}-1`,
      conversationId: conversation.id,
      seq: 1,
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me look.' },
        {
          type: 'data-component',
          id: 'search',
          data: {
            name: 'web-results',
            payload: { results: [result('www.visittrogir.hr'), result('split.gov.hr')] },
          },
        },
        { type: 'text', text: 'Tours run daily [1]. Ferries too [2] [9].' },
      ],
      createdAt: SEED,
    });

    await runRetention(db, dueAt(unit));

    const [kept] = await db.select().from(keptConversations);
    expect(kept?.messages[0]?.parts).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'text', text: 'Tours run daily (visittrogir.hr). Ferries too (split.gov.hr).' },
    ]);
  });

  it('deletes an opted-in Space with no conversation without a kept row', async () => {
    const unit = await seedGuestUnit(db, { now: SEED });
    await db.update(spaces).set({ evaluationOptInAt: SEED }).where(eq(spaces.id, unit.spaceId));
    expect(await runRetention(db, dueAt(unit))).toMatchObject({ deleted: 1, kept: 0 });
    expect(await db.select().from(keptConversations)).toHaveLength(0);
  });

  it('holds a Space with an unsettled Order or payment until it settles', async () => {
    const pending = await seedGuestUnit(db, { now: SEED });
    const refunding = await seedGuestUnit(db, { now: SEED });
    const provider = await seedProvider(db);
    const { offerId } = await seedOrderableOffer(db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const pendingOrder = await seedOrder(pending, { offerId, status: 'pending_provider' });
    const refundOrder = await seedOrder(refunding, {
      offerId,
      status: 'cancelled',
      paymentMode: 'online',
      paymentStatus: 'refund_pending',
    });
    const now = dueAt(pending);

    expect(await runRetention(db, now)).toEqual({
      deleted: 0,
      kept: 0,
      held: 2,
      ledger: 0,
      purged: 0,
    });
    expect(await spaceExists(pending.spaceId)).toBe(true);
    expect(await spaceExists(refunding.spaceId)).toBe(true);
    expect(await db.select().from(orderLedger)).toHaveLength(0);

    await db.update(orders).set({ status: 'declined' }).where(eq(orders.id, pendingOrder));
    await db.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, refundOrder));
    const later = new Date(now.getTime() + 24 * 3_600_000);
    expect(await runRetention(db, later)).toMatchObject({ deleted: 2, held: 0, ledger: 2 });
  });

  it('changes nothing on a rerun', async () => {
    const unit = await seedGuestUnit(db, { now: SEED });
    const { offerId } = await seedOrderableOffer(db, {
      hostId: unit.hostId,
      availabilityMode: 'on_request',
    });
    await seedOrder(unit, { offerId, status: 'completed' });
    const now = dueAt(unit);
    await runRetention(db, now);
    const before = await db.select().from(orderLedger);

    expect(await runRetention(db, now)).toEqual({
      deleted: 0,
      kept: 0,
      held: 0,
      ledger: 0,
      purged: 0,
    });
    expect(await db.select().from(orderLedger)).toEqual(before);
  });

  it('purges ledger rows past their 11 years and keeps later ones', async () => {
    const now = new Date('2040-01-01T00:00:00Z');
    const row = {
      offerId: crypto.randomUUID(),
      offerTitle: 'Kayak tour',
      date: '2028-07-01',
      quantity: 1,
      currency: 'EUR',
      paymentMode: 'direct' as const,
      commissionBp: 0,
      status: 'completed' as const,
      paymentStatus: 'none' as const,
      guestEmail: 'guest@example.test',
      orderCreatedAt: SEED,
      recordedAt: SEED,
    };
    const old = crypto.randomUUID();
    const recent = crypto.randomUUID();
    await db.insert(orderLedger).values([
      { ...row, orderId: old, keepUntil: now },
      { ...row, orderId: recent, keepUntil: new Date(now.getTime() + 1) },
    ]);

    expect((await runRetention(db, now)).purged).toBe(1);
    const left = await db.select({ orderId: orderLedger.orderId }).from(orderLedger);
    expect(left).toEqual([{ orderId: recent }]);
  });
});
