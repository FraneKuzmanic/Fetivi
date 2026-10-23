import { randomUUID } from 'node:crypto';
import {
  catalogRecords,
  createCatalogRecord,
  createHostAddedPlace,
  createHostPick,
  destinations,
  EMPTY_ABOUT_ME,
  replaceAboutMe,
  seedTrogir,
  updateAboutMe,
  type WarningLanguage,
  type WeatherReport,
  type WeatherSource,
} from '@fetivi/domain';
import {
  fixedWeatherSource,
  noopQueue,
  publishCatalog,
  publishHostPlace,
  sampleWeatherReport,
  seedGuestUnit,
  unavailableWeatherSource,
} from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from '../../testing';
import { IDENTITY_ARGS } from '../tool';

const WINTER = new Date('2027-01-15T08:00:00Z');
const SUMMER = new Date('2027-07-10T08:00:00Z');
const CATALOG_TOOLS = [
  'search_places',
  'get_place',
  'list_host_picks',
  'search_events',
  'get_weather',
  'get_transport_notes',
];
// SUMMER is 10:00 on this day in Zagreb.
const SUMMER_DAY = '2027-07-10';
const SAMPLE = sampleWeatherReport(SUMMER_DAY);

// The server is built once; each weather test swaps the source behind it.
let weather: WeatherSource = fixedWeatherSource(SAMPLE);
const weatherLanguages: WarningLanguage[] = [];
const switchableWeather: WeatherSource = {
  report(place, language, now) {
    weatherLanguages.push(language);
    return weather.report(place, language, now);
  },
  warnings: (place, language, now) => weather.warnings(place, language, now),
};

let t: TestServer;
let a: Awaited<ReturnType<typeof seedGuestUnit>>;
let tokenA: string;
let tokenB: string;
let tokenC: string;
let bPropertyId: string;
let lovrijenacId: string;
let tokenD: string;
let copacabanaId: string;
let addedId: string;

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
  t = await createTestServer({ listen: true, now: () => SUMMER, weather: switchableWeather });
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

  // A's host picks Copacabana and adds a place; D is another property in Trogir.
  const copacabana = (
    await t.db.select({ id: catalogRecords.id, title: catalogRecords.title }).from(catalogRecords)
  ).find((r) => r.title.startsWith('Copacabana'));
  if (!copacabana) throw new Error('no Copacabana');
  copacabanaId = copacabana.id;
  const pick = await createHostPick(
    t.db,
    noopQueue,
    a.propertyId,
    { recordId: copacabanaId, note: 'Go before ten' },
    SUMMER,
  );
  await publishHostPlace(t.db, pick.id);
  const added = await createHostAddedPlace(
    t.db,
    noopQueue,
    a.propertyId,
    {
      name: 'Bakery Lucija',
      placeCategory: 'shop',
      location: { lat: 43.517, lng: 16.252 },
      address: null,
      note: 'Burek from six',
    },
    // Added after the pick, so the order (created_at, id) is fixed.
    new Date(SUMMER.getTime() + 60_000),
  );
  await publishHostPlace(t.db, added.id);
  addedId = added.id;
  const d = await seedGuestUnit(t.db, { now: SUMMER });
  tokenD = await tokenFor(d.spaceId);
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
  it('lists the catalog tools, get_weather and web_fallback_search inside a destination', async () => {
    const tools = await listNames(tokenA);
    expect(tools.map((tool) => tool.name)).toEqual([...CATALOG_TOOLS, 'web_fallback_search']);
    const identity = new Set<string>(IDENTITY_ARGS.map((x) => x.toLowerCase()));
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.outputSchema).toBeDefined();
      for (const key of Object.keys(tool.inputSchema.properties ?? {})) {
        expect(identity.has(key.toLowerCase())).toBe(false);
      }
    }
  });

  it('lists only web_fallback_search without a destination', async () => {
    for (const token of [tokenB, tokenC]) {
      expect((await listNames(token)).map((tool) => tool.name)).toEqual(['web_fallback_search']);
    }
  });

  it('lists only web_fallback_search without catalog:read', async () => {
    const token = await tokenFor(a.spaceId, { scope: 'web_fallback:search' });
    expect((await listNames(token)).map((tool) => tool.name)).toEqual(['web_fallback_search']);
  });

  it('lists no tools without any local scope', async () => {
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

  it("ranks by the Space's About me", async () => {
    const titles = async () =>
      (
        (await call(tokenA, 'search_places', { limit: 10 })).structuredContent as {
          results: { title: string }[];
        }
      ).results.map((r) => r.title);
    const copacabana = (list: string[]) => list.findIndex((title) => title.includes('Copacabana'));
    const before = await titles();
    await updateAboutMe(t.db, a.spaceId, { addInterests: ['beaches'] }, SUMMER);
    try {
      const after = await titles();
      expect(copacabana(before)).toBeGreaterThan(-1);
      expect(copacabana(after)).toBeLessThan(copacabana(before));
      expect([...after].sort()).toEqual([...before].sort());
    } finally {
      await replaceAboutMe(t.db, a.spaceId, EMPTY_ABOUT_ME, SUMMER);
    }
  });

  it('rejects invalid input', async () => {
    const outcome = await call(tokenA, 'search_places', { limit: 50 }).then(
      (r) => (r.isError ? 'error' : 'ok'),
      () => 'error',
    );
    expect(outcome).toBe('error');
  });
});

