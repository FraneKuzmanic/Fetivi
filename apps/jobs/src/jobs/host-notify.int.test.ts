import {
  completeHostMessage,
  createJobQueue,
  createMemoryMailer,
  createMemoryPushSender,
  ensureQueues,
  getOrCreateConversation,
  type HostNotifyDeps,
  type HostNotifyJobData,
  type JobQueue,
  loadGuestProjection,
  prepareHostMessage,
  QUEUES,
  saveHostNotificationSettings,
} from '@fetivi/domain';
import { createTestDatabase, seedGuestUnit, type TestDatabase } from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EGRESS_ALLOWLIST } from '../egress';
import { hostDigestsJob, hostNotifyJob } from './host-notify';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;

/** 06:00Z = 08:00 in Zagreb (UTC+2), before the 09:00 slot. */
const SENT = new Date('2027-05-03T06:00:00Z');
/** 09:05 in Zagreb; the 09:00 slot is 07:00Z. */
const AFTER_SLOT = new Date('2027-05-03T07:05:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

/** The host-notify jobs recorded for a host message or a host's digests. */
const hostJobs = async (field: 'handoffId' | 'hostId', value: string) => {
  const { rows } = await testDb.pool.query<{ data: HostNotifyJobData }>(
    `select data from pgboss.job where name = $1 and data->>'${field}' = $2 order by created_on`,
    [QUEUES.hostNotify, value],
  );
  return rows.map((r) => r.data);
};

function notifyDeps(now: Date) {
  const mailer = createMemoryMailer();
  const deps: HostNotifyDeps = {
    db: testDb.db,
    mailer,
    push: createMemoryPushSender(),
    webOrigin: 'https://host.fetivi.test',
    now: () => now,
  };
  return { mailer, deps };
}

/** A guest sends a normal Host message through the real send path, with the pg-boss queue. */
async function sendHostMessage(options: { digest?: boolean } = {}) {
  const seed = await seedGuestUnit(testDb.db, { now: SENT });
  if (options.digest) {
    await saveHostNotificationSettings(
      testDb.db,
      seed.hostId,
      { mode: 'digest', digestTimes: ['09:00', '14:00', '19:00'] },
      SENT,
    );
  }
  const projection = await loadGuestProjection(testDb.db, {
    unitId: seed.unitId,
    stayId: seed.stayId,
    language: 'en',
    now: SENT,
  });
  await getOrCreateConversation(testDb.db, seed.spaceId, { systemPrompt: 's', projection }, SENT);
  const deps = { db: testDb.db, queue, now: () => SENT };
  const { pendingId } = await prepareHostMessage(
    deps,
    { spaceId: seed.spaceId, language: 'en' },
    { text: 'The heating is off.', reason: 'problem', urgency: 'normal' },
  );
  const { message } = await completeHostMessage(deps, {
    pendingId,
    spaceId: seed.spaceId,
    text: 'The heating is off.',
  });
  return { seed, handoffId: message.id };
}

describe('host-notify job', () => {
  it('emails the host once for a Host message sent in Immediate mode', async () => {
    const { seed, handoffId } = await sendHostMessage();
    const jobs = await hostJobs('handoffId', handoffId);
    expect(jobs).toEqual([{ kind: 'message', handoffId }]);

    const { mailer, deps } = notifyDeps(SENT);
    const job = hostNotifyJob(deps);
    await job.handler({ kind: 'message', handoffId });
    await job.handler({ kind: 'message', handoffId });
    expect(mailer.sent).toHaveLength(1);
    const { rows } = await testDb.pool.query<{ email: string }>(
      'select email from accounts where id = $1',
      [seed.hostId],
    );
    expect(mailer.sent[0]?.to).toBe(rows[0]?.email);
    expect(mailer.sent[0]?.text).toContain(`/inbox?message=${handoffId}`);
    expect(mailer.sent[0]?.text).not.toContain('The heating is off.');
  });

  it('defers a normal message in Digest mode, then sends it in one digest per slot', async () => {
    const { seed, handoffId } = await sendHostMessage({ digest: true });
    const immediate = notifyDeps(SENT);
    await hostNotifyJob(immediate.deps).handler({ kind: 'message', handoffId });
    expect(immediate.mailer.sent).toEqual([]);

    // Before the slot, nothing is due; after it, two cron runs enqueue one digest job.
    const cron = (now: Date) =>
      hostDigestsJob({ db: testDb.db, queue, now: () => now }).handler({});
    await cron(SENT);
    expect(await hostJobs('hostId', seed.hostId)).toEqual([]);
    await cron(AFTER_SLOT);
    await cron(AFTER_SLOT);
    const digests = await hostJobs('hostId', seed.hostId);
    expect(digests).toEqual([
      { kind: 'digest', hostId: seed.hostId, slot: '2027-05-03T07:00:00.000Z' },
    ]);

    const digest = notifyDeps(AFTER_SLOT);
    const [data] = digests;
    if (!data) throw new Error('no digest job');
    await hostNotifyJob(digest.deps).handler(data);
    await hostNotifyJob(digest.deps).handler(data);
    expect(digest.mailer.sent).toHaveLength(1);
    expect(digest.mailer.sent[0]?.subject).toBe('1 new guest message');
  });

  it('allowlists the host push services for egress', () => {
    expect(EGRESS_ALLOWLIST).toEqual(expect.arrayContaining(['web.push.apple.com']));
    expect(new Set(EGRESS_ALLOWLIST).size).toBe(EGRESS_ALLOWLIST.length);
  });
});
