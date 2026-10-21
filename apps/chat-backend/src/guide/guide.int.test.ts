import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogRecords, type GuestProjection, seedTrogir, turnMetrics } from '@fetivi/domain';
import { noopQueue, publishCatalog, seedGuestUnit } from '@fetivi/domain/testing';
import { MockLanguageModelV4 } from 'ai/test';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, get, write } from '../testing';

const DAY = 86_400_000;

/** Any model call fails the test: the Guide never calls the model. */
const model = new MockLanguageModelV4({
  doStream: () => {
    throw new Error('model called');
  },
});

let t: ChatTestApp;

beforeAll(async () => {
  t = await createChatTestApp({ model });
});

afterAll(async () => {
  await t?.close();
});

const HOW_TO = {
  category: 'how_tos' as const,
  title: 'Washer',
  body: '1. Open the door.\n2. Program 3.',
  media: [{ caption: 'The dial', contentType: 'image/png' as const }],
};

describe('GET /api/unit', () => {
  it('needs a space', async () => {
    const response = await get(t.app, '/api/unit');
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'no-space' }]);
  });

  it('returns the unit record in the Space language, gated until the release', async () => {
    const seed = await seedGuestUnit(t.db, {
      now: t.clock.now(),
      checkInInDays: 2,
      blocks: [HOW_TO],
    });
    const { cookie } = await enterSpace(t, seed);

    const before = (await get(t.app, '/api/unit', cookie)).json().unit as GuestProjection;
    expect(before.arrival).toBeNull();
    expect(before.wifi?.password).toBeNull();
    expect(before.contacts.hostPhone).toBeNull();
    const howTo = before.blocks.find((b) => b.category === 'how_tos');
    expect(howTo?.media).toEqual([
      { id: seed.extraBlocks[0]?.media[0], kind: 'image', caption: 'en:The dial' },
    ]);

    const switched = await write('PATCH', t.app, '/api/space', { language: 'de' }, { cookie });
    expect(switched.statusCode).toBe(200);
    const german = (await get(t.app, '/api/unit', cookie)).json().unit as GuestProjection;
    expect(german.language).toBe('de');
    expect(german.blocks.map((b) => b.title)).toContain(seed.alwaysTitle('de'));
    expect(german.blocks.find((b) => b.category === 'how_tos')?.media[0]?.caption).toBe(
      'de:The dial',
    );

    t.clock.advance(3 * DAY);
    const after = (await get(t.app, '/api/unit', cookie)).json().unit as GuestProjection;
    expect(after.arrival?.doorCode).toBe(seed.secrets.doorCode);
    expect(after.wifi?.password).toBe(seed.secrets.wifiPassword);
    expect(after.contacts.hostPhone).toBe(seed.secrets.hostPhone);
  });
});

describe('GET /api/guide/saved-places', () => {
  it('is empty without saved places or a destination', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), location: null });
    const { cookie } = await enterSpace(t, seed);
    expect((await get(t.app, '/api/guide/saved-places', cookie)).json()).toEqual({ places: [] });
  });

  it('returns the saved places as cards, newest first', async () => {
    const own = await createChatTestApp({ model });
    try {
      const { destinationId } = await seedTrogir(own.db, noopQueue, own.clock.now());
      await publishCatalog(own.db, destinationId);
      const places = await own.db
        .select({ id: catalogRecords.id })
        .from(catalogRecords)
        .where(
          and(eq(catalogRecords.destinationId, destinationId), eq(catalogRecords.kind, 'place')),
        );
      const [first, second] = places;
      if (!first || !second) throw new Error('no places');
      const seed = await seedGuestUnit(own.db, { now: own.clock.now() });
      const { cookie } = await enterSpace(own, seed);
      for (const id of [first.id, second.id]) {
        const saved = await write('PUT', own.app, `/api/saved-places/${id}`, undefined, {
          cookie,
        });
        expect(saved.statusCode).toBe(200);
        own.clock.advance(1000);
      }

      const response = await get(own.app, '/api/guide/saved-places', cookie);
      expect(response.statusCode).toBe(200);
      const cards = response.json().places as { id: string; title: string; summary: string }[];
      expect(cards.map((c) => c.id)).toEqual([second.id, first.id]);
      expect(cards[0]?.title).toMatch(/^\[en\] /);
      expect(cards.every((c) => c.summary.length <= 160)).toBe(true);
    } finally {
      await own.close();
    }
  });
});

describe('the Guide never calls the model', () => {
  it('serves the unit, saved places and media with no model call or turn', async () => {
    const seed = await seedGuestUnit(t.db, { now: t.clock.now(), blocks: [HOW_TO] });
    const { cookie } = await enterSpace(t, seed);
    const mediaId = seed.extraBlocks[0]?.media[0] ?? '';
    await writeFile(path.join(t.mediaDir, `${mediaId}.png`), Buffer.from([0x89, 0x50]));

    expect((await get(t.app, '/api/unit', cookie)).statusCode).toBe(200);
    expect((await get(t.app, '/api/guide/saved-places', cookie)).statusCode).toBe(200);
    expect((await get(t.app, `/api/media/${mediaId}`, cookie)).statusCode).toBe(200);
    expect(model.doStreamCalls).toHaveLength(0);
    expect(await t.db.select().from(turnMetrics)).toEqual([]);
  });
});
