import { findConversation, turnMetrics } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { createEgress } from '@fetivi/egress';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, readStream, write } from '../testing';
import { createChatModel } from './model';

// Four real Sonnet 5.5 turns on the seeded unit, about $0.05. Opt-in only (vitest does not load
// the root .env):
// FETIVI_LIVE_TESTS=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run --project integration apps/chat-backend/src/chat/chat.live.int.test.ts
const apiKey = process.env.ANTHROPIC_API_KEY;
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(apiKey);

describe.skipIf(!live)('live chat turn (Sonnet 5.5)', () => {
  let t: ChatTestApp;

  beforeAll(async () => {
    t = await createChatTestApp({
      model: createChatModel({
        apiKey,
        fetch: createEgress({ allowlist: ['api.anthropic.com'] }).fetch,
      }),
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  const answer = async (cookie: string, text: string) => {
    const response = await write('POST', t.app, '/api/chat', { text }, { cookie });
    expect(response.statusCode).toBe(200);
    const chunks = readStream(response);
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    return chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
  };

  it('answers from the unit record and reads the prefix from the cache', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 0 });
    const { cookie, space } = await enterSpace(t, seed);

    const wifi = await answer(cookie, "What's the Wi-Fi password?");
    console.info('turn 1:', wifi);
    expect(wifi).toContain(seed.secrets.wifiPassword);

    const network = await answer(cookie, 'And the network name?');
    console.info('turn 2:', network);
    // The fixture names the network Net-<tag>, the tag inside the password W-<tag>-4.
    expect(network).toContain(`Net-${seed.secrets.wifiPassword.split('-')[1]}`);

    const dinner = await answer(cookie, 'Which restaurant is best for dinner tonight?');
    // Wording is for a human to read: no tool can name a venue yet.
    console.info('turn 3:', dinner);
    expect(dinner.length).toBeGreaterThan(0);

    // A language switch adds a system note mid-conversation, which Anthropic accepts only
    // after a user message.
    const patched = await write('PATCH', t.app, '/api/space', { language: 'hr' }, { cookie });
    expect(patched.statusCode).toBe(200);
    const croatian = await answer(cookie, 'Where do I park?');
    console.info('turn 4:', croatian);
    expect(croatian.length).toBeGreaterThan(0);

    const conversation = await findConversation(t.db, space.space.id);
    if (!conversation) throw new Error('no conversation');
    const rows = await t.db
      .select()
      .from(turnMetrics)
      .where(eq(turnMetrics.conversationId, conversation.id))
      .orderBy(asc(turnMetrics.id));
    for (const [i, r] of rows.entries()) {
      console.info(
        `metrics turn ${i + 1}: input ${r.inputTokens}, cache read ${r.cacheReadTokens}, cache write ${r.cacheWriteTokens}, output ${r.outputTokens}, wall ${r.wallMs} ms, mcp ${r.mcpMs} ms`,
      );
    }
    expect(rows).toHaveLength(4);
    expect(rows[1]?.cacheReadTokens).toBeGreaterThan(0);
  }, 180_000);
});
