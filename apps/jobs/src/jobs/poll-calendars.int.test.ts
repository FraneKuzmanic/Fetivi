import {
  calendarFeeds,
  createJobQueue,
  createMemoryMailer,
  ensureQueues,
  type JobQueue,
  listProposals,
  QUEUES,
  units,
  uuidFrom,
} from '@fetivi/domain';
import {
  createTestDatabase,
  ics,
  type SeededGuestUnit,
  seedGuestUnit,
  stubFetch,
  type TestDatabase,
} from '@fetivi/domain/testing';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EGRESS_ALLOWLIST } from '../egress';
import { pollCalendarJob, pollCalendarsJob, stayNotifyJob } from './poll-calendars';

let testDb: TestDatabase;
let boss: PgBoss;
let queue: JobQueue;
let unit: SeededGuestUnit;
let feedId: string;

const NOW = new Date('2026-10-19T10:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  boss = new PgBoss({ connectionString: testDb.url, supervise: false, schedule: false });
  boss.on('error', console.error);
  await boss.start();
  await ensureQueues(boss);
  queue = createJobQueue(boss);
  unit = await seedGuestUnit(testDb.db, { now: NOW });
  const [feed] = await testDb.db
    .insert(calendarFeeds)
    .values({
      unitId: unit.unitId,
      source: 'airbnb',
      url: 'https://www.airbnb.com/calendar/ical/1.ics?s=x',
    })
    .returning();
  feedId = feed?.id as string;
});

afterAll(async () => {
  await boss?.stop({ graceful: false, timeout: 1000 });
  await testDb?.drop();
});

describe('calendar jobs', () => {
  it('fans out one poll per live feed and slot, and none for a unit that is not live', async () => {
    const [otherUnit] = await testDb.db
      .insert(units)
      .values({ propertyId: unit.propertyId, name: 'Not live' })
      .returning();
    const [idle] = await testDb.db
      .insert(calendarFeeds)
      .values({
        unitId: otherUnit?.id as string,
        source: 'booking',
        url: 'https://ical.booking.com/v1/export?t=y',
      })
      .returning();
    const job = pollCalendarsJob({ db: testDb.db, queue, now: () => NOW });
    expect(job.cron).toBe('*/30 * * * *');
    await job.handler({});
    await job.handler({});
    const slot = Math.floor(NOW.getTime() / (30 * 60_000));
    const sent = await boss.getJobById(QUEUES.pollCalendar, uuidFrom(`calendar:${feedId}:${slot}`));
    expect(sent?.data).toEqual({ feedId });
    const skipped = await boss.getJobById(
      QUEUES.pollCalendar,
      uuidFrom(`calendar:${idle?.id}:${slot}`),
    );
    expect(skipped).toBeNull();
    const { rows } = await testDb.pool.query(
      'select count(*)::int as n from pgboss.job where name = $1',
      [QUEUES.pollCalendar],
    );
    expect(rows[0].n).toBe(1);
  });

  it('polls a feed into a proposal', async () => {
    const job = pollCalendarJob({
      db: testDb.db,
      queue,
      now: () => NOW,
      fetch: stubFetch([ics([{ uid: 'a', checkIn: '2026-11-02', checkout: '2026-11-05' }])]),
    });
    await job.handler({ feedId });
    const proposals = await listProposals(testDb.db, { hostId: unit.hostId }, NOW);
    expect(proposals).toMatchObject([{ checkIn: '2026-11-02', sources: ['airbnb'] }]);
  });

  it('emails the host on a date change', async () => {
    const mailer = createMemoryMailer();
    const job = stayNotifyJob({
      db: testDb.db,
      mailer,
      now: () => NOW,
      webOrigin: 'http://host.test',
    });
    await job.handler({
      stayId: unit.stayId,
      kind: 'dates_changed',
      checkIn: unit.stay.checkIn,
      checkout: unit.stay.checkout,
    });
    expect(mailer.sent).toHaveLength(1);
  });

  it('allowlists the calendar hosts for egress', () => {
    expect(EGRESS_ALLOWLIST).toEqual(
      expect.arrayContaining(['www.airbnb.com', 'ical.booking.com', 'admin.booking.com']),
    );
  });
});
