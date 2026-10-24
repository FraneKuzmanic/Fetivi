import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendTurn, getOrCreateConversation } from '../../conversations/store';
import { accounts } from '../../db/schema/accounts';
import type { MessagePart } from '../../db/schema/conversations';
import { infoBlocks } from '../../db/schema/info-blocks';
import { properties } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import { contentGaps, hostSuggestions } from '../../db/schema/suggestions';
import { loadGuestProjection } from '../../projection/load';
import { registerStay } from '../../stays/store';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../../testing';
import { hashToken, newToken } from '../../tokens';
import { suggestionText } from './copy';
import { GAP_TOOL_NAME } from './gaps';
import { listHostSuggestions } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = 86_400_000;
const SENTINEL = `SENTINEL-${randomUUID()}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const text = (t: string): MessagePart => ({ type: 'text', text: t });
const note = (input: Record<string, unknown>): MessagePart => ({
  type: `tool-${GAP_TOOL_NAME}`,
  toolCallId: randomUUID(),
  state: 'output-available',
  input,
  output: { noted: true },
});

let stayDay = 0;
/** A further Stay of the unit, with its own space. */
async function addStay(unitId: string) {
  stayDay += 3;
  const checkIn = new Date(NOW.getTime() + stayDay * DAY).toISOString().slice(0, 10);
  const checkout = new Date(NOW.getTime() + (stayDay + 2) * DAY).toISOString().slice(0, 10);
  const stay = await registerStay(
    testDb.db,
    unitId,
    { checkIn, checkout, partySize: 2, bookerName: null, reservationNumber: null },
    NOW,
  );
  const [space] = await testDb.db
    .insert(spaces)
    .values({
      stayId: stay.id,
      tokenHash: hashToken(newToken()),
      language: 'en',
      closedAt: new Date(NOW.getTime() + 30 * DAY),
      createdAt: NOW,
      updatedAt: NOW,
    })
    .returning();
  if (!space) throw new Error('no space');
  return { stayId: stay.id, spaceId: space.id };
}

/** One guest question and one Fetivi answer in the Stay's space. */
async function turn(
  s: { unitId: string; stayId: string; spaceId: string },
  answer: MessagePart[],
  now = NOW,
) {
  const projection = await loadGuestProjection(testDb.db, {
    unitId: s.unitId,
    stayId: s.stayId,
    language: 'en',
    now: NOW,
  });
  const c = await getOrCreateConversation(
    testDb.db,
    s.spaceId,
    { systemPrompt: 's', projection },
    NOW,
  );
  const answerId = randomUUID();
  await appendTurn(testDb.db, {
    conversationId: c.id,
    messages: [
      { id: randomUUID(), role: 'user', parts: [text(`Is there a washing machine? ${SENTINEL}`)] },
      { id: answerId, role: 'assistant', parts: answer },
    ],
    projection,
    situationNote: null,
    aboutMeNote: null,
    now,
  });
  return { conversationId: c.id, answerId, projection };
}

const gapAnswer = (topic = 'laundry') => [
  note({ topic, note: `${SENTINEL} guest words` }),
  text(`I do not have that information. ${SENTINEL}`),
];

const gapsOf = (unitId: string) =>
  testDb.db.select().from(contentGaps).where(eq(contentGaps.unitId, unitId));
const suggestionsOf = (unitId: string) =>
  testDb.db.select().from(hostSuggestions).where(eq(hostSuggestions.unitId, unitId));

describe('recording content gaps (AC 1, AC 4)', () => {
  it('stores one topic code per Stay and nothing the guest wrote', async () => {
    const s = await seedGuestUnit(testDb.db, { now: NOW });
    const t = await turn(s, gapAnswer());
    const rows = await gapsOf(s.unitId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stayId: s.stayId, unitId: s.unitId, topic: 'laundry' });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'stayId',
      'topic',
      'unitId',
    ]);
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);

    // A second answer in the same Stay, and a resumed turn re-reading the parts, add nothing.
    await turn(s, gapAnswer());
    await appendTurn(testDb.db, {
      conversationId: t.conversationId,
      messages: [],
      updated: [{ id: t.answerId, parts: gapAnswer() }],
      projection: t.projection,
      situationNote: null,
      aboutMeNote: null,
      now: NOW,
    });
    expect(await gapsOf(s.unitId)).toHaveLength(1);
  });

  it('records two topics of one answer, and nothing for failed calls or unknown topics', async () => {
    const s = await seedGuestUnit(testDb.db, { now: NOW });
    await turn(s, [
      note({ topic: 'jacuzzi' }),
      { ...note({ topic: 'hot_water' }), state: 'output-error' },
      text('Sorry'),
    ]);
    expect(await gapsOf(s.unitId)).toHaveLength(0);
    await turn(s, [note({ topic: 'parking' }), note({ topic: 'laundry' }), text('Sorry')]);
    expect((await gapsOf(s.unitId)).map((r) => r.topic).sort()).toEqual(['laundry', 'parking']);
  });
});

describe('creating Suggestions (AC 2)', () => {
  it('opens one Suggestion once a topic went unanswered in two Stays of the unit', async () => {
    const s = await seedGuestUnit(testDb.db, { now: NOW });
    await turn(s, gapAnswer());
    expect(await suggestionsOf(s.unitId)).toHaveLength(0);

    // A gap in a different unit does not count.
    const other = await seedGuestUnit(testDb.db, { now: NOW });
    await turn(other, gapAnswer());
    expect(await suggestionsOf(s.unitId)).toHaveLength(0);

    const second = await addStay(s.unitId);
    await turn({ unitId: s.unitId, ...second }, gapAnswer());
    let open = await suggestionsOf(s.unitId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ topic: 'laundry', stayCount: 2, resolvedAt: null });

    const third = await addStay(s.unitId);
    await turn({ unitId: s.unitId, ...third }, gapAnswer());
    open = await suggestionsOf(s.unitId);
    expect(open).toHaveLength(1);
    expect(open[0]?.stayCount).toBe(3);
    expect(JSON.stringify(open)).not.toContain(SENTINEL);
  });
});

describe('listing Suggestions (AC 2, AC 3, AC 4)', () => {
  async function unitWithSuggestion(topic = 'laundry') {
    const s = await seedGuestUnit(testDb.db, { now: NOW });
    await turn(s, gapAnswer(topic));
    const second = await addStay(s.unitId);
    await turn({ unitId: s.unitId, ...second }, gapAnswer(topic));
    return s;
  }

  it("returns Fetivi's sentence in the host's language with the wizard link", async () => {
    const s = await unitWithSuggestion();
    await testDb.db.update(accounts).set({ uiLanguage: 'hr' }).where(eq(accounts.id, s.hostId));
    const list = await listHostSuggestions(testDb.db, s.hostId, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      unitId: s.unitId,
      unitName: s.unitName,
      topic: 'laundry',
      stepId: 'how_tos',
      fieldId: 'laundry',
      stayCount: 2,
      text: suggestionText('hr', 'laundry', 2),
      wizardPath: `/units/${s.unitId}/setup/how_tos#field-laundry`,
    });
    const [property] = await testDb.db
      .select({ name: properties.name })
      .from(properties)
      .where(eq(properties.id, s.propertyId));
    expect(list[0]?.propertyName).toBe(property?.name);
    expect(JSON.stringify(list)).not.toContain(SENTINEL);

    // Another host never sees it.
    const other = await seedGuestUnit(testDb.db, { now: NOW });
    expect(await listHostSuggestions(testDb.db, other.hostId, NOW)).toEqual([]);
  });

  it('resolves once the host fills the field, and counts afresh after that', async () => {
    const s = await unitWithSuggestion();
    expect(await listHostSuggestions(testDb.db, s.hostId, NOW)).toHaveLength(1);

    await testDb.db.insert(infoBlocks).values({
      unitId: s.unitId,
      category: 'how_tos',
      title: 'Laundry',
      body: 'Washing machine in the bathroom.',
      visibility: 'always',
      wizardKey: 'laundry',
    });
    const later = new Date(NOW.getTime() + DAY);
    expect(await listHostSuggestions(testDb.db, s.hostId, later)).toEqual([]);
    const [resolved] = await suggestionsOf(s.unitId);
    expect(resolved?.resolvedAt).toEqual(later);

    // The host removes it again; one new Stay is not enough, two are.
    await testDb.db
      .delete(infoBlocks)
      .where(and(eq(infoBlocks.unitId, s.unitId), eq(infoBlocks.wizardKey, 'laundry')));
    const after = new Date(later.getTime() + DAY);
    const a = await addStay(s.unitId);
    await turn({ unitId: s.unitId, ...a }, gapAnswer(), after);
    expect(await listHostSuggestions(testDb.db, s.hostId, after)).toEqual([]);
    const b = await addStay(s.unitId);
    await turn({ unitId: s.unitId, ...b }, gapAnswer(), after);
    const fresh = await listHostSuggestions(testDb.db, s.hostId, after);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.stayCount).toBe(2);
    expect(fresh[0]?.id).not.toBe(resolved?.id);
  });

  it('resolves a column field through the property, the unit inheriting it', async () => {
    const s = await unitWithSuggestion('parking');
    expect(await listHostSuggestions(testDb.db, s.hostId, NOW)).toHaveLength(1);
    await testDb.db
      .update(properties)
      .set({ parkingType: 'free_on_site' })
      .where(eq(properties.id, s.propertyId));
    expect(await listHostSuggestions(testDb.db, s.hostId, NOW)).toEqual([]);
  });

  it('is empty for a host with no units', async () => {
    const [host] = await testDb.db
      .insert(accounts)
      .values({ email: `empty-${randomUUID()}@example.test`, passwordHash: 'x', role: 'host' })
      .returning();
    expect(await listHostSuggestions(testDb.db, host?.id ?? '', NOW)).toEqual([]);
  });
});
