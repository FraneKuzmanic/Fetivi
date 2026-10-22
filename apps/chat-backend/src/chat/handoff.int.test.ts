import { randomUUID } from 'node:crypto';
import {
  accounts,
  appendInboxMessage,
  findConversation,
  handoffMessages,
  INBOX_PART_TYPE,
  loadMessages,
  pendingActions,
  QUEUES,
  replyToHandoff,
  runHandoffTranslation,
  type ToolTransport,
} from '@fetivi/domain';
import {
  type RecordedJob,
  recordingQueue,
  scriptedHandoffTranslator,
  seedGuestUnit,
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

// The guest side of a Host message end to end: a mocked model, the real database, and the stay
// tools over the real MCP servers or in process (V0): every case runs in both modes.

type StreamResult = { stream: ReadableStream<unknown> };

const usage = () => ({
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
});

const callsStep = (calls: { id: string; toolName: string; input: unknown }[]): StreamResult => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'stream-start', warnings: [] },
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

const DRAFT = { message: 'The shower has no hot water.', reason: 'problem', urgency: 'urgent' };
const draftCall = (id = 'call-draft', input: unknown = DRAFT) => ({
  id,
  toolName: 'draft_host_message',
  input,
});
const sendCall = (id = 'call-send', input: unknown = DRAFT) => ({
  id,
  toolName: 'send_host_message',
  input,
});

const apps: ChatTestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((t) => t.close()));
});

