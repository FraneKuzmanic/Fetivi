import {
  addFeed,
  type CalendarFeedRow,
  CalendarRuleError,
  calendarEvents,
  calendarFeeds,
  confirmProposal,
  type Db,
  dismissProposal,
  feedLabel,
  type JobQueue,
  keepStay,
  listFeeds,
  listProposals,
  markBookingLinksApproved,
  properties,
  removeFeed,
  units,
} from '@fetivi/domain';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { findOwnedProperty, findOwnedUnit } from '../properties/store';
import { findOwnedStay, ownedStayOut } from '../stays/out';
import { hostIdOf, withStayErrors } from '../stays/routes';
import { FeedCreate, ProposalConfirm, ProposalsQuery } from './schemas';

export interface CalendarRouteDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  guestOrigin: string;
}

const IdParams = z.object({ id: z.uuid() });

const CALENDAR_ERROR_STATUS: Record<CalendarRuleError['code'], number> = {
  'not-found': 404,
  'invalid-calendar-url': 400,
  'calendar-exists': 409,
  'too-many-calendars': 409,
  'proposal-gone': 409,
  'not-possibly-cancelled': 409,
};

/** Calendar and Stay rule errors as HTTP errors. */
const withCalendarErrors = <T>(run: () => Promise<T>): Promise<T> =>
  withStayErrors(async () => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CalendarRuleError) {
        throw new HttpError(CALENDAR_ERROR_STATUS[error.code], error.code);
      }
      throw error;
    }
  });

/** Never the URL: its query string is the export secret, and the host has it already. */
function feedOut(feed: CalendarFeedRow) {
  return {
    id: feed.id,
    unitId: feed.unitId,
    source: feed.source,
    label: feedLabel(feed.url),
    lastPolledAt: feed.lastPolledAt?.toISOString() ?? null,
    lastOkAt: feed.lastOkAt?.toISOString() ?? null,
    lastError: feed.lastError,
    createdAt: feed.createdAt.toISOString(),
  };
}

export async function calendarRoutes(app: FastifyInstance, deps: CalendarRouteDeps): Promise<void> {
  const { db, queue } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;
  /** The host to approve in the Booking.com extranet: where the hand-over link points. */
  const domain = new URL(deps.guestOrigin).host;
  const ctx = () => ({ now: deps.now(), guestOrigin: deps.guestOrigin });

  /** A pending event of one of the host's units; 404 otherwise. */
  async function assertOwnedEvent(hostId: string, eventId: string): Promise<void> {
    const [row] = await db
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .innerJoin(calendarFeeds, eq(calendarFeeds.id, calendarEvents.feedId))
      .innerJoin(units, eq(units.id, calendarFeeds.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(and(eq(calendarEvents.id, eventId), eq(properties.hostId, hostId)));
    if (!row) throw new HttpError(404, 'not-found');
  }

  app.get('/api/host/units/:id/calendars', host, async (request) => {
    const { unit, property } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const feeds = await listFeeds(db, unit.id);
    return {
      feeds: feeds.map(feedOut),
      bookingLinks: {
        needed: feeds.some((f) => f.source === 'booking') && !property.bookingLinksApprovedAt,
        approvedAt: property.bookingLinksApprovedAt?.toISOString() ?? null,
        domain,
        propertyId: property.id,
      },
    };
  });

  app.post('/api/host/units/:id/calendars', host, async (request, reply) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { url } = FeedCreate.parse(request.body);
    const feed = await withCalendarErrors(() =>
      addFeed({ db, queue, now: deps.now }, unit.id, url),
    );
    return reply.status(201).send(feedOut(feed));
  });

  app.delete('/api/host/calendars/:id', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const [feed] = await db
      .select({ id: calendarFeeds.id })
      .from(calendarFeeds)
      .innerJoin(units, eq(units.id, calendarFeeds.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(and(eq(calendarFeeds.id, idOf(request)), eq(properties.hostId, hostId)));
    if (!feed) throw new HttpError(404, 'not-found');
    await removeFeed(db, feed.id);
    return reply.status(204).send();
  });

  app.get('/api/host/stay-proposals', host, async (request) => {
    const hostId = hostIdOf(request);
    const { unitId } = ProposalsQuery.parse(request.query);
    if (unitId) await findOwnedUnit(db, hostId, unitId);
    const proposals = await listProposals(db, { hostId, unitId }, deps.now());
    // Properties with a Booking.com feed whose guest domain is not approved yet.
    const pending = await db
      .selectDistinct({ propertyId: properties.id, propertyName: properties.name })
      .from(calendarFeeds)
      .innerJoin(units, eq(units.id, calendarFeeds.unitId))
      .innerJoin(properties, eq(properties.id, units.propertyId))
      .where(
        and(
          eq(properties.hostId, hostId),
          eq(calendarFeeds.source, 'booking'),
          isNull(properties.bookingLinksApprovedAt),
          unitId ? eq(units.id, unitId) : undefined,
        ),
      )
      .orderBy(asc(properties.name), asc(properties.id));
    return { proposals, bookingLinks: { domain, pending } };
  });

  app.post('/api/host/stay-proposals/:id/confirm', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await assertOwnedEvent(hostId, id);
    const body = ProposalConfirm.parse(request.body);
    const stay = await withCalendarErrors(() => confirmProposal({ db, now: deps.now }, id, body));
    return reply.status(201).send(await ownedStayOut(db, hostId, stay.id, ctx()));
  });

  app.post('/api/host/stay-proposals/:id/dismiss', host, async (request, reply) => {
    const id = idOf(request);
    await assertOwnedEvent(hostIdOf(request), id);
    await withCalendarErrors(() => dismissProposal(db, id, deps.now()));
    return reply.status(204).send();
  });

  app.post('/api/host/stays/:id/keep', host, async (request) => {
    const hostId = hostIdOf(request);
    const { stay } = await findOwnedStay(db, hostId, idOf(request));
    await withCalendarErrors(() => keepStay(db, stay.id, deps.now()));
    return ownedStayOut(db, hostId, stay.id, ctx());
  });

  app.post('/api/host/properties/:id/booking-links-approved', host, async (request, reply) => {
    const property = await findOwnedProperty(db, hostIdOf(request), idOf(request));
    await markBookingLinksApproved(db, property.id, deps.now());
    return reply.status(204).send();
  });
}
