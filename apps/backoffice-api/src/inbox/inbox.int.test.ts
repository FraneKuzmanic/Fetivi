import {
  accounts,
  completeHostMessage,
  createJobQueue,
  getOrCreateConversation,
  guestInboxState,
  loadGuestProjection,
  loadMessages,
  prepareHostMessage,
  properties,
  QUEUES,
} from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

/** A guest of `hostId` who sent one Host message in `spaceLanguage`. */
async function sentBy(hostId: string, spaceLanguage: 'en' | 'de' = 'en') {
  const seed = await seedGuestUnit(t.db, { now: t.clock.now(), spaceLanguage });
  await t.db.update(properties).set({ hostId }).where(eq(properties.id, seed.propertyId));
  const projection = await loadGuestProjection(t.db, {
    unitId: seed.unitId,
    stayId: seed.stayId,
    language: spaceLanguage,
    now: t.clock.now(),
  });
  const conversation = await getOrCreateConversation(
    t.db,
    seed.spaceId,
    { systemPrompt: 's', projection },
    t.clock.now(),
  );
  const deps = { db: t.db, queue: createJobQueue(t.boss), now: t.clock.now };
  const { pendingId } = await prepareHostMessage(
    deps,
    { spaceId: seed.spaceId, language: spaceLanguage },
    { text: 'The shower has no hot water.', reason: 'problem', urgency: 'urgent' },
  );
  const { message } = await completeHostMessage(deps, {
    pendingId,
    spaceId: seed.spaceId,
    text: 'The shower has no hot water.',
  });
  return { seed, id: message.id, conversationId: conversation.id };
}

async function jobsFor(id: string) {
  const { rows } = await t.testDb.pool.query(
    "select data->>'part' as part from pgboss.job where name = $1 and data->>'handoffId' = $2",
    [QUEUES.translateHandoff, id],
  );
  return rows.map((r: { part: string }) => r.part);
}

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
});

afterAll(async () => {
  await t?.close();
});

describe('host inbox', () => {
  it('needs a host session', async () => {
    expect((await get(t.app, '/api/host/inbox')).statusCode).toBe(401);
  });

  it('lists only the host’s own messages, with the unread count', async () => {
    const mine = await sentBy(hostA.id);
    const theirs = await sentBy(hostB.id);
    const inbox = (await get(t.app, '/api/host/inbox', hostA.cookie)).json();
    const ids = inbox.messages.map((m: { id: string }) => m.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(inbox.unread).toBe(ids.length);
    expect(inbox.messages.find((m: { id: string }) => m.id === mine.id)).toMatchObject({
      urgency: 'urgent',
      reason: 'problem',
      text: 'The shower has no hot water.',
      translationState: 'not_needed',
      readAt: null,
      reply: null,
    });
    expect(
      (await post(t.app, `/api/host/inbox/${theirs.id}/read`, {}, hostA.cookie)).statusCode,
    ).toBe(404);
  });

  it('opening marks Read for the guest; an acting admin does not', async () => {
    const acted = await sentBy(hostA.id);
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const read = await post(t.app, `/api/host/inbox/${acted.id}/read`, {}, adminCookie);
      expect(read.statusCode).toBe(204);
      expect((await guestInboxState(t.db, acted.seed.spaceId)).handoffs).toEqual([
        { id: acted.id, status: 'sent' },
      ]);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }

    const read = await post(t.app, `/api/host/inbox/${acted.id}/read`, {}, hostA.cookie);
    expect(read.statusCode).toBe(204);
    expect((await guestInboxState(t.db, acted.seed.spaceId)).handoffs).toEqual([
      { id: acted.id, status: 'read' },
    ]);
  });

  it('a same-language reply reaches the guest at once; a second reply is refused', async () => {
    const sent = await sentBy(hostA.id);
    const reply = await post(
      t.app,
      `/api/host/inbox/${sent.id}/reply`,
      { text: ' A plumber comes at 16:00. ' },
      hostA.cookie,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.json().message).toMatchObject({
      reply: { text: 'A plumber comes at 16:00.', translationState: 'not_needed' },
    });
    expect(reply.json().message.reply.deliveredAt).not.toBeNull();
    const rows = await loadMessages(t.db, sent.conversationId);
    expect(rows.map((r) => r.kind)).toEqual(['inbox']);

    const again = await post(
      t.app,
      `/api/host/inbox/${sent.id}/reply`,
      { text: 'x' },
      hostA.cookie,
    );
    expect([again.statusCode, again.json()]).toEqual([409, { error: 'already-replied' }]);
    const empty = await sentBy(hostA.id);
    expect(
      (await post(t.app, `/api/host/inbox/${empty.id}/reply`, { text: '  ' }, hostA.cookie))
        .statusCode,
    ).toBe(400);
  });

  it('a reply in another language waits for its translation job', async () => {
    const sent = await sentBy(hostA.id, 'de');
    expect(await jobsFor(sent.id)).toEqual(['message']);
    const reply = await post(
      t.app,
      `/api/host/inbox/${sent.id}/reply`,
      { text: 'A plumber comes at 16:00.' },
      hostA.cookie,
    );
    expect(reply.json().message.reply).toMatchObject({
      translationState: 'pending',
      deliveredAt: null,
    });
    expect((await jobsFor(sent.id)).sort()).toEqual(['message', 'reply']);
    expect(await loadMessages(t.db, sent.conversationId)).toEqual([]);
  });

  it('another host’s message cannot be replied to; act-as replies are audited', async () => {
    const theirs = await sentBy(hostB.id);
    expect(
      (await post(t.app, `/api/host/inbox/${theirs.id}/reply`, { text: 'x' }, hostA.cookie))
        .statusCode,
    ).toBe(404);

    const acted = await sentBy(hostA.id);
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const reply = await post(
        t.app,
        `/api/host/inbox/${acted.id}/reply`,
        { text: 'On it.' },
        adminCookie,
      );
      expect(reply.statusCode).toBe(200);
      expect(reply.json().message.readAt).toBeNull();
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
    await vi.waitFor(async () => {
      const audit = await get(t.app, '/api/admin/audit', adminCookie);
      expect(audit.json().entries.map((e: { route: string }) => e.route)).toContain(
        '/api/host/inbox/:id/reply',
      );
    });
  });
});
