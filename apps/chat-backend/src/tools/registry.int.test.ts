import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  fromLocalDateTime,
  guestIdentityFor,
  guestTokenClaims,
  handoffMessages,
  identityOf,
  loadSituation,
  MCP_SERVERS,
  pendingActions,
  type SpaceContext,
} from '@fetivi/domain';
import {
  createTestDatabase,
  noopQueue,
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { createEgress, type Egress } from '@fetivi/egress';
import { buildMcpTestApp, TEST_REQUEST_STATE_SECRET } from '@fetivi/mcp-servers/testing';
import { stateCodec } from '@fetivi/mcp-servers/tools';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPIRED, type Outcome, type PausedCall } from '../loop/elicitation';
import { createToolCatalog } from '../mcp/tools';
import { TEST_ISSUER, TEST_MCP_BASE } from '../testing';
import { loadSigningKey } from '../tokens/keys';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';
import { inProcessBinding } from './inprocess';
import { mcpBinding, type ToolBinding, type TurnTools } from './registry';

// V0 against V1 on one database: the same definitions, identity, checks and confirmation rule.

const ZONE = 'Europe/Zagreb';
const CONTACT = { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000' };

let testDb: TestDatabase;
let mcpApp: FastifyInstance;
let tokens: TokenConfig;
let current = Date.now();
const clock = { now: () => new Date(current) };
const bindings = {} as Record<'mcp' | 'inprocess', ToolBinding>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const key = await loadSigningKey(undefined);
  tokens = { key, issuer: TEST_ISSUER, mcpBaseUrl: TEST_MCP_BASE };
  mcpApp = buildMcpTestApp({
    db: testDb.db,
    keys: createLocalJWKSet({ keys: [key.publicJwk] }),
    issuer: TEST_ISSUER,
    publicBase: TEST_MCP_BASE,
    now: clock.now,
  });
  await mcpApp.listen({ host: '127.0.0.1', port: 0 });
  const port = (mcpApp.server.address() as AddressInfo).port;
  const egress = createEgress({ allowlist: ['127.0.0.1'], allowInsecureLocalhost: true });
  const mcpFetch: Egress['fetch'] = (url, init) =>
    egress.fetch(String(url).replace(TEST_MCP_BASE, `http://127.0.0.1:${port}`), init);
  bindings.mcp = mcpBinding({ tokens, mcpFetch, catalog: createToolCatalog() });
  bindings.inprocess = inProcessBinding({
    db: testDb.db,
    now: clock.now,
    queue: noopQueue,
    requestStateSecret: TEST_REQUEST_STATE_SECRET,
  });
});

afterAll(async () => {
  await mcpApp?.close();
  await testDb?.drop();
});

const opened: TurnTools[] = [];
async function open(transport: 'mcp' | 'inprocess', ctx: SpaceContext): Promise<TurnTools> {
  const tools = await bindings[transport].open(ctx, new Date());
  opened.push(tools);
  return tools;
}
afterAll(async () => {
  await Promise.all(opened.map((t) => t.close()));
});

const context = (over: Partial<SpaceContext>): SpaceContext => ({
  phase: 'upcoming',
  insideDestination: true,
  hostHasOwnOffers: false,
  spaceId: randomUUID(),
  stayId: randomUUID(),
  unitId: randomUUID(),
  propertyId: randomUUID(),
  destinationId: randomUUID(),
  language: 'en',
  ...over,
});

const SITUATIONS: [string, SpaceContext, string[]][] = [
  [
    'inside a destination, before arrival',
    context({}),
    [
      'draft_host_message',
      'send_host_message',
      'search_places',
      'get_place',
      'search_events',
      'get_transport_notes',
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
      'get_about_me',
      'update_about_me',
    ],
  ],
  [
    'in stay, in German',
    context({ phase: 'in_stay', language: 'de' }),
    [
      'draft_host_message',
      'send_host_message',
      'search_places',
      'get_place',
      'search_events',
      'get_transport_notes',
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
      'get_about_me',
      'update_about_me',
    ],
  ],
  [
    'outside a destination without own Offers',
    context({ insideDestination: false, destinationId: null }),
    [
      'draft_host_message',
      'send_host_message',
      'list_my_orders',
      'get_about_me',
      'update_about_me',
    ],
  ],
  [
    'outside a destination with own Offers',
    context({ insideDestination: false, destinationId: null, hostHasOwnOffers: true }),
    [
      'draft_host_message',
      'send_host_message',
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
      'get_about_me',
      'update_about_me',
    ],
  ],
  [
    'after checkout',
    context({ phase: 'ended' }),
    [
      'search_places',
      'get_place',
      'search_events',
      'get_transport_notes',
      'list_my_orders',
      'get_about_me',
    ],
  ],
];

