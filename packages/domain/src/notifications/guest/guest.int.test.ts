import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findConversation, getOrCreateConversation, loadMessages } from '../../conversations/store';
import { calendarEvents, calendarFeeds } from '../../db/schema/calendar';
import { handoffMessages } from '../../db/schema/handoff';
import {
  emailSuppressions,
  guestNotificationDeliveries,
  pushSubscriptions,
} from '../../db/schema/notifications';
import { orders } from '../../db/schema/orders';
import { spaces } from '../../db/schema/spaces';
import { stays } from '../../db/schema/stays';
import { INBOX_PART_TYPE } from '../../handoff/vocabulary';
import { createMemoryMailer, type Mailer, type MailMessage } from '../../mail';
import { createOrder } from '../../orders/machine';
import { loadGuestProjection } from '../../projection/load';
import type { GuestLanguage } from '../../property/vocabulary';
import { confirmHeldOrder } from '../../services/adapters';
import {
  createTestDatabase,
  noopQueue,
  publishOffer,
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '../../testing';
import { deliverGuestNotification, type GuestNotifyDeps } from './deliver';
import type { GuestNotifyJobData } from './enqueue';
import { createMemoryPushSender, pushState, recordPushOffer, savePushSubscription } from './push';
import { dueStayNotices } from './reminders';
import { isEmailSuppressed, suppressEmail } from './suppressions';

let testDb: TestDatabase;
const NOW = new Date('2027-05-01T10:00:00Z');
const DAY = '2027-05-02';
const SLOT_AT = new Date('2027-05-02T07:00:00Z'); // 09:00 in Zagreb
const ORIGIN = 'https://guest.fetivi.test';

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

function deps(over: Partial<GuestNotifyDeps> = {}) {
  const mailer = createMemoryMailer();
  const push = createMemoryPushSender();
  return {
    mailer,
    push,
    deps: { db: testDb.db, mailer, push, guestOrigin: ORIGIN, now: () => NOW, ...over },
  };
}

interface Guest extends SeededGuestUnit {
  endpoint: string;
}

/** A guest with a Conversation and a push subscription unless told otherwise. */
async function guest(
  options: { conversation?: boolean; subscribed?: boolean; language?: GuestLanguage } = {},
): Promise<Guest> {
  const language = options.language ?? 'en';
  const g = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: language, checkInInDays: 0 });
  if (options.conversation !== false) {
    const projection = await loadGuestProjection(testDb.db, {
      unitId: g.unitId,
      stayId: g.stayId,
      language,
      now: NOW,
    });
    await getOrCreateConversation(testDb.db, g.spaceId, { systemPrompt: 's', projection }, NOW);
  }
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(6).toString('hex')}`;
  if (options.subscribed !== false) {
    await savePushSubscription(testDb.db, g.spaceId, { endpoint, p256dh: 'p', auth: 'a' }, NOW);
  }
  return { ...g, endpoint };
}

async function confirmedOrder(g: SeededGuestUnit, options: { publish?: boolean } = {}) {
  const provider = await seedProvider(testDb.db);
  const { offerId, slotId } = await seedOrderableOffer(testDb.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    startsAt: SLOT_AT,
  });
  if (options.publish) await publishOffer(testDb.db, offerId);
  const orderDeps = { db: testDb.db, queue: noopQueue, now: () => NOW };
  const { order } = await createOrder(orderDeps, {
    spaceId: g.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'Ana@Example.test', name: 'Ana' },
    hold: { expiresAt: new Date(NOW.getTime() + 30 * 60_000) },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirmHeldOrder(orderDeps, ref);
  return ref;
}

async function inboxNotices(spaceId: string) {
  const conversation = await findConversation(testDb.db, spaceId);
  if (!conversation) return [];
  const rows = await loadMessages(testDb.db, conversation.id);
  return rows
    .filter((r) => r.kind === 'inbox')
    .flatMap((r) => r.parts)
    .filter((p) => p.type === INBOX_PART_TYPE)
    .map((p) => p.data as Record<string, unknown>);
}

async function optIn(spaceId: string, email = 'guest@example.test') {
  await testDb.db.update(spaces).set({ email, emailOptInAt: NOW }).where(eq(spaces.id, spaceId));
}

describe('deliverGuestNotification: Order kinds', () => {
  it('sends a confirmation on inbox, email and push', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const { deps: d, mailer, push } = deps();
    const result = await deliverGuestNotification(d, { kind: 'order_confirmed', ...ref });
    expect(result).toEqual({ inbox: 'sent', email: 'sent', push: 'sent' });

    const [notice] = await inboxNotices(g.spaceId);
    expect(notice).toMatchObject({
      kind: 'notice',
      notification: 'order_confirmed',
      orderId: ref.orderId,
      offerTitle: 'Kayak tour',
      date: DAY,
      startTime: '09:00',
      reviewUrl: null,
    });
    expect(JSON.stringify(notice)).not.toContain('Ana');

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: 'Ana@Example.test',
      idempotencyKey: `order:${ref.orderId}:proposal:${ref.proposalId}:notify:order_confirmed:email`,
    });
    expect(mailer.sent[0]?.subject).toBe('Confirmed: Kayak tour, Sun 2 May at 09:00');
    expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/trip`);

    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.message).toEqual({
      title: 'Confirmed',
      body: 'Kayak tour, Sun 2 May at 09:00',
      url: '/trip',
    });
    expect(push.sent[0]?.topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('uses the Offer title in the space language', async () => {
    const g = await guest({ language: 'hr' });
    const ref = await confirmedOrder(g, { publish: true });
    const { deps: d, mailer } = deps();
    await deliverGuestNotification(d, { kind: 'order_cancelled', ...ref });
    expect(mailer.sent[0]?.subject).toMatch(/^Otkazano: \[hr\] Kayak tour/);
    expect((await inboxNotices(g.spaceId))[0]?.offerTitle).toBe('[hr] Kayak tour');
  });

  it('sends once per channel for duplicate events, in sequence and in parallel', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const { deps: d, mailer, push } = deps();
    const job: GuestNotifyJobData = { kind: 'order_confirmed', ...ref };
    await deliverGuestNotification(d, job);
    expect(await deliverGuestNotification(d, job)).toEqual({
      inbox: 'already_sent',
      email: 'already_sent',
      push: 'already_sent',
    });
    await Promise.all([1, 2, 3].map(() => deliverGuestNotification(d, job)));
    expect(await inboxNotices(g.spaceId)).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });

  it('runs three parallel first deliveries as one', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const { deps: d, mailer, push } = deps();
    const job: GuestNotifyJobData = { kind: 'order_declined', ...ref };
    const results = await Promise.all([1, 2, 3].map(() => deliverGuestNotification(d, job)));
    expect(results.filter((r) => r.inbox === 'sent')).toHaveLength(1);
    expect(await inboxNotices(g.spaceId)).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });

  it('keeps the inbox once when the email fails and the retry sends it', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const sent: MailMessage[] = [];
    let failures = 1;
    const flaky: Mailer = {
      async send(message) {
        if (failures-- > 0) throw new Error('smtp down');
        sent.push(message);
      },
    };
    const { deps: d, push } = deps({ mailer: flaky });
    const job: GuestNotifyJobData = { kind: 'order_expired', ...ref };
    await expect(deliverGuestNotification(d, job)).rejects.toThrow('smtp down');
    expect(await inboxNotices(g.spaceId)).toHaveLength(1);
    expect(push.sent).toHaveLength(0);
    expect(await deliverGuestNotification(d, job)).toEqual({
      inbox: 'already_sent',
      email: 'sent',
      push: 'sent',
    });
    expect(await inboxNotices(g.spaceId)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('skips a suppressed address, case-insensitively, and still sends inbox and push', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    await suppressEmail(testDb.db, 'ana@example.TEST', 'bounced', NOW);
    await suppressEmail(testDb.db, 'ana@example.test', 'complained', NOW);
    expect(await isEmailSuppressed(testDb.db, 'ANA@example.test')).toBe(true);
    const { deps: d, mailer } = deps();
    expect(await deliverGuestNotification(d, { kind: 'order_failed', ...ref })).toEqual({
      inbox: 'sent',
      email: 'skipped',
      push: 'sent',
    });
    expect(mailer.sent).toHaveLength(0);
    await testDb.db.delete(emailSuppressions);
  });

  it('skips only the inbox without a Conversation', async () => {
    const g = await guest({ conversation: false });
    const ref = await confirmedOrder(g);
    const { deps: d } = deps();
    expect(await deliverGuestNotification(d, { kind: 'order_new_proposal', ...ref })).toEqual({
      inbox: 'skipped',
      email: 'sent',
      push: 'sent',
    });
  });

  it('skips push without a sender or a subscription, and after the Stay', async () => {
    const g = await guest({ subscribed: false });
    const ref = await confirmedOrder(g);
    expect(
      (await deliverGuestNotification(deps().deps, { kind: 'order_confirmed', ...ref })).push,
    ).toBe('skipped');
    const h = await guest();
    const ref2 = await confirmedOrder(h);
    expect(
      (
        await deliverGuestNotification(deps({ push: null }).deps, {
          kind: 'order_confirmed',
          ...ref2,
        })
      ).push,
    ).toBe('skipped');
    const k = await guest();
    const ref3 = await confirmedOrder(k);
    await testDb.db.update(spaces).set({ closedAt: NOW }).where(eq(spaces.id, k.spaceId));
    expect(
      (await deliverGuestNotification(deps().deps, { kind: 'order_cancelled', ...ref3 })).push,
    ).toBe('skipped');
  });

  it('deletes a gone subscription and keeps the others', async () => {
    const g = await guest();
    const other = `https://updates.push.services.mozilla.com/wpush/v2/${randomBytes(4).toString('hex')}`;
    await savePushSubscription(
      testDb.db,
      g.spaceId,
      { endpoint: other, p256dh: 'p', auth: 'a' },
      NOW,
    );
    const ref = await confirmedOrder(g);
    const { deps: d, push } = deps();
    push.gone.add(g.endpoint);
    expect((await deliverGuestNotification(d, { kind: 'order_confirmed', ...ref })).push).toBe(
      'sent',
    );
    const left = await testDb.db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.spaceId, g.spaceId));
    expect(left.map((s) => s.endpoint)).toEqual([other]);
  });
});

