import { pushSubscriptions, spaces } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, get, write } from '../testing';

const PUBLIC_KEY = 'BTestVapidPublicKey';
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const KEYS = { p256dh: 'p256dh-key', auth: 'auth-key' };

let t: ChatTestApp;

beforeAll(async () => {
  t = await createChatTestApp({ model: null, pushPublicKey: PUBLIC_KEY });
});

afterAll(async () => {
  await t?.close();
});

async function guest() {
  const seed = await seedGuestUnit(t.db, { now: t.clock.now() });
  return enterSpace(t, seed);
}

const offeredAt = async (spaceId: string) =>
  (await t.db.select().from(spaces).where(eq(spaces.id, spaceId)))[0]?.pushOfferedAt;

describe('push routes', () => {
  it('records the offer once', async () => {
    const { cookie, space } = await guest();
    expect((await get(t.app, '/api/push', cookie)).json()).toEqual({
      publicKey: PUBLIC_KEY,
      offered: false,
      subscribed: false,
    });
    expect((await write('POST', t.app, '/api/push/offer', {}, { cookie })).statusCode).toBe(204);
    const first = await offeredAt(space.space.id);
    expect(first).toBeInstanceOf(Date);
    t.clock.advance(60_000);
    await write('POST', t.app, '/api/push/offer', {}, { cookie });
    expect(await offeredAt(space.space.id)).toEqual(first);
    expect((await get(t.app, '/api/push', cookie)).json()).toMatchObject({ offered: true });
  });

  it('stores an allowed subscription and spends the offer', async () => {
    const { cookie } = await guest();
    const saved = await write(
      'POST',
      t.app,
      '/api/push/subscription',
      { endpoint: FCM, keys: KEYS },
      { cookie },
    );
    expect(saved.statusCode).toBe(204);
    expect((await get(t.app, '/api/push', cookie)).json()).toEqual({
      publicKey: PUBLIC_KEY,
      offered: true,
      subscribed: true,
    });
  });

  it('refuses an endpoint outside the push services', async () => {
    const { cookie, space } = await guest();
    const res = await write(
      'POST',
      t.app,
      '/api/push/subscription',
      { endpoint: 'https://evil.example/push', keys: KEYS },
      { cookie },
    );
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'push-endpoint' });
    expect(await offeredAt(space.space.id)).toBeNull();
  });

  it('moves an endpoint to the space that subscribed it last', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/shared-device';
    const first = await guest();
    const second = await guest();
    for (const g of [first, second]) {
      await write('POST', t.app, '/api/push/subscription', { endpoint, keys: KEYS }, g);
    }
    const rows = await t.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(rows.map((r) => r.spaceId)).toEqual([second.space.space.id]);
    expect((await get(t.app, '/api/push', first.cookie)).json()).toMatchObject({
      subscribed: false,
    });
  });

  it('needs the space cookie', async () => {
    expect((await get(t.app, '/api/push')).statusCode).toBe(401);
    expect((await write('POST', t.app, '/api/push/offer', {})).statusCode).toBe(401);
  });
});
