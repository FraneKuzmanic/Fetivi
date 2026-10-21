import { randomUUID } from 'node:crypto';
import { catalogRecords, seedTrogir } from '@fetivi/domain';
import { noopQueue, publishCatalog, seedGuestUnit } from '@fetivi/domain/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, enterSpace, get, type TestApp, write } from '../testing';

let t: TestApp;
let placeId: string;
let otherPlaceId: string;

beforeAll(async () => {
  t = await createTestApp();
  const { destinationId } = await seedTrogir(t.db, noopQueue, t.clock.now());
  await publishCatalog(t.db, destinationId);
  const places = await t.db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(and(eq(catalogRecords.destinationId, destinationId), eq(catalogRecords.kind, 'place')));
  const [first, second] = places;
  if (!first || !second) throw new Error('no places seeded');
  placeId = first.id;
  otherPlaceId = second.id;
});

afterAll(async () => {
  await t?.close();
});

async function guest() {
  const seed = await seedGuestUnit(t.db, { now: t.clock.now() });
  const { cookie } = await enterSpace(t, seed);
  return { seed, cookie };
}

const list = (cookie?: string) => get(t.app, '/api/saved-places', cookie);
const save = (id: string, cookie?: string, origin?: string | null) =>
  write('PUT', t.app, `/api/saved-places/${id}`, undefined, { cookie, origin });
const unsave = (id: string, cookie?: string) =>
  write('DELETE', t.app, `/api/saved-places/${id}`, undefined, { cookie });

describe('Saved places endpoints', () => {
  it('needs a Space, and the app origin to write', async () => {
    expect([(await list()).statusCode, (await list()).json()]).toEqual([
      401,
      { error: 'no-space' },
    ]);
    expect((await save(placeId)).statusCode).toBe(401);
    const { cookie } = await guest();
    const foreign = await save(placeId, cookie, 'http://evil.test');
    expect([foreign.statusCode, foreign.json()]).toEqual([403, { error: 'bad-origin' }]);
  });

  it('saves and removes a place the guest can see', async () => {
    const { cookie } = await guest();
    expect((await list(cookie)).json()).toEqual({ placeIds: [] });
    const saved = await save(placeId, cookie);
    expect([saved.statusCode, saved.json()]).toEqual([200, { placeIds: [placeId] }]);
    expect((await save(placeId, cookie)).json()).toEqual({ placeIds: [placeId] });
    expect((await list(cookie)).json()).toEqual({ placeIds: [placeId] });
    const removed = await unsave(placeId, cookie);
    expect([removed.statusCode, removed.json()]).toEqual([200, { placeIds: [] }]);
  });

  it('answers 404 for an unknown place and 400 for a bad id', async () => {
    const { cookie } = await guest();
    const unknown = await save(randomUUID(), cookie);
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: 'not-found' }]);
    const bad = await save('not-a-uuid', cookie);
    expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'invalid-input' }]);
  });

  it('keeps each Space of a Stay apart', async () => {
    const { seed, cookie: first } = await guest();
    const { cookie: second } = await enterSpace(t, seed);
    await save(placeId, first);
    await save(otherPlaceId, second);
    expect((await list(first)).json()).toEqual({ placeIds: [placeId] });
    expect((await list(second)).json()).toEqual({ placeIds: [otherPlaceId] });
  });

  // Last: it moves the shared clock past every Stay's end.
  it('allows only removals once the Stay has ended', async () => {
    const { cookie } = await guest();
    await save(placeId, cookie);
    t.clock.advance(7 * 86_400_000);

    const added = await save(otherPlaceId, cookie);
    expect([added.statusCode, added.json()]).toEqual([409, { error: 'space-closed' }]);
    const removed = await unsave(placeId, cookie);
    expect([removed.statusCode, removed.json()]).toEqual([200, { placeIds: [] }]);
  });
});
