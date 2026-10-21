import { fromLocalDateTime, orders } from '@fetivi/domain';
import {
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { createEgress } from '@fetivi/egress';
import type { UIMessageChunk } from 'ai';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, readStream, write } from '../testing';
import { createChatModel } from './model';

// The booking flow with real Sonnet 5.5: three or four turns, about $0.05. Opt-in only (vitest
// does not load the root .env):
// FETIVI_LIVE_TESTS=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run --project integration apps/chat-backend/src/chat/booking.live.int.test.ts
const apiKey = process.env.ANTHROPIC_API_KEY;
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(apiKey);

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!live)('live booking (Sonnet 5.5)', () => {
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

  const post = async (cookie: string, body: object) => {
    const response = await write('POST', t.app, '/api/chat', body, { cookie });
    expect(response.statusCode).toBe(200);
    const chunks = readStream(response);
    expect(chunks.filter((c) => c.type === 'error')).toEqual([]);
    const text = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => (c as { delta: string }).delta)
      .join('');
    return { chunks, text };
  };
  const cardOf = (chunks: UIMessageChunk[]) =>
    chunks.find((c) => c.type === 'data-elicitation') as unknown as
      | { id: string; data: { draft: { quantity: number } } }
      | undefined;

  it('books the boat trip only after the guest confirms the card', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), checkInInDays: 0 });
    const destinationId = await seedDestination(t.db);
    const provider = await seedProvider(t.db);
    const day = plusDays(seed.stay.checkIn, 1);
    const boat = await seedOrderableOffer(t.db, {
      providerId: provider.id,
      destinationId,
      availabilityMode: 'allotment',
      startsAt: fromLocalDateTime(`${day}T09:00`, 'Europe/Zagreb'),
      capacity: 20,
      title: 'Blue Lagoon boat trip',
      category: 'boat_trip',
      priceMinor: 4500,
      contactFields: 'name',
    });
    await publishOffer(t.db, boat.offerId);
    const { cookie, space } = await enterSpace(t, seed);

    const list = await post(cookie, { text: 'Which boat trips can I book?' });
    console.info('turn 1:', list.text);
    expect(list.text).toContain('Blue Lagoon');

    let turn = await post(cookie, {
      text: `Book the Blue Lagoon trip for 2 people on ${day} at 9.`,
    });
    console.info('turn 2:', turn.text);
    if (!cardOf(turn.chunks)) {
      // The model may confirm the details in words first.
      turn = await post(cookie, { text: 'Yes, please book it.' });
      console.info('turn 3:', turn.text);
    }
    const card = cardOf(turn.chunks);
    expect(card?.data.draft.quantity).toBe(2);
    const placedBefore = await t.db.select().from(orders).where(eq(orders.spaceId, space.space.id));
    expect(placedBefore).toEqual([]);

    const done = await post(cookie, {
      answer: {
        toolCallId: card?.id,
        action: 'accept',
        content: { email: 'guest@example.test', name: 'Ana' },
      },
    });
    console.info('after the tap:', done.text);
    const placed = await t.db.select().from(orders).where(eq(orders.spaceId, space.space.id));
    expect(placed).toHaveLength(1);
    expect(done.text.length).toBeGreaterThan(0);
  });
});
