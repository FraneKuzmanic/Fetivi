import {
  createMemoryMailer,
  findConversation,
  fromLocalDateTime,
  type JobQueue,
  loadMessages,
  type MessagePart,
  orders,
  pendingActions,
  QUEUES,
  sendProviderNotification,
  spaces,
  type ToolTransport,
  turnMetrics,
} from '@fetivi/domain';
import {
  publishOffer,
  scriptedHandoffTranslator,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { simulateReadableStream, type UIMessageChunk } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ChatTestApp,
  createChatTestApp,
  enterSpace,
  get,
  readStream,
  write,
} from '../testing';

// The guest side of an Order end to end: a mocked model, the real database, and the guest tools
// over the real MCP servers or in process (V0): every case runs in both modes.

type StreamResult = { stream: ReadableStream<unknown> };
const ZONE = 'Europe/Zagreb';
const CONTACT = { email: 'guest@example.test', name: 'Ana', phone: '+385 91 000' };

const usage = () => ({
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
});

type Call = { id: string; toolName: string; input: unknown };

/** One step's calls, after `text` when given. */
const callsStep = (calls: Call[], text?: string): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      ...(text
        ? [
            { type: 'text-start', id: 't0' },
            { type: 'text-delta', id: 't0', delta: text },
            { type: 'text-end', id: 't0' },
          ]
        : []),
      ...calls.map((c) => ({
        type: 'tool-call',
        toolCallId: c.id,
        toolName: c.toolName,
        input: JSON.stringify(c.input),
      })),
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: usage() },
    ],
  }),
});

const textStep = (text: string): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: text },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: usage() },
    ],
  }),
});

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const apps: ChatTestApp[] = [];
// Each test's app (database, MCP servers) closes right after it, so few connections stay open.
afterEach(async () => {
  await Promise.all(apps.splice(0).map((t) => t.close()));
});

/** A guest in Trogir with the Provider's Blue Lagoon boat trip bookable the day after check-in. */
async function setup(transport: ToolTransport) {
  const jobs: { name: string; data: Record<string, unknown> }[] = [];
  const queue: JobQueue = {
    send: async (name, data) => {
      jobs.push({ name, data: data as Record<string, unknown> });
    },
    publish: async () => {},
  };
  // Filled per test; the mock reads it by call index.
  const steps: StreamResult[] = [];
  const model = new MockLanguageModelV4({ doStream: steps as never });
  const t = await createChatTestApp({ model, queue, transport });
  apps.push(t);
  const seed = await seedGuestUnit(t.db, {
    now: t.clock.now(),
    checkInInDays: 2,
    releaseDaysBefore: 1,
  });
  const destinationId = await seedDestination(t.db);
  const provider = await seedProvider(t.db);
  const day = plusDays(seed.stay.checkIn, 1);
  const boat = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: fromLocalDateTime(`${day}T09:00`, ZONE),
    capacity: 40,
    contactFields: 'name_and_phone',
    title: 'Blue Lagoon boat trip',
    category: 'boat_trip',
  });
  await publishOffer(t.db, boat.offerId);
  const { cookie, space } = await enterSpace(t, seed);
  const args = { offerId: boat.offerId, date: day, quantity: 2, slotId: boat.slotId };
  return { t, model, steps, jobs, provider, cookie, space, day, args };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const sendText = (s: Setup, text: string) =>
  write('POST', s.t.app, '/api/chat', { text }, { cookie: s.cookie });
const sendAnswer = (s: Setup, answer: Record<string, unknown>) =>
  write('POST', s.t.app, '/api/chat', { answer }, { cookie: s.cookie });

const order = (id: string, input: unknown) => ({ id, toolName: 'create_order', input });
const PRICE_SAID = 'The trip is €90 for two.';
/** create_order after the words a booking card needs (ticket 62). */
const orderStep = (...calls: Call[]) => callsStep(calls, PRICE_SAID);

async function stored(s: Setup) {
  const conversation = await findConversation(s.t.db, s.space.space.id);
  if (!conversation) throw new Error('no conversation');
  return loadMessages(s.t.db, conversation.id);
}

const ordersOf = (s: Setup) =>
  s.t.db.select().from(orders).where(eq(orders.spaceId, s.space.space.id));
