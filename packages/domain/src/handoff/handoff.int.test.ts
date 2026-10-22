import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findConversation, getOrCreateConversation, loadMessages } from '../conversations/store';
import { accounts } from '../db/schema/accounts';
import { handoffMessages } from '../db/schema/handoff';
import { pendingActions } from '../db/schema/pending-actions';
import { createJobQueue, ensureQueues, QUEUES, uuidFrom } from '../jobs/queue';
import { loadGuestProjection } from '../projection/load';
import type { GuestLanguage } from '../property/vocabulary';
import { releasePending } from '../services/pending/create-order';
import { insertPending } from '../services/pending/store';
import {
  createTestDatabase,
  type RecordedJob,
  recordingQueue,
  type SeededGuestUnit,
  scriptedHandoffTranslator,
  seedGuestUnit,
  type TestDatabase,
} from '../testing';
import {
  deliverReply,
  guestInboxState,
  listHostInbox,
  markHandoffRead,
  markInboxSeen,
  replyToHandoff,
  unreadCount,
} from './inbox';
import {
  assertCanHandOff,
  completeHostMessage,
  getPendingHostMessage,
  HandoffRuleError,
  prepareHostMessage,
} from './send';
import { runHandoffTranslation } from './translate';

let testDb: TestDatabase;
const NOW = new Date('2027-05-01T10:00:00Z');
let clock = NOW;
let queue = recordingQueue();

const deps = () => ({ db: testDb.db, queue, now: () => clock });
const DRAFT = {
  text: '  The shower has no hot water.  ',
  reason: 'problem',
  urgency: 'urgent',
} as const;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

async function codeOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof HandoffRuleError) return error.code;
    throw error;
  }
  return 'ok';
}

/** A guest with a Conversation; the host reads the back office in `hostLanguage`. */
async function guest(
  options: { spaceLanguage?: GuestLanguage; hostLanguage?: GuestLanguage } = {},
): Promise<SeededGuestUnit & { language: GuestLanguage }> {
  clock = NOW;
  queue = recordingQueue();
  const language = options.spaceLanguage ?? 'en';
  const g = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: language });
  await testDb.db
    .update(accounts)
    .set({ uiLanguage: options.hostLanguage ?? 'en' })
    .where(eq(accounts.id, g.hostId));
  const projection = await loadGuestProjection(testDb.db, {
    unitId: g.unitId,
    stayId: g.stayId,
    language,
    now: NOW,
  });
  await getOrCreateConversation(testDb.db, g.spaceId, { systemPrompt: 's', projection }, NOW);
  return { ...g, language };
}

const prepare = (g: SeededGuestUnit & { language: GuestLanguage }) =>
  prepareHostMessage(deps(), { spaceId: g.spaceId, language: g.language }, DRAFT);

const rowsOf = (spaceId: string) =>
  testDb.db.select().from(handoffMessages).where(eq(handoffMessages.spaceId, spaceId));

const handoffJobs = (): RecordedJob[] => queue.jobs.filter((j) => j.name === 'translate-handoff');
const guestNotifyJobs = (): RecordedJob[] => queue.jobs.filter((j) => j.name === 'guest-notify');

async function sent(options: { spaceLanguage?: GuestLanguage; hostLanguage?: GuestLanguage } = {}) {
  const g = await guest(options);
  const { pendingId } = await prepare(g);
  const { message } = await completeHostMessage(deps(), {
    pendingId,
    spaceId: g.spaceId,
    text: 'Edited: no hot water',
  });
  return { g, message };
}

