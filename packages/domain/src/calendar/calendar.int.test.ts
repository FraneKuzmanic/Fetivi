import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { calendarEvents, calendarFeeds } from '../db/schema/calendar';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import { uuidFrom } from '../jobs/queue';
import { createMemoryMailer } from '../mail';
import { StayRuleError } from '../stays/rules';
import { registerStay } from '../stays/store';
import { createTestDatabase, recordingQueue, type TestDatabase } from '../testing';
import { CalendarRuleError } from './errors';
import { type FixtureEvent, ics, type StubResponse, stubFetch } from './fixtures';
import { sendStayDatesChanged } from './notify';
import {
  addFeed,
  type CalendarDeps,
  confirmProposal,
  dismissProposal,
  keepStay,
  listProposals,
  pollFeed,
} from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const OCT_24 = { checkIn: '2026-10-24', checkout: '2026-10-27' };

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** A host with a live unit in Europe/Zagreb and an Airbnb and a Booking.com feed on it. */
async function seed(options: { live?: boolean; suspended?: boolean } = {}) {
  const { live = true, suspended = false } = options;
  const tag = randomBytes(4).toString('hex');
  const [host] = await testDb.db
    .insert(accounts)
    .values({
      email: `host-${tag}@example.test`,
      passwordHash: 'x',
      role: 'host',
      suspendedAt: suspended ? NOW : null,
    })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await testDb.db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa', timezone: 'Europe/Zagreb', approvedAt: NOW })
    .returning();
  if (!property) throw new Error('no property');
  const [unit] = await testDb.db
    .insert(units)
    .values({ propertyId: property.id, name: 'Unit 1', qrSlug: live ? `qr${tag}` : null })
    .returning();
  if (!unit) throw new Error('no unit');
  const feeds = await testDb.db
    .insert(calendarFeeds)
    .values([
      { unitId: unit.id, source: 'airbnb', url: `https://www.airbnb.com/calendar/ical/${tag}.ics` },
      { unitId: unit.id, source: 'booking', url: `https://ical.booking.com/v1/export?t=${tag}` },
    ])
    .returning();
  const [airbnb, booking] = feeds as [(typeof feeds)[number], (typeof feeds)[number]];
  const queue = recordingQueue();
  return {
    host,
    hostId: host.id,
    propertyId: property.id,
    unitId: unit.id,
    airbnb,
    booking,
    queue,
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

const deps = (s: Seeded, responses: StubResponse[], now = NOW): CalendarDeps => ({
  db: testDb.db,
  queue: s.queue,
  now: () => now,
  fetch: stubFetch(responses),
});

const poll = (s: Seeded, feedId: string, response: StubResponse) =>
  pollFeed(deps(s, [response]), feedId);

const airbnbFile = (events: FixtureEvent[]) => ics(events, 'airbnb');
const bookingFile = (events: FixtureEvent[]) => ics(events, 'booking');

const proposals = (s: Seeded) => listProposals(testDb.db, { hostId: s.hostId }, NOW);

const confirm = (s: Seeded, eventId: string) =>
  confirmProposal(deps(s, []), eventId, { partySize: 2 });

const stayRow = async (id: string) => {
  const [row] = await testDb.db.select().from(stays).where(eq(stays.id, id));
  return row;
};

const eventsOf = (feedId: string) =>
  testDb.db.select().from(calendarEvents).where(eq(calendarEvents.feedId, feedId));

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) =>
      error instanceof CalendarRuleError || error instanceof StayRuleError
        ? error.code
        : String(error),
  );

