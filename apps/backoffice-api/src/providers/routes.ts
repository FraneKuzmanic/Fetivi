import {
  addAllotmentSlots,
  createOffer,
  type Db,
  deleteOffer,
  deleteSlot,
  expandWeeklySchedule,
  InvalidTimeInputError,
  type JobQueue,
  listOfferTranslations,
  OfferRuleError,
  pgCode,
  providers,
  retryOfferTranslation,
  setSlotCapacity,
  updateOffer,
} from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findDestination } from '../catalog/out';
import { HttpError } from '../http-error';
import { withTranslationErrors } from '../translation-errors';
import {
  findOffer,
  findProvider,
  findSlotZone,
  listProviderOffers,
  listProviders,
  listSlots,
  offerDetail,
  providerOut,
  slotOut,
  zoneOf,
} from './out';
import {
  OfferCreate,
  OfferPatch,
  ProviderCreate,
  ProviderPatch,
  SlotPatch,
  SlotsBulkBody,
  SlotsQuery,
} from './schemas';

export interface ProviderDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });

const OFFER_ERROR_STATUS: Record<OfferRuleError['code'], number> = {
  'not-found': 404,
  'invalid-input': 400,
  'offer-has-slots': 409,
  'seats-taken': 409,
};

/** Turns Offer rule and time errors into HTTP errors. */
async function withOfferErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OfferRuleError) {
      throw new HttpError(OFFER_ERROR_STATUS[error.code], error.code);
    }
    if (error instanceof InvalidTimeInputError) throw new HttpError(400, 'invalid-input');
    throw error;
  }
}

/** 23505: the Provider name is taken. */
async function uniqueName<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (pgCode(error) === '23505') throw new HttpError(400, 'invalid-input');
    throw error;
  }
}

export async function providerRoutes(app: FastifyInstance, deps: ProviderDeps): Promise<void> {
  const { db, queue, now } = deps;
  const admin = { config: { access: 'admin' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;

  async function detailOf(id: string) {
    const { offer, provider, destination } = await findOffer(db, id);
    return offerDetail(db, offer, provider, destination);
  }

  // --- Providers ------------------------------------------------------------------------------

  app.get('/api/admin/providers', admin, async () => ({ providers: await listProviders(db) }));

  app.post('/api/admin/providers', admin, async (request, reply) => {
    const input = ProviderCreate.parse(request.body);
    const [row] = await uniqueName(() =>
      db
        .insert(providers)
        .values({ ...input, createdAt: now(), updatedAt: now() })
        .returning(),
    );
    if (!row) throw new Error('provider insert returned nothing');
    return reply.status(201).send(providerOut(row));
  });

  app.get('/api/admin/providers/:id', admin, async (request) => {
    const { provider, offerCount } = await findProvider(db, idOf(request));
    return providerOut(provider, offerCount);
  });

  app.patch('/api/admin/providers/:id', admin, async (request) => {
    const id = idOf(request);
    const input = ProviderPatch.parse(request.body);
    await findProvider(db, id);
    await uniqueName(() =>
      db
        .update(providers)
        .set({ ...input, updatedAt: now() })
        .where(eq(providers.id, id)),
    );
    const { provider, offerCount } = await findProvider(db, id);
    return providerOut(provider, offerCount);
  });

  app.delete('/api/admin/providers/:id', admin, async (request, reply) => {
    const { provider, offerCount } = await findProvider(db, idOf(request));
    if (offerCount > 0) throw new HttpError(409, 'provider-has-offers');
    try {
      await db.delete(providers).where(eq(providers.id, provider.id));
    } catch (error) {
      // 23503: an Offer was added meanwhile; the foreign key restricts the delete.
      if (pgCode(error) === '23503') throw new HttpError(409, 'provider-has-offers');
      throw error;
    }
    return reply.status(204).send();
  });

  // --- Offers ---------------------------------------------------------------------------------

  app.get('/api/admin/providers/:id/offers', admin, async (request) => {
    const { provider } = await findProvider(db, idOf(request));
    return { offers: await listProviderOffers(db, provider.id) };
  });

  app.post('/api/admin/providers/:id/offers', admin, async (request, reply) => {
    const { provider } = await findProvider(db, idOf(request));
    const input = OfferCreate.parse(request.body);
    // An unknown destination in the body is bad input, not a missing resource.
    await findDestination(db, input.destinationId).catch((error: unknown) => {
      if (error instanceof HttpError && error.statusCode === 404) {
        throw new HttpError(400, 'invalid-input');
      }
      throw error;
    });
    const offer = await withOfferErrors(() =>
      createOffer(db, queue, { ...input, providerId: provider.id }, now()),
    );
    return reply.status(201).send(await detailOf(offer.id));
  });

  app.get('/api/admin/offers/:id', admin, async (request) => detailOf(idOf(request)));

  app.patch('/api/admin/offers/:id', admin, async (request) => {
    const id = idOf(request);
    const input = OfferPatch.parse(request.body);
    await withOfferErrors(() => updateOffer(db, queue, id, input, now()));
    return detailOf(id);
  });

  app.delete('/api/admin/offers/:id', admin, async (request, reply) => {
    await withOfferErrors(() => deleteOffer(db, idOf(request)));
    return reply.status(204).send();
  });

  // --- Allotment slots ------------------------------------------------------------------------

  app.get('/api/admin/offers/:id/slots', admin, async (request) => {
    const { offer, destination } = await findOffer(db, idOf(request));
    const { past } = SlotsQuery.parse(request.query);
    const timezone = zoneOf(destination);
    return { timezone, slots: await listSlots(db, offer.id, timezone, now(), past === 'true') };
  });

  app.post('/api/admin/offers/:id/slots/bulk', admin, async (request) => {
    const { offer, destination } = await findOffer(db, idOf(request));
    const { capacity, ...schedule } = SlotsBulkBody.parse(request.body);
    // Slot times are entered in the destination's zone; an Offer without one cannot take them.
    if (!destination) throw new HttpError(400, 'invalid-input');
    const expanded = expandWeeklySchedule(schedule, destination.timezone);
    const result = await withOfferErrors(() =>
      addAllotmentSlots(db, offer.id, expanded.startsAt, capacity, now()),
    );
    return { created: result.created, skipped: expanded.skipped + result.skipped };
  });

  app.patch('/api/admin/allotment-slots/:id', admin, async (request) => {
    const id = idOf(request);
    const { capacity } = SlotPatch.parse(request.body);
    const slot = await withOfferErrors(() => setSlotCapacity(db, id, capacity));
    return slotOut(slot, await findSlotZone(db, id));
  });

  app.delete('/api/admin/allotment-slots/:id', admin, async (request, reply) => {
    await withOfferErrors(() => deleteSlot(db, idOf(request)));
    return reply.status(204).send();
  });

  // --- Translations ---------------------------------------------------------------------------

  app.get('/api/admin/offers/:id/translations', admin, async (request) => {
    const { offer } = await findOffer(db, idOf(request));
    return listOfferTranslations(db, offer);
  });

  app.post('/api/admin/offers/:id/translations/retry', admin, async (request) => {
    const { offer } = await findOffer(db, idOf(request));
    await withTranslationErrors(() => retryOfferTranslation({ db, queue, now }, offer.id));
    const { offer: after } = await findOffer(db, offer.id);
    return { view: await listOfferTranslations(db, after) };
  });
}
