import {
  type Db,
  extractManualText,
  type JobQueue,
  LIMITS,
  loadEffectiveUnit,
  MANUAL_CONTENT_TYPES,
  MANUAL_TYPES,
  type ManualImportModel,
  type ManualSource,
  normalizeManualText,
  SNIFFED_AS,
  sniffManualType,
  wizardFacts,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../http-error';
import { findOwnedUnit } from '../properties/store';
import { buildDrafts } from './drafts';
import { ItemParams, PasteBody, UnitParams } from './schemas';
import { getImport, importOut, replaceImport, resolveItem } from './store';

export interface ManualImportDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
  model: ManualImportModel;
}

/** The host id comes only from request.auth, never from the client. */
function hostIdOf(request: FastifyRequest): string {
  const hostId = request.auth.hostId;
  if (!hostId) throw new HttpError(403, 'forbidden');
  return hostId;
}

/**
 * On the import route, Fastify's own 413 and 415 mean a file too large or of a type we do not
 * take. Our own errors pass through unchanged.
 */
const uploadErrors = (error: { statusCode?: number }) => {
  if (error instanceof HttpError) throw error;
  if (error.statusCode === 413) throw new HttpError(413, 'manual-too-large');
  if (error.statusCode === 415) throw new HttpError(415, 'unsupported-manual');
  throw error;
};

const declaredType = (request: FastifyRequest) =>
  (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

/** The manual's text and where it came from: pasted JSON, or a PDF, DOCX or TXT file as the raw body. */
async function readManual(
  request: FastifyRequest,
): Promise<{ text: string; source: ManualSource }> {
  const body = request.body;
  if (!Buffer.isBuffer(body)) return { text: PasteBody.parse(body).text, source: 'paste' };
  const type = MANUAL_TYPES[declaredType(request) as keyof typeof MANUAL_TYPES];
  // The bytes decide; the declared type must agree with them.
  if (!type || sniffManualType(body) !== SNIFFED_AS[type]) {
    throw new HttpError(415, 'unsupported-manual');
  }
  const text = await extractManualText(body, type);
  if (text === null) throw new HttpError(415, 'unsupported-manual');
  return { text, source: type };
}

/** House manual import (ticket 21): drafts from an existing manual, confirmed one by one. */
export async function manualImportRoutes(
  app: FastifyInstance,
  deps: ManualImportDeps,
): Promise<void> {
  const { db, queue, model } = deps;
  const host = { config: { access: 'host' as const } };

  // Only in this plugin's scope. text/plain has a built-in string parser, replaced by a buffer one.
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser(
    MANUAL_CONTENT_TYPES,
    { parseAs: 'buffer', bodyLimit: LIMITS.manualBytes },
    (_request, body, done) => done(null, body),
  );

  const path = '/api/host/units/:id/manual-import';

  app.get(path, host, async (request) => {
    const { unit } = await findOwnedUnit(
      db,
      hostIdOf(request),
      UnitParams.parse(request.params).id,
    );
    const row = await getImport(db, unit.id);
    return { import: row ? importOut(row) : null };
  });

  app.post(
    path,
    { ...host, bodyLimit: LIMITS.manualBytes, errorHandler: uploadErrors },
    async (request, reply) => {
      const { unit } = await findOwnedUnit(
        db,
        hostIdOf(request),
        UnitParams.parse(request.params).id,
      );
      const manual = await readManual(request);
      const text = normalizeManualText(manual.text);
      if (text === '') throw new HttpError(422, 'manual-empty');
      if (text.length > LIMITS.manualText) throw new HttpError(413, 'manual-too-long');

      // Outside any transaction: the call can take a while, and only its result is stored.
      const result = await model.extract(text);
      if (!result.ok) {
        if (result.error === 'not-configured') throw new HttpError(503, 'import-not-configured');
        // The detail only; never the manual's text.
        request.log.warn({ detail: result.detail }, 'manual import model call failed');
        throw new HttpError(502, 'import-failed');
      }

      const effective = await loadEffectiveUnit(db, unit.id);
      if (!effective) throw new HttpError(404, 'not-found');
      const items = buildDrafts(result.output, {
        values: wizardFacts(effective).values,
        amenities: effective.amenities.map((a) => a.amenity),
      });
      const row = await replaceImport(db, {
        unitId: unit.id,
        source: manual.source,
        items,
        now: deps.now(),
      });
      return reply.status(201).send({ import: importOut(row) });
    },
  );

  for (const action of ['confirm', 'dismiss'] as const) {
    app.post(`${path}/items/:itemId/${action}`, host, async (request) => {
      const { id, itemId } = ItemParams.parse(request.params);
      const owned = await findOwnedUnit(db, hostIdOf(request), id);
      const { row, warnings } = await resolveItem(db, queue, {
        owned,
        itemId,
        action,
        body: request.body,
        now: deps.now(),
      });
      return action === 'confirm'
        ? { import: importOut(row), warnings }
        : { import: importOut(row) };
    });
  }
}
