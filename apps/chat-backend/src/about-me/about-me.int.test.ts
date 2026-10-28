import { type AboutMe, EMPTY_ABOUT_ME, SPACE_COOKIE } from '@fetivi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieFrom, createTestApp, get, seedLiveUnit, type TestApp, write } from '../testing';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t?.close();
});

const CLOSED_AT = new Date('2026-10-24T22:00:00Z');

async function enter(slug: string, pin: string): Promise<string> {
  const response = await write('POST', t.app, `/api/access/${slug}/pin`, { pin, language: 'en' });
  const cookie = cookieFrom(response, SPACE_COOKIE);
  if (!cookie) throw new Error(`PIN entry failed: ${response.body}`);
  return cookie;
}

const read = (cookie?: string) => get(t.app, '/api/about-me', cookie);
const put = (body: unknown, cookie?: string, origin?: string | null) =>
  write('PUT', t.app, '/api/about-me', body, { cookie, origin });

const FULL: AboutMe = {
  party: 'family',
  interests: ['nature', 'beaches'],
  pace: 'easy',
  budget: 'mid',
  transport: 'car',
  needs: ['step_free', 'gluten_free'],
};
const CANONICAL: AboutMe = {
  ...FULL,
  interests: ['beaches', 'nature'],
  needs: ['gluten_free', 'step_free'],
};

describe('About me endpoints', () => {
  it('needs a Space, and the app origin to write', async () => {
    expect((await read()).statusCode).toBe(401);
    expect((await read()).json()).toEqual({ error: 'no-space' });
    const noSpace = await put(EMPTY_ABOUT_ME);
    expect(noSpace.statusCode).toBe(401);
    expect(noSpace.json()).toEqual({ error: 'no-space' });

    const { slug, pin } = await seedLiveUnit(t.db);
    const cookie = await enter(slug, pin);
    const foreign = await put(EMPTY_ABOUT_ME, cookie, 'http://evil.test');
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toEqual({ error: 'bad-origin' });
  });

  it("stores the guest's own choices, needs included", async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const cookie = await enter(slug, pin);
    expect((await read(cookie)).json()).toEqual({ aboutMe: EMPTY_ABOUT_ME });
    const saved = await put(FULL, cookie);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ aboutMe: CANONICAL });
    expect((await read(cookie)).json()).toEqual({ aboutMe: CANONICAL });
  });

  it('refuses unknown keys and codes and changes nothing', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const cookie = await enter(slug, pin);
    await put(FULL, cookie);
    for (const body of [
      { ...FULL, special: true },
      { ...FULL, interests: ['halal'] },
      { ...FULL, needs: ['halal'] },
      { ...FULL, transport: 'plane' },
      { ...FULL, transport: undefined },
      { ...FULL, name: 'Ana' },
    ]) {
      const response = await put(body, cookie);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid-input' });
    }
    expect((await read(cookie)).json()).toEqual({ aboutMe: CANONICAL });
  });

  it('keeps each Space of a Stay apart', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const first = await enter(slug, pin);
    const second = await enter(slug, pin);
    await put({ ...EMPTY_ABOUT_ME, party: 'couple' }, first);
    await put({ ...EMPTY_ABOUT_ME, party: 'friends' }, second);
    expect((await read(first)).json()).toMatchObject({ aboutMe: { party: 'couple' } });
    expect((await read(second)).json()).toMatchObject({ aboutMe: { party: 'friends' } });
  });

  // Last: it moves the shared clock past every Stay's end.
  it('allows only removals once the Stay has ended', async () => {
    const { slug, pin } = await seedLiveUnit(t.db);
    const cookie = await enter(slug, pin);
    await put(FULL, cookie);
    t.clock.advance(CLOSED_AT.getTime() - t.clock.now().getTime() + 60_000);

    const added = await put({ ...CANONICAL, interests: [...CANONICAL.interests, 'food'] }, cookie);
    expect(added.statusCode).toBe(409);
    expect(added.json()).toEqual({ error: 'space-closed' });

    const removed = await put({ ...CANONICAL, pace: null, needs: ['step_free'] }, cookie);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ aboutMe: { ...CANONICAL, pace: null, needs: ['step_free'] } });
    expect((await read(cookie)).json()).toEqual(removed.json());
  });
});
