import {
  correctTranslation,
  type Db,
  type Executor,
  findSecretLikeText,
  GUEST_LANGUAGES,
  infoBlocks,
  type JobQueue,
  LIMITS,
  listTranslations,
  type MediaStore,
  mediaFilesOf,
  properties,
  refreshStayTimes,
  retryFieldTextTranslation,
  retryTranslation,
  syncFieldTexts,
  unitHiddenBlocks,
  units,
} from '@fetivi/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { withTranslationErrors } from '../translation-errors';
import { qrFileName, renderQr, unitLink } from './qr';
import {
  AmenitiesBody,
  BlockCreate,
  BlockPatch,
  HiddenBlocksBody,
  PropertyCreate,
  type PropertyInput,
  PropertyPatch,
  TranslationCorrection,
  UnitBlockCreate,
  UnitCreate,
  UnitPatch,
} from './schemas';
import {
  blockOut,
  countBlocks,
  findOwnedBlock,
  findOwnedFieldText,
  findOwnedProperty,
  findOwnedUnit,
  listProperties,
  mediaByBlock,
  ownedPropertyIds,
  propertyDetail,
  replacePropertyAmenities,
  replaceUnitAmenities,
  saveBlock,
  unitDetail,
} from './store';
import { goLiveUnit, wizardStatus } from './wizard';

export interface PropertyDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  guestOrigin: string;
  media: MediaStore;
}

const IdParams = z.object({ id: z.uuid() });
const QrQuery = z.object({ format: z.enum(['svg', 'png']).default('svg') });
const LanguageParams = z.object({ id: z.uuid(), language: z.enum(GUEST_LANGUAGES) });

/** The host id comes only from request.auth, never from the client. */
function hostIdOf(request: FastifyRequest): string {
  const hostId = request.auth.hostId;
  if (!hostId) throw new HttpError(403, 'forbidden');
  return hostId;
}

/** Maps the API's { lat, lng } to the column's { x: lng, y: lat }. */
function propertyValues(input: PropertyInput) {
  const { location, ...rest } = input;
  if (location === undefined) return rest;
  return { ...rest, location: location ? { x: location.lng, y: location.lat } : null };
}

async function blockResult(db: Executor, block: Parameters<typeof blockOut>[0]) {
  const media = await mediaByBlock(db, [block.id]);
  return {
    block: blockOut(block, media.get(block.id)),
    warnings: findSecretLikeText(`${block.title}\n${block.body}`),
  };
}

