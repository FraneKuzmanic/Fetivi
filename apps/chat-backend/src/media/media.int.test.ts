import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { blockMedia, infoBlocks } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, enterSpace, get, type TestApp } from '../testing';

const DAY = 86_400_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.close();
});

/** A unit with one always-visible how-to and one after-release arrival block, each with a photo. */
async function seedWithMedia() {
  const seed = await seedGuestUnit(t.db, {
    now: t.clock.now(),
    checkInInDays: 2,
    blocks: [
      {
        category: 'how_tos',
        title: 'Washer',
        body: 'Program 3.',
        media: [{ caption: 'Dial', contentType: 'image/png' }],
      },
      {
        category: 'arrival_access',
        title: 'Lockbox',
        body: 'By the door.',
        media: [{ caption: 'Lockbox', contentType: 'image/png' }],
      },
    ],
  });
  const [howTo, arrival] = seed.extraBlocks;
  const ids = { howTo: howTo?.media[0] ?? '', arrival: arrival?.media[0] ?? '' };
  for (const id of Object.values(ids)) await writeFile(path.join(t.mediaDir, `${id}.png`), PNG);
  const { cookie } = await enterSpace(t, seed);
  return { seed, ids, cookie, howToBlock: howTo?.id ?? '' };
}

describe('GET /api/media/:id', () => {
  it('serves a published item with its type, and byte ranges', async () => {
    const { ids, cookie } = await seedWithMedia();
    const full = await get(t.app, `/api/media/${ids.howTo}`, cookie);
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/png');
    expect(full.headers['x-content-type-options']).toBe('nosniff');
    expect(full.headers['cache-control']).toBe('private, max-age=86400');
    expect(full.rawPayload.equals(PNG)).toBe(true);

    const range = await t.app.inject({
      method: 'GET',
      url: `/api/media/${ids.howTo}`,
      headers: { cookie, range: 'bytes=0-1' },
    });
    expect(range.statusCode).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-1/${PNG.length}`);
    expect(range.rawPayload.equals(PNG.subarray(0, 2))).toBe(true);
  });

  it('holds back the media of an after-release block until the release', async () => {
    const { ids, cookie } = await seedWithMedia();
    expect((await get(t.app, `/api/media/${ids.arrival}`, cookie)).statusCode).toBe(404);
    t.clock.advance(3 * DAY);
    expect((await get(t.app, `/api/media/${ids.arrival}`, cookie)).statusCode).toBe(200);
  });

  it('hides an item added at a revision not yet published', async () => {
    const { cookie, howToBlock } = await seedWithMedia();
    await t.db.update(infoBlocks).set({ revision: 2 }).where(eq(infoBlocks.id, howToBlock));
    const [late] = await t.db
      .insert(blockMedia)
      .values({
        blockId: howToBlock,
        kind: 'image',
        contentType: 'image/png',
        bytes: PNG.length,
        caption: 'Late',
        addedRevision: 2,
        position: 1,
      })
      .returning();
    await writeFile(path.join(t.mediaDir, `${late?.id}.png`), PNG);
    expect((await get(t.app, `/api/media/${late?.id}`, cookie)).statusCode).toBe(404);
  });

  it("refuses another unit's media, a missing cookie and a malformed id", async () => {
    const a = await seedWithMedia();
    const b = await seedWithMedia();
    expect((await get(t.app, `/api/media/${b.ids.howTo}`, a.cookie)).statusCode).toBe(404);
    const anonymous = await get(t.app, `/api/media/${a.ids.howTo}`);
    expect(anonymous.statusCode).toBe(401);
    expect((await get(t.app, '/api/media/..%2F..%2Fetc', a.cookie)).statusCode).toBe(404);
    expect((await get(t.app, '/api/media/not-a-uuid', a.cookie)).statusCode).toBe(404);
  });
});
