import {
  type CivilDate,
  setDailyMessageCap,
  startOfCivilDay,
  toLocalDateTime,
} from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type ChatTestApp,
  createChatTestApp,
  enterSpace,
  get,
  readStream,
  write,
} from '../testing';

// The soft daily message cap (PRD §6.1): N typed messages a property-day, the next one refused
// before any model call; card answers, the Guide and My trip keep working.

type StreamResult = { stream: ReadableStream<unknown> };

const ZONE = 'Europe/Zagreb';

const usage = () => ({
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
});

const textStep = (text: string): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: usage() },
    ],
  }),
});

const callStep = (id: string, toolName: string, input: unknown): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: usage() },
    ],
  }),
});

const DRAFT = { message: 'The shower has no hot water.', reason: 'problem', urgency: 'urgent' };

const apps: ChatTestApp[] = [];
afterAll(async () => {
  await Promise.all(apps.map((t) => t.close()));
});

describe.each(['mcp', 'inprocess'] as const)('the daily message cap (%s)', (transport) => {
  it('lets N messages through, refuses the next without the model, and resets at the property’s midnight', async () => {
    const steps: StreamResult[] = [];
    const model = new MockLanguageModelV4({ doStream: steps as never });
    const t = await createChatTestApp({ model, transport });
    apps.push(t);
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 2 });
    const { cookie } = await enterSpace(t, seed);
    const send = (text: string) => write('POST', t.app, '/api/chat', { text }, { cookie });
    await setDailyMessageCap(t.db, 2, t.clock.now());

    steps.push(textStep('Hello!'));
    expect((await send('Hi')).statusCode).toBe(200);
    // The second message opens a Host message card.
    steps.push(
      callStep('call-draft', 'draft_host_message', DRAFT),
      callStep('call-send', 'send_host_message', DRAFT),
    );
    const opened = await send('The shower has no hot water');
    expect(opened.statusCode).toBe(200);
    readStream(opened);
    expect(model.doStreamCalls).toHaveLength(3);

    const capped = await send('One more thing');
    expect([capped.statusCode, capped.json()]).toEqual([429, { error: 'message-cap' }]);
    expect(model.doStreamCalls).toHaveLength(3);

    // My trip and the Guide are untouched.
    expect((await get(t.app, '/api/orders', cookie)).statusCode).toBe(200);
    expect((await get(t.app, '/api/plan', cookie)).statusCode).toBe(200);
    expect((await get(t.app, '/api/unit', cookie)).statusCode).toBe(200);

    // A card answer is not a typed message: it still goes through.
    steps.push(textStep('I sent your message to your host.'));
    const tap = await write(
      'POST',
      t.app,
      '/api/chat',
      {
        answer: { toolCallId: 'call-send', action: 'accept', content: { message: 'No hot water' } },
      },
      { cookie },
    );
    expect(tap.statusCode).toBe(200);
    expect(model.doStreamCalls).toHaveLength(4);
    // ...and it does not count towards the cap.
    expect((await send('Still capped')).statusCode).toBe(429);

    // The admin raising the cap applies to the next message.
    await setDailyMessageCap(t.db, 3, t.clock.now());
    steps.push(textStep('Sure.'));
    expect((await send('One more')).statusCode).toBe(200);
    expect((await send('And another')).statusCode).toBe(429);

    // A new day at the property.
    const today = toLocalDateTime(t.clock.now(), ZONE).slice(0, 10) as CivilDate;
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10) as CivilDate;
    t.clock.advance(startOfCivilDay(tomorrow, ZONE).getTime() - t.clock.now().getTime() + 1000);
    steps.push(textStep('Good morning!'));
    expect((await send('Good morning')).statusCode).toBe(200);
    expect(model.doStreamCalls).toHaveLength(6);
  });
});
