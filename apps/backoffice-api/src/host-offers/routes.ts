import {
  addAllotmentSlots,
  createOffer,
  type Db,
  deleteOffer,
  deleteSlot,
  expandWeeklySchedule,
  hostTimezone,
  type JobQueue,
  listOfferTranslations,
  pgCode,
  retryOfferTranslation,
  setSlotCapacity,
  updateOffer,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { listSlots, slotOut } from '../providers/out';
import { withOfferErrors } from '../providers/routes';
import { SlotPatch, SlotsBulkBody, SlotsQuery } from '../providers/schemas';
import { hostIdOf } from '../stays/routes';
import { withTranslationErrors } from '../translation-errors';
import { assertHostSlot, findHostOffer, hostOfferOut, listHostOffers } from './out';
import { HostOfferCreate, HostOfferPatch } from './schemas';

export interface HostOfferDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });

/**
 * A host's own services (38): the admin Offer routes, owned by `offers.host_id` = the session's
 * host. Another host's id is 404. Act-as writes are audited by the auth plugin.
 */
export async function hostOfferRoutes(app: FastifyInstance, deps: HostOfferDeps): Promise<void> {
  const { db, queue, now } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;
  const owned = (request: FastifyRequest) => findHostOffer(db, hostIdOf(request), idOf(request));

  async function detailOf(hostId: string, id: string) {
    const offer = await findHostOffer(db, hostId, id);
    return hostOfferOut(offer, await hostTimezone(db, hostId));
  }

  app.get('/api/host/offers', host, async (request) => ({
    offers: await listHostOffers(db, hostIdOf(request)),
  }));

  app.post('/api/host/offers', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const input = HostOfferCreate.parse(request.body);
    const offer = await withOfferErrors(() => createOffer(db, queue, { ...input, hostId }, now()));
    return reply.status(201).send(await detailOf(hostId, offer.id));
  });

  app.get('/api/host/offers/:id', host, async (request) =>
    detailOf(hostIdOf(request), idOf(request)),
  );

  app.patch('/api/host/offers/:id', host, async (request) => {
    const offer = await owned(request);
    const input = HostOfferPatch.parse(request.body);
    await withOfferErrors(() => updateOffer(db, queue, offer.id, input, now()));
    return detailOf(hostIdOf(request), offer.id);
  });

  app.delete('/api/host/offers/:id', host, async (request, reply) => {
    const offer = await owned(request);
    try {
      await withOfferErrors(() => deleteOffer(db, offer.id));
    } catch (error) {
      // 23503: Orders reference the Offer (restrict); the host turns it off instead.
      if (pgCode(error) === '23503') throw new HttpError(409, 'offer-has-orders');
      throw error;
    }
    return reply.status(204).send();
  });

  // --- Allotment slots, in the host's zone ------------------------------------------------------

  app.get('/api/host/offers/:id/slots', host, async (request) => {
    const offer = await owned(request);
    const { past } = SlotsQuery.parse(request.query);
    const timezone = await hostTimezone(db, hostIdOf(request));
    return { timezone, slots: await listSlots(db, offer.id, timezone, now(), past === 'true') };
  });

  app.post('/api/host/offers/:id/slots/bulk', host, async (request) => {
    const offer = await owned(request);
    const { capacity, ...schedule } = SlotsBulkBody.parse(request.body);
    const expanded = expandWeeklySchedule(schedule, await hostTimezone(db, hostIdOf(request)));
    const result = await withOfferErrors(() =>
      addAllotmentSlots(db, offer.id, expanded.startsAt, capacity, now()),
    );
    return { created: result.created, skipped: expanded.skipped + result.skipped };
  });

  app.patch('/api/host/allotment-slots/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await assertHostSlot(db, hostId, id);
    const { capacity } = SlotPatch.parse(request.body);
    const slot = await withOfferErrors(() => setSlotCapacity(db, id, capacity));
    return slotOut(slot, await hostTimezone(db, hostId));
  });

  app.delete('/api/host/allotment-slots/:id', host, async (request, reply) => {
    const id = idOf(request);
    await assertHostSlot(db, hostIdOf(request), id);
    await withOfferErrors(() => deleteSlot(db, id));
    return reply.status(204).send();
  });

  // --- Translations -----------------------------------------------------------------------------

  app.get('/api/host/offers/:id/translations', host, async (request) =>
    listOfferTranslations(db, await owned(request)),
  );

  app.post('/api/host/offers/:id/translations/retry', host, async (request) => {
    const offer = await owned(request);
    await withTranslationErrors(() => retryOfferTranslation({ db, queue, now }, offer.id));
    return { view: await listOfferTranslations(db, await owned(request)) };
  });
}
