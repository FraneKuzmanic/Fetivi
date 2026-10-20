import {
  type Db,
  type Executor,
  InvalidTimeInputError,
  needsPinWarning,
  properties,
  registerStay,
  type StayRow,
  StayRuleError,
  stayPhase,
  stays,
  toLocalDateTime,
  units,
  updateStay,
} from '@fetivi/domain';
import { and, asc, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { unitLink } from '../properties/qr';
import { findOwnedUnit, ownedUnitIds } from '../properties/store';
import { StayCreate, StayPatch, StaysQuery } from './schemas';

export interface StayDeps {
  db: Db;
  now: () => Date;
  guestOrigin: string;
}

const IdParams = z.object({ id: z.uuid() });
const PAST_LIMIT = 50;

const STAY_ERROR_STATUS: Record<StayRuleError['code'], number> = {
  'not-found': 404,
  'invalid-input': 400,
  'unit-not-live': 409,
  'account-suspended': 403,
  'stay-ended': 409,
};

/** Turns Stay rule and time errors into HTTP errors. */
async function withStayErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof StayRuleError) {
      throw new HttpError(STAY_ERROR_STATUS[error.code], error.code);
    }
    if (error instanceof InvalidTimeInputError) throw new HttpError(400, 'invalid-input');
    throw error;
  }
}

/** The host id comes only from request.auth, never from the client. */
function hostIdOf(request: FastifyRequest): string {
  const hostId = request.auth.hostId;
  if (!hostId) throw new HttpError(403, 'forbidden');
  return hostId;
}

/** A Stay with the unit and property fields its output needs, scoped to the host's units. */
const selectStays = (db: Executor) =>
  db
    .select({
      stay: stays,
      unitName: units.name,
      qrSlug: units.qrSlug,
      propertyId: properties.id,
      propertyName: properties.name,
      timezone: properties.timezone,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId));

type StayJoin = Awaited<ReturnType<ReturnType<typeof selectStays>['execute']>>[number];

export async function stayRoutes(app: FastifyInstance, deps: StayDeps): Promise<void> {
  const { db, guestOrigin } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;

  function stayOut(row: StayJoin) {
    const { stay, timezone } = row;
    const now = deps.now();
    return {
      id: stay.id,
      unitId: stay.unitId,
      unitName: row.unitName,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      timezone,
      checkIn: stay.checkIn,
      checkout: stay.checkout,
      partySize: stay.partySize,
      bookerName: stay.bookerName,
      reservationNumber: stay.reservationNumber,
      pin: stay.pin,
      arrivalReleaseAt: stay.arrivalReleaseAt.toISOString(),
      arrivalReleaseLocal: toLocalDateTime(stay.arrivalReleaseAt, timezone),
      activeUntil: stay.activeUntil.toISOString(),
      possiblyCancelled: stay.possiblyCancelled,
      pinSentAt: stay.pinSentAt?.toISOString() ?? null,
      handoverLanguage: stay.handoverLanguage,
      unitLink: row.qrSlug ? unitLink(guestOrigin, row.qrSlug) : null,
      phase: stayPhase(stay, timezone, now),
      pinWarning: needsPinWarning(stay, timezone, now),
      createdAt: stay.createdAt.toISOString(),
      updatedAt: stay.updatedAt.toISOString(),
    };
  }

  async function findOwnedStay(hostId: string, id: string): Promise<StayJoin> {
    const [row] = await selectStays(db).where(and(eq(stays.id, id), eq(properties.hostId, hostId)));
    if (!row) throw new HttpError(404, 'not-found');
    return row;
  }

  const detailOf = async (hostId: string, stay: StayRow) =>
    stayOut(await findOwnedStay(hostId, stay.id));

  app.get('/api/host/stays', host, async (request) => {
    const hostId = hostIdOf(request);
    const { unitId, past } = StaysQuery.parse(request.query);
    if (unitId) await findOwnedUnit(db, hostId, unitId);
    const now = deps.now();
    const scope = and(
      eq(properties.hostId, hostId),
      unitId ? eq(stays.unitId, unitId) : undefined,
      past ? lte(stays.activeUntil, now) : gt(stays.activeUntil, now),
    );
    const rows = past
      ? await selectStays(db).where(scope).orderBy(desc(stays.checkout)).limit(PAST_LIMIT)
      : await selectStays(db).where(scope).orderBy(asc(stays.checkIn), asc(stays.createdAt));
    return { stays: rows.map(stayOut) };
  });

  app.post('/api/host/units/:id/stays', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const { unit } = await findOwnedUnit(db, hostId, idOf(request));
    const body = StayCreate.parse(request.body);
    const stay = await withStayErrors(() => registerStay(db, unit.id, body, deps.now()));
    return reply.status(201).send(await detailOf(hostId, stay));
  });

  app.get('/api/host/stays/:id', host, async (request) =>
    stayOut(await findOwnedStay(hostIdOf(request), idOf(request))),
  );

  app.patch('/api/host/stays/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const { stay } = await findOwnedStay(hostId, idOf(request));
    const body = StayPatch.parse(request.body);
    const updated = await withStayErrors(() => updateStay(db, stay.id, body, deps.now()));
    return detailOf(hostId, updated);
  });

  app.delete('/api/host/stays/:id', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const deleted = await db
      .delete(stays)
      .where(and(eq(stays.id, idOf(request)), inArray(stays.unitId, ownedUnitIds(db, hostId))))
      .returning({ id: stays.id });
    if (deleted.length === 0) throw new HttpError(404, 'not-found');
    return reply.status(204).send();
  });
}
