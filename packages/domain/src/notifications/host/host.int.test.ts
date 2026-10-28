import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../../db/schema/accounts';
import { handoffMessages } from '../../db/schema/handoff';
import { hostNotificationDeliveries, hostPushSubscriptions } from '../../db/schema/notifications';
import { properties } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import type { HandoffUrgency } from '../../handoff/vocabulary';
import { createMemoryMailer } from '../../mail';
import {
  createTestDatabase,
  type SeededGuestUnit,
  seedGuestUnit,
  type TestDatabase,
} from '../../testing';
import { createMemoryPushSender } from '../guest/push';
import { deliverHostDigest, deliverHostMessageNotification, type HostNotifyDeps } from './deliver';
import { dueDigests } from './digests';
import { countHostPushSubscriptions, saveHostPushSubscription } from './push';
import { getHostNotificationSettings, saveHostNotificationSettings } from './settings';
import { HOST_CHANNELS } from './vocabulary';

let testDb: TestDatabase;
const ORIGIN = 'https://host.fetivi.test';
/** 09:05 in Zagreb (UTC+2); the 09:00 slot is 07:00Z. */
const NOW = new Date('2027-05-03T07:05:00Z');
const SLOT = '2027-05-03T07:00:00.000Z';
const BEFORE_SLOT = new Date('2027-05-03T06:00:00Z');
const AFTER_SLOT = new Date('2027-05-03T07:02:00Z');
const GUEST_TEXT = 'Secret guest words';

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

function deps(over: Partial<HostNotifyDeps> = {}) {
  const mailer = createMemoryMailer();
  const push = createMemoryPushSender();
  const d: HostNotifyDeps = {
    db: testDb.db,
    mailer,
    push,
    webOrigin: ORIGIN,
    now: () => NOW,
    ...over,
  };
  return { mailer, push, deps: d };
}

async function host(options: { mode?: 'immediate' | 'digest'; subscribed?: boolean } = {}) {
  const g = await seedGuestUnit(testDb.db, { now: NOW });
  if (options.mode) {
    await saveHostNotificationSettings(
      testDb.db,
      g.hostId,
      { mode: options.mode, digestTimes: ['09:00', '14:00', '19:00'] },
      NOW,
    );
  }
  const endpoint = `https://web.push.apple.com/${randomBytes(6).toString('hex')}`;
  if (options.subscribed !== false) {
    await saveHostPushSubscription(testDb.db, g.hostId, { endpoint, p256dh: 'p', auth: 'a' }, NOW);
  }
  return { ...g, endpoint };
}

/** Another unit (with its own property) owned by `hostId`. */
async function unitOf(hostId: string): Promise<SeededGuestUnit> {
  const g = await seedGuestUnit(testDb.db, { now: NOW });
  await testDb.db.update(properties).set({ hostId }).where(eq(properties.id, g.propertyId));
  return { ...g, hostId };
}

