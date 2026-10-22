import {
  completeHostMessage,
  getOrCreateConversation,
  listHostInbox,
  loadGuestProjection,
  loadMessages,
  prepareHostMessage,
  replyToHandoff,
} from '@fetivi/domain';
import {
  createTestDatabase,
  noopQueue,
  scriptedHandoffTranslator,
  seedGuestUnit,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translateHandoffJob } from './translate-handoff';

let testDb: TestDatabase;
const NOW = new Date('2027-05-01T10:00:00Z');
const now = () => NOW;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** A German-speaking guest whose host reads the back office in Croatian, with one sent message. */
async function sent() {
  const seed = await seedGuestUnit(testDb.db, { now: NOW, spaceLanguage: 'de' });
  await testDb.pool.query('update accounts set ui_language = $1 where id = $2', [
    'hr',
    seed.hostId,
  ]);
  const projection = await loadGuestProjection(testDb.db, {
    unitId: seed.unitId,
    stayId: seed.stayId,
    language: 'de',
    now: NOW,
  });
  const conversation = await getOrCreateConversation(
    testDb.db,
    seed.spaceId,
    { systemPrompt: 's', projection },
    NOW,
  );
  const deps = { db: testDb.db, queue: noopQueue, now };
  const { pendingId } = await prepareHostMessage(
    deps,
    { spaceId: seed.spaceId, language: 'de' },
    { text: 'Kein warmes Wasser.', reason: 'problem', urgency: 'urgent' },
  );
  const { message } = await completeHostMessage(deps, {
    pendingId,
    spaceId: seed.spaceId,
    text: 'Kein warmes Wasser.',
  });
  return { seed, id: message.id, conversationId: conversation.id };
}

describe('translate-handoff job', () => {
  it('translates a pending message for the host', async () => {
    const { seed, id } = await sent();
    const translator = scriptedHandoffTranslator(['Nema tople vode.']);
    await translateHandoffJob({ db: testDb.db, now, handoffTranslator: translator }).handler({
      handoffId: id,
      part: 'message',
    });
    const [message] = await listHostInbox(testDb.db, seed.hostId);
    expect(message).toMatchObject({ translation: 'Nema tople vode.', translationState: 'done' });
    expect(translator.calls).toEqual([{ text: 'Kein warmes Wasser.', to: 'hr' }]);
  });

  it('delivers a translated reply to the guest once', async () => {
    const { seed, id, conversationId } = await sent();
    await replyToHandoff(
      { db: testDb.db, queue: noopQueue, now },
      {
        hostId: seed.hostId,
        accountId: seed.hostId,
        id,
        text: 'Majstor stiže u 16h.',
        markRead: true,
      },
    );
    const job = translateHandoffJob({
      db: testDb.db,
      now,
      handoffTranslator: scriptedHandoffTranslator(['Der Installateur kommt um 16 Uhr.']),
    });
    await job.handler({ handoffId: id, part: 'reply' });
    await job.handler({ handoffId: id, part: 'reply' });
    const rows = await loadMessages(testDb.db, conversationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.parts[0]).toMatchObject({
      type: 'data-inbox',
      data: { text: 'Der Installateur kommt um 16 Uhr.', original: 'Majstor stiže u 16h.' },
    });
  });
});
