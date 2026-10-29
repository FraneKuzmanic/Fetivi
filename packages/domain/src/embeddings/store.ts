import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { type Db, type Executor, pgCode } from '../db/client';
import { catalogRecords, catalogTranslations } from '../db/schema/catalog';
import { catalogEmbeddings, hostPlaceEmbeddings } from '../db/schema/embeddings';
import { hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
import { type JobQueue, QUEUES, uuidFrom } from '../jobs/queue';
import type { GuestLanguage } from '../property/vocabulary';
import { EMBEDDING_LIMITS } from './vocabulary';
import { type Embedder, EmbeddingNotConfiguredError } from './voyage';

// Search vectors of published text (ticket 61). A job embeds a translation when its revision is
// published; the backfill embeds whatever is still missing for the current model. Texts are
// never logged.

export type EmbeddingDeps = { db: Db; embedder: Embedder };

export type EmbeddingRunResult = 'embedded' | 'nothing-to-do' | 'discarded' | 'not-configured';

export interface CatalogEmbeddingJobData {
  recordId: string;
  revision: number;
}

export interface HostPlaceEmbeddingJobData {
  hostPlaceId: string;
  revision: number;
}

/** What is embedded of a catalog translation. */
export const catalogEmbeddingText = (t: { title: string; body: string }) =>
  `${t.title}\n\n${t.body}`;

/** What is embedded of a host-added place's translation. */
export const hostPlaceEmbeddingText = (t: { name: string; note: string }) =>
  `${t.name}\n\n${t.note}`;

/** Enqueues embedding of a record's newly published revision inside `tx`. */
export async function enqueueCatalogEmbedding(
  tx: Executor,
  queue: JobQueue,
  record: { id: string; revision: number },
): Promise<void> {
  const data: CatalogEmbeddingJobData = { recordId: record.id, revision: record.revision };
  await queue.send(QUEUES.embedCatalogRecord, data, tx, {
    id: uuidFrom(`embed:catalog:${record.id}:${record.revision}`),
  });
}

/** Enqueues embedding of a host-added place's newly published revision inside `tx`. */
export async function enqueueHostPlaceEmbedding(
  tx: Executor,
  queue: JobQueue,
  row: { id: string; revision: number },
): Promise<void> {
  const data: HostPlaceEmbeddingJobData = { hostPlaceId: row.id, revision: row.revision };
  await queue.send(QUEUES.embedHostPlace, data, tx, {
    id: uuidFrom(`embed:host-place:${row.id}:${row.revision}`),
  });
}

interface Pending {
  language: GuestLanguage;
  text: string;
}

/**
 * Embeds `pending` and stores each vector with `insert`. Without a key the run ends quietly (the
 * backfill covers it later); any other failure throws so pg-boss retries. A revision deleted
 * meanwhile (a newer publish) violates the foreign key: discarded.
 */
async function embedAndStore(
  embedder: Embedder,
  pending: Pending[],
  insert: (rows: { language: GuestLanguage; vector: number[] }[]) => Promise<unknown>,
): Promise<{ result: EmbeddingRunResult; tokens: number }> {
  if (pending.length === 0) return { result: 'nothing-to-do', tokens: 0 };
  let embedded: { vectors: number[][]; tokens: number };
  try {
    embedded = await embedder.embed(
      pending.map((p) => p.text),
      'document',
    );
  } catch (error) {
    if (error instanceof EmbeddingNotConfiguredError) {
      return { result: 'not-configured', tokens: 0 };
    }
    throw error;
  }
  try {
    await insert(
      pending.map((p, i) => ({ language: p.language, vector: embedded.vectors[i] ?? [] })),
    );
  } catch (error) {
    if (pgCode(error) === '23503') return { result: 'discarded', tokens: embedded.tokens };
    throw error;
  }
  return { result: 'embedded', tokens: embedded.tokens };
}

/** The embed-catalog-record job: vectors for the published revision's translations that lack one. */
export async function runCatalogEmbedding(
  { db, embedder }: EmbeddingDeps,
  { recordId, revision }: CatalogEmbeddingJobData,
): Promise<{ result: EmbeddingRunResult; tokens: number }> {
  const [record] = await db
    .select({ publishedRevision: catalogRecords.publishedRevision })
    .from(catalogRecords)
    .where(eq(catalogRecords.id, recordId));
  // A newer publish has its own job.
  if (!record || record.publishedRevision !== revision) return { result: 'discarded', tokens: 0 };

  const rows = await db
    .select({
      language: catalogTranslations.language,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
    })
    .from(catalogTranslations)
    .leftJoin(
      catalogEmbeddings,
      and(
        eq(catalogEmbeddings.recordId, catalogTranslations.recordId),
        eq(catalogEmbeddings.revision, catalogTranslations.revision),
        eq(catalogEmbeddings.language, catalogTranslations.language),
        eq(catalogEmbeddings.model, embedder.model),
      ),
    )
    .where(
      and(
        eq(catalogTranslations.recordId, recordId),
        eq(catalogTranslations.revision, revision),
        isNull(catalogEmbeddings.recordId),
      ),
    );
  return embedAndStore(
    embedder,
    rows.map((r) => ({ language: r.language, text: catalogEmbeddingText(r) })),
    (vectors) =>
      db
        .insert(catalogEmbeddings)
        .values(vectors.map((v) => ({ recordId, revision, model: embedder.model, ...v })))
        .onConflictDoNothing(),
  );
}

/** The embed-host-place job; a pick (no name of its own) is not searched by its text. */
export async function runHostPlaceEmbedding(
  { db, embedder }: EmbeddingDeps,
  { hostPlaceId, revision }: HostPlaceEmbeddingJobData,
): Promise<{ result: EmbeddingRunResult; tokens: number }> {
  const [row] = await db
    .select({ publishedRevision: hostPlaces.publishedRevision, name: hostPlaces.name })
    .from(hostPlaces)
    .where(eq(hostPlaces.id, hostPlaceId));
  if (!row || row.publishedRevision !== revision) return { result: 'discarded', tokens: 0 };
  if (row.name === null) return { result: 'nothing-to-do', tokens: 0 };

  const rows = await db
    .select({
      language: hostPlaceTranslations.language,
      name: hostPlaceTranslations.name,
      note: hostPlaceTranslations.note,
    })
    .from(hostPlaceTranslations)
    .leftJoin(
      hostPlaceEmbeddings,
      and(
        eq(hostPlaceEmbeddings.hostPlaceId, hostPlaceTranslations.hostPlaceId),
        eq(hostPlaceEmbeddings.revision, hostPlaceTranslations.revision),
        eq(hostPlaceEmbeddings.language, hostPlaceTranslations.language),
        eq(hostPlaceEmbeddings.model, embedder.model),
      ),
    )
    .where(
      and(
        eq(hostPlaceTranslations.hostPlaceId, hostPlaceId),
        eq(hostPlaceTranslations.revision, revision),
        isNull(hostPlaceEmbeddings.hostPlaceId),
      ),
    );
  return embedAndStore(
    embedder,
    rows.map((r) => ({ language: r.language, text: hostPlaceEmbeddingText(r) })),
    (vectors) =>
      db
        .insert(hostPlaceEmbeddings)
        .values(vectors.map((v) => ({ hostPlaceId, revision, model: embedder.model, ...v })))
        .onConflictDoNothing(),
  );
}

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Embeds every published catalog and host-added place translation without a vector of the
 * current model. Rerunning embeds nothing new. Errors propagate: the CLI reports them.
 */
export async function backfillEmbeddings({
  db,
  embedder,
}: EmbeddingDeps): Promise<{ catalog: number; hostPlaces: number; tokens: number }> {
  const model = embedder.model;
  let tokens = 0;

  const catalogRows = await db
    .select({
      recordId: catalogTranslations.recordId,
      revision: catalogTranslations.revision,
      language: catalogTranslations.language,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
    })
    .from(catalogTranslations)
    .innerJoin(
      catalogRecords,
      and(
        eq(catalogRecords.id, catalogTranslations.recordId),
        eq(catalogRecords.publishedRevision, catalogTranslations.revision),
      ),
    )
    .leftJoin(
      catalogEmbeddings,
      and(
        eq(catalogEmbeddings.recordId, catalogTranslations.recordId),
        eq(catalogEmbeddings.revision, catalogTranslations.revision),
        eq(catalogEmbeddings.language, catalogTranslations.language),
        eq(catalogEmbeddings.model, model),
      ),
    )
    .where(isNull(catalogEmbeddings.recordId));
  for (const batch of batches(catalogRows, EMBEDDING_LIMITS.batchSize)) {
    const { vectors, tokens: used } = await embedder.embed(
      batch.map(catalogEmbeddingText),
      'document',
    );
    tokens += used;
    await db
      .insert(catalogEmbeddings)
      .values(
        batch.map((r, i) => ({
          recordId: r.recordId,
          revision: r.revision,
          language: r.language,
          model,
          vector: vectors[i] ?? [],
        })),
      )
      .onConflictDoNothing();
  }

  const hostRows = await db
    .select({
      hostPlaceId: hostPlaceTranslations.hostPlaceId,
      revision: hostPlaceTranslations.revision,
      language: hostPlaceTranslations.language,
      name: hostPlaceTranslations.name,
      note: hostPlaceTranslations.note,
    })
    .from(hostPlaceTranslations)
    .innerJoin(
      hostPlaces,
      and(
        eq(hostPlaces.id, hostPlaceTranslations.hostPlaceId),
        eq(hostPlaces.publishedRevision, hostPlaceTranslations.revision),
      ),
    )
    .leftJoin(
      hostPlaceEmbeddings,
      and(
        eq(hostPlaceEmbeddings.hostPlaceId, hostPlaceTranslations.hostPlaceId),
        eq(hostPlaceEmbeddings.revision, hostPlaceTranslations.revision),
        eq(hostPlaceEmbeddings.language, hostPlaceTranslations.language),
        eq(hostPlaceEmbeddings.model, model),
      ),
    )
    .where(and(isNotNull(hostPlaces.name), isNull(hostPlaceEmbeddings.hostPlaceId)));
  for (const batch of batches(hostRows, EMBEDDING_LIMITS.batchSize)) {
    const { vectors, tokens: used } = await embedder.embed(
      batch.map(hostPlaceEmbeddingText),
      'document',
    );
    tokens += used;
    await db
      .insert(hostPlaceEmbeddings)
      .values(
        batch.map((r, i) => ({
          hostPlaceId: r.hostPlaceId,
          revision: r.revision,
          language: r.language,
          model,
          vector: vectors[i] ?? [],
        })),
      )
      .onConflictDoNothing();
  }

  return { catalog: catalogRows.length, hostPlaces: hostRows.length, tokens };
}

/** A record's published texts and current-model vectors, as search scores them. */
export interface SearchTexts {
  titles: string[];
  /** Every title and body (or name and note) of every language. */
  texts: string[];
  /** One per embedded translation; empty when not embedded yet. */
  vectors: number[][];
}

function entry(map: Map<string, SearchTexts>, id: string): SearchTexts {
  let e = map.get(id);
  if (!e) {
    e = { titles: [], texts: [], vectors: [] };
    map.set(id, e);
  }
  return e;
}

/** Published texts and `model` vectors of catalog records `ids`. */
export async function catalogSearchTexts(
  db: Executor,
  ids: string[],
  model: string,
): Promise<Map<string, SearchTexts>> {
  const map = new Map<string, SearchTexts>();
  if (ids.length === 0) return map;
  const published = and(
    eq(catalogRecords.id, catalogTranslations.recordId),
    eq(catalogRecords.publishedRevision, catalogTranslations.revision),
  );
  const translations = await db
    .select({
      id: catalogTranslations.recordId,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
    })
    .from(catalogTranslations)
    .innerJoin(catalogRecords, published)
    .where(inArray(catalogTranslations.recordId, ids));
  for (const t of translations) {
    const e = entry(map, t.id);
    e.titles.push(t.title);
    e.texts.push(t.title, t.body);
  }
  const vectors = await db
    .select({ id: catalogEmbeddings.recordId, vector: catalogEmbeddings.vector })
    .from(catalogEmbeddings)
    .innerJoin(
      catalogRecords,
      and(
        eq(catalogRecords.id, catalogEmbeddings.recordId),
        eq(catalogRecords.publishedRevision, catalogEmbeddings.revision),
      ),
    )
    .where(and(inArray(catalogEmbeddings.recordId, ids), eq(catalogEmbeddings.model, model)));
  for (const v of vectors) entry(map, v.id).vectors.push(v.vector);
  return map;
}

/** Published names, notes and `model` vectors of host-added places `ids`. */
export async function hostPlaceSearchTexts(
  db: Executor,
  ids: string[],
  model: string,
): Promise<Map<string, SearchTexts>> {
  const map = new Map<string, SearchTexts>();
  if (ids.length === 0) return map;
  const translations = await db
    .select({
      id: hostPlaceTranslations.hostPlaceId,
      name: hostPlaceTranslations.name,
      note: hostPlaceTranslations.note,
    })
    .from(hostPlaceTranslations)
    .innerJoin(
      hostPlaces,
      and(
        eq(hostPlaces.id, hostPlaceTranslations.hostPlaceId),
        eq(hostPlaces.publishedRevision, hostPlaceTranslations.revision),
      ),
    )
    .where(inArray(hostPlaceTranslations.hostPlaceId, ids));
  for (const t of translations) {
    const e = entry(map, t.id);
    e.titles.push(t.name);
    e.texts.push(t.name, t.note);
  }
  const vectors = await db
    .select({ id: hostPlaceEmbeddings.hostPlaceId, vector: hostPlaceEmbeddings.vector })
    .from(hostPlaceEmbeddings)
    .innerJoin(
      hostPlaces,
      and(
        eq(hostPlaces.id, hostPlaceEmbeddings.hostPlaceId),
        eq(hostPlaces.publishedRevision, hostPlaceEmbeddings.revision),
      ),
    )
    .where(
      and(inArray(hostPlaceEmbeddings.hostPlaceId, ids), eq(hostPlaceEmbeddings.model, model)),
    );
  for (const v of vectors) entry(map, v.id).vectors.push(v.vector);
  return map;
}
