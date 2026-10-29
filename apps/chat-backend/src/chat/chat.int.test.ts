import { randomUUID } from 'node:crypto';
import {
  createCatalogRecord,
  destinations,
  findConversation,
  loadMessages,
  type MessageRow,
  seedTrogir,
  turnMetrics,
  type WeatherReport,
  type WeatherSource,
} from '@fetivi/domain';
import {
  fixedWeatherSource,
  noopQueue,
  publishCatalog,
  sampleWeatherReport,
  seedGuestUnit,
  TROGIR,
} from '@fetivi/domain/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { afterAll, describe, expect, it } from 'vitest';
import { createFerryhopper } from '../mcp/external/ferryhopper';
import { FERRYHOPPER_PINNED_TOOLS } from '../mcp/external/pin';
import { recordedFerryhopperFetch } from '../mcp/external/testing';
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
async function setup(model: MockLanguageModelV4 | null, probe = false, weather?: WeatherSource) {
  const t = await createChatTestApp({ model, probe, ...(weather ? { weather } : {}) });
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
      // Uncached input only: 20 + 20, the cache reads counted once in their own column.
      inputTokens: 40,
      outputTokens: 15,
      cacheReadTokens: 180,
      cacheWriteTokens: 0,
    });
    expect(metrics[0]?.mcpMs).toBeGreaterThan(0);
    expect(metrics[0]?.wallMs).toBeGreaterThanOrEqual(metrics[0]?.mcpMs ?? 0);
    expect(metrics[0]?.transport).toBe('mcp');
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
    // The automatic history breakpoint rides on every request, never on the messages.
    for (const c of [c1, c2]) {
      expect(c?.providerOptions?.anthropic).toMatchObject({ cacheControl: { type: 'ephemeral' } });
    }
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

describe('The weather note', () => {
  const inDestination = (t: ChatTestApp) =>
    t.db
      .insert(destinations)
      .values({ name: `Trogir ${randomUUID()}`, centre: TROGIR, radiusM: 10_000 });
  const zagrebToday = (now: Date) =>
    DateTime.fromJSDate(now, { zone: 'Europe/Zagreb' }).toISODate() as string;

  it('appends the weather after the situation, once per change, and stores it', async () => {
    let edit = (r: WeatherReport) => r;
    const weather = fixedWeatherSource((now) => edit(sampleWeatherReport(zagrebToday(now))));
    const model = mockModel([textStep('one'), textStep('two'), textStep('three')]);
    const { t, cookie, space } = await setup(model, false, weather);
    await inDestination(t);

    await send(t, cookie, 'weather?');
    const first = systemTexts(model.doStreamCalls[0]?.prompt ?? []).at(-1) ?? '';
    expect(first).toMatch(/^Situation: it is .*\n\nWeather \(forecast MET Norway/s);
    expect(first).toContain('yellow wind warning (Middle Dalmatia region)');
    const { conversation } = await stored(t, space.space.id);
    expect(conversation.weatherNote).toBe(first.slice(first.indexOf('Weather (')));

    // Same report, same quarter hour: no new system message at all.
    await send(t, cookie, 'and?');
    const p2 = model.doStreamCalls[1]?.prompt ?? [];
    expect(systemTexts(p2)).toHaveLength(2);

    edit = (r) => ({ ...r, warnings: [] });
    await send(t, cookie, 'still?');
    const p3 = model.doStreamCalls[2]?.prompt ?? [];
    expect(systemTexts(p3)).toHaveLength(3);
    expect(systemTexts(p3)[2]).toMatch(/^Weather \(.*No DHMZ warnings in force\.$/);
    expectAnthropicSystemOrder(p3);
    expect((await stored(t, space.space.id)).conversation.weatherNote).toContain(
      'No DHMZ warnings in force.',
    );
  });

  it('adds no weather note when every source is down, or outside a destination', async () => {
    const down = mockModel([textStep('one')]);
    const a = await setup(down);
    await inDestination(a.t);
    await send(a.t, a.cookie, 'weather?');
    expect(systemTexts(down.doStreamCalls[0]?.prompt ?? []).join()).not.toContain('Weather (');
    expect((await stored(a.t, a.space.space.id)).conversation.weatherNote).toBeNull();

    const weather = fixedWeatherSource((now) => sampleWeatherReport(zagrebToday(now)));
    const outside = mockModel([textStep('one')]);
    const b = await setup(outside, false, weather);
    await send(b.t, b.cookie, 'weather?');
    expect(systemTexts(outside.doStreamCalls[0]?.prompt ?? []).join()).not.toContain('Weather (');
    expect(weather.calls).toBe(0);
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
    const model = mockModel([]);
    const { t, cookie, space } = await setup(model);
    t.clock.advance(space.space.closedAt.getTime() - t.clock.now().getTime() + 60_000);
    const closed = await send(t, cookie, 'hi');
    expect([closed.statusCode, closed.json()]).toEqual([409, { error: 'space-closed' }]);
    // A card answer is refused the same way: read-only mode cannot reach the model.
    const answer = await write(
      'POST',
      t.app,
      '/api/chat',
      { answer: { toolCallId: 'call-1', action: 'accept', content: {} } },
      { cookie },
    );
    expect([answer.statusCode, answer.json()]).toEqual([409, { error: 'space-closed' }]);
    expect(model.doStreamCalls).toHaveLength(0);
    const history = await get(t.app, '/api/chat', cookie);
    expect([history.statusCode, history.json()]).toEqual([200, { messages: [], feedback: {} }]);
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

const callStep = (toolName: string, input: unknown): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: usage(100, 10),
      },
    ],
  }),
});

