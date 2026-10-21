import { EMPTY_ABOUT_ME, getAboutMe, replaceAboutMe } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from '../../testing';
import { IDENTITY_ARGS } from '../tool';

const DAY = 24 * 60 * 60 * 1000;

let t: TestServer;

async function connect(token: string) {
  const client = new Client(
    { name: 'test-client', version: '0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${t.url}/trip`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

async function tokenFor(spaceId: string, extra: { scope?: string } = {}) {
  return signToken(t.keys, { server: 'trip', ctx: await contextOf(t.db, spaceId), ...extra });
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const client = await connect(token);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

async function listTools(token: string) {
  const client = await connect(token);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

/** A guest whose Stay is open now (arrives in two days). */
const seedOpen = () => seedGuestUnit(t.db);
/** A guest whose Stay ended weeks ago: its token is in phase `ended`. */
const seedEnded = () =>
  seedGuestUnit(t.db, { now: new Date(Date.now() - 40 * DAY), checkInInDays: 2, nights: 3 });

const aboutMeOf = (result: Awaited<ReturnType<typeof call>>) =>
  (result.structuredContent as { aboutMe: unknown }).aboutMe;

beforeAll(async () => {
  t = await createTestServer({ listen: true });
});

afterAll(async () => {
  await t?.close();
});

describe('trip tool list', () => {
  it('lists both About me tools while the Stay is open', async () => {
    const a = await seedOpen();
    const tools = await listTools(await tokenFor(a.spaceId));
    expect(tools.map((tool) => tool.name)).toEqual(['get_about_me', 'update_about_me']);
    const identity = new Set<string>(IDENTITY_ARGS.map((x) => x.toLowerCase()));
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      for (const key of Object.keys(tool.inputSchema.properties ?? {})) {
        expect(identity.has(key.toLowerCase())).toBe(false);
      }
    }
    const update = tools.find((tool) => tool.name === 'update_about_me');
    expect(update?.annotations?.destructiveHint).toBe(true);
    expect(Object.keys(update?.inputSchema.properties ?? {})).not.toContain('needs');
  });

  it('is read-only after checkout', async () => {
    const ended = await seedEnded();
    expect((await contextOf(t.db, ended.spaceId)).phase).toBe('ended');
    const token = await tokenFor(ended.spaceId);
    expect((await listTools(token)).map((tool) => tool.name)).toEqual(['get_about_me']);
    const read = await call(token, 'get_about_me');
    expect(read.isError).toBeFalsy();
    expect(aboutMeOf(read)).toEqual(EMPTY_ABOUT_ME);
    const write = await call(token, 'update_about_me', { pace: 'easy' }).then(
      (r) => (r.isError ? 'error' : 'ok'),
      () => 'error',
    );
    expect(write).toBe('error');
    expect(await getAboutMe(t.db, ended.spaceId)).toEqual(EMPTY_ABOUT_ME);
  });
});

describe('trip tools', () => {
  it('saves ordinary preferences and reads them back', async () => {
    const a = await seedOpen();
    const token = await tokenFor(a.spaceId);
    const saved = await call(token, 'update_about_me', {
      party: 'family',
      addInterests: ['beaches'],
    });
    expect(saved.isError).toBeFalsy();
    const expected = { ...EMPTY_ABOUT_ME, party: 'family', interests: ['beaches'] };
    expect(aboutMeOf(saved)).toEqual(expected);
    expect(aboutMeOf(await call(token, 'get_about_me'))).toEqual(expected);
    expect(await getAboutMe(t.db, a.spaceId)).toEqual(expected);
  });

  it('rejects special-category and unknown fields and stores nothing', async () => {
    const a = await seedOpen();
    const token = await tokenFor(a.spaceId);
    await call(token, 'update_about_me', { pace: 'mixed' });
    const before = await getAboutMe(t.db, a.spaceId);
    for (const args of [
      { needs: ['halal'] },
      { addInterests: ['beaches'], needs: ['gluten_free'] },
      { special: true, addInterests: ['food'] },
      { health: 'coeliac' },
      { addInterests: ['halal'] },
    ]) {
      const result = await call(token, 'update_about_me', args);
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    const after = await getAboutMe(t.db, a.spaceId);
    expect(after).toEqual(before);
    expect(after.needs).toEqual([]);
  });

  it("shows needs the guest saved and keeps them through the model's updates", async () => {
    const a = await seedOpen();
    const token = await tokenFor(a.spaceId);
    await replaceAboutMe(t.db, a.spaceId, { ...EMPTY_ABOUT_ME, needs: ['halal'] }, new Date());
    expect(aboutMeOf(await call(token, 'get_about_me'))).toMatchObject({ needs: ['halal'] });
    const updated = await call(token, 'update_about_me', { addInterests: ['food'] });
    expect(aboutMeOf(updated)).toMatchObject({ interests: ['food'], needs: ['halal'] });
  });

  it("never reads another Space's About me", async () => {
    const a = await seedOpen();
    const b = await seedOpen();
    await replaceAboutMe(t.db, a.spaceId, { ...EMPTY_ABOUT_ME, party: 'couple' }, new Date());
    await replaceAboutMe(t.db, b.spaceId, { ...EMPTY_ABOUT_ME, party: 'group' }, new Date());
    expect(aboutMeOf(await call(await tokenFor(a.spaceId), 'get_about_me'))).toMatchObject({
      party: 'couple',
    });
    expect(aboutMeOf(await call(await tokenFor(b.spaceId), 'get_about_me'))).toMatchObject({
      party: 'group',
    });
  });
});
