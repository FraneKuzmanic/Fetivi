import {
  allotmentSlots,
  CANCEL_DRAFT_META_KEY,
  createJobQueue,
  createOrder,
  fromLocalDateTime,
  GUEST_CONFIRMS_META_KEY,
  paymentAttempts,
  providerPropose,
  QUEUES,
  RESPOND_DRAFT_META_KEY,
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
  options: Parameters<typeof connect>[1] & { tool?: string } = {},
) {
  const client = await connect(await ctxOf(g), options);
  try {
    return await client.callTool(
      {
        name: options.tool ?? 'create_order',
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

  it('in a destination: six tools in order, with honest annotations', async () => {
    const tools = await names(guest);
    expect(tools.map((x) => x.name)).toEqual([
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
      'cancel_order',
      'respond_to_order_update',
    ]);
    for (const read of tools.slice(0, 3)) expect(read.annotations?.readOnlyHint).toBe(true);
    expect(tools[3]?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    for (const write of tools.slice(4)) {
      expect(write.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
    }
    for (const tool of tools) expect(tool.outputSchema).toBeDefined();
    // Only the guest-confirmed writes carry the pause flag the chat backend reads.
    expect(tools.map((x) => x._meta?.[GUEST_CONFIRMS_META_KEY] === true)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('outside a destination: six tools with own Offers, else only the order tools', async () => {
    expect((await names(outsider)).map((x) => x.name)).toHaveLength(6);
    expect((await names(lonely)).map((x) => x.name)).toEqual([
      'list_my_orders',
      'cancel_order',
      'respond_to_order_update',
    ]);
  });

  it('after checkout: only list_my_orders, cancel_order and respond_to_order_update', async () => {
    expect((await names(ended)).map((x) => x.name)).toEqual([
      'list_my_orders',
      'cancel_order',
      'respond_to_order_update',
    ]);
  });

  it('without orders:manage: no respond_to_order_update', async () => {
    const client = await connect(await ctxOf(guest), {
      scope: 'offers:read orders:read orders:create',
    });
    const { tools } = await client.listTools();
    await client.close();
    expect(tools.map((x) => x.name)).not.toContain('respond_to_order_update');
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

  it('refuses a date outside the stay and another host’s Offer; on request is bookable', async () => {
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
    // The Provider answers for the time (36).
    expect(sunset.structuredContent).toMatchObject({
      starts: [{ slotId: null, startsAt: null, startsAtLocal: null, remaining: null }],
    });
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

describe('cancel_order', () => {
  type CancelDraft = {
    pendingId: string;
    orderId: string;
    cancellationPolicy: string;
    refundMinor: number | null;
    refundPercent: number | null;
  };
  const cancelArgs = (orderId: string) => ({ orderId });
  const tap: Answer = { action: 'accept', content: {} };
  const asCancel = { tool: 'cancel_order' };

  /** A confirmed pay-direct boat Order of the guest, booked through create_order. */
  async function booked(): Promise<string> {
    const asked = await firstHalf(guest, boatArgs());
    const done = await resume(guest, boatArgs(), asked.requestState, accept);
    return (done.structuredContent as { order: { id: string } }).order.id;
  }

  /** Turns an Order into a captured pay-online one of 50.00 EUR, 50 % after the cutoff. */
  async function captured(orderId: string, freeCancelHoursBefore = 24) {
    const order = await orderById(orderId);
    if (!order?.currentProposalId) throw new Error('no proposal');
    await t.db.insert(paymentAttempts).values({
      orderId,
      proposalId: order.currentProposalId,
      proposalVersion: 1,
      stripeAccountId: 'acct_test',
      amountMinor: 5000,
      currency: 'EUR',
      applicationFeeMinor: 500,
      productName: 'Blue Lagoon boat trip',
      locale: 'en',
      expiresAt: new Date(clock.getTime() + 30 * 60_000),
      paymentIntentId: `pi_${orderId}`,
      intentStatus: 'succeeded',
    });
    await t.testDb.pool.query(
      `update orders set payment_mode = 'online', payment_status = 'captured',
         free_cancel_hours_before = $2, refund_percent_after = 50 where id = $1`,
      [orderId, freeCancelHoursBefore],
    );
  }

  async function asked(g: SeededGuestUnit, orderId: string) {
    const result = (await call(g, 'cancel_order', cancelArgs(orderId))) as unknown as InputRequired;
    expect(result.resultType).toBe('input_required');
    const params = result.inputRequests.confirm?.params as {
      message: string;
      requestedSchema: { properties: Record<string, unknown> };
      _meta: Record<string, CancelDraft>;
    };
    return { result, params, draft: params._meta[CANCEL_DRAFT_META_KEY] as CancelDraft };
  }

  const attemptOf = (orderId: string) =>
    t.db.query.paymentAttempts.findFirst({ where: (a, { eq }) => eq(a.orderId, orderId) });
  const cancelEvents = async (orderId: string) =>
    (
      await t.db.query.orderEvents.findMany({ where: (e, { eq }) => eq(e.orderId, orderId) })
    ).filter((e) => e.toStatus === 'cancelled' && e.fromStatus !== 'cancelled');
  const setOrder = (orderId: string, set: string) =>
    t.testDb.pool.query(`update orders set ${set} where id = $1`, [orderId]);

  it('shows the policy and the refund from the rules; the tap refunds that amount', async () => {
    const id = await booked();
    // A 720 h rule: the cutoff has passed, so the policy gives 50 %.
    await captured(id, 720);
    const { result, params, draft } = await asked(guest, id);
    expect(params.requestedSchema.properties).toEqual({});
    expect(draft).toMatchObject({ orderId: id, refundMinor: 2500, refundPercent: 50 });
    expect(draft.cancellationPolicy.length).toBeGreaterThan(0);
    expect(params.message).toContain('You get back 25.00 EUR (50 %)');
    expect((await orderById(id))?.status).toBe('confirmed');

    const done = await resume(guest, cancelArgs(id), result.requestState, tap, asCancel);
    expect(done.structuredContent).toMatchObject({
      outcome: 'cancelled',
      order: { id, status: 'cancelled', paymentStatus: 'refund_pending', refundMinor: 2500 },
    });
    expect(await attemptOf(id)).toMatchObject({ refundStatus: 'pending', refundAmountMinor: 2500 });
  });

  it('a pay-direct Order cancels with no refund line', async () => {
    const id = await booked();
    const { result, params, draft } = await asked(guest, id);
    expect(draft.refundMinor).toBeNull();
    expect(params.message).toContain('paid directly to the provider');
    const done = await resume(guest, cancelArgs(id), result.requestState, tap, asCancel);
    expect(done.structuredContent).toMatchObject({
      outcome: 'cancelled',
      order: { status: 'cancelled', paymentStatus: 'none' },
    });
  });

  it('decline releases the card; nothing is cancelled', async () => {
    const id = await booked();
    const { result } = await asked(guest, id);
    const declined = await resume(
      guest,
      cancelArgs(id),
      result.requestState,
      { action: 'cancel' },
      asCancel,
    );
    expect(declined.structuredContent).toEqual({ outcome: 'not_cancelled', order: null });
    const later = await resume(guest, cancelArgs(id), result.requestState, tap, asCancel);
    expect(later.isError).toBe(true);
    expect((await orderById(id))?.status).toBe('confirmed');
  });

  it('a replayed tap gives the same outcome and one cancel event', async () => {
    const id = await booked();
    await captured(id);
    const { result } = await asked(guest, id);
    const first = await resume(guest, cancelArgs(id), result.requestState, tap, asCancel);
    const second = await resume(guest, cancelArgs(id), result.requestState, tap, asCancel);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(await cancelEvents(id)).toHaveLength(1);
    // A new card for the cancelled Order is refused.
    const again = await call(guest, 'cancel_order', cancelArgs(id));
    expect(errorText(again)).toBe("This order can't be cancelled any more.");
  });

  it("another space's Order is not permitted", async () => {
    const id = await booked();
    const result = await call(neighbour, 'cancel_order', cancelArgs(id));
    expect(result).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
  });

  it('after checkout: a confirmed Order is refused, an unresolved one is cancelled', async () => {
    const queue = createJobQueue(t.boss);
    const date = plusDays(ended.stay.checkIn, 1);
    const make = async () =>
      (
        await createOrder(
          { db: t.db, queue, now: () => clock },
          {
            spaceId: ended.spaceId,
            offerId: offer.sunset,
            date,
            quantity: 1,
            contact: { email: 'guest@example.test' },
          },
        )
      ).order;
    const waiting = await make();
    expect(waiting.status).toBe('pending_provider');
    const settled = await make();
    await setOrder(settled.id, "status = 'confirmed'");

    const refusedCall = await call(ended, 'cancel_order', cancelArgs(settled.id));
    expect(errorText(refusedCall)).toContain('After checkout');
    const { result } = await asked(ended, waiting.id);
    const out = await resume(ended, cancelArgs(waiting.id), result.requestState, tap, asCancel);
    expect(out.structuredContent).toMatchObject({ outcome: 'cancelled' });
  });

  it('a refund that changed since the card re-asks with the new amount', async () => {
    const id = await booked();
    await captured(id);
    const { result, draft } = await asked(guest, id);
    expect(draft).toMatchObject({ refundMinor: 5000, refundPercent: 100 });
    // The cutoff passes while the card is open.
    await setOrder(id, 'free_cancel_hours_before = 720');
    const again = (await resume(
      guest,
      cancelArgs(id),
      result.requestState,
      tap,
      asCancel,
    )) as unknown as InputRequired;
    expect(again.resultType).toBe('input_required');
    const params = again.inputRequests.confirm?.params as { _meta: Record<string, CancelDraft> };
    const next = params._meta[CANCEL_DRAFT_META_KEY];
    expect(next).toMatchObject({ refundMinor: 2500, refundPercent: 50 });
    expect((await orderById(id))?.status).toBe('confirmed');
    const done = await resume(guest, cancelArgs(id), again.requestState, tap, asCancel);
    expect(done.structuredContent).toMatchObject({ order: { refundMinor: 2500 } });
  });

  it("one server verifies both tools' states; one tool's state never completes the other", async () => {
    const id = await booked();
    const order = await firstHalf(guest, boatArgs());
    const crossed = await resume(guest, cancelArgs(id), order.requestState, tap, asCancel);
    expect(crossed).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
    const { result } = await asked(guest, id);
    const other = await resume(guest, boatArgs(), result.requestState, accept);
    expect(other).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
    expect((await orderById(id))?.status).toBe('confirmed');
    const done = await resume(guest, boatArgs(), order.requestState, accept);
    expect((done.structuredContent as { outcome: string }).outcome).toBe('ordered');
  });
});

describe('respond_to_order_update', () => {
  type RespondDraft = {
    pendingId: string;
    orderId: string;
    proposer: string;
    startsAtLocal: string | null;
    previous: { date: string };
  };
  const args = (orderId: string) => ({ orderId });
  const asRespond = { tool: 'respond_to_order_update' };
  const answer = (value: string): Answer => ({ action: 'accept', content: { answer: value } });

  /** A pay-direct on-request Order of `g` with the Provider's new time (v2) awaiting the guest. */
  async function updated(g: SeededGuestUnit = guest) {
    const deps = { db: t.db, queue: createJobQueue(t.boss), now: () => clock };
    const { order } = await createOrder(deps, {
      spaceId: g.spaceId,
      offerId: offer.sunset,
      date: plusDays(g.stay.checkIn, 1),
      quantity: 2,
      contact: { email: 'guest@example.test' },
    });
    await providerPropose(
      deps,
      { orderId: order.id, proposalId: order.currentProposalId as string },
      { date: plusDays(g.stay.checkIn, 1), time: '18:30' },
      { trigger: 'provider_link' },
    );
    return order.id;
  }

  async function asked(g: SeededGuestUnit, orderId: string) {
    const result = (await call(
      g,
      'respond_to_order_update',
      args(orderId),
    )) as unknown as InputRequired;
    expect(result.resultType).toBe('input_required');
    const params = result.inputRequests.confirm?.params as {
      message: string;
      requestedSchema: { properties: Record<string, unknown>; required: string[] };
      _meta: Record<string, RespondDraft>;
    };
    return { result, params, draft: params._meta[RESPOND_DRAFT_META_KEY] as RespondDraft };
  }

  it('shows the new terms on a card; accepting confirms the order', async () => {
    const id = await updated();
    const { result, params, draft } = await asked(guest, id);
    expect(params.requestedSchema.required).toEqual(['answer']);
    expect(draft).toMatchObject({ orderId: id, proposer: 'provider_time' });
    expect(draft.startsAtLocal?.slice(11)).toBe('18:30');
    expect(params.message).toContain('at 18:30');
    const done = await resume(guest, args(id), result.requestState, answer('accept'), asRespond);
    expect(done.structuredContent).toMatchObject({
      outcome: 'accepted',
      order: { id, status: 'confirmed', respondBy: null },
    });
  });

  it('declining the terms cancels; not now leaves the order waiting', async () => {
    const id = await updated();
    const { result } = await asked(guest, id);
    const notNow = await resume(
      guest,
      args(id),
      result.requestState,
      { action: 'decline' },
      asRespond,
    );
    expect(notNow.structuredContent).toEqual({ outcome: 'not_answered', order: null });
    expect((await orderById(id))?.status).toBe('awaiting_confirmation');

    const again = await asked(guest, id);
    const done = await resume(
      guest,
      args(id),
      again.result.requestState,
      answer('decline'),
      asRespond,
    );
    expect(done.structuredContent).toMatchObject({
      outcome: 'declined',
      order: { status: 'cancelled' },
    });
  });

  it('re-asks without an answer, and a replayed tap gives the same outcome', async () => {
    const id = await updated();
    const { result } = await asked(guest, id);
    const reasked = (await resume(
      guest,
      args(id),
      result.requestState,
      { action: 'accept', content: {} },
      asRespond,
    )) as unknown as InputRequired;
    expect(reasked.resultType).toBe('input_required');
    const first = await resume(guest, args(id), result.requestState, answer('accept'), asRespond);
    const second = await resume(guest, args(id), result.requestState, answer('decline'), asRespond);
    expect(second.structuredContent).toEqual(first.structuredContent);
  });

  it('a card for terms already answered is refused and changes nothing', async () => {
    const id = await updated();
    const { result } = await asked(guest, id);
    const other = await asked(guest, id);
    await resume(guest, args(id), other.result.requestState, answer('decline'), asRespond);
    const stale = await resume(guest, args(id), result.requestState, answer('accept'), asRespond);
    expect(errorText(stale)).toBe(
      'The provider changed the terms again; nothing was changed. Show the new terms.',
    );
    expect((await orderById(id))?.status).toBe('cancelled');
  });

  it('an order without new terms is refused, and another space is not permitted', async () => {
    const first = await firstHalf(guest, boatArgs());
    const booked = await resume(guest, boatArgs(), first.requestState, accept);
    const bookedId = (booked.structuredContent as { order: { id: string } }).order.id;
    const none = await call(guest, 'respond_to_order_update', args(bookedId));
    expect(errorText(none)).toBe('This order has no new terms to answer.');
    const id = await updated();
    const foreign = await call(neighbour, 'respond_to_order_update', args(id));
    expect(foreign).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
  });

  it('a cancel_order state never completes respond_to_order_update', async () => {
    const id = await updated();
    const cancelCard = (await call(guest, 'cancel_order', {
      orderId: id,
    })) as unknown as InputRequired;
    const crossed = await resume(
      guest,
      args(id),
      cancelCard.requestState,
      answer('accept'),
      asRespond,
    );
    expect(crossed).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
    expect((await orderById(id))?.status).toBe('awaiting_confirmation');
  });
});