const pendingOf = (s: Setup) =>
  s.t.db.select().from(pendingActions).where(eq(pendingActions.spaceId, s.space.space.id));

const ofType = <T extends UIMessageChunk['type']>(chunks: UIMessageChunk[], type: T) =>
  chunks.filter((c) => c.type === type) as Extract<UIMessageChunk, { type: T }>[];
const cards = (chunks: UIMessageChunk[]) =>
  chunks.filter((c) => c.type === 'data-elicitation') as unknown as {
    id: string;
    data: {
      toolCallId: string;
      requestState: string;
      draft: { offerTitle: string; quantity: number };
      requestedSchema: { properties: Record<string, unknown> };
    };
  }[];
const partOf = (parts: MessagePart[], type: string) =>
  parts.find((p) => p.type === type) as Record<string, unknown> | undefined;

describe.each(['mcp', 'inprocess'] as const)('booking in chat (%s)', (transport) => {
  it('asks for confirmation, books on the tap and resumes the same message (E2E)', async () => {
    const s = await setup(transport);
    s.steps.push(
      orderStep(order('call-order', s.args)),
      textStep('Your Blue Lagoon trip is booked for two.'),
    );

    // 1. The model calls create_order: the step stops and the card is streamed.
    const first = readStream(await sendText(s, 'Book the boat trip for two'));
    expect(ofType(first, 'tool-input-available')).toHaveLength(1);
    const [card] = cards(first);
    expect(card?.id).toBe('call-order');
    expect(card?.data.draft).toMatchObject({
      offerTitle: '[en] Blue Lagoon boat trip',
      quantity: 2,
    });
    expect(Object.keys(card?.data.requestedSchema.properties ?? {}).sort()).toEqual([
      'email',
      'name',
      'note',
      'phone',
    ]);
    expect(card?.data.requestState.length).toBeGreaterThan(20);
    expect(ofType(first, 'tool-output-available')).toEqual([]);
    expect(first.at(-1)?.type).toBe('finish');
    expect(s.model.doStreamCalls).toHaveLength(1);
    expect(await ordersOf(s)).toEqual([]);
    expect((await pendingOf(s)).map((p) => p.state)).toEqual(['pending']);

    const before = await stored(s);
    const paused = before.at(-1);
    expect(paused?.role).toBe('assistant');
    expect(partOf(paused?.parts ?? [], 'tool-create_order')).toMatchObject({
      state: 'input-available',
    });
    expect(partOf(paused?.parts ?? [], 'data-elicitation')).toMatchObject({
      id: 'call-order',
      data: { requestState: card?.data.requestState },
    });

    // 2. The guest confirms: the stored requestState goes back and the same message continues.
    const second = readStream(
      await sendAnswer(s, { toolCallId: 'call-order', action: 'accept', content: CONTACT }),
    );
    expect(second[0]).toEqual({ type: 'start', messageId: paused?.id });
    const output = ofType(second, 'tool-output-available')[0];
    expect(output).toMatchObject({ toolCallId: 'call-order', output: { outcome: 'ordered' } });
    expect(second).toContainEqual(
      expect.objectContaining({
        type: 'data-component',
        id: 'call-order',
        data: expect.objectContaining({ name: 'receipt-card' }),
      }),
    );
    expect(second).toContainEqual(
      expect.objectContaining({ delta: 'Your Blue Lagoon trip is booked for two.' }),
    );
    expect(s.model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(s.model.doStreamCalls[1]?.prompt)).toContain('ordered');

    const placed = await ordersOf(s);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      status: 'confirmed',
      quantity: 2,
      guestEmail: CONTACT.email,
    });
    const [space] = await s.t.db.select().from(spaces).where(eq(spaces.id, s.space.space.id));
    expect(space?.email).toBe(CONTACT.email);
    expect(space?.emailOptInAt).not.toBeNull();

    // The Provider is told: the job the server queued sends one email.
    const notify = s.jobs.find(
      (j) => j.name === QUEUES.orderNotify && j.data.kind === 'provider_confirmed',
    );
    expect(notify).toBeDefined();
    const mailer = createMemoryMailer();
    const sent = await sendProviderNotification(
      {
        db: s.t.db,
        mailer,
        now: s.t.clock.now,
        providerLink: {
          secret: 'booking-test-secret-that-is-long-enough',
          baseUrl: 'http://x.test',
        },
        webOrigin: 'http://admin.test',
        handoffTranslator: scriptedHandoffTranslator([null]),
      },
      notify?.data as { orderId: string; proposalId: string; kind: 'provider_confirmed' },
    );
    expect(sent).toBe('sent');
    expect(mailer.sent.map((m) => m.to)).toEqual([s.provider.email]);

    // One assistant message holds the card's call, the receipt and the words after it.
    const after = await stored(s);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    const history = (await get(s.t.app, '/api/chat', s.cookie)).json() as {
      messages: { id: string; role: string; parts: { type: string; data?: { name?: string } }[] }[];
    };
    expect(history.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const answer = history.messages[1];
    expect(answer?.id).toBe(paused?.id);
    expect(answer?.parts.some((p) => p.type === 'data-elicitation')).toBe(true);
    expect(answer?.parts.find((p) => p.type === 'data-component')?.data?.name).toBe('receipt-card');
    expect(answer?.parts.at(-1)).toMatchObject({ type: 'text' });

    const metrics = await s.t.db.select().from(turnMetrics);
    expect(metrics.map((m) => m.toolNames)).toEqual([['create_order'], ['create_order']]);
    expect(metrics.map((m) => m.transport)).toEqual([transport, transport]);
  });

  it('pauses only the write tool when it is called with a read tool', async () => {
    const s = await setup(transport);
    s.steps.push(
      callsStep(
        [{ id: 'call-list', toolName: 'list_offers', input: {} }, order('call-order', s.args)],
        PRICE_SAID,
      ),
    );
    const chunks = readStream(await sendText(s, 'What boat trips are there? Book the first.'));
    expect(ofType(chunks, 'tool-output-available').map((c) => c.toolCallId)).toEqual(['call-list']);
    expect(cards(chunks).map((c) => c.id)).toEqual(['call-order']);
    expect(s.model.doStreamCalls).toHaveLength(1);
  });

  it('writes the words first when create_order comes without them, then shows the card', async () => {
    const s = await setup(transport);
    s.steps.push(callsStep([order('call-order', s.args)]), textStep(PRICE_SAID));
    const chunks = readStream(await sendText(s, 'Book the boat trip for two'));
    // The words step may only write, and sees the turn without the paused call.
    expect(s.model.doStreamCalls).toHaveLength(2);
    expect(s.model.doStreamCalls[1]?.toolChoice).toEqual({ type: 'none' });
    expect(JSON.stringify(s.model.doStreamCalls[1]?.prompt)).not.toContain('call-order');
    // The words come before the card, which belongs to the model's own call.
    const said = chunks.findIndex((c) => 'delta' in c && c.delta === PRICE_SAID);
    const card = chunks.findIndex((c) => c.type === 'data-elicitation');
    expect(said).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(said);
    expect(cards(chunks).map((c) => c.id)).toEqual(['call-order']);
    expect((await pendingOf(s)).map((p) => p.state)).toEqual(['pending']);
    const parts = (await stored(s)).at(-1)?.parts ?? [];
    expect(parts.map((p) => p.type).filter((t) => t !== 'step-start')).toEqual([
      'tool-create_order',
      'text',
      'data-elicitation',
    ]);
  });

  it('asks for no extra words when the step already said them', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)));
    const chunks = readStream(await sendText(s, 'Book the boat trip for two'));
    expect(s.model.doStreamCalls).toHaveLength(1);
    expect(cards(chunks).map((c) => c.id)).toEqual(['call-order']);
  });

  // Ticket 66: Not now is the guest's choice, not a failure for the model to explain.
  it.each(['decline', 'cancel'] as const)(
    'Not now (%s) books nothing, releases the record and starts no model turn',
    async (action) => {
      const s = await setup(transport);
      s.steps.push(orderStep(order('call-order', s.args)), textStep('Anything else?'));
      await sendText(s, 'Book it');
      const chunks = readStream(await sendAnswer(s, { toolCallId: 'call-order', action }));
      expect(ofType(chunks, 'tool-output-available')[0]).toMatchObject({
        output: { outcome: 'not_ordered', order: null },
      });
      expect(chunks.some((c) => c.type === 'data-component')).toBe(false);
      expect(chunks.some((c) => c.type === 'text-delta')).toBe(false);
      expect(chunks.at(-1)?.type).toBe('finish');
      expect(s.model.doStreamCalls).toHaveLength(1);
      expect(await ordersOf(s)).toEqual([]);
      expect((await pendingOf(s)).map((p) => p.state)).toEqual(['released']);
      // Stored as the browser shows it: the declined card is the answer's last part.
      const parts = (await stored(s)).at(-1)?.parts ?? [];
      expect(parts.map((p) => p.type).filter((t) => t !== 'step-start')).toEqual([
        'text',
        'tool-create_order',
        'data-elicitation',
      ]);
      expect(partOf(parts, 'tool-create_order')).toMatchObject({
        state: 'output-available',
        output: { outcome: 'not_ordered' },
      });

      // The model sees the decline only in the next turn's history.
      readStream(await sendText(s, 'What about dinner?'));
      expect(s.model.doStreamCalls).toHaveLength(2);
      const results = (s.model.doStreamCalls[1]?.prompt ?? [])
        .filter((m) => m.role === 'tool')
        .flatMap((m) => m.content as { type: string; toolCallId: string }[]);
      expect(results.map((r) => r.toolCallId)).toContain('call-order');
      expect(JSON.stringify(results)).toContain('not_ordered');
    },
  );

  it('a second tap finds nothing to answer and books once', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)), textStep('Booked.'));
    await sendText(s, 'Book it');
    const tap = { toolCallId: 'call-order', action: 'accept', content: CONTACT };
    expect((await sendAnswer(s, tap)).statusCode).toBe(200);
    const again = await sendAnswer(s, tap);
    expect([again.statusCode, again.json()]).toEqual([409, { error: 'nothing-to-answer' }]);
    expect(await ordersOf(s)).toHaveLength(1);
  });

  it('answers 409 for an unknown call and 400 for a forged body', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)));
    const none = await sendAnswer(s, { toolCallId: 'call-order', action: 'accept' });
    expect([none.statusCode, none.json()]).toEqual([409, { error: 'nothing-to-answer' }]);
    await sendText(s, 'Book it');
    const unknown = await sendAnswer(s, { toolCallId: 'call-other', action: 'accept' });
    expect([unknown.statusCode, unknown.json()]).toEqual([409, { error: 'nothing-to-answer' }]);
    for (const body of [
      { answer: { toolCallId: 'call-order', action: 'accept', requestState: 'forged' } },
      { text: 'hi', answer: { toolCallId: 'call-order', action: 'accept' } },
      { answer: { toolCallId: 'call-order', action: 'maybe' } },
    ]) {
      const bad = await write('POST', s.t.app, '/api/chat', body, { cookie: s.cookie });
      expect([bad.statusCode, bad.json()]).toEqual([400, { error: 'invalid-input' }]);
    }
    expect(await ordersOf(s)).toEqual([]);
  });

  it('new text while a card is open cancels it first, so no call is left without a result', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)), textStep('Sure, what else?'));
    await sendText(s, 'Book it');
    const chunks = readStream(await sendText(s, 'Actually, what about restaurants?'));
    expect(chunks).toContainEqual(expect.objectContaining({ delta: 'Sure, what else?' }));
    expect((await pendingOf(s)).map((p) => p.state)).toEqual(['released']);
    expect(await ordersOf(s)).toEqual([]);

    const prompt = s.model.doStreamCalls[1]?.prompt ?? [];
    const results = prompt
      .filter((m) => m.role === 'tool')
      .flatMap((m) => m.content as { type: string; toolCallId: string }[]);
    expect(results.map((r) => [r.type, r.toolCallId])).toEqual([['tool-result', 'call-order']]);
    expect(JSON.stringify(results)).toContain('not_ordered');

    const rows = await stored(s);
    const cancelled = rows.find((r) => r.parts.some((p) => p.type === 'tool-create_order'));
    expect(partOf(cancelled?.parts ?? [], 'tool-create_order')).toMatchObject({
      state: 'output-available',
      output: { outcome: 'not_ordered' },
    });
    // The old card is answered now: a late tap finds nothing.
    const late = await sendAnswer(s, {
      toolCallId: 'call-order',
      action: 'accept',
      content: CONTACT,
    });
    expect(late.statusCode).toBe(409);
  });

  it('a refusal of the first half goes back to the model in the same response', async () => {
    const s = await setup(transport);
    s.steps.push(
      orderStep(order('call-order', { ...s.args, date: plusDays(s.day, 30), slotId: undefined })),
      textStep('That day is outside your stay.'),
    );
    const chunks = readStream(await sendText(s, 'Book it next month'));
    expect(ofType(chunks, 'tool-output-error')[0]).toMatchObject({ toolCallId: 'call-order' });
    expect(cards(chunks)).toEqual([]);
    expect(chunks).toContainEqual(
      expect.objectContaining({ delta: 'That day is outside your stay.' }),
    );
    expect(chunks.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(s.model.doStreamCalls).toHaveLength(2);
    expect(await pendingOf(s)).toEqual([]);
  });

  it('a tap after the confirmation expired books nothing and the model explains', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)), textStep('That confirmation expired.'));
    await sendText(s, 'Book it');
    // The pending record's TTL runs on the app clock (the requestState codec on the real one).
    s.t.clock.advance(11 * 60_000);
    const chunks = readStream(
      await sendAnswer(s, { toolCallId: 'call-order', action: 'accept', content: CONTACT }),
    );
    expect(ofType(chunks, 'tool-output-error')[0]).toMatchObject({ toolCallId: 'call-order' });
    expect(chunks).toContainEqual(expect.objectContaining({ delta: 'That confirmation expired.' }));
    expect(await ordersOf(s)).toEqual([]);
    expect((await pendingOf(s)).map((p) => p.state)).toEqual(['released']);
  });

  it('two cards in one step: the first answer waits for the second before the model runs', async () => {
    const s = await setup(transport);
    s.steps.push(
      orderStep(order('call-a', s.args), order('call-b', { ...s.args, quantity: 1 })),
      textStep('Both are booked.'),
    );
    const first = readStream(await sendText(s, 'Book two trips'));
    expect(cards(first).map((c) => c.id)).toEqual(['call-a', 'call-b']);
    const a = readStream(
      await sendAnswer(s, { toolCallId: 'call-a', action: 'accept', content: CONTACT }),
    );
    expect(ofType(a, 'tool-output-available').map((c) => c.toolCallId)).toEqual(['call-a']);
    expect(s.model.doStreamCalls).toHaveLength(1);
    const b = readStream(
      await sendAnswer(s, { toolCallId: 'call-b', action: 'accept', content: CONTACT }),
    );
    expect(b).toContainEqual(expect.objectContaining({ delta: 'Both are booked.' }));
    expect(s.model.doStreamCalls).toHaveLength(2);
    expect(await ordersOf(s)).toHaveLength(2);
  });

  it('a model failure after the tap stores nothing; the next tap returns the same Order', async () => {
    const s = await setup(transport);
    s.steps.push(orderStep(order('call-order', s.args)));
    const failing = {
      stream: new ReadableStream({
        start(controller) {
          controller.error(new Error('overloaded'));
        },
      }),
    };
    s.steps.push(failing, textStep('Booked.'));
    await sendText(s, 'Book it');
    const tap = { toolCallId: 'call-order', action: 'accept', content: CONTACT };
    const failed = readStream(await sendAnswer(s, tap));
    expect(failed).toContainEqual({ type: 'error', errorText: 'turn-failed' });
    const ok = readStream(await sendAnswer(s, tap));
    expect(ofType(ok, 'tool-output-available')[0]).toMatchObject({
      output: { outcome: 'ordered' },
    });
    expect(await ordersOf(s)).toHaveLength(1);
  });

  it('the availability picker comes from check_availability', async () => {
    const s = await setup(transport);
    s.steps.push(
      callsStep([
        {
          id: 'call-avail',
          toolName: 'check_availability',
          input: { offerId: s.args.offerId, date: s.day, quantity: 2 },
        },
      ]),
      textStep('There is a start at 09:00.'),
    );
    const chunks = readStream(await sendText(s, 'When does it leave?'));
    expect(chunks).toContainEqual({
      type: 'data-component',
      id: 'call-avail',
      data: {
        name: 'availability-picker',
        payload: {
          offerId: s.args.offerId,
          date: s.day,
          quantity: 2,
          starts: [{ slotId: s.args.slotId, startsAtLocal: `${s.day}T09:00`, remaining: 40 }],
        },
      },
    });
  });
});
