import { and, asc, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { type Db, type Executor, pgCode, type Tx } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { type CalendarFeedRow, calendarEvents, calendarFeeds } from '../db/schema/calendar';
import { properties, units } from '../db/schema/properties';
import { type StayRow, stays } from '../db/schema/stays';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import { StayRuleError } from '../stays/rules';
import { assertUnitLive, registerStay, type StayInput, updateStay } from '../stays/store';
import { PIN_WARNING_DAYS } from '../stays/vocabulary';
import { arrivalReleaseAt, type CivilDate, endOfCheckoutDay } from '../time';
import { CalendarFeedError, CalendarRuleError } from './errors';
import { parseFeedUrl } from './feed-url';
import { parseICal } from './ical';
import { plan, type SyncAction, type UnitStay } from './reconcile';
import { CALENDAR_LIMITS, type CalendarSource } from './vocabulary';

export interface CalendarDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  /** The jobs process passes egress.fetch, so only the calendar hosts are reachable. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface StayNotifyJobData {
  stayId: string;
  kind: 'dates_changed';
  checkIn: CivilDate;
  checkout: CivilDate;
}

/** The job key of a date-change email; one per Stay and new dates. */
export const stayDatesJobKey = (stayId: string, checkIn: CivilDate, checkout: CivilDate) =>
  `stay:${stayId}:dates:${checkIn}:${checkout}`;

/** Locks the property row FOR UPDATE: every calendar write that touches Stays or proposals takes it first. */
async function lockProperty(tx: Executor, propertyId: string): Promise<void> {
  await tx
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .for('update');
}

async function unitLiveness(db: Executor, unitId: string) {
  const [row] = await db
    .select({
      propertyId: units.propertyId,
      qrSlug: units.qrSlug,
      approvedAt: properties.approvedAt,
      suspendedAt: accounts.suspendedAt,
      timezone: properties.timezone,
    })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(accounts, eq(accounts.id, properties.hostId))
    .where(eq(units.id, unitId));
  return row;
}

// --- Feeds -------------------------------------------------------------------------------------

export async function listFeeds(db: Executor, unitId: string): Promise<CalendarFeedRow[]> {
  return db
    .select()
    .from(calendarFeeds)
    .where(eq(calendarFeeds.unitId, unitId))
    .orderBy(asc(calendarFeeds.createdAt), asc(calendarFeeds.id));
}

/** Ids of the feeds of live units of non-suspended hosts: the ones the cron polls. */
export async function liveFeedIds(db: Executor): Promise<string[]> {
  const rows = await db
    .select({ id: calendarFeeds.id })
    .from(calendarFeeds)
    .innerJoin(units, eq(units.id, calendarFeeds.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(accounts, eq(accounts.id, properties.hostId))
    .where(
      and(isNotNull(units.qrSlug), isNotNull(properties.approvedAt), isNull(accounts.suspendedAt)),
    );
  return rows.map((r) => r.id);
}

/** Adds a feed to a live unit (at most six) and polls it at once. */
export async function addFeed(
  deps: Pick<CalendarDeps, 'db' | 'queue' | 'now'>,
  unitId: string,
  rawUrl: string,
): Promise<CalendarFeedRow> {
  const { url, source } = parseFeedUrl(rawUrl);
  const now = deps.now();
  try {
    return await deps.db.transaction(async (tx) => {
      const unit = await unitLiveness(tx, unitId);
      if (!unit) throw new StayRuleError('not-found');
      await lockProperty(tx, unit.propertyId);
      assertUnitLive(unit);
      const existing = await listFeeds(tx, unitId);
      if (existing.some((f) => f.url === url)) throw new CalendarRuleError('calendar-exists');
      if (existing.length >= CALENDAR_LIMITS.feedsPerUnit) {
        throw new CalendarRuleError('too-many-calendars');
      }
      const [row] = await tx
        .insert(calendarFeeds)
        .values({ unitId, source, url, createdAt: now, updatedAt: now })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await deps.queue.send(QUEUES.pollCalendar, { feedId: row.id }, tx, {
        id: uuidFrom(`calendar:${row.id}:added`),
      });
      return row;
    });
  } catch (error) {
    if (pgCode(error) === '23505') throw new CalendarRuleError('calendar-exists');
    throw error;
  }
}

/** Removes a feed and its events; Stays it registered stay as they are. */
export async function removeFeed(db: Db, feedId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [feed] = await tx
      .select({ propertyId: units.propertyId })
      .from(calendarFeeds)
      .innerJoin(units, eq(units.id, calendarFeeds.unitId))
      .where(eq(calendarFeeds.id, feedId));
    if (!feed) return;
    await lockProperty(tx, feed.propertyId);
    await tx.delete(calendarFeeds).where(eq(calendarFeeds.id, feedId));
  });
}

// --- Polling -----------------------------------------------------------------------------------

export type PollOutcome =
  | { outcome: 'gone' | 'skipped' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'ok'; counts: Partial<Record<SyncAction['type'] | 'linked', number>> };

/** Reads at most `maxBytes` of the body; more is too-large. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > CALENDAR_LIMITS.maxBytes) throw new CalendarFeedError('too-large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CALENDAR_LIMITS.maxBytes) {
      await reader.cancel();
      throw new CalendarFeedError('too-large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchFeed(deps: Pick<CalendarDeps, 'fetch'>, url: string): Promise<string> {
  let response: Response;
  try {
    response = await deps.fetch(url, {
      signal: AbortSignal.timeout(CALENDAR_LIMITS.fetchTimeoutMs),
      headers: { accept: 'text/calendar, text/plain;q=0.9' },
    });
  } catch {
    throw new CalendarFeedError('fetch-failed');
  }
  if (!response.ok) throw new CalendarFeedError('http-error', response.status);
  try {
    return await readCapped(response);
  } catch (error) {
    if (error instanceof CalendarFeedError) throw error;
    throw new CalendarFeedError('fetch-failed');
  }
}

/**
 * Reads one feed and applies the sync plan in one transaction (property row locked first). The
 * fetch runs before the transaction; a failed fetch or parse only records the error on the feed
 * and never touches events, so a glitch cannot vanish a booking.
 */
export async function pollFeed(deps: CalendarDeps, feedId: string): Promise<PollOutcome> {
  const [feed] = await deps.db
    .select({ url: calendarFeeds.url, unitId: calendarFeeds.unitId })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.id, feedId));
  if (!feed) return { outcome: 'gone' };
  const unit = await unitLiveness(deps.db, feed.unitId);
  if (!unit) return { outcome: 'gone' };
  try {
    assertUnitLive(unit);
  } catch {
    return { outcome: 'skipped' };
  }

  let fetched: ReturnType<typeof parseICal>;
  try {
    fetched = parseICal(await fetchFeed(deps, feed.url), unit.timezone);
  } catch (error) {
    if (!(error instanceof CalendarFeedError)) throw error;
    const now = deps.now();
    await deps.db
      .update(calendarFeeds)
      .set({ lastPolledAt: now, lastError: error.stored, updatedAt: now })
      .where(eq(calendarFeeds.id, feedId));
    return { outcome: 'failed', error: error.stored };
  }

  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    await lockProperty(tx, unit.propertyId);
    const [locked] = await tx
      .select({ id: calendarFeeds.id })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.id, feedId))
      .for('update');
    if (!locked) return { outcome: 'gone' as const };
    const known = await tx.select().from(calendarEvents).where(eq(calendarEvents.feedId, feedId));
    const actions = plan({
      known,
      fetched,
      stays: await unitStays(tx, feed.unitId, feedId, now),
      zone: unit.timezone,
      now,
    });
    const counts: Partial<Record<SyncAction['type'] | 'linked', number>> = {};
    for (const action of actions) {
      counts[action.type] = (counts[action.type] ?? 0) + 1;
      await applyAction(tx, deps.queue, feedId, action, now);
    }
    const linked = await linkMatchingPending(tx, feed.unitId, now);
    if (linked) counts.linked = linked;
    await tx
      .update(calendarFeeds)
      .set({ lastPolledAt: now, lastOkAt: now, lastError: null, updatedAt: now })
      .where(eq(calendarFeeds.id, feedId));
    return { outcome: 'ok' as const, counts };
  });
}