describe('deliverGuestNotification: reminder', () => {
  it('sends while the Order is confirmed on the same proposal', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const { deps: d, mailer } = deps();
    expect((await deliverGuestNotification(d, { kind: 'order_reminder', ...ref })).email).toBe(
      'sent',
    );
    expect(mailer.sent[0]?.idempotencyKey).toBe(
      `order:${ref.orderId}:proposal:${ref.proposalId}:remind:email`,
    );
  });

  it('is dropped after a cancel, on a stale proposal, or once the item has started', async () => {
    const g = await guest();
    const ref = await confirmedOrder(g);
    const skipped = { inbox: 'skipped', email: 'skipped', push: 'skipped' };
    const stale = { ...ref, proposalId: crypto.randomUUID() };
    expect(
      await deliverGuestNotification(deps().deps, { kind: 'order_reminder', ...stale }),
    ).toEqual(skipped);
    const late = deps({ now: () => SLOT_AT }).deps;
    expect(await deliverGuestNotification(late, { kind: 'order_reminder', ...ref })).toEqual(
      skipped,
    );
    await testDb.db.update(orders).set({ status: 'cancelled' }).where(eq(orders.id, ref.orderId));
    expect(await deliverGuestNotification(deps().deps, { kind: 'order_reminder', ...ref })).toEqual(
      skipped,
    );
  });
});