describe('calendar sync with fixture feeds', () => {
  it('merges identical dates of two feeds into one proposal and links both on confirm', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'a1@airbnb.com', ...OCT_24 }]));
    await poll(s, s.booking.id, bookingFile([{ uid: 'b1@booking.com', ...OCT_24 }]));
    const [proposal, ...rest] = await proposals(s);
    expect(rest).toHaveLength(0);
    expect(proposal).toMatchObject({ ...OCT_24, sources: ['airbnb', 'booking'] });
    expect(proposal?.summaries).toEqual([
      { source: 'airbnb', summary: 'Reserved' },
      { source: 'booking', summary: 'CLOSED - Not available' },
    ]);

    const stay = await confirm(s, proposal?.id as string);
    const linked = [...(await eventsOf(s.airbnb.id)), ...(await eventsOf(s.booking.id))];
    expect(linked.map((e) => [e.status, e.stayId])).toEqual([
      ['confirmed', stay.id],
      ['confirmed', stay.id],
    ]);
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'a1@airbnb.com', ...OCT_24 }]));
    await poll(s, s.booking.id, bookingFile([{ uid: 'b1@booking.com', ...OCT_24 }]));
    expect(await proposals(s)).toHaveLength(0);
  });

  it('never brings a dismissed event back, not even after a date change', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'x', ...OCT_24 }]));
    const [proposal] = await proposals(s);
    await dismissProposal(testDb.db, proposal?.id as string, NOW);
    expect(await proposals(s)).toHaveLength(0);
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'x', ...OCT_24 }]));
    await poll(
      s,
      s.airbnb.id,
      airbnbFile([{ uid: 'x', checkIn: '2026-10-25', checkout: '2026-10-28' }]),
    );
    expect(await proposals(s)).toHaveLength(0);
    expect(await code(dismissProposal(testDb.db, proposal?.id as string, NOW))).toBe(
      'proposal-gone',
    );
  });

  it('proposes blocks that look identical to bookings, and the host sorts them', async () => {
    const s = await seed();
    await poll(
      s,
      s.booking.id,
      bookingFile([
        { uid: 'block@booking.com', checkIn: '2026-11-02', checkout: '2026-11-09' },
        { uid: 'booking@booking.com', ...OCT_24 },
      ]),
    );
    const list = await proposals(s);
    expect(list.map((p) => p.summaries[0]?.summary)).toEqual([
      'CLOSED - Not available',
      'CLOSED - Not available',
    ]);
    const [booking, block] = list;
    await dismissProposal(testDb.db, block?.id as string, NOW);
    await confirm(s, booking?.id as string);
    await poll(
      s,
      s.booking.id,
      bookingFile([
        { uid: 'block@booking.com', checkIn: '2026-11-02', checkout: '2026-11-09' },
        { uid: 'booking@booking.com', ...OCT_24 },
      ]),
    );
    expect(await proposals(s)).toHaveLength(0);
    expect(await testDb.db.select().from(stays).where(eq(stays.unitId, s.unitId))).toHaveLength(1);
  });

  it('moves a Stay on a date change with the same UID, keeps the PIN and notifies once', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'k', ...OCT_24 }]));
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    const moved = airbnbFile([{ uid: 'k', checkIn: '2026-10-25', checkout: '2026-10-29' }]);
    await poll(s, s.airbnb.id, moved);
    const after = await stayRow(stay.id);
    expect(after).toMatchObject({ checkIn: '2026-10-25', checkout: '2026-10-29', pin: stay.pin });
    const notify = s.queue.jobs.filter((j) => j.name === 'stay-notify');
    expect(notify).toEqual([
      {
        name: 'stay-notify',
        data: {
          stayId: stay.id,
          kind: 'dates_changed',
          checkIn: '2026-10-25',
          checkout: '2026-10-29',
        },
        id: uuidFrom(`stay:${stay.id}:dates:2026-10-25:2026-10-29`),
      },
    ]);
    const before = s.queue.jobs.length;
    await poll(s, s.airbnb.id, moved);
    expect(s.queue.jobs.length).toBe(before);
  });

  it('moves a Stay when the UID changes along with the dates', async () => {
    const s = await seed();
    await poll(s, s.booking.id, bookingFile([{ uid: 'old@booking.com', ...OCT_24 }]));
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    await poll(
      s,
      s.booking.id,
      bookingFile([{ uid: 'new@booking.com', checkIn: '2026-10-25', checkout: '2026-10-29' }]),
    );
    expect(await stayRow(stay.id)).toMatchObject({
      checkIn: '2026-10-25',
      checkout: '2026-10-29',
      pin: stay.pin,
      possiblyCancelled: false,
    });
    const events = await eventsOf(s.booking.id);
    expect(events.map((e) => [e.uid, e.status, e.stayId])).toEqual([
      ['new@booking.com', 'confirmed', stay.id],
    ]);
    expect(await proposals(s)).toHaveLength(0);
  });

  it('falls back to possibly cancelled plus proposals when a UID change is ambiguous', async () => {
    const s = await seed();
    const nov = { checkIn: '2026-11-02', checkout: '2026-11-05' };
    await poll(
      s,
      s.booking.id,
      bookingFile([
        { uid: 'o1', ...OCT_24 },
        { uid: 'o2', ...nov },
      ]),
    );
    const ids = (await proposals(s)).map((p) => p.id);
    const first = await confirm(s, ids[0] as string);
    const second = await confirm(s, ids[1] as string);
    await poll(
      s,
      s.booking.id,
      bookingFile([
        { uid: 'n1', checkIn: '2026-10-25', checkout: '2026-10-28' },
        { uid: 'n2', checkIn: '2026-11-03', checkout: '2026-11-06' },
      ]),
    );
    expect((await stayRow(first.id))?.possiblyCancelled).toBe(true);
    expect((await stayRow(second.id))?.possiblyCancelled).toBe(true);
    expect(await proposals(s)).toHaveLength(2);
  });

  it('marks a vanished booking possibly cancelled; the PIN keeps working until the host decides', async () => {
    const s = await seed();
    const file = airbnbFile([{ uid: 'v', ...OCT_24 }]);
    await poll(s, s.airbnb.id, file);
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    await poll(s, s.airbnb.id, airbnbFile([]));
    const flagged = await stayRow(stay.id);
    expect(flagged?.possiblyCancelled).toBe(true);
    expect(flagged?.activeUntil.getTime()).toBeGreaterThan(NOW.getTime());
    expect(flagged?.pin).toBe(stay.pin);

    await poll(s, s.airbnb.id, file);
    expect((await stayRow(stay.id))?.possiblyCancelled).toBe(false);

    await poll(s, s.airbnb.id, airbnbFile([]));
    expect((await keepStay(testDb.db, stay.id, NOW)).possiblyCancelled).toBe(false);
    expect(await code(keepStay(testDb.db, stay.id, NOW))).toBe('not-possibly-cancelled');
  });

  it('never touches events when the feed cannot be read', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'f', ...OCT_24 }]));
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    const before = await eventsOf(s.airbnb.id);
    for (const [response, error] of [
      [{ status: 500 }, 'http-500'],
      [new Error('ECONNRESET'), 'fetch-failed'],
      ['<!doctype html><html>Log in</html>', 'not-a-calendar'],
    ] as const) {
      expect(await poll(s, s.airbnb.id, response)).toEqual({ outcome: 'failed', error });
      const [feed] = await testDb.db
        .select()
        .from(calendarFeeds)
        .where(eq(calendarFeeds.id, s.airbnb.id));
      expect(feed?.lastError).toBe(error);
    }
    expect(await eventsOf(s.airbnb.id)).toEqual(before);
    expect((await stayRow(stay.id))?.possiblyCancelled).toBe(false);
  });

  it('links an event to a manually registered Stay with the same dates', async () => {
    const s = await seed();
    const manual = await registerStay(testDb.db, s.unitId, { ...OCT_24, partySize: 3 }, NOW);
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'm', ...OCT_24 }]));
    expect(await proposals(s)).toHaveLength(0);
    const [event] = await eventsOf(s.airbnb.id);
    expect(event).toMatchObject({ status: 'confirmed', stayId: manual.id });
  });

  it('registers one Stay when two confirms race', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'r', ...OCT_24 }]));
    const id = (await proposals(s))[0]?.id as string;
    const results = await Promise.all([code(confirm(s, id)), code(confirm(s, id))]);
    expect(results.sort()).toEqual(['ok', 'proposal-gone']);
    expect(await testDb.db.select().from(stays).where(eq(stays.unitId, s.unitId))).toHaveLength(1);
  });

  it('never proposes the events of a deleted Stay again', async () => {
    const s = await seed();
    const file = airbnbFile([{ uid: 'del', ...OCT_24 }]);
    await poll(s, s.airbnb.id, file);
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    await testDb.db.delete(stays).where(eq(stays.id, stay.id));
    await poll(s, s.airbnb.id, file);
    expect(await proposals(s)).toHaveLength(0);
    expect((await eventsOf(s.airbnb.id))[0]).toMatchObject({ status: 'confirmed', stayId: null });
  });

  it('accepts feeds only on live units and skips suspended hosts', async () => {
    const notLive = await seed({ live: false });
    expect(
      await code(
        addFeed(
          deps(notLive, []),
          notLive.unitId,
          'https://www.airbnb.com/calendar/ical/9.ics?s=1',
        ),
      ),
    ).toBe('unit-not-live');
    const live = await seed();
    const feed = await addFeed(
      deps(live, []),
      live.unitId,
      'https://www.airbnb.de/calendar/ical/9.ics?s=1',
    );
    expect(feed).toMatchObject({
      source: 'airbnb',
      url: 'https://www.airbnb.com/calendar/ical/9.ics?s=1',
    });
    expect(live.queue.jobs).toEqual([
      {
        name: 'poll-calendar',
        data: { feedId: feed.id },
        id: uuidFrom(`calendar:${feed.id}:added`),
      },
    ]);
    expect(
      await code(
        addFeed(deps(live, []), live.unitId, 'https://www.airbnb.com/calendar/ical/9.ics?s=1'),
      ),
    ).toBe('calendar-exists');
    const suspended = await seed({ suspended: true });
    expect(await poll(suspended, suspended.airbnb.id, airbnbFile([]))).toEqual({
      outcome: 'skipped',
    });
  });

  it('emails the host about new dates without the PIN, and skips a superseded job', async () => {
    const s = await seed();
    await poll(s, s.airbnb.id, airbnbFile([{ uid: 'n', ...OCT_24 }]));
    const stay = await confirm(s, (await proposals(s))[0]?.id as string);
    const mailer = createMemoryMailer();
    const notifyDeps = { db: testDb.db, mailer, now: () => NOW, webOrigin: 'http://host.test' };
    const job = { stayId: stay.id, kind: 'dates_changed' as const, ...OCT_24 };
    expect(await sendStayDatesChanged(notifyDeps, job)).toBe('sent');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(s.host.email);
    expect(mailer.sent[0]?.text).toContain(`http://host.test/stays/${stay.id}`);
    expect(mailer.sent[0]?.text).not.toContain(stay.pin);
    expect(await sendStayDatesChanged(notifyDeps, { ...job, checkout: '2026-10-28' })).toBe(
      'skipped',
    );
  });
});
