import {
  CATALOG_KINDS,
  CatalogRuleError,
  catalogRecords,
  createCatalogRecord,
  type Db,
  destinations,
  fromLocalDateTime,
  InvalidTimeInputError,
  type JobQueue,
  listCatalogTranslations,
  markVerified,
  replaceOpeningHours,
  replacePlaceImages,
  replaceSeasons,
  retryCatalogTranslation,
  updateCatalogRecord,
} from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';
import { withTranslationErrors } from '../properties/routes';
import {
  destinationOut,
  findDestination,
  findRecord,
  listDestinations,
  listRecords,
  recordDetail,
} from './out';
import {
  DestinationCreate,
  DestinationPatch,
  ImagesBody,
  OpeningHoursBody,
  RecordCreate,
  recordPatchFor,
  SeasonsBody,
} from './schemas';

export interface CatalogDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });
const RecordsQuery = z.object({ kind: z.enum(CATALOG_KINDS).optional() });

type LatLng = { lat: number; lng: number };
const toPoint = (p: LatLng | null | undefined) =>
  p === undefined ? undefined : p === null ? null : { x: p.lng, y: p.lat };

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

/** Turns catalog rule and time errors into HTTP errors. */
async function withCatalogErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CatalogRuleError) {
      throw new HttpError(error.code === 'not-found' ? 404 : 400, error.code);
    }
    if (error instanceof InvalidTimeInputError) throw new HttpError(400, 'invalid-input');
    throw error;
  }
}

/** The body fields a create or patch may carry that need converting. */
interface Convertible {
  location?: LatLng | null;
  startsAt?: string;
  endsAt?: string;
}

/** Omit over each member of a union, so a per-kind body keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Body fields to column values: points to { x, y }, event wall-clock times to instants. */
function recordValues<T extends object>(input: T, timezone: string) {
  const { location, startsAt, endsAt, ...rest } = input as T & Convertible;
  const converted: { location?: { x: number; y: number } | null; startsAt?: Date; endsAt?: Date } =
    {};
  if (location !== undefined) converted.location = toPoint(location);
  if (startsAt !== undefined) converted.startsAt = fromLocalDateTime(startsAt, timezone);
  if (endsAt !== undefined) converted.endsAt = fromLocalDateTime(endsAt, timezone);
  return { ...(rest as DistributiveOmit<T, keyof Convertible>), ...converted };
}

const seasonRows = (seasons: { from: string; to: string }[]) =>
  seasons.map(({ from, to }) => {
    const [fromMonth, fromDay] = from.split('-').map(Number) as [number, number];
    const [toMonth, toDay] = to.split('-').map(Number) as [number, number];
    return { fromMonth, fromDay, toMonth, toDay };
  });