describe('tool definitions', () => {
  it.each(SITUATIONS)('are the same over MCP and in process: %s', async (_, ctx, names) => {
    const [mcp, inprocess] = await Promise.all([open('mcp', ctx), open('inprocess', ctx)]);
    const [overMcp, inProcess] = await Promise.all([mcp.list(), inprocess.list()]);
    expect(overMcp.map((l) => l.tool.name)).toEqual(names);
    // Whole Tool objects, in order: name, title, description, schemas, annotations and _meta.
    expect(inProcess).toEqual(overMcp);
  });
});

describe('identity', () => {
  it('in process is what each server derives from its token', async () => {
    const ctx = context({ phase: 'in_stay' });
    const minted = await mintServerTokens(tokens, ctx, new Date());
    for (const server of MCP_SERVERS) {
      const fromToken = identityOf(guestTokenClaims.parse(decodeJwt(minted[server])));
      expect(guestIdentityFor(server, ctx)).toEqual(fromToken);
    }
  });
});

let destinationId: string | undefined;

/** A guest in a destination, a Provider's bookable boat trip, and a neighbour host's Offer. */
async function seeded() {
  const { db } = testDb;
  const seed = await seedGuestUnit(db, { now: clock.now(), checkInInDays: 2 });
  const neighbour = await seedGuestUnit(db, { now: clock.now() });
  // One destination around Trogir for the whole file, so every guest resolves to it.
  destinationId ??= await seedDestination(db);
  const provider = await seedProvider(db);
  const day = new Date(Date.parse(`${seed.stay.checkIn}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const startsAt = fromLocalDateTime(`${day}T09:00`, ZONE);
  const boat = await seedOrderableOffer(db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt,
    capacity: 40,
    contactFields: 'name_and_phone',
  });
  await publishOffer(db, boat.offerId);
  const foreign = await seedOrderableOffer(db, {
    hostId: neighbour.hostId,
    availabilityMode: 'allotment',
    startsAt,
  });
  await publishOffer(db, foreign.offerId);
  const ctx = await loadSituation(db, seed.spaceId, clock.now());
  if (!ctx) throw new Error('no situation');
  const args = { offerId: boat.offerId, date: day, quantity: 2, slotId: boat.slotId };
  return { ctx, day, args, foreign, neighbour };
}

const errorOf = (run: Promise<unknown>) =>
  run.then(
    () => 'no error',
    (error: Error) => error.message,
  );

describe('ownership and scope checks', () => {
  it('refuse the same way in both modes', async () => {
    const s = await seeded();
    for (const transport of ['mcp', 'inprocess'] as const) {
      const tools = await open(transport, s.ctx);
      const listed = await tools.list();
      const tool = (name: string) => {
        const found = listed.find((l) => l.tool.name === name);
        if (!found) throw new Error(`${name} not listed`);
        return found;
      };
      // Another host's Offer and an unknown place are not the caller's to see.
      expect(
        await errorOf(
          tools.call(tool('check_availability'), {
            offerId: s.foreign.offerId,
            date: s.day,
            quantity: 1,
          }),
        ),
      ).toBe('not permitted');
      expect(await errorOf(tools.call(tool('get_place'), { placeId: randomUUID() }))).toBe(
        'not permitted',
      );
      // A domain refusal arrives as its text.
      expect(
        await errorOf(
          tools.call(tool('check_availability'), {
            offerId: s.args.offerId,
            date: '2020-01-01',
            quantity: 1,
          }),
        ),
      ).toMatch(/outside the guest's stay|has passed/);
      // Arguments that fail the schema never reach the domain.
      expect(await errorOf(tools.call(tool('get_place'), { placeId: 42 }))).toMatch(
        /^Input validation error: Invalid arguments for tool get_place: placeId/,
      );
    }
    // Outside a destination the catalog tools are not there at all, in either mode.
    const outside = { ...s.ctx, insideDestination: false, destinationId: null };
    for (const transport of ['mcp', 'inprocess'] as const) {
      const tools = await open(transport, outside);
      expect(
        await errorOf(
          tools.call({ server: 'local', tool: { name: 'search_places' } } as never, {}),
        ),
      ).toMatch(/Tool search_places not found/);
    }
  });
});

const pausedCall = async (
  tools: TurnTools,
  input: unknown,
  id = 'call-1',
  toolName = 'create_order',
): Promise<PausedCall> => {
  const listed = (await tools.list()).find((l) => l.tool.name === toolName);
  if (!listed) throw new Error(`${toolName} not listed`);
  return { listed, toolCallId: id, toolName, input };
};

function card(outcome: Outcome) {
  if (outcome.kind !== 'ask') throw new Error(`no card: ${JSON.stringify(outcome)}`);
  return outcome.payload;
}

const pendingRow = async (pendingId: string) => {
  const [row] = await testDb.db
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.id, pendingId));
  return row;
};

describe('the pending record', () => {
  it('in process stores the same record and shows the same card', async () => {
    const s = await seeded();
    const cards = [];
    for (const transport of ['mcp', 'inprocess'] as const) {
      const tools = await open(transport, s.ctx);
      cards.push(card(await tools.firstHalf(await pausedCall(tools, s.args))));
    }
    const [overMcp, inProcess] = cards;
    const rows = await Promise.all(cards.map((c) => pendingRow(c?.draft?.pendingId ?? '')));
    expect(rows.map((r) => r?.state)).toEqual(['pending', 'pending']);
    const ttl = (r: (typeof rows)[number]) =>
      (r?.expiresAt.getTime() ?? 0) - (r?.createdAt.getTime() ?? 0);
    expect(ttl(rows[1])).toBe(ttl(rows[0]));
    // Only the record id and its seal differ.
    const strip = (c: typeof overMcp) => ({
      ...c,
      requestState: undefined,
      draft: { ...c?.draft, pendingId: undefined },
    });
    expect(strip(inProcess)).toEqual(strip(overMcp));
  });

  it.each(['mcp', 'inprocess'] as const)(
    'applies one completion rule (%s): seal, owner, TTL, consumed once',
    async (transport) => {
      const s = await seeded();
      const tools = await open(transport, s.ctx);
      const call = await pausedCall(tools, s.args);
      const first = card(await tools.firstHalf(call));
      const pendingId = first.draft?.pendingId ?? '';
      const accept = { action: 'accept' as const, content: CONTACT };

      // A tampered seal, or one sealed for another space, books nothing.
      const at = Math.floor(first.requestState.length / 2);
      const flipped = first.requestState[at] === 'A' ? 'B' : 'A';
      const tampered = `${first.requestState.slice(0, at)}${flipped}${first.requestState.slice(at + 1)}`;
      const foreign = await stateCodec(
        'create_order',
        TEST_REQUEST_STATE_SECRET,
        s.neighbour.spaceId,
      ).mint({
        pendingId,
      });
      for (const requestState of [tampered, foreign]) {
        expect(await tools.answer({ ...call, requestState, answer: accept })).toEqual({
          kind: 'error',
          errorText: EXPIRED,
        });
      }
      expect((await pendingRow(pendingId))?.state).toBe('pending');

      // The tap books once; the same tap again gets the same Order.
      const ordered = await tools.answer({
        ...call,
        requestState: first.requestState,
        answer: accept,
      });
      const again = await tools.answer({
        ...call,
        requestState: first.requestState,
        answer: accept,
      });
      expect(ordered).toMatchObject({ kind: 'output', output: { outcome: 'ordered' } });
      expect(again).toEqual(ordered);
      expect((await pendingRow(pendingId))?.state).toBe('consumed');

      // A record past its TTL on the app clock is released with the expiry refusal.
      const late = await pausedCall(tools, s.args, 'call-2');
      const second = card(await tools.firstHalf(late));
      current += 11 * 60_000;
      expect(
        await tools.answer({ ...late, requestState: second.requestState, answer: accept }),
      ).toEqual({
        kind: 'error',
        errorText: 'The confirmation expired; nothing was booked. Offer to try again.',
      });
      expect((await pendingRow(second.draft?.pendingId ?? ''))?.state).toBe('released');
    },
  );
});

describe('a paused tool the caller no longer has', () => {
  it.each(['mcp', 'inprocess'] as const)(
    'expires both halves and books nothing (%s)',
    async (transport) => {
      const s = await seeded();
      const live = await open(transport, s.ctx);
      const call = await pausedCall(live, s.args);
      const first = card(await live.firstHalf(call));
      // After checkout create_order is not listed: no orders:create in the token or identity.
      const ended = await open(transport, { ...s.ctx, phase: 'ended' });
      const expired = { kind: 'error', errorText: EXPIRED };
      expect(await ended.firstHalf(call)).toEqual(expired);
      expect(
        await ended.answer({
          ...call,
          requestState: first.requestState,
          answer: { action: 'accept', content: CONTACT },
        }),
      ).toEqual(expired);
      expect((await pendingRow(first.draft?.pendingId ?? ''))?.state).toBe('pending');
    },
  );

  it.each(['mcp', 'inprocess'] as const)(
    'refuses a host message card left open past checkout (%s)',
    async (transport) => {
      const s = await seeded();
      const live = await open(transport, s.ctx);
      const draft = { message: 'No hot water.', reason: 'problem', urgency: 'urgent' };
      const call = await pausedCall(live, draft, 'call-host', 'send_host_message');
      const first = card(await live.firstHalf(call));
      const [row] = await testDb.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.spaceId, s.ctx.spaceId));
      expect(row).toMatchObject({ kind: 'send_host_message', state: 'pending' });
      // After checkout the stay tools are gone, so the tap reaches no tool half.
      const ended = await open(transport, { ...s.ctx, phase: 'ended' });
      expect(
        await ended.answer({
          ...call,
          requestState: first.requestState,
          answer: { action: 'accept', content: { message: 'Late text' } },
        }),
      ).toEqual({ kind: 'error', errorText: EXPIRED });
      expect((await pendingRow(row?.id ?? ''))?.state).toBe('pending');
      expect(
        await testDb.db
          .select()
          .from(handoffMessages)
          .where(eq(handoffMessages.spaceId, s.ctx.spaceId)),
      ).toEqual([]);
    },
  );
});