const putAboutMe = (t: ChatTestApp, cookie: string, body: Record<string, unknown>) =>
  write(
    'PUT',
    t.app,
    '/api/about-me',
    { party: null, interests: [], pace: null, budget: null, transport: null, needs: [], ...body },
    { cookie },
  );

describe('About me in the conversation', () => {
  it('appends an About me note only when About me changes', async () => {
    const model = mockModel([textStep('one'), textStep('two'), textStep('three')]);
    const { t, cookie, space } = await setup(model);

    await send(t, cookie, 'hello');
    const first = await stored(t, space.space.id);
    expect(first.rows.some((r) => textOf(r).includes('About me'))).toBe(false);
    expect(first.conversation.aboutMeNote).toBeNull();

    expect((await putAboutMe(t, cookie, { party: 'couple', interests: ['food'] })).statusCode).toBe(
      200,
    );
    await send(t, cookie, 'any ideas?');
    const second = await stored(t, space.space.id);
    const notes = second.rows.filter(
      (r) => r.role === 'system' && textOf(r).includes('About me ('),
    );
    expect(notes).toHaveLength(1);
    expect(textOf(notes[0])).toContain('a couple');
    expect(textOf(notes[0])).toContain('food and wine');
    expect(second.conversation.aboutMeNote).toBe(textOf(notes[0]).split('\n\n').at(-1));
    expectAnthropicSystemOrder(model.doStreamCalls[1]?.prompt ?? []);

    await send(t, cookie, 'thanks');
    const third = await stored(t, space.space.id);
    expect(third.rows.filter((r) => textOf(r).includes('About me'))).toHaveLength(1);
    expect(third.conversation.aboutMeNote).toBe(second.conversation.aboutMeNote);
  });

  it('reorders search_places by a saved interest', async () => {
    const turn = () => [
      callStep('search_places', { date: '2027-07-12', limit: 10 }),
      textStep('Here you go.'),
    ];
    const model = mockModel([...turn(), ...turn()]);
    const { t, cookie, space } = await setup(model);
    const { destinationId } = await seedTrogir(t.db, noopQueue, t.clock.now());
    await publishCatalog(t.db, destinationId);

    const titlesOfLastSearch = async () => {
      const { rows } = await stored(t, space.space.id);
      const part = rows
        .flatMap((r) => r.parts)
        .filter((p) => p.type === 'tool-search_places')
        .at(-1) as { state: string; output: { results: { title: string }[] } } | undefined;
      expect(part?.state).toBe('output-available');
      return part?.output.results.map((r) => r.title) ?? [];
    };
    const copacabana = (titles: string[]) => titles.findIndex((x) => x.includes('Copacabana'));

    await send(t, cookie, 'Where should we go?');
    const before = await titlesOfLastSearch();
    await putAboutMe(t, cookie, { interests: ['beaches'] });
    await send(t, cookie, 'Where should we go?');
    const after = await titlesOfLastSearch();

    expect(copacabana(before)).toBeGreaterThan(-1);
    expect(copacabana(after)).toBeLessThan(copacabana(before));
  });

  it("refuses the model's attempt to save a special-category need", async () => {
    const model = mockModel([callStep('update_about_me', { needs: ['halal'] }), textStep('ok')]);
    const { t, cookie, space } = await setup(model);

    await send(t, cookie, 'We eat halal, remember that');
    const { rows } = await stored(t, space.space.id);
    const part = rows.flatMap((r) => r.parts).find((p) => p.type === 'tool-update_about_me');
    expect(part).toMatchObject({ state: 'output-error' });
    // The cause is the tool's strict input schema, and the model is told so.
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt.at(-1))).toContain(
      'Invalid arguments for tool update_about_me: Unrecognized key: \\"needs\\"',
    );
    const read = await get(t.app, '/api/about-me', cookie);
    expect(read.json()).toMatchObject({ aboutMe: { needs: [] } });
  });
});