/** A Host message on the unit, in a fresh space of its Stay. */
async function message(
  g: SeededGuestUnit,
  options: { urgency?: HandoffUrgency; sentAt?: Date; readAt?: Date } = {},
): Promise<string> {
  const [space] = await testDb.db
    .insert(spaces)
    .values({
      stayId: g.stayId,
      tokenHash: randomBytes(16).toString('hex'),
      language: 'en',
      closedAt: g.stay.activeUntil,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  if (!space) throw new Error('no space');
  const [row] = await testDb.db
    .insert(handoffMessages)
    .values({
      spaceId: space.id,
      stayId: g.stayId,
      unitId: g.unitId,
      reason: 'problem',
      urgency: options.urgency ?? 'normal',
      guestLanguage: 'en',
      text: GUEST_TEXT,
      hostLanguage: 'en',
      translationState: 'not_needed',
      sentAt: options.sentAt ?? BEFORE_SLOT,
      readAt: options.readAt ?? null,
    })
    .returning();
  if (!row) throw new Error('no message');
  return row.id;
}

const claimOf = async (id: string) => {
  const [row] = await testDb.db
    .select({ key: handoffMessages.hostNotificationKey })
    .from(handoffMessages)
    .where(eq(handoffMessages.id, id));
  return row?.key ?? null;
};

const dueFor = async (hostIds: string[]) =>
  (await dueDigests(testDb.db, NOW)).filter((d) => hostIds.includes(d.hostId));

describe('immediate host notification', () => {
  it('emails and pushes the host once, linking to the message', async () => {
    const g = await host();
    const id = await message(g);
    const { mailer, push, deps: d } = deps();

    const first = await deliverHostMessageNotification(d, id);
    expect(first).toEqual({ outcome: 'notified', channels: { email: 'sent', push: 'sent' } });
    await deliverHostMessageNotification(d, id);
    await Promise.all([1, 2, 3].map(() => deliverHostMessageNotification(d, id)));

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: expect.stringMatching(/^host-/),
      subject: `New guest message: ${g.unitName}`,
      idempotencyKey: `handoff:${id}:host:email`,
    });
    expect(mailer.sent[0]?.text).toContain(`${ORIGIN}/inbox?message=${id}`);
    expect(mailer.sent[0]?.text).not.toContain(GUEST_TEXT);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({
      sub: { endpoint: g.endpoint },
      message: { url: `/inbox?message=${id}` },
      urgency: 'normal',
    });
    expect(await claimOf(id)).toBe(`handoff:${id}:host`);
  });

  it('skips push without a subscription or a sender; email still goes', async () => {
    const g = await host({ subscribed: false });
    const id = await message(g);
    const { mailer, deps: d } = deps();
    expect(await deliverHostMessageNotification(d, id)).toEqual({
      outcome: 'notified',
      channels: { email: 'sent', push: 'skipped' },
    });
    const other = await host();
    const { deps: noPush } = deps({ push: null, mailer });
    const second = await deliverHostMessageNotification(noPush, await message(other));
    expect(second.channels).toEqual({ email: 'sent', push: 'skipped' });
    expect(mailer.sent).toHaveLength(2);
  });

  it('skips a message the host already read, and a suspended host', async () => {
    const g = await host();
    const { mailer, deps: d } = deps();
    const read = await message(g, { readAt: BEFORE_SLOT });
    expect((await deliverHostMessageNotification(d, read)).outcome).toBe('skipped');
    const suspended = await host();
    await testDb.db
      .update(accounts)
      .set({ suspendedAt: NOW })
      .where(eq(accounts.id, suspended.hostId));
    expect((await deliverHostMessageNotification(d, await message(suspended))).outcome).toBe(
      'skipped',
    );
    expect(mailer.sent).toEqual([]);
  });

  it('deletes a gone push subscription and still emails', async () => {
    const g = await host();
    const { mailer, push, deps: d } = deps();
    push.gone.add(g.endpoint);
    const result = await deliverHostMessageNotification(d, await message(g));
    expect(result.channels).toEqual({ email: 'sent', push: 'sent' });
    expect(mailer.sent).toHaveLength(1);
    expect(await countHostPushSubscriptions(testDb.db, g.hostId)).toBe(0);
  });
});

describe('urgent bypass', () => {
  it('an urgent message notifies a Digest host at once, with high push urgency', async () => {
    const g = await host({ mode: 'digest' });
    const id = await message(g, { urgency: 'urgent' });
    const { mailer, push, deps: d } = deps();
    expect((await deliverHostMessageNotification(d, id)).outcome).toBe('notified');
    expect(mailer.sent[0]?.subject).toBe(`Urgent guest message: ${g.unitName}`);
    expect(push.sent[0]?.urgency).toBe('high');
  });

  it('a normal message is deferred for a Digest host and stays unclaimed', async () => {
    const g = await host({ mode: 'digest' });
    const id = await message(g);
    const { mailer, push, deps: d } = deps();
    expect((await deliverHostMessageNotification(d, id)).outcome).toBe('deferred');
    expect(mailer.sent).toEqual([]);
    expect(push.sent).toEqual([]);
    expect(await claimOf(id)).toBeNull();
  });
});

