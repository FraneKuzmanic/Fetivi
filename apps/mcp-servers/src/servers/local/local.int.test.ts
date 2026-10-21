import { randomUUID } from 'node:crypto';
import { createCatalogRecord, destinations, seedTrogir } from '@fetivi/domain';
import { noopQueue, publishCatalog, seedGuestUnit } from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from '../../testing';
import { IDENTITY_ARGS } from '../tool';

const WINTER = new Date('2027-01-15T08:00:00Z');
const SUMMER = new Date('2027-07-10T08:00:00Z');
const CATALOG_TOOLS = ['search_places', 'get_place', 'search_events', 'get_transport_notes'];

let t: TestServer;
let a: Awaited<ReturnType<typeof seedGuestUnit>>;
let tokenA: string;
let tokenB: string;
let tokenC: string;
let bPropertyId: string;
let lovrijenacId: string;

async function connect(token: string) {
  const client = new Client(
    { name: 'test-client', version: '0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${t.url}/local`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

async function tokenFor(
  spaceId: string,
  extra: { scope?: string; claims?: Record<string, unknown> } = {},
) {
  return signToken(t.keys, { server: 'local', ctx: await contextOf(t.db, spaceId), ...extra });
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const client = await connect(token);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  t = await createTestServer({ listen: true, now: () => SUMMER });
  const { destinationId } = await seedTrogir(t.db, noopQueue, WINTER);
  await publishCatalog(t.db, destinationId);

  const [dubrovnik] = await t.db
    .insert(destinations)
    .values({ name: 'Dubrovnik', centre: { x: 18.0944, y: 42.6507 }, radiusM: 15_000 })
    .returning();
  if (!dubrovnik) throw new Error('no destination');
  // A beach, so a leak would show in the beach search too.
  const lovrijenac = await createCatalogRecord(
    t.db,
    noopQueue,
    {
      destinationId: dubrovnik.id,
      kind: 'place',
      placeCategory: 'beach',
      title: 'Lovrijenac fortress beach',
      description: 'A fortress outside the city walls.',
      location: { x: 18.1043, y: 42.6406 },
    },
    WINTER,
  );
  lovrijenacId = lovrijenac.id;
  await publishCatalog(t.db, dubrovnik.id);

  a = await seedGuestUnit(t.db, { now: SUMMER, spaceLanguage: 'it' });
  const b = await seedGuestUnit(t.db, { now: SUMMER, location: { x: 15.9819, y: 45.815 } });
  const c = await seedGuestUnit(t.db, { now: SUMMER, location: null });
  tokenA = await tokenFor(a.spaceId);
  tokenB = await tokenFor(b.spaceId);
  tokenC = await tokenFor(c.spaceId);
  bPropertyId = b.propertyId;
});

afterAll(async () => {
  await t?.close();
});

const listNames = async (token: string) => {
  const client = await connect(token);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
};

describe('local tool list', () => {
  it('lists the four catalog tools inside a destination', async () => {
    const tools = await listNames(tokenA);
    expect(tools.map((tool) => tool.name)).toEqual(CATALOG_TOOLS);
    const identity = new Set<string>(IDENTITY_ARGS.map((x) => x.toLowerCase()));
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.outputSchema).toBeDefined();
      for (const key of Object.keys(tool.inputSchema.properties ?? {})) {
        expect(identity.has(key.toLowerCase())).toBe(false);
      }
    }
  });

  it('lists no tools without a destination', async () => {
    expect(await listNames(tokenB)).toEqual([]);
    expect(await listNames(tokenC)).toEqual([]);
  });

  it('lists no tools without catalog:read', async () => {
    expect(await listNames(await tokenFor(a.spaceId, { scope: '' }))).toEqual([]);
  });
});

describe('local tools', () => {
  it('refuses a token whose property does not own the Stay', async () => {
    const forged = await tokenFor(a.spaceId, {
      claims: { property: bPropertyId },
    });
    const result = await call(forged, 'search_places', {});
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'not permitted' }]);
  });

  it('answers structured content in the guest language with a JSON text fallback', async () => {
    const result = await call(tokenA, 'search_places', { category: 'beach' });
    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as { results: { id: string; title: string }[] };
    expect(structured.results[0]?.title.startsWith('[it] Copacabana')).toBe(true);
    expect(structured.results.map((r) => r.id)).not.toContain(lovrijenacId);
    const [text] = result.content as { type: string; text: string }[];
    expect(JSON.parse(text?.text ?? '')).toEqual(structured);
  });

  it('never returns another destination', async () => {
    const result = await call(tokenA, 'search_places', { limit: 10 });
    const ids = (result.structuredContent as { results: { id: string }[] }).results.map(
      (r) => r.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(lovrijenacId);

    const foreign = await call(tokenA, 'get_place', { placeId: lovrijenacId });
    expect(foreign.isError).toBe(true);
    expect(foreign.content).toEqual([{ type: 'text', text: 'not permitted' }]);
  });

  it('answers an unknown id the same as a foreign one', async () => {
    const unknown = await call(tokenA, 'get_place', { placeId: randomUUID() });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toEqual([{ type: 'text', text: 'not permitted' }]);
  });

  it('finds the summer festival in local time', async () => {
    const result = await call(tokenA, 'search_events');
    const { results } = result.structuredContent as {
      results: { title: string; startsAt: string }[];
    };
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('[it] Trogir Summer of Culture');
    expect(results[0]?.startsAt).toBe('2027-07-01T20:00');
  });

  it('returns transport notes with their links', async () => {
    const result = await call(tokenA, 'get_transport_notes', { mode: 'bus' });
    const { results } = result.structuredContent as {
      results: { links: { url: string }[] }[];
    };
    expect(results).toHaveLength(1);
    expect(results[0]?.links.map((l) => l.url)).toEqual(['https://www.promet-split.hr/']);
  });

  it('rejects invalid input', async () => {
    const outcome = await call(tokenA, 'search_places', { limit: 50 }).then(
      (r) => (r.isError ? 'error' : 'ok'),
      () => 'error',
    );
    expect(outcome).toBe('error');
  });
});
