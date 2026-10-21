import { randomUUID } from 'node:crypto';
import {
  destinations,
  findConversation,
  loadMessages,
  type MessageRow,
  turnMetrics,
} from '@fetivi/domain';
import { seedGuestUnit, TROGIR } from '@fetivi/domain/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
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

const usage = (input: number, output: number, cacheRead = 0) => ({
  inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

const toolStep = (): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'probe_situation',
        input: '{"topic":"wifi"}',
      },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: usage(100, 10, 80),
      },
    ],
  }),
});

const textStep = (text: string, delays: { initial?: number; chunk?: number } = {}) => ({
  stream: simulateReadableStream({
    initialDelayInMs: delays.initial ?? null,
    chunkDelayInMs: delays.chunk ?? null,
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      {
        type: 'finish',
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: usage(120, 5, 100),
      },
    ],
  }),
});

const mockModel = (steps: StreamResult[]) => new MockLanguageModelV4({ doStream: steps as never });

const apps: ChatTestApp[] = [];
async function setup(model: MockLanguageModelV4 | null, probe = false) {
  const t = await createChatTestApp({ model, probe });
  apps.push(t);
  const seed = await seedGuestUnit(t.db, {
    now: t.clock.now(),
    checkInInDays: 2,
    releaseDaysBefore: 1,
  });
  const { cookie, space } = await enterSpace(t, seed);
  return { t, seed, cookie, space };
}

afterAll(async () => {
  await Promise.all(apps.map((t) => t.close()));
});

const send = (t: ChatTestApp, cookie: string, text: string) =>
  write('POST', t.app, '/api/chat', { text }, { cookie });

async function stored(t: ChatTestApp, spaceId: string) {
  const conversation = await findConversation(t.db, spaceId);
  if (!conversation) throw new Error('no conversation');
  return { conversation, rows: await loadMessages(t.db, conversation.id) };
}