describe('send_host_message halves', () => {
  it('the first half stores a pending record only', async () => {
    const g = await guest();
    const { pendingId, draft } = await prepare(g);
    expect(draft).toMatchObject({ text: 'The shower has no hot water.', urgency: 'urgent' });
    const [row] = await testDb.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.id, pendingId));
    expect(row).toMatchObject({ kind: 'send_host_message', orderId: null, state: 'pending' });
    expect(await getPendingHostMessage(testDb.db, pendingId, g.spaceId)).toMatchObject({ draft });
    expect(await rowsOf(g.spaceId)).toEqual([]);
    expect(queue.jobs).toEqual([]);
  });

  it('the tap stores the edited text and enqueues one translation', async () => {
    const { g, message } = await sent({ spaceLanguage: 'de', hostLanguage: 'hr' });
    const [row] = await rowsOf(g.spaceId);
    expect(row).toMatchObject({
      id: message.id,
      text: 'Edited: no hot water',
      urgency: 'urgent',
      reason: 'problem',
      guestLanguage: 'de',
      hostLanguage: 'hr',
      translationState: 'pending',
      sentAt: NOW,
    });
    expect(handoffJobs()).toEqual([
      {
        name: 'translate-handoff',
        data: { handoffId: message.id, part: 'message' },
        id: expect.any(String),
      },
    ]);
  });

  it('same language: no translation job', async () => {
    const { g } = await sent();
    const [row] = await rowsOf(g.spaceId);
    expect(row?.translationState).toBe('not_needed');
    expect(handoffJobs()).toEqual([]);
  });

  it('a replayed tap returns the same message, once', async () => {
    const g = await guest({ spaceLanguage: 'de' });
    const { pendingId } = await prepare(g);
    const input = { pendingId, spaceId: g.spaceId, text: 'once' };
    const first = await completeHostMessage(deps(), input);
    const second = await completeHostMessage(deps(), { ...input, text: 'twice' });
    expect(second).toEqual({ message: first.message, replay: true });
    expect(await rowsOf(g.spaceId)).toHaveLength(1);
    expect(handoffJobs()).toHaveLength(1);
  });

  it('a declined card sends nothing and cannot be completed later', async () => {
    const g = await guest();
    const { pendingId } = await prepare(g);
    expect(await releasePending(testDb.db, { pendingId, spaceId: g.spaceId, now: NOW })).toBe(
      'released',
    );
    expect(
      await codeOf(completeHostMessage(deps(), { pendingId, spaceId: g.spaceId, text: 'x' })),
    ).toBe('released');
    expect(await rowsOf(g.spaceId)).toEqual([]);
  });

  it('an expired card is released and sends nothing', async () => {
    const g = await guest();
    const { pendingId } = await prepare(g);
    clock = new Date(NOW.getTime() + 601_000);
    expect(
      await codeOf(completeHostMessage(deps(), { pendingId, spaceId: g.spaceId, text: 'x' })),
    ).toBe('expired');
    expect(await rowsOf(g.spaceId)).toEqual([]);
  });

  it('empty or another space’s tap is refused', async () => {
    const g = await guest();
    const other = await guest();
    const { pendingId } = await prepare(g);
    expect(
      await codeOf(completeHostMessage(deps(), { pendingId, spaceId: g.spaceId, text: '   ' })),
    ).toBe('invalid-input');
    expect(
      await codeOf(completeHostMessage(deps(), { pendingId, spaceId: other.spaceId, text: 'x' })),
    ).toBe('not-found');
    expect(await rowsOf(g.spaceId)).toEqual([]);
  });

  it('never twice in one conversation', async () => {
    const g = await guest();
    const a = await prepare(g);
    const b = await prepare(g);
    await completeHostMessage(deps(), { pendingId: a.pendingId, spaceId: g.spaceId, text: 'a' });
    expect(await codeOf(assertCanHandOff(testDb.db, g.spaceId))).toBe('already-sent');
    expect(await codeOf(prepare(g))).toBe('already-sent');
    expect(
      await codeOf(
        completeHostMessage(deps(), { pendingId: b.pendingId, spaceId: g.spaceId, text: 'b' }),
      ),
    ).toBe('already-sent');
    const [pendingB] = await testDb.db
      .select()
      .from(pendingActions)
      .where(eq(pendingActions.id, b.pendingId));
    expect(pendingB?.state).toBe('released');
    expect((await rowsOf(g.spaceId)).map((r) => r.text)).toEqual(['a']);
  });

  it('create_order records still need an order id', async () => {
    const g = await guest();
    await expect(
      insertPending(testDb.db, {
        kind: 'create_order',
        spaceId: g.spaceId,
        stayId: g.stayId,
        payload: {} as never,
        expiresAt: NOW,
        now: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe('host inbox', () => {
  it('lists only the host’s own messages and marks Read once', async () => {
    const { g, message } = await sent();
    const other = await sent();
    const inbox = await listHostInbox(testDb.db, g.hostId);
    expect(inbox.map((m) => m.id)).toEqual([message.id]);
    expect(inbox[0]).toMatchObject({ unitName: g.unitName, readAt: null, reply: null });
    expect(await unreadCount(testDb.db, g.hostId)).toBe(1);
    expect((await guestInboxState(testDb.db, g.spaceId)).handoffs).toEqual([
      { id: message.id, status: 'sent' },
    ]);

    await markHandoffRead(testDb.db, { hostId: g.hostId, id: message.id, now: NOW });
    await markHandoffRead(testDb.db, {
      hostId: g.hostId,
      id: message.id,
      now: new Date(NOW.getTime() + 5000),
    });
    expect((await listHostInbox(testDb.db, g.hostId))[0]?.readAt).toBe(NOW.toISOString());
    expect(await unreadCount(testDb.db, g.hostId)).toBe(0);
    expect((await guestInboxState(testDb.db, g.spaceId)).handoffs).toEqual([
      { id: message.id, status: 'read' },
    ]);
    expect(
      await codeOf(
        markHandoffRead(testDb.db, { hostId: g.hostId, id: other.message.id, now: NOW }),
      ),
    ).toBe('not-found');
  });

  it('a same-language reply lands in the Chat as one inbox message, once', async () => {
    const { g, message } = await sent();
    const reply = await replyToHandoff(deps(), {
      hostId: g.hostId,
      accountId: g.hostId,
      id: message.id,
      text: ' A plumber comes at 16:00. ',
      markRead: true,
    });
    expect(reply.reply).toMatchObject({
      text: 'A plumber comes at 16:00.',
      translationState: 'not_needed',
    });
    expect(reply.readAt).toBe(NOW.toISOString());
    const conversationRows = await findConversation(testDb.db, g.spaceId);
    const rows = await loadMessages(testDb.db, conversationRows?.id as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 1, role: 'assistant', kind: 'inbox' });
    expect(rows[0]?.parts).toEqual([
      {
        type: 'data-inbox',
        id: message.id,
        data: {
          kind: 'host-reply',
          handoffId: message.id,
          text: 'A plumber comes at 16:00.',
          original: null,
          repliedAt: NOW.toISOString(),
        },
      },
    ]);
    expect(
      await codeOf(
        replyToHandoff(deps(), {
          hostId: g.hostId,
          accountId: g.hostId,
          id: message.id,
          text: 'again',
          markRead: true,
        }),
      ),
    ).toBe('already-replied');
    expect(handoffJobs()).toEqual([]);
    // The guest's email and push go out through one guest-notify job from the same transaction.
    expect(guestNotifyJobs()).toEqual([
      {
        name: 'guest-notify',
        data: { kind: 'host_reply', spaceId: g.spaceId, handoffId: message.id },
        id: expect.any(String),
      },
    ]);
    // A retried delivery writes and enqueues nothing new.
    const again = await testDb.db.transaction((tx) =>
      deliverReply(tx, queue, message.id, { text: 'x', original: null }, NOW),
    );
    expect(again).toBe('already-delivered');
    expect(guestNotifyJobs()).toHaveLength(1);
  });

  it('enqueues the guest notification only when the reply commits', async () => {
    const boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
    boss.on('error', console.error);
    await boss.start();
    try {
      await ensureQueues(boss);
      const real = { db: testDb.db, queue: createJobQueue(boss), now: () => clock };
      const { g, message } = await sent();
      const input = { hostId: g.hostId, accountId: g.hostId, id: message.id, markRead: true };
      const jobId = uuidFrom(`handoff:${message.id}:host_reply`);
      await expect(
        testDb.db.transaction(async (tx) => {
          await replyToHandoff({ ...real, db: tx }, { ...input, text: 'Rolled back.' });
          throw new Error('roll back');
        }),
      ).rejects.toThrow('roll back');
      expect(await boss.getJobById(QUEUES.guestNotify, jobId)).toBeNull();
      expect((await rowsOf(g.spaceId))[0]?.replyText).toBeNull();

      await replyToHandoff(real, { ...input, text: 'Committed.' });
      expect((await boss.getJobById(QUEUES.guestNotify, jobId))?.data).toEqual({
        kind: 'host_reply',
        spaceId: g.spaceId,
        handoffId: message.id,
      });
    } finally {
      await boss.stop({ graceful: false, timeout: 1000 });
    }
  });

  it('an acting admin’s reply does not mark the message Read', async () => {
    const { g, message } = await sent();
    const reply = await replyToHandoff(deps(), {
      hostId: g.hostId,
      accountId: g.hostId,
      id: message.id,
      text: 'On it.',
      markRead: false,
    });
    expect(reply.readAt).toBeNull();
  });

  it('a reply in another language waits for its translation', async () => {
    const { g, message } = await sent({ spaceLanguage: 'de', hostLanguage: 'hr' });
    queue.jobs.length = 0;
    await replyToHandoff(deps(), {
      hostId: g.hostId,
      accountId: g.hostId,
      id: message.id,
      text: 'Vodoinstalater dolazi u 16:00.',
      markRead: true,
    });
    expect(handoffJobs()).toEqual([
      {
        name: 'translate-handoff',
        data: { handoffId: message.id, part: 'reply' },
        id: expect.any(String),
      },
    ]);
    expect((await guestInboxState(testDb.db, g.spaceId)).unread).toBe(0);
  });
});

describe('runHandoffTranslation', () => {
  it('translates the message into the host’s language, once', async () => {
    const { message } = await sent({ spaceLanguage: 'de', hostLanguage: 'hr' });
    const translator = scriptedHandoffTranslator(['Nema tople vode']);
    const run = () =>
      runHandoffTranslation(
        { db: testDb.db, queue, now: () => clock, handoffTranslator: translator },
        { handoffId: message.id, part: 'message' },
      );
    expect(await run()).toBe('done');
    expect(translator.calls).toEqual([{ text: 'Edited: no hot water', to: 'hr' }]);
    const [row] = await testDb.db
      .select()
      .from(handoffMessages)
      .where(eq(handoffMessages.id, message.id));
    expect(row).toMatchObject({ translation: 'Nema tople vode', translationState: 'done' });
    expect(await run()).toBe('discarded');
    expect(translator.calls).toHaveLength(1);
  });

  it('a failed message translation shows the host the original', async () => {
    const { message } = await sent({ spaceLanguage: 'de', hostLanguage: 'hr' });
    const result = await runHandoffTranslation(
      {
        db: testDb.db,
        queue,
        now: () => clock,
        handoffTranslator: scriptedHandoffTranslator([null]),
      },
      { handoffId: message.id, part: 'message' },
    );
    expect(result).toBe('failed');
    const [row] = await testDb.db
      .select()
      .from(handoffMessages)
      .where(eq(handoffMessages.id, message.id));
    expect(row).toMatchObject({ translation: null, translationState: 'failed' });
  });

  it('delivers the translated reply with the original, once; a failure still delivers', async () => {
    for (const output of ['Ein Installateur kommt um 16:00.', null]) {
      const { g, message } = await sent({ spaceLanguage: 'de', hostLanguage: 'hr' });
      await replyToHandoff(deps(), {
        hostId: g.hostId,
        accountId: g.hostId,
        id: message.id,
        text: 'Vodoinstalater dolazi u 16:00.',
        markRead: true,
      });
      const translator = scriptedHandoffTranslator([output]);
      const run = () =>
        runHandoffTranslation(
          { db: testDb.db, queue, now: () => clock, handoffTranslator: translator },
          { handoffId: message.id, part: 'reply' },
        );
      expect(await run()).toBe(output ? 'done' : 'failed');
      expect(await run()).toBe('discarded');
      expect(translator.calls).toEqual([{ text: 'Vodoinstalater dolazi u 16:00.', to: 'de' }]);
      const state = await guestInboxState(testDb.db, g.spaceId);
      expect(state.unread).toBe(1);
      const conversation = await findConversation(testDb.db, g.spaceId);
      const rows = await loadMessages(testDb.db, conversation?.id as string);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.parts[0]).toMatchObject({
        data: output
          ? { text: output, original: 'Vodoinstalater dolazi u 16:00.' }
          : { text: 'Vodoinstalater dolazi u 16:00.', original: null },
      });
    }
  });
});

describe('guest inbox state', () => {
  it('counts inbox messages since the guest last saw the Chat', async () => {
    const { g, message } = await sent();
    expect(await guestInboxState(testDb.db, g.spaceId)).toEqual({
      unread: 0,
      handoffs: [{ id: message.id, status: 'sent' }],
    });
    clock = new Date(NOW.getTime() + 60_000);
    await replyToHandoff(deps(), {
      hostId: g.hostId,
      accountId: g.hostId,
      id: message.id,
      text: 'Hi',
      markRead: true,
    });
    expect(await guestInboxState(testDb.db, g.spaceId)).toEqual({
      unread: 1,
      handoffs: [{ id: message.id, status: 'read' }],
    });
    await markInboxSeen(testDb.db, g.spaceId, new Date(NOW.getTime() + 120_000));
    expect((await guestInboxState(testDb.db, g.spaceId)).unread).toBe(0);
  });
});
