import {
  GUEST_CONFIRMS_META_KEY,
  HOST_MESSAGE_DRAFT_META_KEY,
  QUEUES,
  type SpaceContext,
} from '@fetivi/domain';
import { type SeededGuestUnit, seedGuestUnit } from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contextOf,
  createTestServer,
  signToken,
  TEST_REQUEST_STATE_SECRET,
  type TestServer,
} from '../../testing';
import { stateCodec } from '../request-state';

let t: TestServer;
const clock = new Date();

type InputRequired = {
  resultType: 'input_required';
  inputRequests: Record<string, { method: string; params: Record<string, unknown> }>;
  requestState: string;
};
type Answer = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> };

const ARGS = { message: 'The shower has no hot water.', reason: 'problem', urgency: 'urgent' };

async function connect(ctx: SpaceContext, scope?: string) {
  const token = await signToken(t.keys, { server: 'stay', ctx, scope });
  const client = new Client(
    { name: 'guest-app', version: '0' },
    {
      versionNegotiation: { mode: 'auto' },
      capabilities: { elicitation: { form: {} } },
      inputRequired: { autoFulfill: false },
    },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${t.url}/stay`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function withClient<T>(g: SeededGuestUnit, run: (c: Client) => Promise<T>, scope?: string) {
  const client = await connect(await contextOf(t.db, g.spaceId), scope);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

const call = (g: SeededGuestUnit, name: string, args: Record<string, unknown>, scope?: string) =>
  withClient(g, (c) => c.callTool({ name, arguments: args }, { allowInputRequired: true }), scope);

const resume = (
  g: SeededGuestUnit,
  args: Record<string, unknown>,
  requestState: string,
  answer: Answer,
  scope?: string,
) =>
  withClient(
    g,
    (c) =>
      c.callTool(
        {
          name: 'send_host_message',
          arguments: args,
          inputResponses: { confirm: answer },
          requestState,
        } as Parameters<Client['callTool']>[0],
        { allowInputRequired: true },
      ),
    scope,
  );

async function firstHalf(g: SeededGuestUnit, args: Record<string, unknown> = ARGS) {
  const result = (await call(g, 'send_host_message', args)) as unknown as InputRequired;
  expect(result.resultType).toBe('input_required');
  return result;
}

const handoffsOf = (g: SeededGuestUnit) =>
  t.db.query.handoffMessages.findMany({ where: (h, { eq: e }) => e(h.spaceId, g.spaceId) });
const pendingOf = (g: SeededGuestUnit) =>
  t.db.query.pendingActions.findMany({ where: (p, { eq: e }) => e(p.spaceId, g.spaceId) });
const errorText = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text;
async function refused(run: Promise<{ isError?: unknown }>): Promise<boolean> {
  try {
    return (await run).isError === true;
  } catch {
    return true;
  }
}
async function rpcError(run: Promise<unknown>): Promise<number | 'resolved'> {
  try {
    await run;
    return 'resolved';
  } catch (error) {
    return (error as { code: number }).code;
  }
}
async function translationJobs(id: string) {
  const { rows } = await t.testDb.pool.query(
    "select data->>'part' as part from pgboss.job where name = $1 and data->>'handoffId' = $2",
    [QUEUES.translateHandoff, id],
  );
  return rows.map((r: { part: string }) => r.part);
}

const fresh = (options: Parameters<typeof seedGuestUnit>[1] = {}) =>
  seedGuestUnit(t.db, { now: clock, ...options });

beforeAll(async () => {
  t = await createTestServer({ listen: true, now: () => clock });
});

afterAll(async () => {
  await t?.close();
});

describe('stay tools: listing (authorization matrix)', () => {
  it('lists both before arrival, in stay and outside a destination; only send pauses', async () => {
    for (const g of [
      await fresh(),
      await fresh({ checkInInDays: -1 }),
      await fresh({ location: null }),
    ]) {
      const tools = await withClient(g, async (c) => (await c.listTools()).tools);
      expect(tools.map((tool) => tool.name)).toEqual(['draft_host_message', 'send_host_message']);
      const meta = Object.fromEntries(
        tools.map((tool) => [tool.name, tool._meta?.[GUEST_CONFIRMS_META_KEY]]),
      );
      expect(meta).toEqual({ draft_host_message: undefined, send_host_message: true });
    }
  });

  it('lists neither after checkout, and a direct call is refused', async () => {
    const ended = await fresh({ now: new Date(clock.getTime() - 40 * 86_400_000) });
    expect(await withClient(ended, async (c) => (await c.listTools()).tools)).toEqual([]);
    expect(await refused(call(ended, 'draft_host_message', ARGS))).toBe(true);
    expect(await refused(call(ended, 'send_host_message', ARGS))).toBe(true);
    expect(await pendingOf(ended)).toEqual([]);
  });
});

describe('draft_host_message', () => {
  it('returns the draft and stores nothing', async () => {
    const g = await fresh();
    const result = await call(g, 'draft_host_message', ARGS);
    expect(result.structuredContent).toEqual({
      outcome: 'draft',
      draft: { message: ARGS.message, reason: 'problem', urgency: 'urgent' },
      emergency: null,
    });
    expect(await pendingOf(g)).toEqual([]);
  });

  it('answers an emergency with 112 and the host phone, gated before the release', async () => {
    const before = await fresh();
    const gated = await call(before, 'draft_host_message', { ...ARGS, reason: 'emergency' });
    expect(gated.structuredContent).toMatchObject({
      outcome: 'emergency',
      draft: null,
      emergency: {
        emergencyNumber: '112',
        hostPhone: null,
        releaseAt: before.stay.arrivalReleaseAt.toISOString(),
      },
    });
    const released = await fresh({ releaseDaysBefore: 7 });
    const open = await call(released, 'draft_host_message', { ...ARGS, reason: 'emergency' });
    expect(open.structuredContent).toMatchObject({
      emergency: {
        emergencyNumber: '112',
        hostPhone: released.secrets.hostPhone,
        emergencyContactName: 'Ana',
        releaseAt: null,
      },
    });
    expect(await pendingOf(before)).toEqual([]);
    expect(await pendingOf(released)).toEqual([]);
  });
});

describe('send_host_message', () => {
  it('stores a pending record and shows the stored draft, prefilled', async () => {
    const g = await fresh();
    const first = await firstHalf(g);
    const params = first.inputRequests.confirm?.params as {
      requestedSchema: { properties: { message: { default: string; maxLength: number } } };
      _meta: Record<string, { pendingId: string; text: string; urgency: string }>;
    };
    expect(params.requestedSchema.properties.message).toMatchObject({
      default: ARGS.message,
      maxLength: 1000,
    });
    const [pending] = await pendingOf(g);
    expect(params._meta[HOST_MESSAGE_DRAFT_META_KEY]).toMatchObject({
      pendingId: pending?.id,
      text: ARGS.message,
      urgency: 'urgent',
    });
    expect(pending).toMatchObject({ kind: 'send_host_message', state: 'pending', orderId: null });
    expect(await handoffsOf(g)).toEqual([]);
  });

  it('sends the guest’s edited text on the tap, ignoring re-sent arguments', async () => {
    const g = await fresh({ spaceLanguage: 'de' });
    await t.testDb.pool.query('update accounts set ui_language = $1 where id = $2', [
      'hr',
      g.hostId,
    ]);
    const first = await firstHalf(g);
    const result = await resume(
      g,
      { ...ARGS, message: 'Model text that must never be sent' },
      first.requestState,
      { action: 'accept', content: { message: 'Edited: no hot water since 8.' } },
    );
    expect(result.structuredContent).toMatchObject({
      outcome: 'sent',
      message: { text: 'Edited: no hot water since 8.', urgency: 'urgent' },
    });
    const [row] = await handoffsOf(g);
    expect(row).toMatchObject({
      text: 'Edited: no hot water since 8.',
      guestLanguage: 'de',
      hostLanguage: 'hr',
      translationState: 'pending',
    });
    expect(await translationJobs(row?.id as string)).toEqual(['message']);

    // A replayed tap returns the same message.
    const again = await resume(g, ARGS, first.requestState, {
      action: 'accept',
      content: { message: 'other' },
    });
    expect(again.structuredContent).toEqual(result.structuredContent);
    expect(await handoffsOf(g)).toHaveLength(1);
  });

  it('a decline sends nothing', async () => {
    const g = await fresh();
    const first = await firstHalf(g);
    const result = await resume(g, ARGS, first.requestState, { action: 'decline' });
    expect(result.structuredContent).toEqual({ outcome: 'not_sent', message: null });
    expect(await handoffsOf(g)).toEqual([]);
    expect((await pendingOf(g))[0]?.state).toBe('released');
  });

  it('an empty answer gets the same card again', async () => {
    const g = await fresh();
    const first = await firstHalf(g);
    const again = (await resume(g, ARGS, first.requestState, {
      action: 'accept',
      content: { message: '  ' },
    })) as unknown as InputRequired;
    expect(again.resultType).toBe('input_required');
    expect(await handoffsOf(g)).toEqual([]);
  });

  it('never twice in one conversation', async () => {
    const g = await fresh();
    const first = await firstHalf(g);
    await resume(g, ARGS, first.requestState, { action: 'accept', content: { message: 'once' } });
    const draft = await call(g, 'draft_host_message', ARGS);
    expect(draft.isError).toBe(true);
    expect(errorText(draft)).toContain('already sent the host a message');
    const send = await call(g, 'send_host_message', ARGS);
    expect(send.isError).toBe(true);
    expect(await handoffsOf(g)).toHaveLength(1);
  });

  it('a card left open past checkout cannot be sent', async () => {
    const g = await fresh();
    const first = await firstHalf(g);
    // The token after checkout: the matrix no longer grants host_message:send.
    expect(
      await refused(
        resume(
          g,
          ARGS,
          first.requestState,
          { action: 'accept', content: { message: 'late' } },
          'unit:read',
        ),
      ),
    ).toBe(true);
    expect(await handoffsOf(g)).toEqual([]);
  });

  it('refuses another tool’s or another space’s requestState', async () => {
    const g = await fresh();
    const other = await fresh();
    await firstHalf(g);
    const [pending] = await pendingOf(g);
    const pendingId = pending?.id as string;
    const createOrderState = await stateCodec(
      'create_order',
      TEST_REQUEST_STATE_SECRET,
      g.spaceId,
    ).mint({ pendingId });
    const otherSpace = await stateCodec(
      'send_host_message',
      TEST_REQUEST_STATE_SECRET,
      other.spaceId,
    ).mint({ pendingId });
    for (const state of [createOrderState, otherSpace]) {
      expect(
        await rpcError(resume(g, ARGS, state, { action: 'accept', content: { message: 'x' } })),
      ).toBe(-32602);
    }
    expect(await handoffsOf(g)).toEqual([]);
  });
});