const textAndCallStep = (text: string, toolName: string, input: unknown): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      { type: 'tool-call', toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: usage(100, 10),
      },
    ],
  }),
});

/** A step with text and then several tool calls, as one response. */
const textAndCallsStep = (text: string, calls: [string, unknown][]): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      ...calls.map(([toolName, input], i) => ({
        type: 'tool-call' as const,
        toolCallId: `call-${toolName}-${i}`,
        toolName,
        input: JSON.stringify(input),
      })),
      {
        type: 'finish',
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: usage(100, 10),
      },
    ],
  }),
});

describe('Recommendation components', () => {
  /** Seeds two restaurants and returns their ids by title. */
  async function seedRestaurants(t: ChatTestApp) {
    const { destinationId } = await seedTrogir(t.db, noopQueue, t.clock.now());
    const ids: Record<string, string> = {};
    for (const [title, x] of [
      ['Konoba Mala', 16.2513],
      ['Konoba Velika', 16.2531],
    ] as const) {
      const row = await createCatalogRecord(
        t.db,
        noopQueue,
        {
          destinationId,
          kind: 'place',
          placeCategory: 'restaurant',
          title,
          description: `${title} serves grilled fish.`,
          location: { x, y: 43.5169 },
        },
        t.clock.now(),
      );
      ids[title] = row.id;
    }
    await publishCatalog(t.db, destinationId);
    return ids as { 'Konoba Mala': string; 'Konoba Velika': string };
  }

  const components = (parts: { type: string }[]) =>
    parts.filter((p) => p.type === 'data-component') as unknown as {
      type: string;
      id: string;
      data: { name: string; payload: Record<string, unknown> };
    }[];

  it('"where should we eat tonight" streams and stores the shown carousel and follow-up chips', async () => {
    const steps = [callStep('search_places', { category: 'restaurant', date: '2027-07-12' })];
    const model = mockModel(steps);
    const { t, cookie, space } = await setup(model);
    const ids = await seedRestaurants(t);
    steps.push(
      textAndCallsStep('Try Konoba Velika, or Konoba Mala.', [
        ['show_results', { kind: 'places', ids: [ids['Konoba Velika'], ids['Konoba Mala']] }],
        ['suggest_replies', { replies: ['Show me on a map', 'Something cheaper'] }],
      ]),
      textStep('never reached'),
    );

    const response = await send(t, cookie, 'Where should we eat tonight?');
    expect(response.statusCode).toBe(200);
    // The loop stopped after the step that only showed results and chips.
    expect(model.doStreamCalls).toHaveLength(2);

    const chunks = readStream(response);
    expect(chunks.filter((c) => c.type === 'start')).toHaveLength(1);
    // The search itself draws nothing (ticket 65).
    const searched = chunks.findIndex(
      (c) => c.type === 'tool-output-available' && c.toolCallId === 'call-search_places',
    );
    expect(chunks[searched + 1]?.type).not.toBe('data-component');
    const shown = chunks.findIndex(
      (c) => c.type === 'tool-output-available' && c.toolCallId === 'call-show_results-0',
    );
    expect(chunks[shown]).toMatchObject({ output: { shown: 2 } });
    const carousel = chunks[shown + 1] as unknown as {
      type: string;
      data: { name: string; payload: { places: { title: string }[] } };
    };
    expect(carousel).toMatchObject({ type: 'data-component', data: { name: 'place-carousel' } });
    // In the order the answer gave, not the search's.
    expect(carousel.data.payload.places.map((p) => p.title)).toEqual([
      '[en] Konoba Velika',
      '[en] Konoba Mala',
    ]);
    expect(chunks).toContainEqual({
      type: 'data-component',
      id: 'call-suggest_replies-1',
      data: {
        name: 'follow-up-chips',
        payload: { replies: ['Show me on a map', 'Something cheaper'] },
      },
    });

    const history = (await get(t.app, '/api/chat', cookie)).json() as {
      messages: { role: string; parts: { type: string }[] }[];
    };
    const answer = history.messages.at(-1);
    expect(answer?.role).toBe('assistant');
    const types = answer?.parts.map((p) => p.type) ?? [];
    expect(types.indexOf('text')).toBeLessThan(types.lastIndexOf('data-component'));
    expect(components(answer?.parts ?? []).map((p) => p.data.name)).toEqual([
      'place-carousel',
      'follow-up-chips',
    ]);

    const { rows } = await stored(t, space.space.id);
    expect(components(rows.at(-1)?.parts ?? []).map((p) => p.data.name)).toEqual([
      'place-carousel',
      'follow-up-chips',
    ]);
    // Presentation calls are not MCP calls.
    const [metrics] = await t.db.select().from(turnMetrics);
    expect(metrics?.toolNames).toEqual(['search_places']);
  });

  it('sends unknown ids back to the model as a tool error, and shows no carousel', async () => {
    const steps = [callStep('search_places', { category: 'restaurant', date: '2027-07-12' })];
    const model = mockModel(steps);
    const { t, cookie } = await setup(model);
    const ids = await seedRestaurants(t);
    steps.push(
      textAndCallStep('Try Konoba Nowhere.', 'show_results', {
        kind: 'places',
        ids: ['not-a-place'],
      }),
      // A fresh call id, as a real model would use.
      textAndCallsStep('Try Konoba Mala.', [
        ['show_results', { kind: 'places', ids: [ids['Konoba Mala']] }],
      ]),
    );

    const chunks = readStream(await send(t, cookie, 'Where should we eat tonight?'));
    expect(chunks).toContainEqual(
      // The browser gets the generic error text; the model gets the message.
      expect.objectContaining({ type: 'tool-output-error', toolCallId: 'call-show_results' }),
    );
    // The error went back to the model, which corrected the call.
    expect(model.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain(
      'Unknown places ids: not-a-place',
    );
    expect(components(chunks as never).map((c) => c.data.name)).toEqual(['place-carousel']);
  });

  it('lets the model answer in text after results shown without any, and resends them after it', async () => {
    const steps = [callStep('search_places', { category: 'restaurant', date: '2027-07-12' })];
    const model = mockModel(steps);
    const { t, cookie, space } = await setup(model);
    const ids = await seedRestaurants(t);
    steps.push(
      callStep('show_results', { kind: 'places', ids: [ids['Konoba Mala']] }),
      textStep('Try Konoba Mala tonight.'),
      textStep('You are welcome.'),
    );

    const chunks = readStream(await send(t, cookie, 'Where should we eat tonight?'));
    expect(model.doStreamCalls).toHaveLength(3);
    // The guard step may only write text, and keeps the show_results call so its words match.
    expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: 'none' });
    expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain('"toolName":"show_results"');
    expect(components(chunks as never).map((c) => c.data.name)).toEqual(['place-carousel']);
    const types = (await stored(t, space.space.id)).rows.at(-1)?.parts.map((p) => p.type) ?? [];
    expect(types.indexOf('tool-show_results')).toBeLessThan(types.indexOf('text'));

    readStream(await send(t, cookie, 'Thanks'));
    const prompt = model.doStreamCalls[3]?.prompt ?? [];
    const content = (i: number) =>
      (prompt[i]?.content ?? []) as { type: string; text?: string; toolName?: string }[];
    const at = prompt.findIndex(
      (m, i) =>
        m.role === 'assistant' && content(i).some((c) => c.text === 'Try Konoba Mala tonight.'),
    );
    expect(content(at).map((c) => [c.type, c.toolName])).toEqual([
      ['text', undefined],
      ['tool-call', 'show_results'],
    ]);
    expect(prompt[at + 1]?.role).toBe('tool');
    expect(JSON.stringify(prompt.slice(0, at))).not.toContain('"toolName":"show_results"');
  });

  it('shows no component for an empty search or invalid chips, and the text still streams', async () => {
    const model = mockModel([
      callStep('search_places', { category: 'nightlife', date: '2027-07-12' }),
      textAndCallStep('Nothing checked for that.', 'suggest_replies', {
        replies: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
      textStep('Anything else?'),
    ]);
    const { t, cookie } = await setup(model);

    const chunks = readStream(await send(t, cookie, 'Any nightlife?'));
    expect(chunks.some((c) => c.type === 'data-component')).toBe(false);
    expect(
      chunks.some(
        (c) =>
          (c.type === 'tool-input-error' || c.type === 'tool-output-error') &&
          c.toolCallId === 'call-suggest_replies',
      ),
    ).toBe(true);
    // The invalid call went back to the model, which answered in text.
    expect(model.doStreamCalls).toHaveLength(3);
    expect(chunks).toContainEqual(expect.objectContaining({ delta: 'Anything else?' }));
    expect(chunks.at(-1)?.type).toBe('finish');
  });

  it('lets the model answer in text when it showed chips without any', async () => {
    const model = mockModel([
      callStep('suggest_replies', { replies: ['Thanks'] }),
      textStep('Here is what I would do.'),
    ]);
    const { t, cookie } = await setup(model);

    const chunks = readStream(await send(t, cookie, 'Any tips?'));
    expect(model.doStreamCalls).toHaveLength(2);
    // The second call may only write text, and is sent without the chips call.
    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: 'auto' });
    expect(model.doStreamCalls[1]?.toolChoice).toEqual({ type: 'none' });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).not.toContain(
      '"toolName":"suggest_replies"',
    );
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain('"toolName"');
    expect(chunks).toContainEqual(
      expect.objectContaining({ data: expect.objectContaining({ name: 'follow-up-chips' }) }),
    );
    expect(chunks).toContainEqual(expect.objectContaining({ delta: 'Here is what I would do.' }));
  });

  it('does not resend component parts to the model', async () => {
    const model = mockModel([
      callStep('search_places', { category: 'restaurant', date: '2027-07-12' }),
      textAndCallStep('Try Konoba Mala.', 'suggest_replies', { replies: ['Thanks'] }),
      textStep('You are welcome.'),
    ]);
    const { t, cookie } = await setup(model);
    await seedRestaurants(t);

    await send(t, cookie, 'Where should we eat tonight?');
    await send(t, cookie, 'Thanks');
    const prompt = JSON.stringify(model.doStreamCalls[2]?.prompt);
    expect(prompt).toContain('Konoba Mala');
    expect(prompt).not.toContain('place-carousel');
    expect(prompt).not.toContain('data-component');
    expect(prompt).not.toContain('follow-up-chips');
  });

  it('resends a rescued answer with its chips after its text', async () => {
    const model = mockModel([
      callStep('search_places', { category: 'restaurant', date: '2027-07-12' }),
      callStep('suggest_replies', { replies: ['Show me on a map'] }),
      textStep('Try Konoba Mala tonight.'),
      textStep('You are welcome.'),
    ]);
    const { t, cookie, space } = await setup(model);
    await seedRestaurants(t);

    readStream(await send(t, cookie, 'Where should we eat tonight?'));
    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: 'none' });
    // Stored as streamed: the chips came before the words.
    const types = (await stored(t, space.space.id)).rows.at(-1)?.parts.map((p) => p.type) ?? [];
    expect(types.indexOf('tool-suggest_replies')).toBeLessThan(types.indexOf('text'));

    readStream(await send(t, cookie, 'Thanks'));
    const prompt = model.doStreamCalls[3]?.prompt ?? [];
    const content = (i: number) =>
      (prompt[i]?.content ?? []) as { type: string; text?: string; toolName?: string }[];
    const at = prompt.findIndex(
      (m, i) =>
        m.role === 'assistant' && content(i).some((c) => c.text === 'Try Konoba Mala tonight.'),
    );
    expect(content(at).map((c) => [c.type, c.toolName])).toEqual([
      ['text', undefined],
      ['tool-call', 'suggest_replies'],
    ]);
    expect(prompt[at + 1]?.role).toBe('tool');
    expect(content(at + 1)).toContainEqual(
      expect.objectContaining({ type: 'tool-result', toolName: 'suggest_replies' }),
    );
    expect(JSON.stringify(prompt.slice(0, at))).not.toContain('"toolName":"suggest_replies"');
  });
});

