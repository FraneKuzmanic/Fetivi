import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTrogir } from '../catalog/seed/trogir';
import { appendInboxMessage, appendTurn, getOrCreateConversation } from '../conversations/store';
import { rejectCurationItem } from '../curation/review';
import { catalogRecords } from '../db/schema/catalog';
import { conversations, type MessagePart } from '../db/schema/conversations';
import { curationItems } from '../db/schema/curation';
import { answerFeedback } from '../db/schema/feedback';
import { spaces } from '../db/schema/spaces';
import { loadGuestProjection } from '../projection/load';
import { registerStay } from '../stays/store';
import {
  createTestDatabase,
  noopQueue,
  publishCatalog,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import { hashToken, newToken } from '../tokens';
import { adminAnswerStats, unitAnswerStats } from './stats';
import { listConversationFeedback, setAnswerFeedback } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = 86_400_000;
let places: { id: string; destinationId: string }[] = [];

beforeAll(async () => {
  testDb = await createTestDatabase();
  const { destinationId } = await seedTrogir(testDb.db, noopQueue, NOW);
  await publishCatalog(testDb.db, destinationId);
  places = await testDb.db
    .select({ id: catalogRecords.id, destinationId: catalogRecords.destinationId })
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.destinationId, destinationId),
        inArray(catalogRecords.kind, ['place', 'day_trip']),
      ),
    )
    .orderBy(catalogRecords.title);
  expect(places.length).toBeGreaterThanOrEqual(5);
});

afterAll(async () => {
  await testDb?.drop();
});

const text = (t: string): MessagePart => ({ type: 'text', text: t });
const searchPart = (
  results: { id: string; hostAdded?: boolean }[],
  category?: string,
): MessagePart => ({
  type: 'tool-search_places',
  toolCallId: randomUUID(),
  state: 'output-available',
  input: category ? { category } : { query: 'beach' },
  output: { date: '2026-10-19', openAt: null, results },
});

async function conversationFor(spaceId: string, unitId: string, stayId: string) {
  const projection = await loadGuestProjection(testDb.db, {
    unitId,
    stayId,
    language: 'en',
    now: NOW,
  });
  const c = await getOrCreateConversation(
    testDb.db,
    spaceId,
    { systemPrompt: 's', projection },
    NOW,
  );
  return { conversationId: c.id, projection };
}

/** Stores one user question and one Fetivi answer; returns the answer's id. */
async function turn(
  conv: Awaited<ReturnType<typeof conversationFor>>,
  answerParts: MessagePart[],
  question = 'hi',
): Promise<string> {
  const id = randomUUID();
  await appendTurn(testDb.db, {
    conversationId: conv.conversationId,
    messages: [
      { id: randomUUID(), role: 'user', parts: [text(question)] },
      { id, role: 'assistant', parts: answerParts },
    ],
    projection: conv.projection,
    situationNote: null,
    aboutMeNote: null,
    now: NOW,
  });
  return id;
}

async function seedChat(options: Parameters<typeof seedGuestUnit>[1] = { now: NOW }) {
  const s = await seedGuestUnit(testDb.db, options);
  const conv = await conversationFor(s.spaceId, s.unitId, s.stayId);
  return { ...s, conv };
}

