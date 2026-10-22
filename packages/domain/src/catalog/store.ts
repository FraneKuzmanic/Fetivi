import { eq } from 'drizzle-orm';
import { INTERESTS } from '../about-me/vocabulary';
import { FERRY_LINE_IDS } from '../alerts/vocabulary';
import { type Db, type Executor, pgCode } from '../db/client';
import {
  type CatalogRecordRow,
  catalogOpeningHours,
  catalogRecords,
  catalogSeasons,
  placeImages,
} from '../db/schema/catalog';
import type { JobQueue } from '../jobs/queue';
import { enqueueCatalogTranslation, lockCatalogRecord } from './translation';
import { type ImageSource, KIND_HAS_HOURS, KIND_HAS_SEASONS } from './vocabulary';

// The one write path for catalog record content. A new revision of the title or description
// enqueues its translation in the same transaction, as for blocks.

export type NewCatalogRecord = Omit<
  typeof catalogRecords.$inferInsert,
  | 'id'
  | 'revision'
  | 'publishedRevision'
  | 'translationStatus'
  | 'translationError'
  | 'sourceLanguage'
  | 'verifiedAt'
  | 'verifiedBy'
  | 'createdAt'
  | 'updatedAt'
>;
/** Kind and destination never change. */
export type CatalogRecordChanges = Partial<Omit<NewCatalogRecord, 'destinationId' | 'kind'>>;

export class CatalogRuleError extends Error {
  override name = 'CatalogRuleError';
  constructor(readonly code: 'not-found' | 'invalid-input') {
    super(code);
  }
}

export interface SeasonInput {
  fromMonth: number;
  fromDay: number;
  toMonth: number;
  toDay: number;
}

export interface OpeningHoursInput {
  weekday: number;
  /** 'HH:MM'. */
  opens: string;
  closes: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface PlaceImageInput {
  url: string;
  source: ImageSource;
  licence: string | null;
  attribution: string | null;
  sourcePageUrl: string | null;
}

/** A violated CHECK (23514) is invalid input; anything else is rethrown. */
async function checked<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (pgCode(error) === '23514') throw new CatalogRuleError('invalid-input');
    throw error;
  }
}

/**
 * Ferry line ids and event interests deduplicated, in FERRY_LINES and INTERESTS order; unknown
 * codes are dropped.
 */
function withCodes<T extends { ferryLines?: string[]; interests?: string[] }>(values: T): T {
  const lines = values.ferryLines && new Set(values.ferryLines);
  const interests = values.interests && new Set(values.interests);
  return {
    ...values,
    ...(lines ? { ferryLines: FERRY_LINE_IDS.filter((id) => lines.has(id)) } : {}),
    ...(interests ? { interests: INTERESTS.filter((code) => interests.has(code)) } : {}),
  };
}

/** Inserts a record at revision 1 and enqueues its translation in the same transaction. */
export async function createCatalogRecord(
  db: Db,
  queue: JobQueue,
  values: NewCatalogRecord,
  now: Date,
): Promise<CatalogRecordRow> {
  return checked(() =>
    db.transaction(async (tx) => {
      const [record] = await tx
        .insert(catalogRecords)
        .values({ ...withCodes(values), createdAt: now, updatedAt: now })
        .returning();
      if (!record) throw new Error('catalog record insert returned nothing');
      await enqueueCatalogTranslation(tx, queue, record);
      return record;
    }),
  );
}

async function lockRecord(tx: Executor, id: string) {
  const record = await lockCatalogRecord(tx, id);
  if (!record) throw new CatalogRuleError('not-found');
  return record;
}

/** Updates a record; a changed title or description adds a revision and enqueues it. */
export async function updateCatalogRecord(
  db: Db,
  queue: JobQueue,
  id: string,
  changes: CatalogRecordChanges,
  now: Date,
): Promise<CatalogRecordRow> {
  return checked(() =>
    db.transaction(async (tx) => {
      const current = await lockRecord(tx, id);
      // The editor sends whole sections, so compare values, not presence.
      const textChanged =
        (changes.title !== undefined && changes.title !== current.title) ||
        (changes.description !== undefined && changes.description !== current.description);
      const [record] = await tx
        .update(catalogRecords)
        .set({
          ...withCodes(changes),
          updatedAt: now,
          ...(textChanged
            ? {
                revision: current.revision + 1,
                translationStatus: 'pending' as const,
                translationError: null,
                sourceLanguage: null,
              }
            : {}),
        })
        .where(eq(catalogRecords.id, id))
        .returning();
      if (!record) throw new CatalogRuleError('not-found');
      if (textChanged) await enqueueCatalogTranslation(tx, queue, record);
      return record;
    }),
  );
}

/** Stamps verified_at for the whole record (re-verifying stamps it again). */
export async function markVerified(
  db: Executor,
  id: string,
  by: string | null,
  now: Date,
): Promise<CatalogRecordRow> {
  const [record] = await db
    .update(catalogRecords)
    .set({ verifiedAt: now, verifiedBy: by, updatedAt: now })
    .where(eq(catalogRecords.id, id))
    .returning();
  if (!record) throw new CatalogRuleError('not-found');
  return record;
}

/** Locks the record, checks that its kind takes these rows, and touches it. */
async function replaceRows(
  db: Db,
  recordId: string,
  now: Date,
  allowed: (record: CatalogRecordRow) => boolean,
  write: (tx: Executor) => Promise<void>,
): Promise<void> {
  await checked(() =>
    db.transaction(async (tx) => {
      const record = await lockRecord(tx, recordId);
      if (!allowed(record)) throw new CatalogRuleError('invalid-input');
      await write(tx);
      await tx
        .update(catalogRecords)
        .set({ updatedAt: now })
        .where(eq(catalogRecords.id, recordId));
    }),
  );
}

export async function replaceSeasons(
  db: Db,
  recordId: string,
  rows: SeasonInput[],
  now: Date,
): Promise<void> {
  await replaceRows(
    db,
    recordId,
    now,
    (r) => KIND_HAS_SEASONS[r.kind],
    async (tx) => {
      await tx.delete(catalogSeasons).where(eq(catalogSeasons.recordId, recordId));
      if (rows.length > 0) {
        await tx.insert(catalogSeasons).values(rows.map((row) => ({ ...row, recordId })));
      }
    },
  );
}

export async function replaceOpeningHours(
  db: Db,
  recordId: string,
  rows: OpeningHoursInput[],
  now: Date,
): Promise<void> {
  await replaceRows(
    db,
    recordId,
    now,
    (r) => KIND_HAS_HOURS[r.kind],
    async (tx) => {
      await tx.delete(catalogOpeningHours).where(eq(catalogOpeningHours.recordId, recordId));
      if (rows.length > 0) {
        await tx.insert(catalogOpeningHours).values(rows.map((row) => ({ ...row, recordId })));
      }
    },
  );
}

export async function replacePlaceImages(
  db: Db,
  recordId: string,
  rows: PlaceImageInput[],
  now: Date,
): Promise<void> {
  await replaceRows(
    db,
    recordId,
    now,
    (r) => r.kind === 'place',
    async (tx) => {
      await tx.delete(placeImages).where(eq(placeImages.recordId, recordId));
      if (rows.length > 0) {
        await tx
          .insert(placeImages)
          .values(rows.map((row, position) => ({ ...row, recordId, position })));
      }
    },
  );
}
