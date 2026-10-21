import { readdir } from 'node:fs/promises';
import { blockMedia, QUEUES, uuidFrom } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  del,
  get,
  loginAs,
  patch,
  post,
  signUpVerifiedHost,
  TEST_ORIGIN,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostA: string;
let hostB: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  hostA = await loginAs(t, 'a@example.test');
  hostB = await loginAs(t, 'b@example.test');
});

afterAll(async () => {
  await t?.close();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(8)]);

interface MediaOut {
  id: string;
  kind: string;
  contentType: string;
  caption: string;
  addedRevision: number;
  position: number;
}

function upload(
  blockId: string,
  body: Buffer,
  contentType: string,
  caption: string | null = 'The dial',
  cookie = hostA,
) {
  const query = caption === null ? '' : `?caption=${encodeURIComponent(caption)}`;
  return t.app.inject({
    method: 'POST',
    url: `/api/host/blocks/${blockId}/media${query}`,
    headers: { 'content-type': contentType, origin: TEST_ORIGIN, cookie },
    payload: body,
  });
}

async function newBlock(cookie = hostA) {
  const p = await post(t.app, '/api/host/properties', { name: 'Villa' }, cookie);
  const propertyId = p.json().id as string;
  const u = await post(t.app, `/api/host/properties/${propertyId}/units`, { name: 'A1' }, cookie);
  const unitId = u.json().id as string;
  const r = await post(
    t.app,
    `/api/host/units/${unitId}/blocks`,
    { category: 'how_tos', title: 'Washer', body: 'Program 3.' },
    cookie,
  );
  expect(r.statusCode).toBe(201);
  return { propertyId, unitId, blockId: r.json().block.id as string };
}

const jobsFor = async (blockId: string) =>
  (await t.boss.findJobs<{ blockId: string; revision: number }>(QUEUES.translateBlock)).filter(
    (j) => j.data.blockId === blockId,
  );

const files = () => readdir(t.mediaDir).catch(() => [] as string[]);

