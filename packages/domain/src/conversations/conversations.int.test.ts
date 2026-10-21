import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversations, messages } from '../db/schema/conversations';
import { turnMetrics } from '../db/schema/metrics';
import { spaces } from '../db/schema/spaces';
import { recordTurnMetrics } from '../metrics/store';
import { loadGuestProjection } from '../projection/load';
import type { GuestProjection } from '../projection/projection';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '../testing';
import { appendTurn, findConversation, getOrCreateConversation, loadMessages } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

async function seed() {
  const s = await seedGuestUnit(testDb.db, { now: NOW });
  const projection = await loadGuestProjection(testDb.db, {
    unitId: s.unitId,
    stayId: s.stayId,
    language: 'en',
    now: NOW,
  });
  return { ...s, projection };
}

const text = (t: string) => [{ type: 'text', text: t }];

describe('conversations', () => {
  it('creates one conversation per space and never changes its system prompt', async () => {
    const { spaceId, projection } = await seed();
    expect(await findConversation(testDb.db, spaceId)).toBeNull();
    const first = await getOrCreateConversation(
      testDb.db,
      spaceId,
      { systemPrompt: 'first', projection },
      NOW,
    );
    const second = await getOrCreateConversation(
      testDb.db,
      spaceId,
      { systemPrompt: 'second', projection: { ...projection, language: 'de' } },
      later(1000),
    );
    expect(second).toEqual(first);
    expect(second.systemPrompt).toBe('first');
    expect(second.projection).toEqual(projection);
    expect(second.situationNote).toBeNull();
  });

  it('appends turns in order and records what the model now knows', async () => {
    const { spaceId, projection } = await seed();
    const c = await getOrCreateConversation(
      testDb.db,
      spaceId,
      { systemPrompt: 's', projection },
      NOW,
    );
    await appendTurn(testDb.db, {
      conversationId: c.id,
      messages: [
        { id: 'm1', role: 'system', parts: text('note 1') },
        { id: 'm2', role: 'user', parts: text('hi') },
        { id: 'm3', role: 'assistant', parts: text('hello') },
      ],
      projection,
      situationNote: 'note 1',
      now: later(1000),
    });
    const changed: GuestProjection = { ...projection, language: 'de' };
    await appendTurn(testDb.db, {
      conversationId: c.id,
      messages: [
        { id: 'm4', role: 'user', parts: text('again') },
        { id: 'm5', role: 'assistant', parts: text('yes') },
      ],
      projection: changed,
      situationNote: 'note 2',
      now: later(2000),
    });
    const rows = await loadMessages(testDb.db, c.id);
    expect(rows.map((r) => [r.id, r.seq, r.role, r.kind])).toEqual([
      ['m1', 1, 'system', 'chat'],
      ['m2', 2, 'user', 'chat'],
      ['m3', 3, 'assistant', 'chat'],
      ['m4', 4, 'user', 'chat'],
      ['m5', 5, 'assistant', 'chat'],
    ]);
    expect(rows[1]?.parts).toEqual(text('hi'));
    const after = await findConversation(testDb.db, spaceId);
    expect(after?.projection).toEqual(changed);
    expect(after?.situationNote).toBe('note 2');
    expect(after?.updatedAt).toEqual(later(2000));
    expect(after?.systemPrompt).toBe('s');
  });

  it('deleting the space removes its conversation, messages and metrics', async () => {
    const { spaceId, projection } = await seed();
    const c = await getOrCreateConversation(
      testDb.db,
      spaceId,
      { systemPrompt: 's', projection },
      NOW,
    );
    await appendTurn(testDb.db, {
      conversationId: c.id,
      messages: [{ id: `u-${c.id}`, role: 'user', parts: text('hi') }],
      projection,
      situationNote: null,
      now: NOW,
    });
    await recordTurnMetrics(testDb.db, {
      conversationId: c.id,
      model: 'm',
      startedAt: NOW,
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
    await testDb.db.delete(spaces).where(eq(spaces.id, spaceId));
    expect(await testDb.db.select().from(conversations).where(eq(conversations.id, c.id))).toEqual(
      [],
    );
    expect(
      await testDb.db.select().from(messages).where(eq(messages.conversationId, c.id)),
    ).toEqual([]);
    expect(
      await testDb.db.select().from(turnMetrics).where(eq(turnMetrics.conversationId, c.id)),
    ).toEqual([]);
  });
});