describe('digests', () => {
  it('groups each host’s pending messages into one email per slot', async () => {
    const a = await host({ mode: 'digest' });
    const a2 = await unitOf(a.hostId);
    const b = await host({ mode: 'digest' });
    const a1 = await message(a, { sentAt: new Date('2027-05-03T05:00:00Z') });
    const a2m = await message(a2);
    const late = await message(a, { sentAt: AFTER_SLOT });
    const read = await message(a, { readAt: BEFORE_SLOT });
    const urgent = await message(a, { urgency: 'urgent' });
    const b1 = await message(b);
    const { mailer, push, deps: d } = deps();
    await deliverHostMessageNotification(d, urgent);
    mailer.sent.length = 0;
    push.sent.length = 0;

    const due = await dueFor([a.hostId, b.hostId]);
    expect(due).toHaveLength(2);
    expect(due).toContainEqual({ hostId: a.hostId, slot: SLOT });
    expect(due).toContainEqual({ hostId: b.hostId, slot: SLOT });

    const resultA = await deliverHostDigest(d, { hostId: a.hostId, slot: SLOT });
    expect(resultA).toEqual({
      outcome: 'notified',
      count: 2,
      channels: { email: 'sent', push: 'sent' },
    });
    await deliverHostDigest(d, { hostId: b.hostId, slot: SLOT });

    expect(mailer.sent.map((m) => m.subject)).toEqual([
      '2 new guest messages',
      '1 new guest message',
    ]);
    const textA = mailer.sent[0]?.text ?? '';
    expect(textA.indexOf(a.unitName)).toBeLessThan(textA.indexOf(a2.unitName));
    expect(textA).toContain(`${ORIGIN}/inbox`);
    expect(textA).not.toContain(GUEST_TEXT);
    expect(mailer.sent[0]?.idempotencyKey).toBe(`host:${a.hostId}:digest:${SLOT}:email`);
    expect(push.sent.map((p) => p.message.title)).toEqual([
      '2 new guest messages',
      '1 new guest message',
    ]);
    expect(push.sent[0]?.urgency).toBe('normal');

    const key = `host:${a.hostId}:digest:${SLOT}`;
    expect(await claimOf(a1)).toBe(key);
    expect(await claimOf(a2m)).toBe(key);
    expect(await claimOf(b1)).toBe(`host:${b.hostId}:digest:${SLOT}`);
    expect(await claimOf(late)).toBeNull();
    expect(await claimOf(read)).toBeNull();
    expect(await claimOf(urgent)).toBe(`handoff:${urgent}:host`);

    // A rerun of the slot sends nothing; the late message waits for the next slot.
    expect((await deliverHostDigest(d, { hostId: a.hostId, slot: SLOT })).channels).toEqual({
      email: 'already_sent',
      push: 'already_sent',
    });
    expect(mailer.sent).toHaveLength(2);
    expect(await dueFor([a.hostId, b.hostId])).toEqual([]);
    const next = await dueDigests(testDb.db, new Date('2027-05-03T12:00:00Z'));
    expect(next.filter((x) => x.hostId === a.hostId)).toEqual([
      { hostId: a.hostId, slot: '2027-05-03T12:00:00.000Z' },
    ]);
  });

  it('duplicate runs of one slot send one email with one member list', async () => {
    const g = await host({ mode: 'digest' });
    await message(g);
    await message(g, { sentAt: new Date('2027-05-03T05:30:00Z') });
    const { mailer, push, deps: d } = deps();
    await Promise.all([1, 2, 3].map(() => deliverHostDigest(d, { hostId: g.hostId, slot: SLOT })));
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toBe('2 new guest messages');
    expect(push.sent).toHaveLength(1);
  });

  it('a retry composes the same email even after the host read a listed message', async () => {
    const g = await host({ mode: 'digest' });
    const id = await message(g);
    const failing = createMemoryMailer();
    let fail = true;
    const flaky = {
      async send(m: Parameters<typeof failing.send>[0]) {
        if (fail) throw new Error('provider down');
        await failing.send(m);
      },
    };
    const { deps: d } = deps({ mailer: flaky });
    await expect(deliverHostDigest(d, { hostId: g.hostId, slot: SLOT })).rejects.toThrow();
    await testDb.db.update(handoffMessages).set({ readAt: NOW }).where(eq(handoffMessages.id, id));
    fail = false;
    expect((await deliverHostDigest(d, { hostId: g.hostId, slot: SLOT })).count).toBe(1);
    expect(failing.sent).toHaveLength(1);
  });

  it('the immediate job after a digest claimed the message is skipped', async () => {
    const g = await host({ mode: 'digest' });
    const id = await message(g);
    const { mailer, deps: d } = deps();
    await deliverHostDigest(d, { hostId: g.hostId, slot: SLOT });
    await saveHostNotificationSettings(
      testDb.db,
      g.hostId,
      { mode: 'immediate', digestTimes: ['09:00'] },
      NOW,
    );
    expect((await deliverHostMessageNotification(d, id)).outcome).toBe('skipped');
    expect(mailer.sent).toHaveLength(1);
  });

  it('no pending message: not due, and a digest sends nothing', async () => {
    const g = await host({ mode: 'digest' });
    await message(g, { readAt: BEFORE_SLOT });
    const { mailer, deps: d } = deps();
    expect(await dueFor([g.hostId])).toEqual([]);
    expect(await deliverHostDigest(d, { hostId: g.hostId, slot: SLOT })).toEqual({
      outcome: 'skipped',
      count: 0,
      channels: { email: 'skipped', push: 'skipped' },
    });
    expect(mailer.sent).toEqual([]);
    const rows = await testDb.db
      .select()
      .from(hostNotificationDeliveries)
      .where(eq(hostNotificationDeliveries.hostId, g.hostId));
    expect(rows).toEqual([]);
  });

  it('Immediate hosts and suspended hosts get no digest', async () => {
    const immediate = await host({ mode: 'immediate' });
    await message(immediate);
    const suspended = await host({ mode: 'digest' });
    await message(suspended);
    await testDb.db
      .update(accounts)
      .set({ suspendedAt: NOW })
      .where(eq(accounts.id, suspended.hostId));
    expect(await dueFor([immediate.hostId])).toEqual([]);
    const { mailer, deps: d } = deps();
    expect((await deliverHostDigest(d, { hostId: suspended.hostId, slot: SLOT })).outcome).toBe(
      'skipped',
    );
    expect(mailer.sent).toEqual([]);
  });
});