const textOf = (row: MessageRow | undefined) =>
  (row?.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');

type Prompt = MockLanguageModelV4['doStreamCalls'][number]['prompt'];
const systemTexts = (prompt: Prompt) =>
  prompt.filter((m) => m.role === 'system').map((m) => m.content as string);

/**
 * Anthropic's rule for system messages inside the conversation: each one must follow a user
 * message (the leading ones become the top-level system). The mocked model would accept anything.
 */
function expectAnthropicSystemOrder(prompt: Prompt) {
  const firstOther = prompt.findIndex((m) => m.role !== 'system');
  prompt.forEach((m, i) => {
    if (m.role === 'system' && i > firstOther) expect(prompt[i - 1]?.role).toBe('user');
  });
}

describe('POST /api/chat', () => {
  it('runs a tool call through MCP with this turn’s token, then answers and stores the turn', async () => {
    const model = mockModel([toolStep(), textStep('The Wi-Fi is in the hall.')]);
    const { t, cookie, space } = await setup(model, true);
    // Inside a destination, so the `local` token carries catalog:read.
    await t.db
      .insert(destinations)
      .values({ name: `Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 10_000 });

    const response = await send(t, cookie, 'What about the wifi?');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const chunks = readStream(response);
    const output = chunks.find((c) => c.type === 'tool-output-available');
    expect(output).toMatchObject({
      toolCallId: 'call-1',
      output: { topic: 'wifi', language: 'en' },
    });
    expect((output as { output: { scopes: string[] } }).output.scopes).toContain('catalog:read');
    const types = chunks.map((c) => c.type);
    expect(types.indexOf('text-delta')).toBeGreaterThan(types.indexOf('tool-output-available'));
    expect(chunks.find((c) => c.type === 'text-delta')).toMatchObject({
      delta: 'The Wi-Fi is in the hall.',
    });

    // The second step saw the tool result.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('catalog:read');

    const { conversation, rows } = await stored(t, space.space.id);
    expect(rows.map((r) => r.role)).toEqual(['user', 'system', 'assistant']);
    expect(textOf(rows[0])).toBe('What about the wifi?');
    expect(textOf(rows[1])).toMatch(/^Situation: it is /);
    expect(textOf(rows[2])).toBe('The Wi-Fi is in the hall.');
    const toolPart = rows[2]?.parts.find((p) => p.type === 'tool-probe_situation');
    expect(toolPart).toMatchObject({
      toolCallId: 'call-1',
      state: 'output-available',
      input: { topic: 'wifi' },
      output: { topic: 'wifi', language: 'en' },
    });
    expect(conversation.situationNote).toBe(textOf(rows[1]));

    const history = await get(t.app, '/api/chat', cookie);
    expect(history.statusCode).toBe(200);
    const messages = history.json<{ messages: { id: string; role: string }[] }>().messages;
    expect(messages.map((m) => [m.id, m.role])).toEqual([
      [rows[0]?.id, 'user'],
      [rows[2]?.id, 'assistant'],
    ]);

    const metrics = await t.db
      .select()
      .from(turnMetrics)
      .where(eq(turnMetrics.conversationId, conversation.id));
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      steps: 2,
      toolCalls: 1,
      toolNames: ['probe_situation'],
      inputTokens: 220,
      outputTokens: 15,
      cacheReadTokens: 180,
      cacheWriteTokens: 0,
    });
    expect(metrics[0]?.mcpMs).toBeGreaterThan(0);
    expect(metrics[0]?.wallMs).toBeGreaterThanOrEqual(metrics[0]?.mcpMs ?? 0);
  });

  it('keeps the system block byte-identical and each prompt a prefix of the next', async () => {
    const model = mockModel([textStep('one'), textStep('two'), textStep('three')]);
    const { t, cookie, space } = await setup(model);
    // Start just after a quarter hour, so turns 1 and 2 share the situation note's time.
    const quarter = 15 * 60_000;
    t.clock.advance(quarter - (t.clock.now().getTime() % quarter) + 1000);

    await send(t, cookie, 'first');
    t.clock.advance(60_000);
    await send(t, cookie, 'second');
    const { conversation, rows } = await stored(t, space.space.id);
    const [c1, c2] = model.doStreamCalls;
    const p1 = c1?.prompt ?? [];
    const p2 = c2?.prompt ?? [];

    expect(p1[0]).toEqual(p2[0]);
    expect(p1[0]).toMatchObject({
      role: 'system',
      content: conversation.systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    });
    expect(p2.slice(0, p1.length)).toEqual(p1);
    expect(c1?.tools).toEqual(c2?.tools);
    // Same quarter hour: no new situation note on turn 2.
    expect(rows.filter((r) => r.role === 'system')).toHaveLength(1);
    expect(p2.filter((m) => m.role === 'system')).toHaveLength(2);

    t.clock.advance(15 * 60_000);
    await send(t, cookie, 'third');
    const p3 = model.doStreamCalls[2]?.prompt ?? [];
    expect(p3.slice(0, p2.length)).toEqual(p2);
    expect(p3[0]).toEqual(p1[0]);
    expect(systemTexts(p3)).toHaveLength(3);
    expect(systemTexts(p3)[2]).toMatch(/^Situation: it is /);
    for (const p of [p1, p2, p3]) expectAnthropicSystemOrder(p);
    const after = await stored(t, space.space.id);
    expect(after.conversation.systemPrompt).toBe(conversation.systemPrompt);
    expect(after.rows.map((r) => r.seq)).toEqual(after.rows.map((_, i) => i + 1));
  });

  it('hands the released sections over as a note once the arrival details are released', async () => {
    const model = mockModel([textStep('before'), textStep('after')]);
    const { t, seed, cookie, space } = await setup(model);

    await send(t, cookie, 'wifi?');
    const before = model.doStreamCalls[0]?.prompt ?? [];
    const system = before[0]?.content as string;
    expect(system).toContain('"password":null');
    expect(system).not.toContain(seed.secrets.wifiPassword);

    t.clock.advance(seed.stay.arrivalReleaseAt.getTime() - t.clock.now().getTime() + 60_000);
    await send(t, cookie, 'and now?');
    const prompt = model.doStreamCalls[1]?.prompt ?? [];
    expect(prompt[0]).toEqual(before[0]);
    const note = systemTexts(prompt).find((s) => s.includes('<unit_record_update>')) ?? '';
    expect(note).toContain(seed.secrets.wifiPassword);
    expect(note).toContain(seed.secrets.doorCode);
    // The change and the new situation travel as one system message after the guest's text.
    expect(note).toMatch(/\n\nSituation: it is /);
    expectAnthropicSystemOrder(prompt);
    const update = JSON.parse(note.split('\n')[2] ?? '{}');
    expect(Object.keys(update)).toEqual(
      expect.arrayContaining(['stay', 'arrival', 'wifi', 'contacts', 'blocks']),
    );
    const { conversation } = await stored(t, space.space.id);
    expect(conversation.projection.wifi?.password).toBe(seed.secrets.wifiPassword);
    expect(conversation.systemPrompt).toBe(system);
  });

  it('tells the model about a language switch without touching the system block', async () => {
    const model = mockModel([textStep('hi'), textStep('hallo')]);
    const { t, seed, cookie } = await setup(model);

    await send(t, cookie, 'hello');
    const patched = await write('PATCH', t.app, '/api/space', { language: 'de' }, { cookie });
    expect(patched.statusCode).toBe(200);
    await send(t, cookie, 'und jetzt?');
    const [p1, p2] = model.doStreamCalls.map((c) => c.prompt);
    expect(p2?.[0]).toEqual(p1?.[0]);
    const note = systemTexts(p2 ?? []).find((s) => s.includes('<unit_record_update>')) ?? '';
    const update = JSON.parse(note.split('\n')[2] ?? '{}');
    expect(Object.keys(update).sort()).toEqual(['blocks', 'language']);
    expect(update.language).toBe('de');
    expect(note).toContain(seed.alwaysTitle('de'));
    expect(note).toContain('answer in German from now on');
    expectAnthropicSystemOrder(p2 ?? []);
  });

  it('stores nothing when the model fails, and the next turn works', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls += 1;
        if (calls === 1) throw new Error('overloaded');
        return textStep('fine') as never;
      },
    });
    const { t, cookie, space } = await setup(model);

    const failed = await send(t, cookie, 'hello');
    expect(failed.statusCode).toBe(200);
    expect(readStream(failed)).toContainEqual({ type: 'error', errorText: 'turn-failed' });
    expect(await findConversation(t.db, space.space.id)).not.toBeNull();
    expect((await stored(t, space.space.id)).rows).toEqual([]);
    expect(await t.db.select().from(turnMetrics)).toEqual([]);

    const ok = await send(t, cookie, 'hello again');
    expect(readStream(ok).find((c) => c.type === 'text-delta')).toMatchObject({ delta: 'fine' });
    const { rows } = await stored(t, space.space.id);
    expect(rows.map((r) => r.role)).toEqual(['user', 'system', 'assistant']);
    expect(textOf(rows[0])).toBe('hello again');
  });

  it('sends no arrival secret or host-only value to the model before the release', async () => {
    const model = mockModel([textStep('hi')]);
    const { t, seed, cookie } = await setup(model);
    await send(t, cookie, 'codes?');
    const sent = JSON.stringify(model.doStreamCalls[0]);
    for (const value of [...Object.values(seed.secrets), ...Object.values(seed.private)]) {
      expect(sent).not.toContain(value);
    }
  });
});

describe('POST /api/chat guards', () => {
  it('needs a space, the app origin and some text', async () => {
    const { t, cookie } = await setup(mockModel([]));
    const noSpace = await send(t, '', 'hi');
    expect([noSpace.statusCode, noSpace.json()]).toEqual([401, { error: 'no-space' }]);
    const badOrigin = await write(
      'POST',
      t.app,
      '/api/chat',
      { text: 'hi' },
      { cookie, origin: 'http://evil.test' },
    );
    expect([badOrigin.statusCode, badOrigin.json()]).toEqual([403, { error: 'bad-origin' }]);
    const empty = await send(t, cookie, '   ');
    expect([empty.statusCode, empty.json()]).toEqual([400, { error: 'invalid-input' }]);
  });

  it('refuses a closed space but still shows its history', async () => {
    const { t, cookie, space } = await setup(mockModel([]));
    t.clock.advance(space.space.closedAt.getTime() - t.clock.now().getTime() + 60_000);
    const closed = await send(t, cookie, 'hi');
    expect([closed.statusCode, closed.json()]).toEqual([409, { error: 'space-closed' }]);
    const history = await get(t.app, '/api/chat', cookie);
    expect([history.statusCode, history.json()]).toEqual([200, { messages: [] }]);
  });

  it('answers 503 without a model', async () => {
    const { t, cookie } = await setup(null);
    const response = await send(t, cookie, 'hi');
    expect([response.statusCode, response.json()]).toEqual([503, { error: 'chat-unavailable' }]);
  });

  it('refuses a second turn while one is still streaming', async () => {
    const model = mockModel([textStep('slow', { initial: 400, chunk: 50 }), textStep('next')]);
    const { t, cookie } = await setup(model);
    const first = send(t, cookie, 'one');
    while (model.doStreamCalls.length === 0) await new Promise((r) => setTimeout(r, 10));
    const second = await send(t, cookie, 'two');
    expect([second.statusCode, second.json()]).toEqual([409, { error: 'turn-in-progress' }]);
    expect(readStream(await first).find((c) => c.type === 'text-delta')).toMatchObject({
      delta: 'slow',
    });
    const third = await send(t, cookie, 'three');
    expect(third.statusCode).toBe(200);
  });
});
