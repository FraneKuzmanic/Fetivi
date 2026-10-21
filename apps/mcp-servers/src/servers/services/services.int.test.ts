import {
  allotmentSlots,
  fromLocalDateTime,
  GUEST_CONFIRMS_META_KEY,
  QUEUES,
  type SpaceContext,
} from '@fetivi/domain';
import {
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from '../../testing';

let t: TestServer;
// Drives domain dates and the pending TTL only; tokens and the codec run on the real clock.
let clock = new Date();
const ZONE = 'Europe/Zagreb';

let guest: SeededGuestUnit;
let neighbour: SeededGuestUnit;
let outsider: SeededGuestUnit;
let lonely: SeededGuestUnit;
let ended: SeededGuestUnit;
let day: string;
let day2: string;
const offer = { boat: '', sunset: '', bike: '', neighbourBike: '', outsiderKayak: '' };
let slot09: string;
let slot15: string;

type InputRequired = {
  resultType: 'input_required';
  inputRequests: Record<string, { method: string; params: Record<string, unknown> }>;
  requestState: string;
};
type Answer = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };

const CONTACT = { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000' };

async function connect(ctx: SpaceContext, options: { elicit?: boolean; scope?: string } = {}) {
  const token = await signToken(t.keys, { server: 'services', ctx, scope: options.scope });
  const client = new Client(
    { name: 'guest-app', version: '0' },
    {
      versionNegotiation: { mode: 'auto' },
      capabilities: options.elicit === false ? {} : { elicitation: { form: {} } },
      inputRequired: { autoFulfill: false },
    },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${t.url}/services`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const ctxOf = (g: SeededGuestUnit) => contextOf(t.db, g.spaceId);

async function call(
  g: SeededGuestUnit,
  name: string,
  args: Record<string, unknown>,
  options: Parameters<typeof connect>[1] = {},
) {
  const client = await connect(await ctxOf(g), options);
  try {
    return await client.callTool({ name, arguments: args }, { allowInputRequired: true });
  } finally {
    await client.close();
  }
}

async function firstHalf(g: SeededGuestUnit, args: Record<string, unknown>) {
  const result = (await call(g, 'create_order', args)) as unknown as InputRequired;
  expect(result.resultType).toBe('input_required');
  return result;
}

async function resume(
  g: SeededGuestUnit,
  args: Record<string, unknown>,
  requestState: string,
  answer: Answer,
  options: Parameters<typeof connect>[1] = {},
) {
  const client = await connect(await ctxOf(g), options);
  try {
    return await client.callTool(
      {
        name: 'create_order',
        arguments: args,
        inputResponses: { confirm: answer },
        requestState,
      } as Parameters<Client['callTool']>[0],
      { allowInputRequired: true },
    );
  } finally {
    await client.close();
  }
}

const accept: Answer = { action: 'accept', content: CONTACT };
const boatArgs = () => ({ offerId: offer.boat, date: day, quantity: 2, slotId: slot09 });

const ordersOf = (offerId: string) =>
  t.db.query.orders.findMany({ where: (o, { eq }) => eq(o.offerId, offerId) });
const orderById = (id: string) =>
  t.db.query.orders.findFirst({ where: (o, { eq }) => eq(o.id, id) });
const pendingOf = (g: SeededGuestUnit) =>
  t.db.query.pendingActions.findMany({ where: (p, { eq }) => eq(p.spaceId, g.spaceId) });
async function remaining(slotId: string) {
  const slot = await t.db.query.allotmentSlots.findFirst({
    where: (s, { eq }) => eq(s.id, slotId),
  });
  return slot?.remaining;
}
const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The JSON-RPC error code a rejected call carried. */
async function rpcError(run: Promise<unknown>): Promise<number | 'resolved'> {
  try {
    await run;
    return 'resolved';
  } catch (error) {
    return (error as { code: number }).code;
  }
}
/** A tool error, or a JSON-RPC error such as an unknown tool. */
async function refused(run: Promise<{ isError?: unknown }>): Promise<boolean> {
  try {
    return (await run).isError === true;
  } catch {
    return true;
  }
}
const errorText = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text;

beforeAll(async () => {
  t = await createTestServer({ listen: true, now: () => clock });
  const db = t.db;
  const destinationId = await seedDestination(db);
  guest = await seedGuestUnit(db, { now: clock });
  neighbour = await seedGuestUnit(db, { now: clock });
  outsider = await seedGuestUnit(db, { now: clock, location: null });
  lonely = await seedGuestUnit(db, { now: clock, location: null });
  ended = await seedGuestUnit(db, { now: new Date(clock.getTime() - 40 * 86_400_000) });
  day = plusDays(guest.stay.checkIn, 1);
  day2 = plusDays(guest.stay.checkIn, 2);

  const provider = await seedProvider(db);
  const boat = await seedOrderableOffer(db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: fromLocalDateTime(`${day}T09:00`, ZONE),
    capacity: 40,
    contactFields: 'name_and_phone',
    title: 'Blue Lagoon boat trip',
    category: 'boat_trip',
  });
  offer.boat = boat.offerId;
  slot09 = boat.slotId as string;
  const [s15] = await db
    .insert(allotmentSlots)
    .values([
      {
        offerId: boat.offerId,
        startsAt: fromLocalDateTime(`${day}T15:00`, ZONE),
        capacity: 40,
        remaining: 40,
      },
      {
        offerId: boat.offerId,
        startsAt: fromLocalDateTime(`${day2}T09:00`, ZONE),
        capacity: 40,
        remaining: 40,
      },
    ])
    .returning();
  slot15 = s15?.id as string;
  offer.sunset = (
    await seedOrderableOffer(db, {
      providerId: provider.id,
      destinationId,
      availabilityMode: 'on_request',
      title: 'Sunset cruise',
    })
  ).offerId;
  offer.bike = (
    await seedOrderableOffer(db, {
      hostId: guest.hostId,
      availabilityMode: 'allotment',
      startsAt: fromLocalDateTime(`${day}T10:00`, ZONE),
      title: 'Own bike',
      category: 'rental',
    })
  ).offerId;
  offer.neighbourBike = (
    await seedOrderableOffer(db, {
      hostId: neighbour.hostId,
      availabilityMode: 'allotment',
      startsAt: fromLocalDateTime(`${day}T10:00`, ZONE),
      title: 'Neighbour bike',
    })
  ).offerId;
  offer.outsiderKayak = (
    await seedOrderableOffer(db, {
      hostId: outsider.hostId,
      availabilityMode: 'on_request',
      title: 'Outsider kayak',
    })
  ).offerId;
  for (const id of Object.values(offer)) await publishOffer(db, id);
});

afterAll(async () => {
  await t?.close();
});

describe('tools/list per situation', () => {
  const names = async (g: SeededGuestUnit) => {
    const client = await connect(await ctxOf(g));
    const { tools } = await client.listTools();
    await client.close();
    return tools;
  };

  it('in a destination: four tools in order, with honest annotations', async () => {
    const tools = await names(guest);
    expect(tools.map((x) => x.name)).toEqual([
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
    ]);
    for (const read of tools.slice(0, 3)) expect(read.annotations?.readOnlyHint).toBe(true);
    expect(tools[3]?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    for (const tool of tools) expect(tool.outputSchema).toBeDefined();
    // Only the guest-confirmed write carries the pause flag the chat backend reads.
    expect(tools.map((x) => x._meta?.[GUEST_CONFIRMS_META_KEY] === true)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('outside a destination: four tools with own Offers, else only list_my_orders', async () => {
    expect((await names(outsider)).map((x) => x.name)).toHaveLength(4);
    expect((await names(lonely)).map((x) => x.name)).toEqual(['list_my_orders']);
  });

  it('after checkout: only list_my_orders', async () => {
    expect((await names(ended)).map((x) => x.name)).toEqual(['list_my_orders']);
  });
});

describe('list_offers', () => {
  const titles = async (g: SeededGuestUnit) =>
    (
      (await call(g, 'list_offers', {})).structuredContent as { offers: { title: string }[] }
    ).offers.map((o) => o.title.replace(/^\[en\] /, ''));

  it('shows the destination’s Offers plus the host’s own, never another host’s', async () => {
    expect(await titles(guest)).toEqual(['Blue Lagoon boat trip', 'Own bike', 'Sunset cruise']);
    expect(await titles(neighbour)).toEqual([
      'Blue Lagoon boat trip',
      'Neighbour bike',
      'Sunset cruise',
    ]);
  });

  it('outside a destination shows only the host’s own', async () => {
    expect(await titles(outsider)).toEqual(['Outsider kayak']);
  });
});

describe('check_availability', () => {
  it('lists the day’s starts with local times', async () => {
    const result = await call(guest, 'check_availability', {
      offerId: offer.boat,
      date: day,
      quantity: 2,
    });
    const starts = (result.structuredContent as { starts: { startsAtLocal: string }[] }).starts;
    expect(starts.map((s) => s.startsAtLocal)).toEqual([`${day}T09:00`, `${day}T15:00`]);
  });

  it('refuses a date outside the stay, on request, and another host’s Offer', async () => {
    const outside = await call(guest, 'check_availability', {
      offerId: offer.boat,
      date: '2099-01-01',
      quantity: 1,
    });
    expect(outside.isError).toBe(true);
    expect(errorText(outside)).toBe("That date is outside the guest's stay.");
    const sunset = await call(guest, 'check_availability', {
      offerId: offer.sunset,
      date: day,
      quantity: 1,
    });
    expect(errorText(sunset)).toContain("can't be booked in chat yet");
    const other = await call(guest, 'check_availability', {
      offerId: offer.neighbourBike,
      date: day,
      quantity: 1,
    });
    expect(other).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
  });
});

describe('create_order', () => {
  it('first half stores one pending record and asks for confirmation; accept orders it', async () => {
    const before = (await pendingOf(guest)).length;
    const asked = await firstHalf(guest, boatArgs());
    const request = asked.inputRequests.confirm;
    expect(request?.method).toBe('elicitation/create');
    const params = request?.params as {
      message: string;
      requestedSchema: { properties: Record<string, unknown>; required: string[] };
      _meta: Record<string, { pendingId: string; quantity: number }>;
    };
    expect(Object.keys(params.requestedSchema.properties).sort()).toEqual([
      'email',
      'name',
      'phone',
    ]);
    expect(params.message).toContain('[en] Blue Lagoon boat trip');
    const draft = params._meta['app.fetivi/order-draft'];
    expect(draft?.quantity).toBe(2);
    const pending = await pendingOf(guest);
    expect(pending).toHaveLength(before + 1);
    expect(pending.some((p) => p.id === draft?.pendingId && p.state === 'pending')).toBe(true);
    expect(await remaining(slot09)).toBe(40);

    const done = await resume(guest, boatArgs(), asked.requestState, accept);
    const out = done.structuredContent as {
      outcome: string;
      order: { id: string; status: string };
    };
    expect(out.outcome).toBe('ordered');
    expect(out.order.status).toBe('confirmed');
    const { rows } = await t.testDb.pool.query<{ kind: string }>(
      "select data->>'kind' as kind from pgboss.job where name = $1 and data->>'orderId' = $2",
      [QUEUES.orderNotify, out.order.id],
    );
    expect(rows.map((r) => r.kind)).toContain('provider_confirmed');

    const mine = await call(guest, 'list_my_orders', {});
    const list = (mine.structuredContent as { orders: { id: string; status: string }[] }).orders;
    expect(list.find((o) => o.id === out.order.id)?.status).toBe('confirmed');
    const theirs = await call(neighbour, 'list_my_orders', {});
    expect((theirs.structuredContent as { orders: unknown[] }).orders).toEqual([]);
  });

  it('ignores parameters the model re-sends', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const done = await resume(
      guest,
      { offerId: offer.bike, date: day2, quantity: 9 },
      asked.requestState,
      accept,
    );
    const order = (done.structuredContent as { order: { id: string } }).order;
    const row = await orderById(order.id);
    expect(row).toMatchObject({ offerId: offer.boat, quantity: 2, date: day });
  });

  it('a double tap or re-sent request makes one Order', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const before = (await ordersOf(offer.boat)).length;
    const first = await resume(guest, boatArgs(), asked.requestState, accept);
    const second = await resume(guest, boatArgs(), asked.requestState, accept);
    const id = (r: unknown) =>
      (r as { structuredContent: { order: { id: string } } }).structuredContent.order.id;
    expect(id(second)).toBe(id(first));
    expect(await ordersOf(offer.boat)).toHaveLength(before + 1);
  });

  it('concurrent retries make one Order', async () => {
    const asked = await firstHalf(guest, { ...boatArgs(), slotId: slot15 });
    const before = (await ordersOf(offer.boat)).length;
    const results = await Promise.all(
      [1, 2, 3].map(() => resume(guest, boatArgs(), asked.requestState, accept)),
    );
    const ids = new Set(
      results.map((r) => (r.structuredContent as { order: { id: string } }).order.id),
    );
    expect(ids.size).toBe(1);
    expect(await ordersOf(offer.boat)).toHaveLength(before + 1);
    expect(await remaining(slot15)).toBe(38);
  });

  it('rejects a tampered requestState at the seam', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const [v, body, mac = ''] = asked.requestState.split('.');
    const flipped = `${v}.${body}.${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    const before = (await ordersOf(offer.boat)).length;
    expect(await rpcError(resume(guest, boatArgs(), flipped, accept))).toBe(-32602);
    expect(await ordersOf(offer.boat)).toHaveLength(before);
  });

  it('rejects another space’s requestState; the owner can still complete', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const before = (await ordersOf(offer.boat)).length;
    expect(await rpcError(resume(neighbour, boatArgs(), asked.requestState, accept))).toBe(-32602);
    expect(await ordersOf(offer.boat)).toHaveLength(before);
    const done = await resume(guest, boatArgs(), asked.requestState, accept);
    expect((done.structuredContent as { outcome: string }).outcome).toBe('ordered');
  });

  it('an expired pending record is released and makes no Order', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const before = (await ordersOf(offer.boat)).length;
    const real = clock;
    clock = new Date(real.getTime() + 11 * 60_000);
    try {
      const late = await resume(guest, boatArgs(), asked.requestState, accept);
      expect(late.isError).toBe(true);
      expect(errorText(late)).toContain('expired');
    } finally {
      clock = real;
    }
    expect(await ordersOf(offer.boat)).toHaveLength(before);
    const states = (await pendingOf(guest)).map((p) => p.state);
    expect(states).toContain('released');
  });

  it('decline and cancel release the record; a later accept orders nothing', async () => {
    for (const action of ['decline', 'cancel'] as const) {
      const asked = await firstHalf(guest, boatArgs());
      const before = (await ordersOf(offer.boat)).length;
      const declined = await resume(guest, boatArgs(), asked.requestState, { action });
      expect(declined.structuredContent).toEqual({ outcome: 'not_ordered', order: null });
      const later = await resume(guest, boatArgs(), asked.requestState, accept);
      expect(later.isError).toBe(true);
      expect(await ordersOf(offer.boat)).toHaveLength(before);
    }
  });

  it('a decline or an empty answer after the tap reports the Order, not "not ordered"', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const done = await resume(guest, boatArgs(), asked.requestState, accept);
    const id = (done.structuredContent as { order: { id: string } }).order.id;
    for (const answer of [{ action: 'decline' }, { action: 'accept', content: {} }] as const) {
      const late = await resume(guest, boatArgs(), asked.requestState, answer);
      expect(late.structuredContent).toMatchObject({ outcome: 'ordered', order: { id } });
    }
    expect((await orderById(id))?.status).toBe('confirmed');
  });

  it('an empty answer after the TTL refuses instead of re-asking', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const real = clock;
    clock = new Date(real.getTime() + 11 * 60_000);
    try {
      const late = await resume(guest, boatArgs(), asked.requestState, {
        action: 'accept',
        content: {},
      });
      expect(late.isError).toBe(true);
      expect(errorText(late)).toContain('expired');
    } finally {
      clock = real;
    }
  });

  it('re-asks on an invalid answer', async () => {
    const asked = await firstHalf(guest, boatArgs());
    const again = (await resume(guest, boatArgs(), asked.requestState, {
      action: 'accept',
      content: { email: 'not-an-email', name: 'Ana', phone: '+385 91 000' },
    })) as unknown as InputRequired;
    expect(again.resultType).toBe('input_required');
    expect(again.inputRequests.confirm?.method).toBe('elicitation/create');
  });

  it('a client without elicitation gets a tool error and nothing is stored', async () => {
    const before = (await pendingOf(guest)).length;
    const result = await call(guest, 'create_order', boatArgs(), { elicit: false });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('cannot show a booking confirmation');
    expect(await pendingOf(guest)).toHaveLength(before);
  });

  it('asks for a start when the day has several', async () => {
    const result = await call(guest, 'create_order', {
      offerId: offer.boat,
      date: day,
      quantity: 1,
    });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain('check_availability');
  });

  it('after checkout: the call fails, nothing is stored or ordered', async () => {
    const before = (await pendingOf(ended)).length;
    expect(await refused(call(ended, 'create_order', boatArgs()))).toBe(true);
    expect(await pendingOf(ended)).toHaveLength(before);

    // A card opened in stay, resumed with a token that no longer carries orders:create.
    const asked = await firstHalf(guest, boatArgs());
    const ordersBefore = (await ordersOf(offer.boat)).length;
    const resumed = resume(guest, boatArgs(), asked.requestState, accept, {
      scope: 'orders:read orders:manage',
    });
    expect(await refused(resumed)).toBe(true);
    expect(await ordersOf(offer.boat)).toHaveLength(ordersBefore);
  });
});
