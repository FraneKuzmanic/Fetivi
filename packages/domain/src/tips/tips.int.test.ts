import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateAboutMe } from '../about-me/store';
import { seedTrogir } from '../catalog/seed/trogir';
import { getOrCreateConversation } from '../conversations/store';
import { messages } from '../db/schema/conversations';
import { guestNotificationDeliveries } from '../db/schema/notifications';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { GuestProjection } from '../projection/projection';
import {
  createTestDatabase,
  fixedWeatherSource,
  noopQueue,
  publishCatalog,
  type SeededGuestUnit,
  sampleWeatherReport,
  seedGuestUnit,
  type TestDatabase,
  unavailableWeatherSource,
} from '../testing';
import { fromLocalDateTime } from '../time';
import { type DueTipSpace, dueTipSpaces } from './due';
import { gatherTipInput, pickDailyTip } from './pick';
import { unsubscribeTips } from './unsubscribe';

const ZONE = 'Europe/Zagreb';
/** Registered on 8 July; Stay 9 July (check-in) to 13 July (checkout). */
const REGISTERED = new Date('2027-07-08T08:00:00Z');
const at = (local: string) => fromLocalDateTime(local, ZONE);
const SEND = at('2027-07-10T17:00');
const HOUR = 3_600_000;

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { destinationId } = await seedTrogir(testDb.db, noopQueue, REGISTERED);
  await publishCatalog(testDb.db, destinationId);
});

afterAll(async () => {
  await testDb?.drop();
});

async function guest(
  options: { location?: { x: number; y: number } | null } = {},
): Promise<SeededGuestUnit> {
  return seedGuestUnit(testDb.db, {
    now: REGISTERED,
    checkInInDays: 1,
    nights: 4,
    ...options,
  });
}

async function chatted(spaceId: string, ago: number, role: 'user' | 'assistant' = 'user') {
  const conversation = await getOrCreateConversation(
    testDb.db,
    spaceId,
    { systemPrompt: 'test', projection: {} as GuestProjection },
    REGISTERED,
  );
  const existing = await testDb.db
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.conversationId, conversation.id));
  await testDb.db.insert(messages).values({
    id: randomUUID(),
    conversationId: conversation.id,
    seq: existing.length + 1,
    role,
    parts: [],
    createdAt: new Date(SEND.getTime() - ago),
  });
}

async function optIn(spaceId: string, verified: boolean) {
  await testDb.db
    .update(spaces)
    .set({
      email: `guest-${spaceId.slice(0, 8)}@example.test`,
      emailOptInAt: REGISTERED,
      emailVerifiedAt: verified ? REGISTERED : null,
      tipsEmailOptInAt: REGISTERED,
    })
    .where(eq(spaces.id, spaceId));
}

const dueIds = async (now: Date) => (await dueTipSpaces(testDb.db, now)).map((d) => d.spaceId);