describe('POST /api/host/blocks/:id/media', () => {
  it('stores the file, adds a revision and enqueues its translation', async () => {
    const { blockId } = await newBlock();
    const r = await upload(blockId, PNG, 'image/png');
    expect(r.statusCode).toBe(201);
    const { media, block } = r.json() as {
      media: MediaOut;
      block: { revision: number; translation: { status: string }; media: MediaOut[] };
    };
    expect(media).toMatchObject({
      kind: 'image',
      contentType: 'image/png',
      caption: 'The dial',
      addedRevision: 2,
      position: 0,
    });
    expect(block.revision).toBe(2);
    expect(block.translation.status).toBe('pending');
    expect(block.media.map((m) => m.id)).toEqual([media.id]);
    expect(await files()).toContain(`${media.id}.png`);
    const jobs = await jobsFor(blockId);
    expect(jobs.map((j) => j.id)).toContain(uuidFrom(`translate:${blockId}:2`));
  });

  it('accepts a video and strips newlines from the caption', async () => {
    const { blockId } = await newBlock();
    const r = await upload(blockId, MP4, 'video/mp4', 'Load it\nthen start');
    expect(r.statusCode).toBe(201);
    expect(r.json().media).toMatchObject({ kind: 'video', caption: 'Load it then start' });
  });

  it('checks the bytes, not the declared type', async () => {
    const { blockId } = await newBlock();
    expect((await upload(blockId, JPEG, 'image/png')).statusCode).toBe(415);
    const text = await upload(blockId, Buffer.from('just some text here'), 'image/png');
    expect(text.statusCode).toBe(415);
    expect(text.json()).toEqual({ error: 'unsupported-media' });
    const gif = await upload(blockId, Buffer.from('GIF89a....'), 'image/gif');
    expect(gif.statusCode).toBe(415);
    expect(gif.json()).toEqual({ error: 'unsupported-media' });
    expect((await upload(blockId, Buffer.alloc(0), 'image/png')).statusCode).not.toBe(201);
  });

  it('keeps media errors to the upload route', async () => {
    const { blockId } = await newBlock();
    const headers = { origin: TEST_ORIGIN, cookie: hostA };
    const wrongType = await t.app.inject({
      method: 'PATCH',
      url: `/api/host/blocks/${blockId}`,
      headers: { ...headers, 'content-type': 'text/plain' },
      payload: 'title',
    });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json()).toEqual({ error: 'invalid-input' });
    const tooBig = await t.app.inject({
      method: 'PATCH',
      url: `/api/host/blocks/${blockId}`,
      headers: { ...headers, 'content-type': 'application/json' },
      payload: JSON.stringify({ body: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.json()).toEqual({ error: 'invalid-input' });
  });

  it('enforces the size, count and caption limits', async () => {
    const { blockId } = await newBlock();
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    const tooBig = await upload(blockId, big, 'image/png');
    expect(tooBig.statusCode).toBe(413);
    expect(tooBig.json()).toEqual({ error: 'media-too-large' });
    expect((await upload(blockId, PNG, 'image/png', null)).statusCode).toBe(400);
    expect((await upload(blockId, PNG, 'image/png', '   ')).statusCode).toBe(400);
    expect((await upload(blockId, PNG, 'image/png', 'x'.repeat(201))).statusCode).toBe(400);
    for (let i = 0; i < 6; i++) {
      expect((await upload(blockId, PNG, 'image/png', `item ${i}`)).statusCode).toBe(201);
    }
    const seventh = await upload(blockId, PNG, 'image/png');
    expect(seventh.statusCode).toBe(400);
    expect(seventh.json()).toEqual({ error: 'too-many-media' });
    const rows = await t.db.select().from(blockMedia).where(eq(blockMedia.blockId, blockId));
    expect(rows).toHaveLength(6);
    // Refused uploads leave no file behind.
    const names = new Set(await files());
    expect(rows.every((m) => names.has(`${m.id}.png`))).toBe(true);
  });

  it("refuses another host's block and a request from another origin", async () => {
    const { blockId } = await newBlock();
    expect((await upload(blockId, PNG, 'image/png', 'x', hostB)).statusCode).toBe(404);
    const foreign = await t.app.inject({
      method: 'POST',
      url: `/api/host/blocks/${blockId}/media?caption=x`,
      headers: { 'content-type': 'image/png', origin: 'http://evil.test', cookie: hostA },
      payload: PNG,
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('caption edits, deletes and previews', () => {
  async function withItem() {
    const block = await newBlock();
    const r = await upload(block.blockId, PNG, 'image/png');
    return { ...block, media: r.json().media as MediaOut };
  }

  it('bumps the revision only when the caption changes', async () => {
    const { blockId, media } = await withItem();
    const same = await patch(t.app, `/api/host/media/${media.id}`, { caption: 'The dial' }, hostA);
    expect(same.statusCode).toBe(200);
    expect(same.json().block.revision).toBe(2);
    const changed = await patch(t.app, `/api/host/media/${media.id}`, { caption: 'Dial' }, hostA);
    expect(changed.json().block.revision).toBe(3);
    expect(changed.json().media.caption).toBe('Dial');
    expect((await jobsFor(blockId)).map((j) => j.id)).toContain(uuidFrom(`translate:${blockId}:3`));
  });

  it('serves the preview to its owner only', async () => {
    const { media } = await withItem();
    const r = await get(t.app, `/api/host/media/${media.id}`, hostA);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('private, max-age=3600');
    expect(r.rawPayload.equals(PNG)).toBe(true);
    expect((await get(t.app, `/api/host/media/${media.id}`, hostB)).statusCode).toBe(404);
    expect(
      (await patch(t.app, `/api/host/media/${media.id}`, { caption: 'x' }, hostB)).statusCode,
    ).toBe(404);
    expect((await del(t.app, `/api/host/media/${media.id}`, hostB)).statusCode).toBe(404);
    expect((await get(t.app, '/api/host/media/not-a-uuid', hostA)).statusCode).toBe(400);
  });

  it('deletes the row and the file without a new revision', async () => {
    const { blockId, media } = await withItem();
    expect((await del(t.app, `/api/host/media/${media.id}`, hostA)).statusCode).toBe(204);
    expect(await files()).not.toContain(`${media.id}.png`);
    const rows = await t.db.select().from(blockMedia).where(eq(blockMedia.id, media.id));
    expect(rows).toEqual([]);
    expect((await jobsFor(blockId)).map((j) => j.data.revision)).not.toContain(3);
  });

  it('removes the files with their block, unit or property', async () => {
    const a = await withItem();
    expect((await del(t.app, `/api/host/blocks/${a.blockId}`, hostA)).statusCode).toBe(204);
    const b = await withItem();
    expect((await del(t.app, `/api/host/units/${b.unitId}`, hostA)).statusCode).toBe(204);
    const c = await withItem();
    expect((await del(t.app, `/api/host/properties/${c.propertyId}`, hostA)).statusCode).toBe(204);
    const names = await files();
    for (const m of [a.media, b.media, c.media]) expect(names).not.toContain(`${m.id}.png`);
  });

  it('lists the media in the unit detail', async () => {
    const { unitId, blockId, media } = await withItem();
    const r = await get(t.app, `/api/host/units/${unitId}`, hostA);
    const block = (r.json().blocks as { id: string; media: MediaOut[] }[]).find(
      (b) => b.id === blockId,
    );
    expect(block?.media.map((m) => m.id)).toEqual([media.id]);
  });
});