async function setup(
  transport: ToolTransport,
  options: { location?: null; checkInInDays?: number; hostLanguage?: 'hr' } = {},
) {
  const queue = recordingQueue();
  const steps: StreamResult[] = [];
  const model = new MockLanguageModelV4({ doStream: steps as never });
  const t = await createChatTestApp({ model, queue, transport });
  apps.push(t);
  const seed = await seedGuestUnit(t.db, {
    now: t.clock.now(),
    checkInInDays: options.checkInInDays ?? 2,
    ...(options.location === null ? { location: null } : {}),
  });
  if (options.hostLanguage) {
    await t.db
      .update(accounts)
      .set({ uiLanguage: options.hostLanguage })
      .where(eq(accounts.id, seed.hostId));
  }
  const { cookie, space } = await enterSpace(t, seed);
  return { t, model, steps, queue, seed, cookie, space };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const sendText = (s: Setup, text: string) =>
  write('POST', s.t.app, '/api/chat', { text }, { cookie: s.cookie });
const sendAnswer = (s: Setup, answer: Record<string, unknown>) =>
  write('POST', s.t.app, '/api/chat', { answer }, { cookie: s.cookie });

const handoffsOf = (s: Setup) =>
  s.t.db.select().from(handoffMessages).where(eq(handoffMessages.spaceId, s.space.space.id));
const pendingOf = (s: Setup) =>
  s.t.db.select().from(pendingActions).where(eq(pendingActions.spaceId, s.space.space.id));
const translationJobs = (s: Setup): RecordedJob[] =>
  s.queue.jobs.filter((j) => j.name === QUEUES.translateHandoff);

const ofType = <T extends UIMessageChunk['type']>(chunks: UIMessageChunk[], type: T) =>
  chunks.filter((c) => c.type === type) as Extract<UIMessageChunk, { type: T }>[];
const cards = (chunks: UIMessageChunk[]) =>
  chunks.filter((c) => c.type === 'data-elicitation') as unknown as {
    id: string;
    data: { draft: unknown; hostMessage: { text: string; urgency: string } | null };
  }[];
const components = (chunks: UIMessageChunk[]) =>
  chunks.filter((c) => c.type === 'data-component') as unknown as {
    id: string;
    data: { name: string; payload: Record<string, unknown> };
  }[];
const offeredTools = (s: Setup, call: number) =>
  (s.model.doStreamCalls[call]?.tools ?? []).map((tool) => tool.name);

/** Draft, then the card: the first turn's two steps. */
async function openCard(s: Setup, input: unknown = DRAFT) {
  s.steps.push(
    callsStep([draftCall('call-draft', input)]),
    callsStep([sendCall('call-send', input)]),
  );
  return readStream(await sendText(s, 'The shower has no hot water'));
}

async function sendMessage(s: Setup, text = 'Edited: no hot water since 8.') {
  await openCard(s);
  s.steps.push(textStep('I sent your message to your host.'));
  return readStream(
    await sendAnswer(s, {
      toolCallId: 'call-send',
      action: 'accept',
      content: { message: text },
    }),
  );
}

describe.each(['mcp', 'inprocess'] as const)('handoff to the host (%s)', (transport) => {
  it('shows the stored draft on a card and sends nothing without the tap', async () => {
    const s = await setup(transport);
    const first = await openCard(s);
    const [card] = cards(first);
    expect(card?.id).toBe('call-send');
    expect(card?.data.draft).toBeNull();
    expect(card?.data.hostMessage).toMatchObject({ text: DRAFT.message, urgency: 'urgent' });
    expect(ofType(first, 'tool-output-available').map((o) => o.toolCallId)).toEqual(['call-draft']);
    expect(await handoffsOf(s)).toEqual([]);
    expect((await pendingOf(s)).map((p) => [p.kind, p.state])).toEqual([
      ['send_host_message', 'pending'],
    ]);
    expect(translationJobs(s)).toEqual([]);
  });

  it('sends the guest’s edited text on the tap, never the model’s, with a translation job', async () => {
    const s = await setup(transport, { hostLanguage: 'hr' });
    await openCard(s, { ...DRAFT, message: 'Model text X' });
    s.steps.push(textStep('I sent your message to your host.'));
    const second = readStream(
      await sendAnswer(s, {
        toolCallId: 'call-send',
        action: 'accept',
        content: { message: 'Guest text Y' },
      }),
    );
    expect(ofType(second, 'tool-output-available')[0]).toMatchObject({
      toolCallId: 'call-send',
      output: { outcome: 'sent', message: { text: 'Guest text Y' } },
    });
    expect(components(second)).toContainEqual(
      expect.objectContaining({
        id: 'call-send',
        data: expect.objectContaining({ name: 'host-message-sent' }),
      }),
    );
    expect(second).toContainEqual(
      expect.objectContaining({ delta: 'I sent your message to your host.' }),
    );
    const rows = await handoffsOf(s);
    expect(rows.map((r) => r.text)).toEqual(['Guest text Y']);
    expect(JSON.stringify(rows)).not.toContain('Model text X');
    expect(rows[0]).toMatchObject({ hostLanguage: 'hr', translationState: 'pending' });
    expect(translationJobs(s).map((j) => j.data)).toEqual([
      { handoffId: rows[0]?.id, part: 'message' },
    ]);
  });

  it('never twice in one conversation', async () => {
    const s = await setup(transport);
    await sendMessage(s);
    s.steps.push(callsStep([draftCall('call-again')]), textStep('You already messaged your host.'));
    const again = readStream(await sendText(s, 'Can I message the host again?'));
    expect(ofType(again, 'tool-output-error').map((e) => e.toolCallId)).toEqual(['call-again']);
    // The browser sees a masked error; the model gets the refusal.
    expect(JSON.stringify(s.model.doStreamCalls.at(-1)?.prompt)).toContain(
      'already sent the host a message',
    );
    expect(cards(again)).toEqual([]);
    expect(await handoffsOf(s)).toHaveLength(1);
  });

  it('a decline sends nothing', async () => {
    const declined = await setup(transport);
    await openCard(declined);
    declined.steps.push(textStep('No problem.'));
    const out = readStream(
      await sendAnswer(declined, { toolCallId: 'call-send', action: 'cancel' }),
    );
    expect(ofType(out, 'tool-output-available')[0]).toMatchObject({
      output: { outcome: 'not_sent', message: null },
    });
    expect(await handoffsOf(declined)).toEqual([]);
  });

  it('new text while the card is open cancels it', async () => {
    const moved = await setup(transport);
    await openCard(moved);
    moved.steps.push(textStep('Sure, here is the Wi-Fi.'));
    readStream(await sendText(moved, 'Actually, what is the Wi-Fi?'));
    expect((await pendingOf(moved)).map((p) => p.state)).toEqual(['released']);
    expect(await handoffsOf(moved)).toEqual([]);
  });

  it('after checkout nothing can be sent, not even from a card left open', async () => {
    const s = await setup(transport, { checkInInDays: 1 });
    await openCard(s);
    s.t.clock.advance(6 * 86_400_000);
    const tap = await sendAnswer(s, {
      toolCallId: 'call-send',
      action: 'accept',
      content: { message: 'late' },
    });
    expect([tap.statusCode, tap.json()]).toEqual([409, { error: 'space-closed' }]);
    const text = await sendText(s, 'Message my host');
    expect(text.statusCode).toBe(409);
    expect(await handoffsOf(s)).toEqual([]);
  });

  it.each([
    ['before arrival', { checkInInDays: 3 }],
    ['outside a destination', { location: null }],
  ] as const)('is offered %s', async (_, options) => {
    const s = await setup(transport, options);
    await sendMessage(s);
    expect(offeredTools(s, 0)).toEqual(
      expect.arrayContaining(['draft_host_message', 'send_host_message']),
    );
    expect(await handoffsOf(s)).toHaveLength(1);
  });

  it('an emergency shows 112 and the host phone first, with no card', async () => {
    const s = await setup(transport);
    s.steps.push(
      callsStep([draftCall('call-sos', { ...DRAFT, reason: 'emergency' })]),
      textStep('Call 112 now.'),
    );
    const out = readStream(await sendText(s, 'Someone fell and is bleeding'));
    const [contacts] = components(out);
    expect(contacts).toMatchObject({ id: 'call-sos', data: { name: 'property-info' } });
    const fields = (contacts?.data.payload.fields ?? []) as { key: string }[];
    expect(fields[0]).toMatchObject({
      key: 'emergencyNumber',
      value: '112',
    });
    expect(cards(out)).toEqual([]);
    expect(await pendingOf(s)).toEqual([]);
  });

  it('the host reply reaches the Chat and the model once, translated both ways', async () => {
    const s = await setup(transport, { hostLanguage: 'hr' });
    await sendMessage(s);
    const [row] = await handoffsOf(s);
    const id = row?.id as string;

    // The message to the host is translated into the host's language.
    const translator = scriptedHandoffTranslator(['Nema tople vode.', 'A plumber comes at 4 pm.']);
    const translate = (part: 'message' | 'reply') =>
      runHandoffTranslation(
        { db: s.t.db, queue: s.queue, now: s.t.clock.now, handoffTranslator: translator },
        { handoffId: id, part },
      );
    expect(await translate('message')).toBe('done');
    expect(translator.calls[0]).toEqual({ text: 'Edited: no hot water since 8.', to: 'hr' });

    // The reply comes back translated into the space's language.
    await replyToHandoff(
      { db: s.t.db, queue: s.queue, now: s.t.clock.now },
      {
        hostId: s.seed.hostId,
        accountId: s.seed.hostId,
        id,
        text: 'Majstor dolazi u 16h.',
        markRead: true,
      },
    );
    expect(await translate('reply')).toBe('done');
    expect(translator.calls[1]).toEqual({ text: 'Majstor dolazi u 16h.', to: 'en' });

    const history = (await get(s.t.app, '/api/chat', s.cookie)).json() as {
      messages: { parts: { type: string; data?: Record<string, unknown> }[] }[];
    };
    const inbox = history.messages.at(-1)?.parts[0];
    expect(inbox).toMatchObject({
      type: 'data-inbox',
      data: { text: 'A plumber comes at 4 pm.', original: 'Majstor dolazi u 16h.' },
    });
    expect((await get(s.t.app, '/api/inbox', s.cookie)).json()).toEqual({
      unread: 1,
      handoffs: [{ id, status: 'read' }],
    });

    // The next turn's prompt carries the reply as a note; the one after does not.
    s.steps.push(textStep('Your host says a plumber comes at 4 pm.'), textStep('Enjoy!'));
    readStream(await sendText(s, 'Did the host answer?'));
    const calls = s.model.doStreamCalls;
    expect(JSON.stringify(calls.at(-1)?.prompt)).toContain(
      'The host replied to the guest\'s message (the guest sees it in the chat): \\"A plumber comes at 4 pm.\\"',
    );
    readStream(await sendText(s, 'Thanks'));
    const last = JSON.stringify(s.model.doStreamCalls.at(-1)?.prompt);
    expect(last.split('The host replied').length - 1).toBe(1);

    // Inbox rows never reach the model as conversation messages.
    expect(last).not.toContain('Majstor');
    const conversation = await findConversation(s.t.db, s.space.space.id);
    const rows = await loadMessages(s.t.db, conversation?.id as string);
    expect(rows.filter((r) => r.kind === 'inbox')).toHaveLength(1);
  });

  it('a notice in the inbox is never noted to the model', async () => {
    const s = await setup(transport);
    s.steps.push(textStep('Hello!'), textStep('Enjoy!'));
    readStream(await sendText(s, 'Hi'));
    const conversation = await findConversation(s.t.db, s.space.space.id);
    await appendInboxMessage(s.t.db, {
      conversationId: conversation?.id as string,
      id: randomUUID(),
      parts: [
        {
          type: INBOX_PART_TYPE,
          id: randomUUID(),
          data: {
            kind: 'notice',
            notification: 'order_confirmed',
            orderId: randomUUID(),
            offerTitle: 'Sunset kayak tour',
            date: '2027-05-04',
            startTime: null,
            checkoutTime: null,
            reviewPlatform: null,
            reviewUrl: null,
            at: s.t.clock.now().toISOString(),
          },
        },
      ],
      now: s.t.clock.now(),
    });
    readStream(await sendText(s, 'Anything new?'));
    const prompt = JSON.stringify(s.model.doStreamCalls.at(-1)?.prompt);
    expect(prompt).not.toContain('The host replied');
    expect(prompt).not.toContain('Sunset kayak tour');
  });

  it('a host reply stored while a turn runs reaches the model on the next turn', async () => {
    const s = await setup(transport);
    await sendMessage(s);
    const [row] = await handoffsOf(s);
    // The model's step stores the reply mid-turn, after the history was read.
    const reply = () =>
      replyToHandoff(
        { db: s.t.db, queue: s.queue, now: s.t.clock.now },
        {
          hostId: s.seed.hostId,
          accountId: s.seed.hostId,
          id: row?.id as string,
          text: 'A plumber comes at 4 pm.',
          markRead: true,
        },
      );
    // highWaterMark 0: nothing runs until the loop reads the step.
    const replyingStep: StreamResult = {
      stream: new ReadableStream(
        {
          async pull(controller) {
            await reply();
            for await (const chunk of textStep('Let me check.').stream) controller.enqueue(chunk);
            controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
    };
    s.steps.push(replyingStep, textStep('Your host says a plumber comes at 4 pm.'));
    readStream(await sendText(s, 'Is the host around?'));
    expect(JSON.stringify(s.model.doStreamCalls.at(-1)?.prompt)).not.toContain('The host replied');

    readStream(await sendText(s, 'Did the host answer?'));
    const next = JSON.stringify(s.model.doStreamCalls.at(-1)?.prompt);
    expect(next.split('The host replied').length - 1).toBe(1);
    expect(next).toContain('A plumber comes at 4 pm.');
  });
});