describe('dueTipSpaces', () => {
  it('is due from 17:00 to 21:00 property time, about tomorrow', async () => {
    const g = await guest();
    await chatted(g.spaceId, HOUR);
    expect(await dueIds(at('2027-07-10T16:59'))).not.toContain(g.spaceId);
    expect(await dueIds(at('2027-07-10T20:59'))).toContain(g.spaceId);
    expect(await dueIds(at('2027-07-10T21:00'))).not.toContain(g.spaceId);
    const due = (await dueTipSpaces(testDb.db, SEND)).find((d) => d.spaceId === g.spaceId);
    expect(due).toMatchObject({
      sendDate: '2027-07-10',
      tomorrow: '2027-07-11',
      fullDay: true,
      language: 'en',
      zone: ZONE,
      stayId: g.stayId,
      propertyId: g.propertyId,
    });
  });

  it('needs a guest chat message within 48 hours', async () => {
    const recent = await guest();
    await chatted(recent.spaceId, 47 * HOUR);
    const idle = await guest();
    await chatted(idle.spaceId, 49 * HOUR);
    const assistantOnly = await guest();
    await chatted(assistantOnly.spaceId, HOUR, 'assistant');
    const ids = await dueIds(SEND);
    expect(ids).toContain(recent.spaceId);
    expect(ids).not.toContain(idle.spaceId);
    expect(ids).not.toContain(assistantOnly.spaceId);
  });

  it('waives the 48-hour rule for a verified tip-email opt-in', async () => {
    const verified = await guest();
    await optIn(verified.spaceId, true);
    const unverified = await guest();
    await optIn(unverified.spaceId, false);
    const ids = await dueIds(SEND);
    expect(ids).toContain(verified.spaceId);
    expect(ids).not.toContain(unverified.spaceId);
  });

  it('sends from check-in day to the day before checkout; checkout eve is not a full day', async () => {
    const g = await guest();
    await optIn(g.spaceId, true);
    expect(await dueIds(at('2027-07-08T17:00'))).not.toContain(g.spaceId);
    expect(await dueIds(at('2027-07-09T17:00'))).toContain(g.spaceId);
    const last = (await dueTipSpaces(testDb.db, at('2027-07-12T17:00'))).find(
      (d) => d.spaceId === g.spaceId,
    );
    expect(last).toMatchObject({ tomorrow: '2027-07-13', fullDay: false });
    expect(await dueIds(at('2027-07-13T17:00'))).not.toContain(g.spaceId);
  });

  it('skips possibly cancelled Stays, closed spaces and properties outside a destination', async () => {
    const cancelled = await guest();
    await optIn(cancelled.spaceId, true);
    await testDb.db
      .update(stays)
      .set({ possiblyCancelled: true })
      .where(eq(stays.id, cancelled.stayId));
    const closed = await guest();
    await optIn(closed.spaceId, true);
    await testDb.db
      .update(spaces)
      .set({ closedAt: REGISTERED })
      .where(eq(spaces.id, closed.spaceId));
    const zagreb = await guest({ location: { x: 15.9819, y: 45.815 } });
    await optIn(zagreb.spaceId, true);
    const nowhere = await guest({ location: null });
    await optIn(nowhere.spaceId, true);
    const ids = await dueIds(SEND);
    for (const g of [cancelled, closed, zagreb, nowhere]) expect(ids).not.toContain(g.spaceId);
  });

  it("skips a space that already has today's tip in the ledger", async () => {
    const g = await guest();
    await chatted(g.spaceId, HOUR);
    await testDb.db.insert(guestNotificationDeliveries).values({
      key: `space:${g.spaceId}:daily_tip:2027-07-10`,
      channel: 'inbox',
      kind: 'daily_tip',
      spaceId: g.spaceId,
      sentAt: SEND,
    });
    expect(await dueIds(SEND)).not.toContain(g.spaceId);
    expect(await dueIds(at('2027-07-11T17:00'))).toContain(g.spaceId);
  });
});

describe('gatherTipInput and pickDailyTip on the Trogir catalog', () => {
  async function dueFor(g: SeededGuestUnit): Promise<DueTipSpace> {
    await chatted(g.spaceId, HOUR);
    const due = (await dueTipSpaces(testDb.db, SEND)).find((d) => d.spaceId === g.spaceId);
    if (!due) throw new Error('not due');
    return due;
  }

  it('suggests the rainy-day place when showers are forecast', async () => {
    const due = await dueFor(await guest());
    const weather = fixedWeatherSource(sampleWeatherReport('2027-07-10'));
    const input = await gatherTipInput(testDb.db, weather, due, SEND);
    expect(input.tomorrowSky).toBe('showers');
    expect(pickDailyTip(input)).toMatchObject({
      rule: 'rain',
      date: '2027-07-11',
      kind: 'place',
      title: '[en] Cathedral of St Lawrence',
    });
  });

  it('suggests the festival to a guest who likes sights when the weather is unknown', async () => {
    const g = await guest();
    await updateAboutMe(testDb.db, g.spaceId, { addInterests: ['sights'] }, REGISTERED);
    const due = await dueFor(g);
    const input = await gatherTipInput(testDb.db, unavailableWeatherSource(), due, SEND);
    expect(input).toMatchObject({ tomorrowSky: null, weather: 'unavailable', rainyPlaces: [] });
    expect(pickDailyTip(input)).toMatchObject({
      rule: 'event',
      kind: 'event',
      title: '[en] Trogir Summer of Culture',
      venueName: 'Kamerlengo Fortress',
      startsAt: '2027-07-01T20:00',
    });
  });

  it('suggests the best-ranked place for an empty day without searching events', async () => {
    const due = await dueFor(await guest());
    const input = await gatherTipInput(testDb.db, unavailableWeatherSource(), due, SEND);
    expect(input.events).toEqual([]);
    const tip = pickDailyTip(input);
    expect(tip?.rule).toBe('gap');
    expect(tip?.recordId).toBe(input.places[0]?.id);
  });
});

describe('unsubscribeTips', () => {
  it('clears the tip opt-in, is idempotent, and ignores an unknown space', async () => {
    const g = await guest();
    await optIn(g.spaceId, true);
    await unsubscribeTips(testDb.db, g.spaceId, SEND);
    await unsubscribeTips(testDb.db, g.spaceId, SEND);
    await unsubscribeTips(testDb.db, randomUUID(), SEND);
    const [row] = await testDb.db
      .select({ tips: spaces.tipsEmailOptInAt, email: spaces.email })
      .from(spaces)
      .where(eq(spaces.id, g.spaceId));
    expect(row?.tips).toBeNull();
    expect(row?.email).not.toBeNull();
  });
});
