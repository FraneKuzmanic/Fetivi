import { randomUUID } from 'node:crypto';
import {
  createJobQueue,
  createMemoryMailer,
  createMemoryPushSender,
  deliverGuestNotification,
  ensureQueues,
  fromLocalDateTime,
  type GuestNotifyJobData,
  getOrCreateConversation,
  type JobQueue,
  loadGuestProjection,
  messages,
  QUEUES,
  seedTrogir,
  updateAboutMe,
  type WeatherSource,
} from '@fetivi/domain';
import {
  createTestDatabase,
  fixedWeatherSource,
  noopQueue,
  publishCatalog,
  type SeededGuestUnit,
  sampleWeatherReport,
  seedGuestUnit,
  type TestDatabase,
  unavailableWeatherSource,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dailyTipsJob } from './daily-tips';

const ZONE = 'Europe/Zagreb';
/** Registered on 8 July; Stay 9 July (check-in) to 13 July (checkout), in Trogir's festival. */
const REGISTERED = new Date('2027-07-08T08:00:00Z');
const at = (local: string) => fromLocalDateTime(local, ZONE);
const SEND = at('2027-07-10T17:00');
const HOUR = 3_600_000;
/** Showers on 11 July. */
const rainy = () => fixedWeatherSource(sampleWeatherReport('2027-07-10'));

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  const { destinationId } = await seedTrogir(testDb.db, noopQueue, REGISTERED);
  await publishCatalog(testDb.db, destinationId);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

async function run(now: Date, weather: Pick<WeatherSource, 'report'>) {
  await dailyTipsJob({ db: testDb.db, queue, now: () => now, weather }).handler({});
}

const jobsFor = async (spaceId: string) => {
  const { rows } = await testDb.pool.query<{ data: GuestNotifyJobData }>(
    "select data from pgboss.job where name = $1 and data->>'spaceId' = $2 order by created_on",
    [QUEUES.guestNotify, spaceId],
  );
  return rows.map((r) => r.data);
};

/** A guest whose last chat message is `ago` before the first send slot. */
async function guest(ago: number): Promise<SeededGuestUnit> {
  const g = await seedGuestUnit(testDb.db, { now: REGISTERED, checkInInDays: 1, nights: 4 });
  const projection = await loadGuestProjection(testDb.db, {
    unitId: g.unitId,
    stayId: g.stayId,
    language: 'en',
    now: REGISTERED,
  });
  const conversation = await getOrCreateConversation(
    testDb.db,
    g.spaceId,
    { systemPrompt: 's', projection },
    REGISTERED,
  );
  await testDb.db.insert(messages).values({
    id: randomUUID(),
    conversationId: conversation.id,
    seq: 1,
    role: 'user',
    parts: [],
    createdAt: new Date(SEND.getTime() - ago),
  });
  return g;
}

function deps(now: Date) {
  return {
    db: testDb.db,
    mailer: createMemoryMailer(),
    push: createMemoryPushSender(),
    guestOrigin: 'http://guest.test',
    guestLinkSecret: 'jobs-test-guest-link-secret-long-enough',
    now: () => now,
  };
}

describe('daily-tips job', () => {
  it('sends at most one tip per space and day across runs, changed facts and retries (AC 3)', async () => {
    const g = await guest(HOUR);
    expect(await jobsFor(g.spaceId)).toEqual([]);

    await run(at('2027-07-10T16:59'), rainy());
    expect(await jobsFor(g.spaceId)).toEqual([]);

    await run(SEND, rainy());
    await run(SEND, rainy());
    // The forecast is gone a slot later, so the gap rule would win: still the same job.
    await run(at('2027-07-10T17:15'), unavailableWeatherSource());
    const jobs = await jobsFor(g.spaceId);
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    if (!job) throw new Error('no job');
    expect(job).toMatchObject({
      kind: 'daily_tip',
      spaceId: g.spaceId,
      sendDate: '2027-07-10',
      tip: { rule: 'rain', date: '2027-07-11', title: '[en] Cathedral of St Lawrence' },
    });

    // Inbox only: no tip-email opt-in. A retried delivery sends nothing again.
    expect(await deliverGuestNotification(deps(SEND), job)).toEqual({
      inbox: 'sent',
      email: 'skipped',
      push: 'skipped',
    });
    expect(await deliverGuestNotification(deps(SEND), job)).toMatchObject({
      inbox: 'already_sent',
      push: 'skipped',
    });

    // Later slots the same evening find the ledger row and enqueue nothing.
    await run(at('2027-07-10T18:00'), rainy());
    expect(await jobsFor(g.spaceId)).toHaveLength(1);

    // The next evening is a new tip.
    await run(at('2027-07-11T17:00'), rainy());
    const next = await jobsFor(g.spaceId);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ kind: 'daily_tip', sendDate: '2027-07-11' });
  });

  it('skips a space idle for more than 48 hours without the tip-email opt-in', async () => {
    const idle = await guest(49 * HOUR);
    await run(SEND, rainy());
    expect(await jobsFor(idle.spaceId)).toEqual([]);
  });

  it('still picks an event or a gap tip when the weather is unavailable', async () => {
    const likesSights = await guest(HOUR);
    await updateAboutMe(testDb.db, likesSights.spaceId, { addInterests: ['sights'] }, REGISTERED);
    const plain = await guest(HOUR);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await run(at('2027-07-10T17:30'), unavailableWeatherSource());
      const line = log.mock.calls
        .map(([text]) => JSON.parse(String(text)) as Record<string, unknown>)
        .find((l) => l.job === QUEUES.dailyTips);
      expect(line).toMatchObject({ weather: 'unavailable', failed: 0 });
      expect(JSON.stringify(line)).not.toContain('Cathedral');
    } finally {
      log.mockRestore();
    }
    expect((await jobsFor(likesSights.spaceId)).map((j) => j.tip?.rule)).toEqual(['event']);
    expect((await jobsFor(plain.spaceId)).map((j) => j.tip?.rule)).toEqual(['gap']);
  });
});
