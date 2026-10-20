import { DEVICE_COOKIE, SPACE_COOKIE } from '@fetivi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createTestApp, get, seedLiveUnit, type TestApp, write } from '../testing';

let t: TestApp;
let ipSeq = 0;

beforeAll(async () => {
  t = await createTestApp({ trustProxy: 'loopback' });
});

afterAll(async () => {
  await t?.close();
});

const CLOSED_AT = '2026-10-24T22:00:00.000Z';

/** A client on its own IP, keeping the cookies the server sets, like a browser. */
function client() {
  const ip = `203.0.113.${++ipSeq}`;
  const jar = new Map<string, string>();
  const cookie = () => [...jar.values()].join('; ') || undefined;
  const keep = (response: Awaited<ReturnType<typeof get>>) => {
    for (const c of response.cookies) {
      if (c.maxAge === 0 || c.value === '') jar.delete(c.name);
      else jar.set(c.name, `${c.name}=${c.value}`);
    }
    return response;
  };
  const headers = { 'x-forwarded-for': ip };
  return {
    jar,
    open: async (slug: string) =>
      keep(
        await t.app.inject({
          method: 'GET',
          url: `/api/access/${slug}`,
          headers: { ...headers, ...(cookie() ? { cookie: cookie() as string } : {}) },
        }),
      ),
    pin: async (slug: string, pin: string, language = 'en') =>
      keep(
        await write(
          'POST',
          t.app,
          `/api/access/${slug}/pin`,
          { pin, language },
          {
            cookie: cookie(),
            headers,
          },
        ),
      ),
    space: async () =>
      keep(
        await t.app.inject({
          method: 'GET',
          url: '/api/space',
          headers: { ...headers, ...(cookie() ? { cookie: cookie() as string } : {}) },
        }),
      ),
    patchSpace: async (body: unknown, origin?: string | null) =>
      keep(await write('PATCH', t.app, '/api/space', body, { cookie: cookie(), headers, origin })),
  };
}

describe('GET /api/access/:slug', () => {
  it('answers 204 and sets a device cookie for a live link, revealing nothing else', async () => {
    const { slug } = await seedLiveUnit(t.db);
    const response = await get(t.app, `/api/access/${slug}`);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const device = response.cookies.find((c) => c.name === DEVICE_COOKIE);
    expect(device).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('answers 404 for an unknown slug', async () => {
    const response = await get(t.app, '/api/access/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not-found' });
  });
});

describe('POST /api/access/:slug/pin', () => {
  it('opens a space behind a __Host- cookie that lasts until closing plus 30 days', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const c = client();
    await c.open(slug);
    const response = await c.pin(slug, pin, 'hr');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      language: 'hr',
      closedAt: CLOSED_AT,
      closed: false,
      unitSlug: slug,
    });
    const header = [response.headers['set-cookie']].flat().find((h) => h?.startsWith(SPACE_COOKIE));
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    const space = response.cookies.find((x) => x.name === SPACE_COOKIE);
    const expected = (Date.parse(CLOSED_AT) + 30 * 86_400_000 - t.clock.now().getTime()) / 1000;
    expect(space?.maxAge).toBeGreaterThan(expected - 5);
    expect(space?.maxAge).toBeLessThanOrEqual(expected);

    const resolved = await c.space();
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual({
      language: 'hr',
      closedAt: CLOSED_AT,
      closed: false,
      unitSlug: slug,
    });
    expect(resolved.body).not.toMatch(/Villa|Apartment|Booker/);
  });

  it('opens a new space on a second entry and never attaches to the first', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const c = client();
    await c.pin(slug, pin, 'en');
    const first = c.jar.get(SPACE_COOKIE) as string;
    await c.pin(slug, pin, 'de');
    const second = c.jar.get(SPACE_COOKIE) as string;
    expect(second).not.toBe(first);
    expect((await get(t.app, '/api/space', first)).json().language).toBe('en');
    expect((await get(t.app, '/api/space', second)).json().language).toBe('de');
  });

  it('refuses a malformed body without counting it', async () => {
    const { slug } = await seedLiveUnit(t.db);
    const c = client();
    for (const pin of ['12345', '1234567', '12a456']) {
      expect((await c.pin(slug, pin)).statusCode).toBe(400);
    }
    expect((await c.pin(slug, '123456', 'es')).statusCode).toBe(400);
    for (let i = 0; i < 5; i++) expect((await c.pin(slug, '999999')).statusCode).toBe(401);
  });

  it('answers 404 for an unknown slug', async () => {
    expect((await client().pin('nope', '123456')).statusCode).toBe(404);
  });

  it('throttles a device after five wrong PINs, also for the right one, then lets it in', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const c = client();
    await c.open(slug);
    const wrong = await c.pin(slug, '999999');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'wrong-pin', retryAfter: 0 });
    for (let i = 0; i < 4; i++) await c.pin(slug, '999999');

    const throttled = await c.pin(slug, '999999');
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error).toBe('too-many-attempts');
    expect(throttled.json().retryAfter).toBeGreaterThan(0);
    expect(throttled.headers['retry-after']).toBe(String(throttled.json().retryAfter));
    expect((await c.pin(slug, pin)).statusCode).toBe(429);

    t.clock.advance(throttled.json().retryAfter * 1000);
    expect((await c.pin(slug, pin)).statusCode).toBe(201);
  });

  it('limits an IP that drops its device cookie: the 31st failure in a day waits', async () => {
    const { slug } = await seedLiveUnit(t.db);
    const headers = { 'x-forwarded-for': '198.51.100.7' };
    const attempt = () =>
      write(
        'POST',
        t.app,
        `/api/access/${slug}/pin`,
        { pin: '999999', language: 'en' },
        { headers },
      );
    for (let i = 0; i < 30; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
  });
});

describe('/api/space', () => {
  it('stores a new interface language and checks the origin and the body', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const c = client();
    await c.pin(slug, pin, 'en');
    const patched = await c.patchSpace({ language: 'de' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().language).toBe('de');
    expect((await c.space()).json().language).toBe('de');
    expect((await c.patchSpace({ language: 'it' }, null)).statusCode).toBe(403);
    expect((await c.patchSpace({ language: 'xx' })).statusCode).toBe(400);
  });

  it('answers 401 without a space, and clears a cookie that resolves to none', async () => {
    expect((await get(t.app, '/api/space')).json()).toEqual({ error: 'no-space' });
    const patched = await write('PATCH', t.app, '/api/space', { language: 'de' });
    expect(patched.statusCode).toBe(401);

    const garbage = await get(t.app, '/api/space', `${SPACE_COOKIE}=garbage`);
    expect(garbage.statusCode).toBe(401);
    const cleared = garbage.cookies.find((x) => x.name === SPACE_COOKIE);
    expect(cleared?.value).toBe('');
    expect(cookieFrom(garbage, SPACE_COOKIE)).toBe(`${SPACE_COOKIE}=`);
  });
});

// Moves the shared clock past checkout, so it runs last.
describe('after checkout day', () => {
  it('refuses the PIN and reports the space as closed', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const c = client();
    await c.pin(slug, pin);
    t.clock.advance(Date.parse(CLOSED_AT) - t.clock.now().getTime());
    expect((await c.space()).json()).toMatchObject({ closed: true });
    const late = await client().pin(slug, pin);
    expect(late.statusCode).toBe(401);
    expect(late.json().error).toBe('wrong-pin');
  });
});