export async function propertyRoutes(app: FastifyInstance, deps: PropertyDeps): Promise<void> {
  const { db, queue, guestOrigin, media } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;

  // --- Properties -----------------------------------------------------------------------------

  app.get('/api/host/properties', host, async (request) => ({
    properties: await listProperties(db, hostIdOf(request)),
  }));

  app.post('/api/host/properties', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const body = PropertyCreate.parse(request.body);
    const property = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({ ...propertyValues(body), name: body.name, hostId })
        .returning();
      if (!row) throw new Error('property insert returned nothing');
      // Ticket 50: field texts follow the saved row in the same transaction.
      await syncFieldTexts(tx, queue, { propertyId: row.id }, row, deps.now());
      return row;
    });
    return reply.status(201).send(await propertyDetail(db, property));
  });

  app.get('/api/host/properties/:id', host, async (request) =>
    propertyDetail(db, await findOwnedProperty(db, hostIdOf(request), idOf(request))),
  );

  app.patch('/api/host/properties/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    const body = PropertyPatch.parse(request.body);
    const property = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(properties)
        .set({ ...propertyValues(body), updatedAt: deps.now() })
        .where(and(eq(properties.id, id), eq(properties.hostId, hostId)))
        .returning();
      if (!row) return undefined;
      // A new zone moves the derived instants of the property's active Stays.
      if (body.timezone !== undefined) await refreshStayTimes(tx, { propertyId: id }, deps.now());
      // Ticket 50: synced from the saved row, so an untouched field heals a missing field text.
      await syncFieldTexts(tx, queue, { propertyId: id }, row, deps.now());
      return row;
    });
    if (!property) throw new HttpError(404, 'not-found');
    return propertyDetail(db, property);
  });

  app.delete('/api/host/properties/:id', host, async (request, reply) => {
    // Read before the cascade removes the rows; the files go once the delete succeeded.
    const files = await mediaFilesOf(db, { propertyId: idOf(request) });
    const deleted = await db
      .delete(properties)
      .where(and(eq(properties.id, idOf(request)), eq(properties.hostId, hostIdOf(request))))
      .returning({ id: properties.id });
    if (deleted.length === 0) throw new HttpError(404, 'not-found');
    await media.remove(files);
    return reply.status(204).send();
  });

  app.put('/api/host/properties/:id/amenities', host, async (request) => {
    const property = await findOwnedProperty(db, hostIdOf(request), idOf(request));
    const { amenities } = AmenitiesBody.parse(request.body);
    return {
      amenities: await replacePropertyAmenities(db, queue, property.id, amenities, deps.now()),
    };
  });

  // --- Units ----------------------------------------------------------------------------------

  app.post('/api/host/properties/:id/units', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const property = await findOwnedProperty(db, hostId, idOf(request));
    const { name } = UnitCreate.parse(request.body);
    // A new unit goes live through the go-live check, even under an approved property.
    const [unit] = await db.insert(units).values({ propertyId: property.id, name }).returning();
    if (!unit) throw new Error('unit insert returned nothing');
    return reply
      .status(201)
      .send(await unitDetail(db, await findOwnedUnit(db, hostId, unit.id), guestOrigin));
  });

  app.get('/api/host/units/:id', host, async (request) =>
    unitDetail(db, await findOwnedUnit(db, hostIdOf(request), idOf(request)), guestOrigin),
  );

  app.patch('/api/host/units/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    const body = UnitPatch.parse(request.body);
    const unit = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(units)
        .set({ ...body, updatedAt: deps.now() })
        .where(and(eq(units.id, id), inArray(units.propertyId, ownedPropertyIds(tx, hostId))))
        .returning();
      if (!row) return undefined;
      // A new release offset moves the arrival release time of the unit's active Stays.
      if (body.arrivalReleaseDaysBefore !== undefined) {
        await refreshStayTimes(tx, { unitId: id }, deps.now());
      }
      // Ticket 50: the unit's overrides get their own field texts; a cleared override drops its row.
      await syncFieldTexts(tx, queue, { unitId: id }, row, deps.now());
      return row;
    });
    if (!unit) throw new HttpError(404, 'not-found');
    return unitDetail(db, await findOwnedUnit(db, hostId, id), guestOrigin);
  });

  app.delete('/api/host/units/:id', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const files = await mediaFilesOf(db, { unitId: idOf(request) });
    const deleted = await db
      .delete(units)
      .where(
        and(eq(units.id, idOf(request)), inArray(units.propertyId, ownedPropertyIds(db, hostId))),
      )
      .returning({ id: units.id });
    if (deleted.length === 0) throw new HttpError(404, 'not-found');
    await media.remove(files);
    return reply.status(204).send();
  });

  app.put('/api/host/units/:id/amenities', host, async (request) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { amenities } = AmenitiesBody.parse(request.body);
    return { amenities: await replaceUnitAmenities(db, queue, unit.id, amenities, deps.now()) };
  });

  app.put('/api/host/units/:id/hidden-blocks', host, async (request) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { blockIds } = HiddenBlocksBody.parse(request.body);
    if (blockIds.length > 0) {
      // Only blocks of the unit's own property can be hidden.
      const found = await db
        .select({ id: infoBlocks.id })
        .from(infoBlocks)
        .where(and(inArray(infoBlocks.id, blockIds), eq(infoBlocks.propertyId, unit.propertyId)));
      if (found.length !== blockIds.length) throw new HttpError(400, 'invalid-input');
    }
    await db.transaction(async (tx) => {
      await tx.delete(unitHiddenBlocks).where(eq(unitHiddenBlocks.unitId, unit.id));
      if (blockIds.length > 0) {
        await tx
          .insert(unitHiddenBlocks)
          .values(blockIds.map((blockId) => ({ unitId: unit.id, blockId })));
      }
    });
    return { hiddenBlockIds: blockIds };
  });

  // --- Setup wizard and go-live ---------------------------------------------------------------

  app.get('/api/host/units/:id/wizard', host, async (request) =>
    wizardStatus(db, await findOwnedUnit(db, hostIdOf(request), idOf(request))),
  );

  app.post('/api/host/units/:id/go-live', host, async (request) => {
    const owned = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    await goLiveUnit(db, owned.unit.id);
    return wizardStatus(db, owned);
  });

  app.get('/api/host/units/:id/qr', host, async (request, reply) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { format } = QrQuery.parse(request.query);
    if (!unit.qrSlug) throw new HttpError(409, 'unit-not-live');
    const { body, contentType } = await renderQr(unitLink(guestOrigin, unit.qrSlug), format);
    return reply
      .header('content-type', contentType)
      .header('content-disposition', `attachment; filename="${qrFileName(unit.name, format)}"`)
      .send(body);
  });

  // --- Blocks ---------------------------------------------------------------------------------

  app.post('/api/host/properties/:id/blocks', host, async (request, reply) => {
    const property = await findOwnedProperty(db, hostIdOf(request), idOf(request));
    const body = BlockCreate.parse(request.body);
    if ((await countBlocks(db, { propertyId: property.id })) >= LIMITS.blocksPerOwner) {
      throw new HttpError(400, 'invalid-input');
    }
    const block = await saveBlock(db, queue, { insert: { ...body, propertyId: property.id } });
    return reply.status(201).send(await blockResult(db, block));
  });

  app.post('/api/host/units/:id/blocks', host, async (request, reply) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const body = UnitBlockCreate.parse(request.body);
    let wizardKey: string | null | undefined = body.wizardKey;
    if (body.replacesBlockId) {
      // Only a block of the unit's own property can be replaced.
      const [replaced] = await db
        .select({ id: infoBlocks.id, wizardKey: infoBlocks.wizardKey })
        .from(infoBlocks)
        .where(
          and(eq(infoBlocks.id, body.replacesBlockId), eq(infoBlocks.propertyId, unit.propertyId)),
        );
      if (!replaced) throw new HttpError(400, 'invalid-input');
      // The replacement answers the same wizard prompt unless the body says otherwise.
      if (wizardKey === undefined) wizardKey = replaced.wizardKey;
    }
    if ((await countBlocks(db, { unitId: unit.id })) >= LIMITS.blocksPerOwner) {
      throw new HttpError(400, 'invalid-input');
    }
    const block = await saveBlock(db, queue, { insert: { ...body, wizardKey, unitId: unit.id } });
    return reply.status(201).send(await blockResult(db, block));
  });

  app.patch('/api/host/blocks/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await findOwnedBlock(db, hostId, id);
    const changes = BlockPatch.parse(request.body);
    const block = await saveBlock(db, queue, {
      update: { id, hostId, changes, now: deps.now() },
    });
    return blockResult(db, block);
  });

  app.delete('/api/host/blocks/:id', host, async (request, reply) => {
    const block = await findOwnedBlock(db, hostIdOf(request), idOf(request));
    const files = await mediaFilesOf(db, { blockIds: [block.id] });
    await db.delete(infoBlocks).where(eq(infoBlocks.id, block.id));
    await media.remove(files);
    return reply.status(204).send();
  });

  // --- Translations ---------------------------------------------------------------------------

  const translationDeps = { db, queue, now: deps.now };

  app.get('/api/host/blocks/:id/translations', host, async (request) =>
    listTranslations(db, await findOwnedBlock(db, hostIdOf(request), idOf(request))),
  );

  app.put('/api/host/blocks/:id/translations/:language', host, async (request) => {
    const { id, language } = LanguageParams.parse(request.params);
    const hostId = hostIdOf(request);
    await findOwnedBlock(db, hostId, id);
    const body = TranslationCorrection.parse(request.body);
    const { structureWarnings } = await withTranslationErrors(() =>
      correctTranslation(translationDeps, id, { language, ...body }),
    );
    return {
      view: await listTranslations(db, await findOwnedBlock(db, hostId, id)),
      structureWarnings,
    };
  });

  app.post('/api/host/blocks/:id/translations/retry', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await findOwnedBlock(db, hostId, id);
    await withTranslationErrors(() => retryTranslation(translationDeps, id));
    return { view: await listTranslations(db, await findOwnedBlock(db, hostId, id)) };
  });

  // Ticket 50: a failed field text translation is retried; there are no corrections.
  app.post('/api/host/field-texts/:id/translations/retry', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await findOwnedFieldText(db, hostId, id);
    await withTranslationErrors(() => retryFieldTextTranslation(translationDeps, id));
    return { ok: true };
  });
}