describe('deliverGuestNotification: host reply', () => {
  async function delivered(g: SeededGuestUnit, deliveredAt: Date | null) {
    const [row] = await testDb.db
      .insert(handoffMessages)
      .values({
        spaceId: g.spaceId,
        stayId: g.stayId,
        unitId: g.unitId,
        reason: 'property_question',
        urgency: 'normal',
        guestLanguage: 'en',
        text: 'Is there a hair dryer?',
        hostLanguage: 'en',
        translationState: 'not_needed',
        sentAt: NOW,
        replyText: 'Yes, in the bathroom.',
        repliedAt: NOW,
        replyDeliveredAt: deliveredAt,
      })
      .returning();
    if (!row) throw new Error('no handoff');
    return row.id;
  }

  it('emails an opted-in space and pushes, without a second inbox row', async () => {
    const g = await guest();
    await optIn(g.spaceId);
    const handoffId = await delivered(g, NOW);
    const { deps: d, mailer, push } = deps();
    const job: GuestNotifyJobData = { kind: 'host_reply', spaceId: g.spaceId, handoffId };
    expect(await deliverGuestNotification(d, job)).toEqual({
      inbox: 'skipped',
      email: 'sent',
      push: 'sent',
    });
    expect(mailer.sent[0]).toMatchObject({
      to: 'guest@example.test',
      subject: 'Your host replied',
      idempotencyKey: `handoff:${handoffId}:host_reply:email`,
    });
    expect(mailer.sent[0]?.text).not.toContain('hair dryer');
    expect(push.sent[0]?.message.url).toBe('/chat');
    expect(await inboxNotices(g.spaceId)).toHaveLength(0);
  });

  it('emails no one without an opt-in, and skips an undelivered reply', async () => {
    const g = await guest();
    const handoffId = await delivered(g, NOW);
    expect(
      (
        await deliverGuestNotification(deps().deps, {
          kind: 'host_reply',
          spaceId: g.spaceId,
          handoffId,
        })
      ).email,
    ).toBe('skipped');
    const h = await guest();
    const pending = await delivered(h, null);
    expect(
      (
        await deliverGuestNotification(deps().deps, {
          kind: 'host_reply',
          spaceId: h.spaceId,
          handoffId: pending,
        })
      ).push,
    ).toBe('skipped');
  });
});