/** The unit's active Stays, with the not-vanished linked events of the unit's other feeds. */
async function unitStays(tx: Tx, unitId: string, feedId: string, now: Date): Promise<UnitStay[]> {
  const rows = await tx
    .select({
      id: stays.id,
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      possiblyCancelled: stays.possiblyCancelled,
    })
    .from(stays)
    .where(and(eq(stays.unitId, unitId), gt(stays.activeUntil, now)));
  if (rows.length === 0) return [];
  const linked = await tx
    .select({ id: calendarEvents.id, stayId: calendarEvents.stayId })
    .from(calendarEvents)
    .where(
      and(
        inArray(
          calendarEvents.stayId,
          rows.map((r) => r.id),
        ),
        ne(calendarEvents.feedId, feedId),
        isNull(calendarEvents.vanishedAt),
      ),
    );
  return rows.map((r) => ({
    ...r,
    presentLinkedEventIds: linked.filter((l) => l.stayId === r.id).map((l) => l.id),
  }));
}

async function applyAction(
  tx: Tx,
  queue: JobQueue,
  feedId: string,
  action: SyncAction,
  now: Date,
): Promise<void> {
  const event = (id: string) => eq(calendarEvents.id, id);
  switch (action.type) {
    case 'insert':
      await tx.insert(calendarEvents).values({
        feedId,
        uid: action.uid,
        checkIn: action.checkIn,
        checkout: action.checkout,
        summary: action.summary,
        status: action.status,
        stayId: action.stayId,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return;
    case 'update':
      await tx
        .update(calendarEvents)
        .set({
          checkIn: action.checkIn,
          checkout: action.checkout,
          summary: action.summary,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(event(action.id));
      return;
    case 'touch':
      await tx.update(calendarEvents).set({ lastSeenAt: now }).where(event(action.id));
      return;
    case 'delete':
      await tx.delete(calendarEvents).where(event(action.id));
      return;
    case 'vanish':
      await tx
        .update(calendarEvents)
        .set({ vanishedAt: now, updatedAt: now })
        .where(event(action.id));
      return;
    case 'reappear':
      await tx
        .update(calendarEvents)
        .set({ vanishedAt: null, lastSeenAt: now, updatedAt: now })
        .where(event(action.id));
      return;
    case 'flagPossiblyCancelled':
    case 'clearPossiblyCancelled':
      await tx
        .update(stays)
        .set({ possiblyCancelled: action.type === 'flagPossiblyCancelled', updatedAt: now })
        .where(eq(stays.id, action.stayId));
      return;
    case 'moveStay': {
      const { stayId, checkIn, checkout } = action;
      try {
        // A savepoint: a rejected move rolls back only itself.
        await updateStay(tx, stayId, { checkIn, checkout }, now, {
          inTransaction: (tx2) =>
            queue.send(
              QUEUES.stayNotify,
              { stayId, kind: 'dates_changed', checkIn, checkout } satisfies StayNotifyJobData,
              tx2,
              { id: uuidFrom(stayDatesJobKey(stayId, checkIn, checkout)) },
            ),
        });
      } catch (error) {
        if (!(error instanceof StayRuleError)) throw error;
        console.log(
          JSON.stringify({ job: QUEUES.pollCalendar, feedId, stayId, moveSkipped: error.code }),
        );
      }
      return;
    }
  }
}

/**
 * Links the unit's pending events whose dates equal an active Stay. Heals a confirm racing a
 * poll, and a Stay edited to the dates of a proposal.
 */
async function linkMatchingPending(tx: Tx, unitId: string, now: Date): Promise<number> {
  const active = await tx
    .select({ id: stays.id, checkIn: stays.checkIn, checkout: stays.checkout })
    .from(stays)
    .where(and(eq(stays.unitId, unitId), gt(stays.activeUntil, now)));
  let linked = 0;
  for (const s of active) {
    const rows = await linkGroup(tx, unitId, s, s.id, now);
    linked += rows.length;
  }
  return linked;
}

/** Confirms every pending event of the unit with these dates, linking them to `stayId`. */
async function linkGroup(
  tx: Tx,
  unitId: string,
  dates: { checkIn: CivilDate; checkout: CivilDate },
  stayId: string,
  now: Date,
): Promise<{ id: string }[]> {
  return tx
    .update(calendarEvents)
    .set({ status: 'confirmed', stayId, updatedAt: now })
    .where(
      and(
        eq(calendarEvents.status, 'pending'),
        inArray(
          calendarEvents.feedId,
          tx
            .select({ id: calendarFeeds.id })
            .from(calendarFeeds)
            .where(eq(calendarFeeds.unitId, unitId)),
        ),
        eq(calendarEvents.checkIn, dates.checkIn),
        eq(calendarEvents.checkout, dates.checkout),
      ),
    )
    .returning({ id: calendarEvents.id });
}

// --- Proposals ---------------------------------------------------------------------------------

export interface Proposal {
  /** The earliest-created event of the group. */
  id: string;
  unitId: string;
  unitName: string;
  propertyId: string;
  propertyName: string;
  timezone: string;
  checkIn: CivilDate;
  checkout: CivilDate;
  sources: CalendarSource[];
  summaries: { source: CalendarSource; summary: string }[];
  /** From 00:00 three days before check-in, property time. */
  pinWarning: boolean;
}

/** Pending events of the host's units, merged by unit and identical dates, by check-in. */
export async function listProposals(
  db: Executor,
  scope: { hostId: string; unitId?: string },
  now: Date,
): Promise<Proposal[]> {
  const rows = await db
    .select({
      id: calendarEvents.id,
      checkIn: calendarEvents.checkIn,
      checkout: calendarEvents.checkout,
      summary: calendarEvents.summary,
      createdAt: calendarEvents.createdAt,
      source: calendarFeeds.source,
      unitId: units.id,
      unitName: units.name,
      propertyId: properties.id,
      propertyName: properties.name,
      timezone: properties.timezone,
    })
    .from(calendarEvents)
    .innerJoin(calendarFeeds, eq(calendarFeeds.id, calendarEvents.feedId))
    .innerJoin(units, eq(units.id, calendarFeeds.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(
      and(
        eq(properties.hostId, scope.hostId),
        eq(calendarEvents.status, 'pending'),
        scope.unitId ? eq(units.id, scope.unitId) : undefined,
      ),
    )
    .orderBy(asc(calendarEvents.createdAt), asc(calendarEvents.id));
  const groups = new Map<string, Proposal>();
  for (const r of rows) {
    if (endOfCheckoutDay(r.checkout, r.timezone) <= now) continue;
    const key = `${r.unitId}|${r.checkIn}|${r.checkout}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: r.id,
        unitId: r.unitId,
        unitName: r.unitName,
        propertyId: r.propertyId,
        propertyName: r.propertyName,
        timezone: r.timezone,
        checkIn: r.checkIn,
        checkout: r.checkout,
        sources: [],
        summaries: [],
        pinWarning: now >= arrivalReleaseAt(r.checkIn, r.timezone, PIN_WARNING_DAYS),
      };
      groups.set(key, group);
    }
    if (!group.sources.includes(r.source)) group.sources.push(r.source);
    if (r.summary) group.summaries.push({ source: r.source, summary: r.summary });
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      sources: [...g.sources].sort(),
      summaries: [...g.summaries].sort((a, b) => a.source.localeCompare(b.source)),
    }))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkout.localeCompare(b.checkout));
}

async function findEvent(db: Executor, eventId: string) {
  const [row] = await db
    .select({
      id: calendarEvents.id,
      status: calendarEvents.status,
      checkIn: calendarEvents.checkIn,
      checkout: calendarEvents.checkout,
      unitId: units.id,
      propertyId: units.propertyId,
    })
    .from(calendarEvents)
    .innerJoin(calendarFeeds, eq(calendarFeeds.id, calendarEvents.feedId))
    .innerJoin(units, eq(units.id, calendarFeeds.unitId))
    .where(eq(calendarEvents.id, eventId));
  return row;
}

/**
 * Registers the proposal as a Stay through registerStay and links every pending event of the
 * group to it, in registerStay's transaction. A proposal handled meanwhile is proposal-gone.
 */
export async function confirmProposal(
  deps: Pick<CalendarDeps, 'db' | 'now'>,
  eventId: string,
  input: Omit<StayInput, 'checkIn' | 'checkout'>,
): Promise<StayRow> {
  const event = await findEvent(deps.db, eventId);
  if (!event) throw new CalendarRuleError('not-found');
  if (event.status !== 'pending') throw new CalendarRuleError('proposal-gone');
  const dates = { checkIn: event.checkIn, checkout: event.checkout };
  return registerStay(deps.db, event.unitId, { ...input, ...dates }, deps.now(), {
    // Runs after registerStay locked the property row, so two confirms serialize here.
    inTransaction: async (tx, row) => {
      const linked = await linkGroup(tx, event.unitId, dates, row.id, deps.now());
      if (!linked.some((l) => l.id === eventId)) throw new CalendarRuleError('proposal-gone');
    },
  });
}

/** "Not a booking": dismisses every pending event of the group; their UIDs are never proposed again. */
export async function dismissProposal(db: Db, eventId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await findEvent(tx, eventId);
    if (!found) throw new CalendarRuleError('not-found');
    await lockProperty(tx, found.propertyId);
    const event = await findEvent(tx, eventId);
    if (event?.status !== 'pending') throw new CalendarRuleError('proposal-gone');
    await tx
      .update(calendarEvents)
      .set({ status: 'dismissed', dismissedAt: now, updatedAt: now })
      .where(
        and(
          eq(calendarEvents.status, 'pending'),
          inArray(
            calendarEvents.feedId,
            tx
              .select({ id: calendarFeeds.id })
              .from(calendarFeeds)
              .where(eq(calendarFeeds.unitId, event.unitId)),
          ),
          eq(calendarEvents.checkIn, event.checkIn),
          eq(calendarEvents.checkout, event.checkout),
        ),
      );
  });
}

/** "Keep the Stay": clears the possibly-cancelled flag. */
export async function keepStay(db: Db, stayId: string, now: Date): Promise<StayRow> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ propertyId: units.propertyId })
      .from(stays)
      .innerJoin(units, eq(units.id, stays.unitId))
      .where(eq(stays.id, stayId));
    if (!found) throw new CalendarRuleError('not-found');
    await lockProperty(tx, found.propertyId);
    const [stay] = await tx.select().from(stays).where(eq(stays.id, stayId)).for('update');
    if (!stay) throw new CalendarRuleError('not-found');
    if (!stay.possiblyCancelled) throw new CalendarRuleError('not-possibly-cancelled');
    const [row] = await tx
      .update(stays)
      .set({ possiblyCancelled: false, updatedAt: now })
      .where(eq(stays.id, stayId))
      .returning();
    if (!row) throw new CalendarRuleError('not-found');
    return row;
  });
}

/** The host approved Fetivi's guest domain in the Booking.com extranet. Kept from the first time. */
export async function markBookingLinksApproved(
  db: Executor,
  propertyId: string,
  now: Date,
): Promise<void> {
  await db
    .update(properties)
    .set({ bookingLinksApprovedAt: now })
    .where(and(eq(properties.id, propertyId), isNull(properties.bookingLinksApprovedAt)));
}

/** The calendar sources each Stay was registered or linked from, sorted. */
export async function calendarSourcesOf(
  db: Executor,
  stayIds: readonly string[],
): Promise<Map<string, CalendarSource[]>> {
  const result = new Map<string, CalendarSource[]>();
  if (stayIds.length === 0) return result;
  const rows = await db
    .selectDistinct({ stayId: calendarEvents.stayId, source: calendarFeeds.source })
    .from(calendarEvents)
    .innerJoin(calendarFeeds, eq(calendarFeeds.id, calendarEvents.feedId))
    .where(inArray(calendarEvents.stayId, [...stayIds]))
    .orderBy(asc(calendarFeeds.source));
  for (const r of rows) {
    if (!r.stayId) continue;
    const list = result.get(r.stayId) ?? [];
    list.push(r.source);
    result.set(r.stayId, list);
  }
  return result;
}
