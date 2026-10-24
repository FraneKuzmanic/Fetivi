import { contentGaps, findConversation, loadMessages } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, write } from '../testing';

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

/** The answer's text and the gap note in one step, as the instructions ask. */
const textThenNote = (text: string, input: unknown): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      {
        type: 'tool-call',
        toolCallId: 'call-note',
        toolName: 'note_missing_info',
        input: JSON.stringify(input),
      },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
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

async function gapsOf(t: ChatTestApp, stayId: string) {
  return t.db.select().from(contentGaps).where(eq(contentGaps.stayId, stayId));
}

describe('note_missing_info (44)', () => {
  it('records the topic against the Stay and ends the turn without another step', async () => {
    const model = mockModel([
      textThenNote("I don't have parking details, sorry.", { topic: 'parking' }),
    ]);
    const { t, seed, cookie, space } = await setup(model);

    const response = await write('POST', t.app, '/api/chat', { text: 'Parking?' }, { cookie });
    expect(response.statusCode).toBe(200);
    // One model call: text plus the silent note ends the turn.
    expect(model.doStreamCalls).toHaveLength(1);

    const gaps = await gapsOf(t, seed.stayId);
    expect(gaps.map((g) => ({ unitId: g.unitId, topic: g.topic }))).toEqual([
      { unitId: seed.unitId, topic: 'parking' },
    ]);

    const conversation = await findConversation(t.db, space.space.id);
    if (!conversation) throw new Error('no conversation');
    const answer = (await loadMessages(t.db, conversation.id)).find((r) => r.role === 'assistant');
    expect(answer?.parts.some((p) => p.type === 'tool-note_missing_info')).toBe(true);
  });

  it('records nothing for a topic outside the list, and the turn still completes', async () => {
    const model = mockModel([
      callStep('note_missing_info', { topic: 'jacuzzi' }),
      textStep("I don't have that information."),
    ]);
    const { t, seed, cookie, space } = await setup(model);

    const response = await write('POST', t.app, '/api/chat', { text: 'Jacuzzi?' }, { cookie });
    expect(response.statusCode).toBe(200);
    expect(await gapsOf(t, seed.stayId)).toEqual([]);

    const conversation = await findConversation(t.db, space.space.id);
    if (!conversation) throw new Error('no conversation');
    const answer = (await loadMessages(t.db, conversation.id)).find((r) => r.role === 'assistant');
    expect(answer?.parts.some((p) => p.type === 'text')).toBe(true);
  });
});