describe('deliverGuestNotification: Stay notices', () => {
  it('sends the arrival notice without any codes', async () => {
    const g = await guest();
    await optIn(g.spaceId);
    const { deps: d, mailer, push } = deps();
    const result = await deliverGuestNotification(d, {
      kind: 'arrival_details',
      spaceId: g.spaceId,
    });
    expect(result).toEqual({ inbox: 'sent', email: 'sent', push: 'sent' });
    const everything = JSON.stringify([mailer.sent, push.sent, await inboxNotices(g.spaceId)]);
    for (const secret of [
      g.pin,
      g.secrets.doorCode,
      g.secrets.lockboxCode,
      g.secrets.wifiPassword,
    ]) {
      expect(everything).not.toContain(secret);
    }
    expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/guide`);
  });

  it('skips a possibly cancelled Stay and a closed space', async () => {
    const skipped = { inbox: 'skipped', email: 'skipped', push: 'skipped' };
    const g = await guest();
    await testDb.db.update(stays).set({ possiblyCancelled: true }).where(eq(stays.id, g.stayId));
    expect(
      await deliverGuestNotification(deps().deps, { kind: 'arrival_details', spaceId: g.spaceId }),
    ).toEqual(skipped);
    const h = await guest();
    await testDb.db.update(spaces).set({ closedAt: NOW }).where(eq(spaces.id, h.spaceId));
    expect(
      await deliverGuestNotification(deps().deps, {
        kind: 'checkout_reminder',
        spaceId: h.spaceId,
      }),
    ).toEqual(skipped);
  });

  it('adds the review link when the Stay came from a calendar feed', async () => {
    const g = await guest();
    await optIn(g.spaceId);
    const [feed] = await testDb.db
      .insert(calendarFeeds)
      .values({
        unitId: g.unitId,
        source: 'booking',
        url: `https://ical.booking.com/v1/export?t=${g.stayId}`,
      })
      .returning();
    if (!feed) throw new Error('no feed');
    await testDb.db.insert(calendarEvents).values({
      feedId: feed.id,
      uid: `uid-${g.stayId}`,
      checkIn: g.stay.checkIn,
      checkout: g.stay.checkout,
      status: 'confirmed',
      stayId: g.stayId,
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    });
    const { deps: d, mailer } = deps();
    await deliverGuestNotification(d, { kind: 'checkout_reminder', spaceId: g.spaceId });
    expect(mailer.sent[0]?.text).toContain('Please leave by 10:00.');
    expect(mailer.sent[0]?.text).toContain('leave a review on Booking.com.');
    expect(mailer.sent[0]?.text).toContain('https://secure.booking.com/myreservations.html');
    expect((await inboxNotices(g.spaceId))[0]).toMatchObject({
      notification: 'checkout_reminder',
      checkoutTime: '10:00',
      reviewPlatform: 'booking',
      reviewUrl: 'https://secure.booking.com/myreservations.html',
    });
  });

  it('has no review line for a Stay registered by hand', async () => {
    const g = await guest();
    await optIn(g.spaceId);
    const { deps: d, mailer } = deps();
    await deliverGuestNotification(d, { kind: 'checkout_reminder', spaceId: g.spaceId });
    expect(mailer.sent[0]?.text).not.toContain('review');
    expect((await inboxNotices(g.spaceId))[0]).toMatchObject({
      reviewPlatform: null,
      reviewUrl: null,
    });
  });

  it('writes one ledger row per channel', async () => {
    const g = await guest();
    await optIn(g.spaceId);
    await deliverGuestNotification(deps().deps, { kind: 'arrival_details', spaceId: g.spaceId });
    await deliverGuestNotification(deps().deps, { kind: 'arrival_details', spaceId: g.spaceId });
    const rows = await testDb.db
      .select()
      .from(guestNotificationDeliveries)
      .where(
        and(
          eq(guestNotificationDeliveries.spaceId, g.spaceId),
          eq(guestNotificationDeliveries.key, `space:${g.spaceId}:arrival_details`),
        ),
      );
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'inbox', 'push']);
  });
});

