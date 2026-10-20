import {
  correctTranslation,
  type Db,
  findSecretLikeText,
  GUEST_LANGUAGES,
  infoBlocks,
  type JobQueue,
  LIMITS,
  listTranslations,
  properties,
  retryTranslation,
  TranslationRuleError,
  unitHiddenBlocks,
  units,
} from '@fetivi/domain';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
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
  findOwnedProperty,
  findOwnedUnit,
  issueSlug,
  listProperties,
  ownedPropertyIds,
  propertyDetail,
  replacePropertyAmenities,
  replaceUnitAmenities,
  saveBlock,
  unitDetail,
} from './store';

export interface PropertyDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  guestOrigin: string;
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

const TRANSLATION_ERROR_STATUS: Record<TranslationRuleError['code'], number> = {
  'invalid-input': 400,
  'not-found': 404,
  'stale-revision': 409,
  'translation-not-failed': 409,
};

/** Runs a translation operation, turning its rule errors into HTTP errors. */
export async function withTranslationErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TranslationRuleError) {
      throw new HttpError(TRANSLATION_ERROR_STATUS[error.code], error.code);
    }
    throw error;
  }
}

function blockResult(block: Parameters<typeof blockOut>[0]) {
  return { block: blockOut(block), warnings: findSecretLikeText(`${block.title}\n${block.body}`) };
}

export async function propertyRoutes(app: FastifyInstance, deps: PropertyDeps): Promise<void> {
  const { db, queue, guestOrigin } = deps;
  const host = { config: { access: 'host' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;

  // --- Properties -----------------------------------------------------------------------------

  app.get('/api/host/properties', host, async (request) => ({
    properties: await listProperties(db, hostIdOf(request)),
  }));

  app.post('/api/host/properties', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const body = PropertyCreate.parse(request.body);
    const [property] = await db
      .insert(properties)
      .values({ ...propertyValues(body), name: body.name, hostId })
      .returning();
    if (!property) throw new Error('property insert returned nothing');
    return reply.status(201).send(await propertyDetail(db, property));
  });

  app.get('/api/host/properties/:id', host, async (request) =>
    propertyDetail(db, await findOwnedProperty(db, hostIdOf(request), idOf(request))),
  );

  app.patch('/api/host/properties/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    const body = PropertyPatch.parse(request.body);
    const [property] = await db
      .update(properties)
      .set({ ...propertyValues(body), updatedAt: deps.now() })
      .where(and(eq(properties.id, id), eq(properties.hostId, hostId)))
      .returning();
    if (!property) throw new HttpError(404, 'not-found');
    return propertyDetail(db, property);
  });

  app.delete('/api/host/properties/:id', host, async (request, reply) => {
    const deleted = await db
      .delete(properties)
      .where(and(eq(properties.id, idOf(request)), eq(properties.hostId, hostIdOf(request))))
      .returning({ id: properties.id });
    if (deleted.length === 0) throw new HttpError(404, 'not-found');
    return reply.status(204).send();
  });

  app.put('/api/host/properties/:id/amenities', host, async (request) => {
    const property = await findOwnedProperty(db, hostIdOf(request), idOf(request));
    const { amenities } = AmenitiesBody.parse(request.body);
    return { amenities: await replacePropertyAmenities(db, property.id, amenities) };
  });

  // --- Units ----------------------------------------------------------------------------------

  app.post('/api/host/properties/:id/units', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const property = await findOwnedProperty(db, hostId, idOf(request));
    const { name } = UnitCreate.parse(request.body);
    const unit = await db.transaction(async (tx) => {
      // Locked against a concurrent approval, which would miss a unit inserted after its read.
      const [current] = await tx
        .select({ approvedAt: properties.approvedAt })
        .from(properties)
        .where(eq(properties.id, property.id))
        .for('share');
      const [row] = await tx.insert(units).values({ propertyId: property.id, name }).returning();
      if (!row) throw new Error('unit insert returned nothing');
      // Under an approved property a new unit is live at once.
      if (current?.approvedAt) await issueSlug(tx, row.id);
      return row;
    });
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
    const [unit] = await db
      .update(units)
      .set({ ...body, updatedAt: deps.now() })
      .where(and(eq(units.id, id), inArray(units.propertyId, ownedPropertyIds(db, hostId))))
      .returning();
    if (!unit) throw new HttpError(404, 'not-found');
    return unitDetail(db, await findOwnedUnit(db, hostId, id), guestOrigin);
  });

  app.delete('/api/host/units/:id', host, async (request, reply) => {
    const hostId = hostIdOf(request);
    const deleted = await db
      .delete(units)
      .where(
        and(eq(units.id, idOf(request)), inArray(units.propertyId, ownedPropertyIds(db, hostId))),
      )
      .returning({ id: units.id });
    if (deleted.length === 0) throw new HttpError(404, 'not-found');
    return reply.status(204).send();
  });

  app.put('/api/host/units/:id/amenities', host, async (request) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { amenities } = AmenitiesBody.parse(request.body);
    return { amenities: await replaceUnitAmenities(db, unit.id, amenities) };
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

  app.get('/api/host/units/:id/qr', host, async (request, reply) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const { format } = QrQuery.parse(request.query);
    if (!unit.qrSlug) throw new HttpError(409, 'not-approved');
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
    return reply.status(201).send(blockResult(block));
  });

  app.post('/api/host/units/:id/blocks', host, async (request, reply) => {
    const { unit } = await findOwnedUnit(db, hostIdOf(request), idOf(request));
    const body = UnitBlockCreate.parse(request.body);
    if (body.replacesBlockId) {
      // Only a block of the unit's own property can be replaced.
      const [replaced] = await db
        .select({ id: infoBlocks.id })
        .from(infoBlocks)
        .where(
          and(eq(infoBlocks.id, body.replacesBlockId), eq(infoBlocks.propertyId, unit.propertyId)),
        );
      if (!replaced) throw new HttpError(400, 'invalid-input');
    }
    if ((await countBlocks(db, { unitId: unit.id })) >= LIMITS.blocksPerOwner) {
      throw new HttpError(400, 'invalid-input');
    }
    const block = await saveBlock(db, queue, { insert: { ...body, unitId: unit.id } });
    return reply.status(201).send(blockResult(block));
  });

  app.patch('/api/host/blocks/:id', host, async (request) => {
    const hostId = hostIdOf(request);
    const id = idOf(request);
    await findOwnedBlock(db, hostId, id);
    const changes = BlockPatch.parse(request.body);
    const block = await saveBlock(db, queue, {
      update: { id, hostId, changes, now: deps.now() },
    });
    return blockResult(block);
  });

  app.delete('/api/host/blocks/:id', host, async (request, reply) => {
    const block = await findOwnedBlock(db, hostIdOf(request), idOf(request));
    await db.delete(infoBlocks).where(eq(infoBlocks.id, block.id));
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
}