describe('host picks', () => {
  type Result = { id: string; hostPick: { note: string | null } | null; hostAdded: boolean };
  const resultsOf = (r: Awaited<ReturnType<typeof call>>) =>
    (r.structuredContent as { results: Result[] }).results;

  it("lists A's pick with its note and A's added place", async () => {
    const result = await call(tokenA, 'list_host_picks', {});
    expect(result.isError).toBeFalsy();
    expect(resultsOf(result).map((r) => [r.id, r.hostPick, r.hostAdded])).toEqual([
      [copacabanaId, { note: '[it] Go before ten' }, false],
      [addedId, { note: '[it] Burek from six' }, true],
    ]);
  });

  it("never shows A's picks or added places to another property's guests", async () => {
    expect(resultsOf(await call(tokenD, 'list_host_picks', {}))).toEqual([]);
    const search = resultsOf(await call(tokenD, 'search_places', { limit: 10 }));
    expect(search.map((r) => r.id)).not.toContain(addedId);
    expect(search.find((r) => r.id === copacabanaId)?.hostPick).toBeNull();
    const foreign = await call(tokenD, 'get_place', { placeId: addedId });
    expect(foreign.isError).toBe(true);
    expect(foreign.content).toEqual([{ type: 'text', text: 'not permitted' }]);
  });

  it('marks picks and added places in search_places and get_place', async () => {
    const results = resultsOf(await call(tokenA, 'search_places', { limit: 10 }));
    expect(results.find((r) => r.id === copacabanaId)).toMatchObject({
      hostPick: { note: '[it] Go before ten' },
      hostAdded: false,
    });
    expect(results.find((r) => r.id === addedId)).toMatchObject({ hostAdded: true });
    const place = await call(tokenA, 'get_place', { placeId: addedId });
    expect(place.isError).toBeFalsy();
    expect((place.structuredContent as { place: Result }).place.hostAdded).toBe(true);
  });

  it('is not listed outside a destination', async () => {
    for (const token of [tokenB, tokenC]) {
      await expect(call(token, 'list_host_picks', {})).rejects.toThrow(
        'Tool list_host_picks not found',
      );
    }
  });
});

describe('get_weather', () => {
  const withWeather = async <T>(source: WeatherSource, run: () => Promise<T>) => {
    weather = source;
    try {
      return await run();
    } finally {
      weather = fixedWeatherSource(SAMPLE);
    }
  };

  it('is open-world and read-only', async () => {
    const tool = (await listNames(tokenA)).find((x) => x.name === 'get_weather');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(['date']);
  });

  it('answers the asked day and the next two, with sea, UV, warnings and both credits', async () => {
    weatherLanguages.length = 0;
    const result = await call(tokenA, 'get_weather', {});
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      date: string;
      timezone: string;
      days: { date: string }[];
      sea: unknown;
      uv: unknown;
      warnings: unknown[];
      credits: { source: string; url: string }[];
    };
    expect(out.date).toBe(SUMMER_DAY);
    expect(out.timezone).toBe('Europe/Zagreb');
    expect(out.days.map((d) => d.date)).toEqual(['2027-07-10', '2027-07-11', '2027-07-12']);
    expect(out.sea).toEqual(SAMPLE.sea);
    expect(out.uv).toEqual(SAMPLE.uv);
    expect(out.warnings).toEqual(SAMPLE.warnings);
    expect(out.credits.map((c) => c.source)).toEqual(['DHMZ', 'MET Norway']);
    // The Italian guest gets DHMZ's English text.
    expect(weatherLanguages).toEqual(['en']);
    expect(JSON.parse((result.content as { text: string }[])[0]?.text ?? '')).toEqual(out);
  });

  it('starts at the asked date', async () => {
    const result = await call(tokenA, 'get_weather', { date: '2027-07-11' });
    const out = result.structuredContent as { date: string; days: { date: string }[] };
    expect(out.date).toBe('2027-07-11');
    expect(out.days.map((d) => d.date)).toEqual(['2027-07-11', '2027-07-12']);
  });

  it('asks for Croatian warnings for a Croatian guest', async () => {
    weatherLanguages.length = 0;
    const token = await tokenFor(a.spaceId, { claims: { lang: 'hr' } });
    expect((await call(token, 'get_weather', {})).isError).toBeFalsy();
    expect(weatherLanguages).toEqual(['hr']);
  });

  it('refuses a past day and one more than 8 days ahead', async () => {
    expect(await call(tokenA, 'get_weather', { date: '2027-07-09' })).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'I can only check the weather from today on.' }],
    });
    expect(await call(tokenA, 'get_weather', { date: '2027-07-19' })).toMatchObject({
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Forecasts reach about 8 days ahead; ask again closer to the day.',
        },
      ],
    });
    expect((await call(tokenA, 'get_weather', { date: '2027-07-18' })).isError).toBeFalsy();
  });

  it('says so when no weather service answers', async () => {
    const result = await withWeather(unavailableWeatherSource(), () =>
      call(tokenA, 'get_weather', {}),
    );
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'The weather services are not answering right now.' }],
    });
  });

  it('passes unchecked warnings and an unavailable forecast through as null', async () => {
    const partial: WeatherReport = { ...SAMPLE, forecast: null, warnings: null };
    const result = await withWeather(fixedWeatherSource(partial), () =>
      call(tokenA, 'get_weather', {}),
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      days: null,
      forecastUpdatedAt: null,
      warnings: null,
      sea: SAMPLE.sea,
    });
  });

  // Not registered for such a token, so a call cannot reach the handler at all.
  it('is not there outside a destination or without catalog:read', async () => {
    for (const token of [tokenB, await tokenFor(a.spaceId, { scope: '' })]) {
      expect((await listNames(token)).map((x) => x.name)).not.toContain('get_weather');
      await expect(call(token, 'get_weather', {})).rejects.toThrow('Tool get_weather not found');
    }
  });
});