describe('push offer state', () => {
  it('records the offer once and reports the subscription', async () => {
    const g = await guest({ subscribed: false });
    expect(await pushState(testDb.db, g.spaceId)).toEqual({ offered: false, subscribed: false });
    await recordPushOffer(testDb.db, g.spaceId, NOW);
    await recordPushOffer(testDb.db, g.spaceId, new Date(NOW.getTime() + 1000));
    const [space] = await testDb.db.select().from(spaces).where(eq(spaces.id, g.spaceId));
    expect(space?.pushOfferedAt).toEqual(NOW);
    await savePushSubscription(
      testDb.db,
      g.spaceId,
      { endpoint: g.endpoint, p256dh: 'p', auth: 'a' },
      NOW,
    );
    expect(await pushState(testDb.db, g.spaceId)).toEqual({ offered: true, subscribed: true });
  });

  it('moves an endpoint to the space that subscribes it last', async () => {
    const g = await guest();
    const h = await guest({ subscribed: false });
    await savePushSubscription(
      testDb.db,
      h.spaceId,
      { endpoint: g.endpoint, p256dh: 'q', auth: 'b' },
      NOW,
    );
    expect((await pushState(testDb.db, g.spaceId)).subscribed).toBe(false);
    expect((await pushState(testDb.db, h.spaceId)).subscribed).toBe(true);
  });
});

describe('dueStayNotices', () => {
  const at = (iso: string) => new Date(iso);
  const kindsFor = async (spaceId: string, now: Date) =>
    (await dueStayNotices(testDb.db, now)).filter((n) => n.spaceId === spaceId).map((n) => n.kind);

  it('finds the arrival notice from its release for a day', async () => {
    // Check-in 3 May, released 2 May 00:00 Zagreb = 1 May 22:00Z; the space opened at 10:00Z.
    const g = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: 2 });
    expect(await kindsFor(g.spaceId, at('2027-05-01T21:59:00Z'))).toEqual([]);
    expect(await kindsFor(g.spaceId, at('2027-05-01T22:15:00Z'))).toEqual(['arrival_details']);
    expect(await kindsFor(g.spaceId, at('2027-05-02T21:59:00Z'))).toEqual(['arrival_details']);
    expect(await kindsFor(g.spaceId, at('2027-05-02T22:01:00Z'))).toEqual([]);
  });

  it('skips a space opened after the release', async () => {
    const g = await seedGuestUnit(testDb.db, { now: at('2027-05-02T01:00:00Z'), checkInInDays: 1 });
    expect(await kindsFor(g.spaceId, at('2027-05-02T01:15:00Z'))).toEqual([]);
  });

  it('finds the checkout reminder at 18:00 the evening before', async () => {
    // Checkout 4 May: the reminder is 3 May 18:00 Zagreb = 16:00Z.
    const g = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: 0, nights: 3 });
    expect(await kindsFor(g.spaceId, at('2027-05-03T15:59:00Z'))).toEqual([]);
    expect(await kindsFor(g.spaceId, at('2027-05-03T16:15:00Z'))).toEqual(['checkout_reminder']);
    await testDb.db.update(stays).set({ possiblyCancelled: true }).where(eq(stays.id, g.stayId));
    expect(await kindsFor(g.spaceId, at('2027-05-03T16:15:00Z'))).toEqual([]);
  });

  it('skips a closed space', async () => {
    const g = await seedGuestUnit(testDb.db, { now: NOW, checkInInDays: 0, nights: 3 });
    await testDb.db.update(spaces).set({ closedAt: NOW }).where(eq(spaces.id, g.spaceId));
    expect(await kindsFor(g.spaceId, at('2027-05-03T16:15:00Z'))).toEqual([]);
  });
});
