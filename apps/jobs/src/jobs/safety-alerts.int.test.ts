import {
  createCatalogRecord,
  createJobQueue,
  createMemoryMailer,
  createMemoryPushSender,
  createWeatherSource,
  DHMZ_FEEDS,
  deliverGuestNotification,
  ensureQueues,
  type GuestNotifyJobData,
  getOrCreateConversation,
  hashToken,
  JADROLINIJA_FEED,
  JADROLINIJA_HOST,
  type JobQueue,
  loadGuestProjection,
  newToken,
  QUEUES,
} from '@fetivi/domain';
import {
  createTestDatabase,
  noopQueue,
  type RecordedWeatherFetchOptions,
  recordedWeatherFetch,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
  WEATHER_RECORDED_AT,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EGRESS_ALLOWLIST, jobsEgressAllowlist } from '../egress';
import { safetyAlertsJob } from './safety-alerts';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let destinationId: string;

/** The day before the reconstructed 9603 bulletin ("Linije u prekidu, 15.10.2026"). */
const FERRY_NOW = new Date('2026-10-14T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  destinationId = await seedDestination(testDb.db);
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

/** Runs the handler once on the recorded feeds; a fresh weather source (and cache) each run. */
async function run(
  now: Date,
  options: { jadrolinija: boolean; fetch?: RecordedWeatherFetchOptions },
) {
  const fetch = recordedWeatherFetch(options.fetch);
  const weather = createWeatherSource({ fetch, userAgent: 'test', clock: () => now });
  await safetyAlertsJob({
    db: testDb.db,
    queue,
    now: () => now,
    weather,
    fetch,
    jadrolinija: options.jadrolinija,
    userAgent: 'test',
  }).handler({});
  return fetch.urls;
}

const jobsFor = async (spaceId: string) => {
  const { rows } = await testDb.pool.query<{ data: GuestNotifyJobData }>(
    "select data from pgboss.job where name = $1 and data->>'spaceId' = $2 order by created_on",
    [QUEUES.guestNotify, spaceId],
  );
  return rows.map((r) => r.data);
};

/** A Conversation (for the inbox) and a verified email. */
async function reachable(unitId: string, stayId: string, spaceId: string, now: Date) {
  const projection = await loadGuestProjection(testDb.db, {
    unitId,
    stayId,
    language: 'en',
    now,
  });
  await getOrCreateConversation(testDb.db, spaceId, { systemPrompt: 's', projection }, now);
  await testDb.pool.query(
    'update spaces set email = $1, email_opt_in_at = $2, email_verified_at = $2 where id = $3',
    ['guest@example.test', now, spaceId],
  );
}

async function dayTrip(title: string, ferryLines: string[], now: Date) {
  const record = await createCatalogRecord(
    testDb.db,
    noopQueue,
    {
      destinationId,
      kind: 'day_trip',
      title,
      description: 'By sea.',
      travelMinutes: 90,
      ferryLines,
    },
    now,
  );
  return record.id;
}

async function plan(spaceId: string, date: string, title: string, placeId: string, now: Date) {
  await testDb.pool.query(
    `insert into plan_items (space_id, date, title, place_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [spaceId, date, title, placeId, now],
  );
}

describe('safety-alerts job', () => {
  it('alerts every open space in the Stay once per warning, on every channel (AC 1, AC 4)', async () => {
    const now = WEATHER_RECORDED_AT; // 22:28 on 22 Oct in Zagreb
    const g = await seedGuestUnit(testDb.db, { now, checkInInDays: 0, nights: 4 });
    // A second guest device in the same Stay.
    const { rows } = await testDb.pool.query<{ id: string }>(
      `insert into spaces (stay_id, token_hash, language, closed_at, created_at, updated_at)
       select stay_id, $1, language, closed_at, $2, $2 from spaces where id = $3 returning id`,
      [hashToken(newToken()), now, g.spaceId],
    );
    const second = rows[0];
    if (!second) throw new Error('no space');
    for (const spaceId of [g.spaceId, second.id]) {
      await reachable(g.unitId, g.stayId, spaceId, now);
    }

    const urls = await run(now, { jadrolinija: false });
    await run(now, { jadrolinija: false });
    // Flag off: Jadrolinija is never fetched.
    expect(urls).not.toContain(JADROLINIJA_FEED);

    for (const spaceId of [g.spaceId, second.id]) {
      const jobs = await jobsFor(spaceId);
      // The bura until midnight and the 24 Oct thunderstorm, once each despite two runs.
      expect(jobs.map((j) => [j.kind, j.safety?.source])).toEqual([
        ['weather_warning', 'DHMZ'],
        ['weather_warning', 'DHMZ'],
      ]);
      expect(jobs.map((j) => j.safety && 'type' in j.safety && j.safety.type)).toEqual([
        'wind',
        'thunderstorm',
      ]);

      const mailer = createMemoryMailer();
      const deps = {
        db: testDb.db,
        mailer,
        push: createMemoryPushSender(),
        guestOrigin: 'http://guest.test',
        guestLinkSecret: 'jobs-test-guest-link-secret-long-enough',
        now: () => now,
      };
      for (const data of jobs) {
        expect(await deliverGuestNotification(deps, data)).toEqual({
          inbox: 'sent',
          email: 'sent',
          push: 'skipped',
        });
      }
      expect(mailer.sent.map((m) => m.to)).toEqual(['guest@example.test', 'guest@example.test']);
      expect(mailer.sent[0]?.text).toContain('DHMZ');
      // AC 4: a retried delivery sends nothing again.
      for (const data of jobs) {
        expect(await deliverGuestNotification(deps, data)).toEqual({
          inbox: 'already_sent',
          email: 'already_sent',
          push: 'skipped',
        });
      }
    }
  });

  it('sends a Jadrolinija bulletin only to the space whose plan uses the named line (AC 2, AC 3)', async () => {
    const now = FERRY_NOW;
    const bol = await dayTrip('Bol', ['9603'], now);
    const hvar = await dayTrip('Hvar', ['635'], now);
    const onLine = await seedGuestUnit(testDb.db, { now, checkInInDays: 0, nights: 3 });
    const otherLine = await seedGuestUnit(testDb.db, { now, checkInInDays: 0, nights: 3 });
    const otherDay = await seedGuestUnit(testDb.db, { now, checkInInDays: 0, nights: 3 });
    await plan(onLine.spaceId, '2026-10-15', 'Bol day', bol, now);
    await plan(otherLine.spaceId, '2026-10-15', 'Hvar day', hvar, now);
    await plan(otherDay.spaceId, '2026-10-16', 'Bol day', bol, now);

    const off = await run(now, { jadrolinija: false });
    expect(off).not.toContain(JADROLINIJA_FEED);
    expect(await jobsFor(onLine.spaceId)).toEqual([]);

    const on = await run(now, { jadrolinija: true });
    await run(now, { jadrolinija: true });
    expect(on).toContain(JADROLINIJA_FEED);
    expect(await jobsFor(onLine.spaceId)).toEqual([
      {
        kind: 'ferry_disruption',
        spaceId: onLine.spaceId,
        safety: {
          source: 'Jadrolinija',
          bulletinId: 'urn:uuid:81',
          title: 'Linije u prekidu, 15.10.2026',
          url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
          timezone: 'Europe/Zagreb',
          affected: {
            title: 'Bol day',
            date: '2026-10-15',
            startTime: null,
            orderId: null,
            lines: ['9603'],
          },
        },
      },
    ]);
    expect(await jobsFor(otherLine.spaceId)).toEqual([]);
    expect(await jobsFor(otherDay.spaceId)).toEqual([]);
  });

  it('still makes ferry alerts while DHMZ is down, and warning alerts once it is back', async () => {
    const now = FERRY_NOW;
    const bol = await dayTrip('Bol', ['9603'], now);
    // A Stay from 14 to 25 Oct: the recorded 22 and 24 Oct warnings fall in it.
    const g = await seedGuestUnit(testDb.db, { now, checkInInDays: 0, nights: 11 });
    await plan(g.spaceId, '2026-10-15', 'Bol day', bol, now);

    await run(now, { jadrolinija: true, fetch: { down: [...DHMZ_FEEDS.warnings] } });
    expect((await jobsFor(g.spaceId)).map((j) => j.kind)).toEqual(['ferry_disruption']);

    await run(now, { jadrolinija: true });
    expect((await jobsFor(g.spaceId)).map((j) => j.kind).sort()).toEqual([
      'ferry_disruption',
      'weather_warning',
      'weather_warning',
    ]);
  });

  it('lets the jobs process reach Jadrolinija only when the feed is on', () => {
    expect(jobsEgressAllowlist({ jadrolinija: false })).toEqual(EGRESS_ALLOWLIST);
    expect(EGRESS_ALLOWLIST).not.toContain(JADROLINIJA_HOST);
    expect(EGRESS_ALLOWLIST).toContain('meteo.hr');
    expect(jobsEgressAllowlist({ jadrolinija: true })).toContain(JADROLINIJA_HOST);
  });
});
