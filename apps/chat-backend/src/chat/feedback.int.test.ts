import { curationItems, findConversation, loadMessages, seedTrogir } from '@fetivi/domain';
import { noopQueue, publishCatalog, seedGuestUnit } from '@fetivi/domain/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type ChatTestApp,
  createChatTestApp,
  enterSpace,
  get,
  readStream,
  write,
} from '../testing';

type StreamResult = { stream: ReadableStream<unknown> };

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

const callStep = (toolName: string, input: unknown): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
    ],
  }),
});

const textStep = (text: string): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage },
    ],
  }),
});

const mockModel = (steps: StreamResult[]) => new MockLanguageModelV4({ doStream: steps as never });

const apps: ChatTestApp[] = [];
afterAll(async () => {
  await Promise.all(apps.map((t) => t.close()));
});

async function setup(model: MockLanguageModelV4) {
  const t = await createChatTestApp({ model });
  apps.push(t);
  const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
  const { cookie, space } = await enterSpace(t, seed);
  return { t, seed, cookie, space };
}

const putFeedback = (t: ChatTestApp, cookie: string | undefined, id: string, body: unknown) =>
  write('PUT', t.app, `/api/chat/messages/${encodeURIComponent(id)}/feedback`, body, {
    ...(cookie ? { cookie } : {}),
  });

describe('PUT /api/chat/messages/:id/feedback', () => {
  it('rates an answer, keeps it in the history and flags the places shown', async () => {
    const model = mockModel([
      callStep('search_places', { date: '2027-07-12', limit: 3 }),
      textStep('Here are three beaches.'),
    ]);
    const { t, cookie, space } = await setup(model);
    const { destinationId } = await seedTrogir(t.db, noopQueue, t.clock.now());
    await publishCatalog(t.db, destinationId);

    const response = await write('POST', t.app, '/api/chat', { text: 'Beaches?' }, { cookie });
    expect(response.statusCode).toBe(200);
    const start = readStream(response).find((c) => c.type === 'start') as
      | { messageId?: string }
      | undefined;

    const conversation = await findConversation(t.db, space.space.id);
    if (!conversation) throw new Error('no conversation');
    const rows = await loadMessages(t.db, conversation.id);
    const answer = rows.find((r) => r.role === 'assistant');
    if (!answer) throw new Error('no answer');
    // The browser rates by the id the stream gave it, so it must be the stored one.
    expect(start?.messageId).toBe(answer.id);
    const part = answer.parts.find((p) => p.type === 'tool-search_places') as
      | { output: { results: { id: string }[] } }
      | undefined;
    const placeIds = part?.output.results.map((r) => r.id) ?? [];
    expect(placeIds.length).toBeGreaterThan(0);

    const rated = await putFeedback(t, cookie, answer.id, { thumb: 'down', reason: 'outdated' });
    expect(rated.statusCode).toBe(200);
    expect(rated.json()).toEqual({ feedback: { thumb: 'down', reason: 'outdated' } });

    const history = await get(t.app, '/api/chat', cookie);
    expect(history.json().feedback).toEqual({
      [answer.id]: { thumb: 'down', reason: 'outdated' },
    });

    const flagged = await t.db
      .select()
      .from(curationItems)
      .where(
        and(eq(curationItems.kind, 'guest_flagged'), inArray(curationItems.recordId, placeIds)),
      );
    expect(flagged).toHaveLength(placeIds.length);
    expect(flagged.every((i) => i.status === 'open')).toBe(true);

    // Another guest's space cannot rate it.
    const other = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
    const { cookie: otherCookie } = await enterSpace(t, other);
    expect(
      (await putFeedback(t, otherCookie, answer.id, { thumb: 'up', reason: null })).statusCode,
    ).toBe(404);

    const user = rows.find((r) => r.role === 'user');
    if (!user) throw new Error('no user message');
    const onUser = await putFeedback(t, cookie, user.id, { thumb: 'up', reason: null });
    expect(onUser.statusCode).toBe(404);
    expect(onUser.json()).toEqual({ error: 'not-found' });

    const invalid = await putFeedback(t, cookie, answer.id, { thumb: 'up', reason: 'wrong' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid-input' });
    const extra = await putFeedback(t, cookie, answer.id, { thumb: 'up', reason: null, note: 'x' });
    expect(extra.statusCode).toBe(400);

    expect(
      (await putFeedback(t, undefined, answer.id, { thumb: 'up', reason: null })).statusCode,
    ).toBe(401);
  });

  it('returns an empty feedback map before the first turn', async () => {
    const { t, cookie } = await setup(mockModel([]));
    const history = await get(t.app, '/api/chat', cookie);
    expect(history.json()).toEqual({ messages: [], feedback: {} });
  });
});