describe('settings and subscriptions', () => {
  it('defaults without a row, then the saved values', async () => {
    const g = await host();
    expect(await getHostNotificationSettings(testDb.db, g.hostId)).toEqual({
      mode: 'immediate',
      digestTimes: ['09:00', '14:00', '19:00'],
      timezone: 'Europe/Zagreb',
    });
    await saveHostNotificationSettings(
      testDb.db,
      g.hostId,
      { mode: 'digest', digestTimes: ['08:30', '20:00'] },
      NOW,
    );
    expect(await getHostNotificationSettings(testDb.db, g.hostId)).toMatchObject({
      mode: 'digest',
      digestTimes: ['08:30', '20:00'],
    });
  });

  it('reads the timezone of the oldest property', async () => {
    const g = await host();
    const newer = await unitOf(g.hostId);
    await testDb.db
      .update(properties)
      .set({ timezone: 'Europe/London', createdAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(properties.id, newer.propertyId));
    expect((await getHostNotificationSettings(testDb.db, g.hostId)).timezone).toBe('Europe/London');
    const [account] = await testDb.db
      .insert(accounts)
      .values({
        email: `nohouse-${randomBytes(4).toString('hex')}@example.test`,
        passwordHash: 'x',
        role: 'host',
      })
      .returning();
    if (!account) throw new Error('no account');
    expect((await getHostNotificationSettings(testDb.db, account.id)).timezone).toBe(
      'Europe/Zagreb',
    );
  });

  it('an endpoint moves to the account that subscribed last', async () => {
    const a = await host();
    const b = await host({ subscribed: false });
    await saveHostPushSubscription(
      testDb.db,
      b.hostId,
      { endpoint: a.endpoint, p256dh: 'p2', auth: 'a2' },
      NOW,
    );
    const rows = await testDb.db
      .select()
      .from(hostPushSubscriptions)
      .where(inArray(hostPushSubscriptions.accountId, [a.hostId, b.hostId]));
    expect(rows.map((r) => r.accountId)).toEqual([b.hostId]);
  });

  it('has no SMS or WhatsApp channel', () => {
    expect(HOST_CHANNELS).toEqual(['email', 'push']);
  });
});

describe('in the host language (ticket 53)', () => {
  it('a Croatian host gets the message email, the push and the digest in Croatian', async () => {
    const g = await host({ mode: 'digest' });
    await testDb.db.update(accounts).set({ uiLanguage: 'hr' }).where(eq(accounts.id, g.hostId));
    const urgent = await message(g, { urgency: 'urgent' });
    await message(g);
    await message(g);
    const { mailer, push, deps: d } = deps();

    await deliverHostMessageNotification(d, urgent);
    expect(mailer.sent[0]?.subject).toBe(`Hitna poruka gosta: ${g.unitName}`);
    expect(mailer.sent[0]?.text).toContain('Razlog: Problem');
    expect(push.sent[0]?.message.title).toBe('Hitna poruka gosta');

    await deliverHostDigest(d, { hostId: g.hostId, slot: SLOT });
    expect(mailer.sent[1]?.subject).toBe('2 nove poruke gosta');
    expect(mailer.sent[1]?.text).toContain('Čekaju vas 2 poruke gosta:');
  });

  it('a legacy German host language falls back to English', async () => {
    const g = await host();
    await testDb.db.update(accounts).set({ uiLanguage: 'de' }).where(eq(accounts.id, g.hostId));
    const id = await message(g);
    const { mailer, deps: d } = deps();
    await deliverHostMessageNotification(d, id);
    expect(mailer.sent[0]?.subject).toBe(`New guest message: ${g.unitName}`);
  });
});