async function addSpace(stayId: string) {
  const [space] = await testDb.db
    .insert(spaces)
    .values({
      stayId,
      tokenHash: hashToken(newToken()),
      language: 'en',
      closedAt: new Date(NOW.getTime() + 30 * DAY),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  if (!space) throw new Error('no space');
  return space.id;
}

const rowOf = async (messageId: string) => {
  const [row] = await testDb.db
    .select()
    .from(answerFeedback)
    .where(eq(answerFeedback.messageId, messageId));
  if (!row) throw new Error('no feedback row');
  return row;
};

const place = (i: number) => {
  const p = places[i];
  if (!p) throw new Error('no place');
  return p;
};

const flagsOf = (recordId: string) =>
  testDb.db
    .select()
    .from(curationItems)
    .where(and(eq(curationItems.recordId, recordId), eq(curationItems.kind, 'guest_flagged')));

const rate = (
  spaceId: string,
  messageId: string,
  thumb: 'up' | 'down' | null,
  reason: 'wrong' | 'outdated' | 'not_helpful' | null = null,
) => setAnswerFeedback(testDb.db, { spaceId, messageId, thumb, reason, now: NOW });

describe('recording answers', () => {
  it('writes one row per assistant answer and recomputes its topics on update', async () => {
    const { conv, stayId } = await seedChat();
    const id = await turn(conv, [searchPart([{ id: place(0).id }], 'beach'), text('Try this')]);
    const [row] = await testDb.db
      .select()
      .from(answerFeedback)
      .where(eq(answerFeedback.conversationId, conv.conversationId));
    expect(row).toMatchObject({
      messageId: id,
      stayId,
      conversationId: conv.conversationId,
      topics: ['beach'],
      thumb: null,
      reason: null,
      flaggedAt: null,
    });

    await appendTurn(testDb.db, {
      conversationId: conv.conversationId,
      messages: [],
      updated: [
        {
          id,
          parts: [
            searchPart([{ id: place(0).id }], 'beach'),
            {
              type: 'tool-get_weather',
              toolCallId: 'w',
              state: 'output-available',
              input: {},
              output: {},
            },
            text('Sunny'),
          ],
        },
      ],
      projection: conv.projection,
      situationNote: null,
      aboutMeNote: null,
      now: NOW,
    });
    const rows = await testDb.db
      .select()
      .from(answerFeedback)
      .where(eq(answerFeedback.conversationId, conv.conversationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topics).toEqual(['beach', 'weather']);
  });

  it('records general for an answer with no topical tool', async () => {
    const { conv } = await seedChat();
    const id = await turn(conv, [text('Hello!')]);
    expect((await rowOf(id)).topics).toEqual(['general']);
  });
});

describe('setAnswerFeedback', () => {
  it('never stores message text (AC 5)', async () => {
    const { conv, spaceId } = await seedChat();
    const marker = randomUUID();
    const id = await turn(
      conv,
      [searchPart([{ id: place(1).id }]), text(`Answer ${marker}`)],
      `Question ${marker}`,
    );
    await rate(spaceId, id, 'down', 'not_helpful');
    await rate(spaceId, id, 'down', 'outdated');
    const fb = await testDb.db.select().from(answerFeedback);
    const items = await testDb.db.select().from(curationItems);
    expect(JSON.stringify(fb)).not.toContain(marker);
    expect(JSON.stringify(items)).not.toContain(marker);

    const { rows } = await testDb.db.execute<{
      column_name: string;
      data_type: string;
      udt_name: string;
    }>(
      sql`select column_name, data_type, udt_name from information_schema.columns where table_name = 'answer_feedback'`,
    );
    const textual = rows.filter((c) =>
      ['text', 'character varying', 'jsonb', 'json'].includes(c.data_type),
    );
    expect(textual.map((c) => c.column_name)).toEqual(['message_id']);
  });

  it('rejects a reason without a thumbs down', async () => {
    const { conv, spaceId } = await seedChat();
    const id = await turn(conv, [text('Hi')]);
    for (const thumb of ['up', null] as const) {
      await expect(rate(spaceId, id, thumb, 'wrong')).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
  });

  it("treats another space's, a user's and an inbox message as missing", async () => {
    const a = await seedChat();
    const b = await seedChat();
    const answer = await turn(a.conv, [text('Hi')]);
    await expect(rate(b.spaceId, answer, 'up')).rejects.toMatchObject({ code: 'not-found' });

    const userId = randomUUID();
    await appendTurn(testDb.db, {
      conversationId: a.conv.conversationId,
      messages: [{ id: userId, role: 'user', parts: [text('q')] }],
      projection: a.conv.projection,
      situationNote: null,
      aboutMeNote: null,
      now: NOW,
    });
    await expect(rate(a.spaceId, userId, 'up')).rejects.toMatchObject({ code: 'not-found' });

    const inboxId = randomUUID();
    await testDb.db.transaction((tx) =>
      appendInboxMessage(tx, {
        conversationId: a.conv.conversationId,
        id: inboxId,
        parts: [text('host reply')],
        now: NOW,
      }),
    );
    await expect(rate(a.spaceId, inboxId, 'up')).rejects.toMatchObject({ code: 'not-found' });
    await expect(rate(a.spaceId, randomUUID(), 'up')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('flags catalog places once per answer and bumps open items (AC 2)', async () => {
    const { conv, spaceId, hostId } = await seedChat();
    const [p1, p2] = [place(2), place(3)];
    const first = await turn(conv, [
      searchPart([{ id: p1.id }, { id: p2.id }, { id: randomUUID(), hostAdded: true }]),
      text('These'),
    ]);
    expect(await rate(spaceId, first, 'down', 'outdated')).toEqual({
      thumb: 'down',
      reason: 'outdated',
    });
    for (const p of [p1, p2]) {
      const items = await flagsOf(p.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        status: 'open',
        destinationId: p.destinationId,
        payload: { kind: 'guest_flagged', reason: 'outdated', count: 1 },
      });
    }
    expect((await rowOf(first)).flaggedAt).not.toBeNull();

    // A second answer showing p1 bumps its open item.
    const second = await turn(conv, [
      {
        type: 'tool-get_place',
        toolCallId: 'g',
        state: 'output-available',
        input: {},
        output: { place: { id: p1.id, category: 'beach', hostAdded: false } },
      },
      text('This one'),
    ]);
    await rate(spaceId, second, 'down', 'outdated');
    const bumped = await flagsOf(p1.id);
    expect(bumped).toHaveLength(1);
    expect(bumped[0]?.payload).toMatchObject({ count: 2 });

    // Changing the reason on an answer already flagged flags nothing new.
    await rate(spaceId, first, 'down', 'wrong');
    expect(await flagsOf(p1.id)).toHaveLength(1);
    expect(await flagsOf(p2.id)).toHaveLength(1);

    // After review, a new flag opens a new item.
    await rejectCurationItem(testDb.db, bumped[0]?.id ?? '', hostId, NOW);
    const third = await turn(conv, [searchPart([{ id: p1.id }]), text('Again')]);
    await rate(spaceId, third, 'down', 'outdated');
    const after = await flagsOf(p1.id);
    expect(after).toHaveLength(2);
    expect(after.filter((i) => i.status === 'open')).toHaveLength(1);
  });

  it('does not flag on not helpful, or when the answer showed no catalog places', async () => {
    const { conv, spaceId } = await seedChat();
    const p = place(4);
    const notHelpful = await turn(conv, [searchPart([{ id: p.id }]), text('x')]);
    await rate(spaceId, notHelpful, 'down', 'not_helpful');
    expect(await flagsOf(p.id)).toHaveLength(0);

    const before = await testDb.db.select().from(curationItems);
    const none = await turn(conv, [text('No places here')]);
    await rate(spaceId, none, 'down', 'wrong');
    const onlyHostAdded = await turn(conv, [
      searchPart([{ id: randomUUID(), hostAdded: true }]),
      text('x'),
    ]);
    await rate(spaceId, onlyHostAdded, 'down', 'outdated');
    expect(await testDb.db.select().from(curationItems)).toHaveLength(before.length);
    expect((await rowOf(onlyHostAdded)).flaggedAt).not.toBeNull();
  });

  it('clearing keeps the row and drops it from the history map', async () => {
    const { conv, spaceId } = await seedChat();
    const id = await turn(conv, [text('Hi')]);
    await rate(spaceId, id, 'up');
    expect(await listConversationFeedback(testDb.db, conv.conversationId)).toEqual({
      [id]: { thumb: 'up', reason: null },
    });
    await rate(spaceId, id, null);
    expect(await listConversationFeedback(testDb.db, conv.conversationId)).toEqual({});
    expect(await rowOf(id)).toMatchObject({ thumb: null, topics: ['general'] });
  });

  it('creates the row on demand for an answer stored before ticket 43', async () => {
    const { conv, spaceId } = await seedChat();
    const id = await turn(conv, [searchPart([], 'nature'), text('Hi')]);
    await testDb.db.delete(answerFeedback).where(eq(answerFeedback.messageId, id));
    await rate(spaceId, id, 'up');
    expect(await rowOf(id)).toMatchObject({ thumb: 'up', topics: ['nature'] });
  });
});

describe('stats', () => {
  it('counts per unit and across units, and survives conversation deletion (AC 3, AC 4)', async () => {
    // Unit A: a Stay started 5 days ago with two phones, a started Stay without chats, a future Stay.
    const a = await seedGuestUnit(testDb.db, {
      now: new Date(NOW.getTime() - 5 * DAY),
      checkInInDays: 0,
      nights: 3,
    });
    const quiet = await registerStay(
      testDb.db,
      a.unitId,
      {
        checkIn: '2026-10-08',
        checkout: '2026-10-10',
        partySize: 2,
        bookerName: null,
        reservationNumber: null,
      },
      new Date(NOW.getTime() - 20 * DAY),
    );
    const future = await registerStay(
      testDb.db,
      a.unitId,
      {
        checkIn: '2026-11-10',
        checkout: '2026-11-12',
        partySize: 2,
        bookerName: null,
        reservationNumber: null,
      },
      NOW,
    );
    const c1 = await conversationFor(a.spaceId, a.unitId, a.stayId);
    const space2 = await addSpace(a.stayId);
    const c2 = await conversationFor(space2, a.unitId, a.stayId);
    const m1 = await turn(c1, [
      {
        type: 'tool-show_property_info',
        toolCallId: 'p',
        state: 'output-available',
        input: { topic: 'wifi' },
        output: {},
      },
      text('wifi'),
    ]);
    const m2 = await turn(c1, [
      {
        type: 'tool-show_property_info',
        toolCallId: 'p',
        state: 'output-available',
        input: { topic: 'wifi' },
        output: {},
      },
      text('wifi'),
    ]);
    const m3 = await turn(c2, [searchPart([], 'beach'), text('beach')]);
    await turn(c2, [text('hello')]);
    await rate(a.spaceId, m1, 'up');
    await rate(a.spaceId, m2, 'down', 'not_helpful');
    await rate(space2, m3, 'up');

    const stats = await unitAnswerStats(testDb.db, a.unitId, NOW);
    expect(stats.totals).toEqual({
      conversations: 2,
      answers: 4,
      up: 2,
      down: 1,
      wrong: 0,
      outdated: 0,
      notHelpful: 1,
    });
    expect(stats.topTopics).toEqual([
      { topic: 'wifi', count: 2 },
      { topic: 'beach', count: 1 },
      { topic: 'general', count: 1 },
    ]);
    expect(stats.stays.map((s) => s.stayId)).toEqual([a.stayId, quiet.id]);
    expect(stats.stays.map((s) => s.stayId)).not.toContain(future.id);
    expect(stats.stays[0]).toMatchObject({
      conversations: 2,
      answers: 4,
      up: 2,
      down: 1,
      bookerName: a.private.bookerName,
    });
    expect(stats.stays[1]).toMatchObject({ conversations: 0, answers: 0, up: 0, down: 0 });

    const b = await seedChat();
    await rate(b.spaceId, await turn(b.conv, [text('hi')]), 'down', 'wrong');
    const admin = await adminAnswerStats(testDb.db);
    const rowA = admin.units.find((u) => u.unitId === a.unitId);
    const rowB = admin.units.find((u) => u.unitId === b.unitId);
    expect(rowA).toMatchObject({
      unitName: a.unitName,
      stays: 1,
      conversations: 2,
      answers: 4,
      up: 2,
      down: 1,
    });
    expect(rowB).toMatchObject({ stays: 1, answers: 1, down: 1, wrong: 1 });
    expect(rowA?.hostEmail).toContain('@');
    expect(admin.totals.answers).toBeGreaterThanOrEqual(5);

    // The rows outlive the conversation (PRD §6.5 keeps aggregate counts).
    await testDb.db.delete(conversations).where(eq(conversations.id, c1.conversationId));
    const kept = await testDb.db
      .select()
      .from(answerFeedback)
      .where(eq(answerFeedback.conversationId, c1.conversationId));
    expect(kept).toHaveLength(2);
    expect(kept.every((r) => r.messageId === null)).toBe(true);
    expect((await unitAnswerStats(testDb.db, a.unitId, NOW)).totals).toEqual(stats.totals);
  });
});