export async function catalogRoutes(app: FastifyInstance, deps: CatalogDeps): Promise<void> {
  const { db, queue, now } = deps;
  const admin = { config: { access: 'admin' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;

  async function detailOf(id: string) {
    const { record, destination } = await findRecord(db, id);
    return recordDetail(db, record, destination, now());
  }

  // --- Destinations ---------------------------------------------------------------------------

  app.get('/api/admin/destinations', admin, async () => ({
    destinations: await listDestinations(db),
  }));

  app.post('/api/admin/destinations', admin, async (request, reply) => {
    const { name, centre, radiusKm, timezone } = DestinationCreate.parse(request.body);
    try {
      const [row] = await db
        .insert(destinations)
        .values({
          name,
          centre: { x: centre.lng, y: centre.lat },
          radiusM: Math.round(radiusKm * 1000),
          timezone,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      if (!row) throw new Error('destination insert returned nothing');
      return reply.status(201).send(destinationOut(row));
    } catch (error) {
      // 23505: the name is taken.
      if (pgCode(error) === '23505') throw new HttpError(400, 'invalid-input');
      throw error;
    }
  });

  app.get('/api/admin/destinations/:id', admin, async (request) => {
    const { destination, recordCount } = await findDestination(db, idOf(request));
    return destinationOut(destination, recordCount);
  });

  app.patch('/api/admin/destinations/:id', admin, async (request) => {
    const id = idOf(request);
    const { name, centre, radiusKm, timezone } = DestinationPatch.parse(request.body);
    await findDestination(db, id);
    try {
      await db
        .update(destinations)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(centre === undefined ? {} : { centre: { x: centre.lng, y: centre.lat } }),
          ...(radiusKm === undefined ? {} : { radiusM: Math.round(radiusKm * 1000) }),
          ...(timezone === undefined ? {} : { timezone }),
          updatedAt: now(),
        })
        .where(eq(destinations.id, id));
    } catch (error) {
      if (pgCode(error) === '23505') throw new HttpError(400, 'invalid-input');
      throw error;
    }
    const { destination, recordCount } = await findDestination(db, id);
    return destinationOut(destination, recordCount);
  });

  app.delete('/api/admin/destinations/:id', admin, async (request, reply) => {
    const { destination, recordCount } = await findDestination(db, idOf(request));
    if (recordCount > 0) throw new HttpError(409, 'destination-not-empty');
    try {
      await db.delete(destinations).where(eq(destinations.id, destination.id));
    } catch (error) {
      // 23503: a record was added meanwhile; the foreign key restricts the delete.
      if (pgCode(error) === '23503') throw new HttpError(409, 'destination-not-empty');
      throw error;
    }
    return reply.status(204).send();
  });

  // --- Records --------------------------------------------------------------------------------

  app.get('/api/admin/destinations/:id/records', admin, async (request) => {
    const { destination } = await findDestination(db, idOf(request));
    const { kind } = RecordsQuery.parse(request.query);
    return { records: await listRecords(db, destination, kind, now()) };
  });

  app.post('/api/admin/destinations/:id/records', admin, async (request, reply) => {
    const { destination } = await findDestination(db, idOf(request));
    const { kind, ...input } = RecordCreate.parse(request.body);
    const record = await withCatalogErrors(() =>
      createCatalogRecord(
        db,
        queue,
        {
          destinationId: destination.id,
          kind,
          ...recordValues(input, destination.timezone),
        },
        now(),
      ),
    );
    return reply.status(201).send(await recordDetail(db, record, destination, now()));
  });

  app.get('/api/admin/catalog/records/:id', admin, async (request) => detailOf(idOf(request)));

  app.patch('/api/admin/catalog/records/:id', admin, async (request) => {
    const { record, destination } = await findRecord(db, idOf(request));
    const input = recordPatchFor(record.kind).parse(request.body);
    const updated = await withCatalogErrors(() =>
      updateCatalogRecord(db, queue, record.id, recordValues(input, destination.timezone), now()),
    );
    return recordDetail(db, updated, destination, now());
  });

  app.delete('/api/admin/catalog/records/:id', admin, async (request, reply) => {
    const { record } = await findRecord(db, idOf(request));
    await db.delete(catalogRecords).where(eq(catalogRecords.id, record.id));
    return reply.status(204).send();
  });

  app.put('/api/admin/catalog/records/:id/seasons', admin, async (request) => {
    const id = idOf(request);
    const { seasons } = SeasonsBody.parse(request.body);
    await withCatalogErrors(() => replaceSeasons(db, id, seasonRows(seasons), now()));
    return detailOf(id);
  });

  app.put('/api/admin/catalog/records/:id/opening-hours', admin, async (request) => {
    const id = idOf(request);
    const { hours } = OpeningHoursBody.parse(request.body);
    await withCatalogErrors(() => replaceOpeningHours(db, id, hours, now()));
    return detailOf(id);
  });

  app.put('/api/admin/catalog/records/:id/images', admin, async (request) => {
    const id = idOf(request);
    const { images } = ImagesBody.parse(request.body);
    await withCatalogErrors(() => replacePlaceImages(db, id, images, now()));
    return detailOf(id);
  });

  app.post('/api/admin/catalog/records/:id/verify', admin, async (request) => {
    const id = idOf(request);
    const principal = principalOf(request);
    await withCatalogErrors(() => markVerified(db, id, principal.account.id, now()));
    return detailOf(id);
  });

  // --- Translations ---------------------------------------------------------------------------

  app.get('/api/admin/catalog/records/:id/translations', admin, async (request) => {
    const { record } = await findRecord(db, idOf(request));
    return listCatalogTranslations(db, record);
  });

  app.post('/api/admin/catalog/records/:id/translations/retry', admin, async (request) => {
    const { record } = await findRecord(db, idOf(request));
    await withTranslationErrors(() => retryCatalogTranslation({ db, queue, now }, record.id));
    const { record: after } = await findRecord(db, record.id);
    return { view: await listCatalogTranslations(db, after) };
  });
}