describe.each(['mcp', 'inprocess'] as const)('Property info card (%s)', (transport) => {
  it('shows the Wi-Fi card from the unit record, password held back before the release', async () => {
    const model = mockModel([
      textAndCallStep('The network is below.', 'show_property_info', { topic: 'wifi' }),
    ]);
    const t = await createChatTestApp({ model, transport });
    apps.push(t);
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
    const { cookie } = await enterSpace(t, seed);

    const response = await send(t, cookie, "What's the wifi password?");
    expect(response.statusCode).toBe(200);
    // The card ends the turn, so no second text lands above it.
    expect(model.doStreamCalls).toHaveLength(1);
    const card = readStream(response).find(
      (c) => c.type === 'data-component' && c.id === 'call-show_property_info',
    ) as unknown as { data: { name: string; payload: Record<string, unknown> } } | undefined;
    expect(card?.data.name).toBe('property-info');
    expect(card?.data.payload).toMatchObject({
      topic: 'wifi',
      releaseAt: seed.stay.arrivalReleaseAt.toISOString(),
      fields: [{ key: 'wifiNetwork', action: 'copy' }],
    });
    expect(JSON.stringify(card)).not.toContain(seed.secrets.wifiPassword);
  });
});

describe('Ferryhopper in the turn', () => {
  const PICKER = 'ui://widgets/ferry-trips-picker.html';
  const SEARCH = {
    legs: [
      { departureLocation: 'Split', arrivalLocation: 'Stari Grad', departureDate: '2026-11-02' },
    ],
  };
  const quiet = { info: () => {}, warn: () => {} };

  async function setupFerry(model: MockLanguageModelV4, fetch = recordedFerryhopperFetch()) {
    const ferryhopper = createFerryhopper({ url: 'https://mcp.test/mcp', fetch, log: quiet });
    const t = await createChatTestApp({ model, ferryhopper });
    apps.push(t);
    const seed = await seedGuestUnit(t.db, {
      now: t.clock.now(),
      checkInInDays: 2,
      releaseDaysBefore: 1,
    });
    const { cookie, space } = await enterSpace(t, seed);
    return { t, cookie, space, fetch };
  }

  const toolNames = (model: MockLanguageModelV4) =>
    (model.doStreamCalls[0]?.tools ?? []).map((tool) => tool.name);

  it('streams and stores the widget part after a Ferryhopper search', async () => {
    const model = mockModel([
      callStep('search_ferry_trips', SEARCH),
      textStep('Ferryhopper shows four sailings.'),
    ]);
    const { t, cookie, space } = await setupFerry(model);

    const response = await send(t, cookie, 'Ferry from Split to Hvar on 2 November?');
    expect(response.statusCode).toBe(200);
    const names = toolNames(model);
    for (const name of FERRYHOPPER_PINNED_TOOLS) expect(names).toContain(name);
    expect(names).not.toContain('search_trips');

    const chunks = readStream(response);
    const output = chunks.findIndex(
      (c) => c.type === 'tool-output-available' && c.toolCallId === 'call-search_ferry_trips',
    );
    expect(output).toBeGreaterThan(-1);
    expect(chunks[output + 1]).toMatchObject({
      type: 'data-mcp-app',
      id: 'call-search_ferry_trips',
      data: {
        server: 'ferryhopper',
        toolName: 'search_ferry_trips',
        resourceUri: PICKER,
        input: SEARCH,
      },
    });

    const { rows } = await stored(t, space.space.id);
    expect(rows.at(-1)?.parts.some((p) => p.type === 'data-mcp-app')).toBe(true);
    const history = (await get(t.app, '/api/chat', cookie)).json() as {
      messages: { parts: { type: string; data?: { resourceUri?: string } }[] }[];
    };
    const app = history.messages.at(-1)?.parts.find((p) => p.type === 'data-mcp-app');
    expect(app?.data?.resourceUri).toBe(PICKER);
  });

  it('runs the turn without ferry tools while Ferryhopper is down', async () => {
    const model = mockModel([textStep('Hello.')]);
    const { t, cookie } = await setupFerry(model, recordedFerryhopperFetch({ down: true }));

    const response = await send(t, cookie, 'Hi');
    expect(response.statusCode).toBe(200);
    expect(readStream(response).find((c) => c.type === 'text-delta')).toMatchObject({
      delta: 'Hello.',
    });
    const names = toolNames(model);
    expect(names.length).toBeGreaterThan(0);
    for (const name of FERRYHOPPER_PINNED_TOOLS) expect(names).not.toContain(name);
  });
});
