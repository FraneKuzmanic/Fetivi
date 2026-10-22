import {
  completeHostMessage,
  getOrCreateConversation,
  loadGuestProjection,
  markHandoffRead,
  prepareHostMessage,
  type ResolvedSpace,
  replyToHandoff,
} from '@fetivi/domain';
import { noopQueue, type SeededGuestUnit, seedGuestUnit } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChatTestApp, createChatTestApp, enterSpace, get, write } from '../testing';

let t: ChatTestApp;

beforeAll(async () => {
  t = await createChatTestApp({ model: null });
});

afterAll(async () => {
  await t?.close();
});

const deps = () => ({ db: t.db, queue: noopQueue, now: t.clock.now });

/** A guest in their own Space with a Conversation and one sent Host message. */
async function sentMessage(): Promise<{
  seed: SeededGuestUnit;
  cookie: string;
  space: ResolvedSpace;
  id: string;
}> {
  const seed = await seedGuestUnit(t.db, { now: t.clock.now() });
  const { cookie, space } = await enterSpace(t, seed);
  const projection = await loadGuestProjection(t.db, {
    unitId: seed.unitId,
    stayId: seed.stayId,
    language: 'en',
    now: t.clock.now(),
  });
  await getOrCreateConversation(
    t.db,
    space.space.id,
    { systemPrompt: 's', projection },
    t.clock.now(),
  );
  const { pendingId } = await prepareHostMessage(
    deps(),
    { spaceId: space.space.id, language: 'en' },
    { text: 'No hot water', reason: 'problem', urgency: 'urgent' },
  );
  const { message } = await completeHostMessage(deps(), {
    pendingId,
    spaceId: space.space.id,
    text: 'No hot water',
  });
  return { seed, cookie, space, id: message.id };
}

describe('GET /api/inbox', () => {
  it('needs a space', async () => {
    const response = await get(t.app, '/api/inbox');
    expect([response.statusCode, response.json()]).toEqual([401, { error: 'no-space' }]);
    const seen = await write('POST', t.app, '/api/inbox/seen', {});
    expect(seen.statusCode).toBe(401);
  });

  it('shows Sent, then Read, and counts the host reply until the guest has seen it', async () => {
    const { seed, cookie, id } = await sentMessage();
    const other = await sentMessage();
    expect((await get(t.app, '/api/inbox', cookie)).json()).toEqual({
      unread: 0,
      handoffs: [{ id, status: 'sent' }],
    });

    await markHandoffRead(t.db, { hostId: seed.hostId, id, now: t.clock.now() });
    t.clock.advance(1000);
    await replyToHandoff(deps(), {
      hostId: seed.hostId,
      accountId: seed.hostId,
      id,
      text: 'On my way.',
      markRead: true,
    });
    expect((await get(t.app, '/api/inbox', cookie)).json()).toEqual({
      unread: 1,
      handoffs: [{ id, status: 'read' }],
    });
    // Another space's message never shows.
    expect(JSON.stringify((await get(t.app, '/api/inbox', cookie)).json())).not.toContain(other.id);

    t.clock.advance(1000);
    const seen = await write('POST', t.app, '/api/inbox/seen', {}, { cookie });
    expect(seen.statusCode).toBe(204);
    expect((await get(t.app, '/api/inbox', cookie)).json()).toMatchObject({ unread: 0 });
  });

  it('shows the host reply in the chat history', async () => {
    const { seed, cookie, id } = await sentMessage();
    await replyToHandoff(deps(), {
      hostId: seed.hostId,
      accountId: seed.hostId,
      id,
      text: 'On my way.',
      markRead: true,
    });
    const { messages } = (await get(t.app, '/api/chat', cookie)).json() as {
      messages: { role: string; parts: { type: string; data?: { text: string } }[] }[];
    };
    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts[0]).toMatchObject({
      type: 'data-inbox',
      data: { kind: 'host-reply', text: 'On my way.' },
    });
  });
});
