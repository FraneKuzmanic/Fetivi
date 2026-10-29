import { findConversation, turnMetrics } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { createEgress } from '@fetivi/egress';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, readStream, write } from '../testing';
import { createChatModel } from './model';

// Six real Sonnet 5.5 turns on the seeded unit, about $0.10. Opt-in only (vitest does not load
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

  /**
   * What the guest is shown: the words and the cards' data. A turn may answer with a card alone
   * (a host message offered for a gap, which the next turn cancels).
   */
  const answer = async (cookie: string, text: string, label: string) => {
    const response = await write('POST', t.app, '/api/chat', { text }, { cookie });
    expect(response.statusCode).toBe(200);
    const chunks = readStream(response);
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    const words = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    const cards = chunks.filter((c) => c.type.startsWith('data-'));
    console.info(`${label}:`, words, cards.map((c) => c.type).join(' '));
    const shown = `${words} ${cards.map((c) => JSON.stringify(c)).join(' ')}`.trim();
    expect(shown.length).toBeGreaterThan(0);
    return shown;
  };

  it('answers from the unit record and reads the history from the cache', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 0 });
    const { cookie, space } = await enterSpace(t, seed);

    const wifi = await answer(cookie, "What's the Wi-Fi password?", 'turn 1');
    expect(wifi).toContain(seed.secrets.wifiPassword);

    const network = await answer(cookie, 'And the network name?', 'turn 2');
    // The fixture names the network Net-<tag>, the tag inside the password W-<tag>-4.
    expect(network).toContain(`Net-${seed.secrets.wifiPassword.split('-')[1]}`);

    // Wording is for a human to read: no tool can name a venue yet.
    await answer(cookie, 'Which restaurant is best for dinner tonight?', 'turn 3');

    // A language switch adds a system note mid-conversation, which Anthropic accepts only
    // after a user message.
    const patched = await write('PATCH', t.app, '/api/space', { language: 'hr' }, { cookie });
    expect(patched.statusCode).toBe(200);
    await answer(cookie, 'Where do I park?', 'turn 4');
    await answer(cookie, 'What time is checkout?', 'turn 5');
    await answer(cookie, 'Is there a bakery nearby?', 'turn 6');

    const conversation = await findConversation(t.db, space.space.id);
    if (!conversation) throw new Error('no conversation');
    const rows = await t.db
      .select()
      .from(turnMetrics)
      .where(eq(turnMetrics.conversationId, conversation.id))
      .orderBy(asc(turnMetrics.id));
    for (const [i, r] of rows.entries()) {
      console.info(
        `metrics turn ${i + 1}: steps ${r.steps}, input ${r.inputTokens}, cache read ${r.cacheReadTokens}, cache write ${r.cacheWriteTokens}, output ${r.outputTokens}, input/step ${Math.round(r.inputTokens / r.steps)}, cache read/step ${Math.round(r.cacheReadTokens / r.steps)}, wall ${r.wallMs} ms, mcp ${r.mcpMs} ms`,
      );
    }
    expect(rows).toHaveLength(6);
    expect(rows[1]?.cacheReadTokens).toBeGreaterThan(0);
    // The history is read from the cache: reads per step grow with it, while uncached input per
    // step stays small (the bound leaves room for tool results).
    const later = rows.slice(1);
    for (const r of later) {
      expect(r.cacheReadTokens).toBeGreaterThan(0);
      expect(r.inputTokens / r.steps).toBeLessThan(5_000);
    }
    const first = later[0];
    const last = later.at(-1);
    if (!first || !last) throw new Error('no rows');
    expect(last.cacheReadTokens / last.steps).toBeGreaterThan(first.cacheReadTokens / first.steps);
  }, 300_000);
});
