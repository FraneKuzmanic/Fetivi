import { writeFileSync } from 'node:fs';
import { createEgress } from '@fetivi/egress';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDb } from '../db/client';
import { catalogRecords, catalogTranslations, destinations } from '../db/schema/catalog';
import { hostPlaces, hostPlaceTranslations } from '../db/schema/host-places';
import { catalogEmbeddingText, hostPlaceEmbeddingText } from '../embeddings/store';
import { VOYAGE_HOST } from '../embeddings/vocabulary';
import { createVoyageEmbedder } from '../embeddings/voyage';
import type { FixtureRecord } from './relevance-fixtures';
import { RELEVANCE_CASES } from './relevance-fixtures';

// Dev only, run by hand (61): records the dev DB's Trogir catalog and host-added places in en, hr
// and de with their Voyage vectors, and every labelled query, into recorded/relevance-trogir.json.
// node --env-file=.env --import tsx packages/domain/src/catalog/relevance-record-cli.ts

const LANGUAGES = ['en', 'hr', 'de'] as const;
const OUT = new URL('./recorded/relevance-trogir.json', import.meta.url);

/** float32 little-endian, base64: a quarter of the JSON a number array would take. */
const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64');

const url = process.env.DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/fetivi';
const { db, pool } = createDb(url);
try {
  const embedder = createVoyageEmbedder({
    fetch: createEgress({ allowlist: [VOYAGE_HOST] }).fetch,
    apiKey: process.env.VOYAGE_API_KEY,
  });
  const [trogir] = await db.select().from(destinations).where(eq(destinations.name, 'Trogir'));
  if (!trogir) throw new Error('no Trogir destination in the dev DB');

  const catalog = await db
    .select({
      id: catalogRecords.id,
      name: catalogRecords.title,
      kind: catalogRecords.kind,
      category: catalogRecords.placeCategory,
      rainyDay: catalogRecords.rainyDay,
      language: catalogTranslations.language,
      title: catalogTranslations.title,
      body: catalogTranslations.body,
    })
    .from(catalogRecords)
    .innerJoin(
      catalogTranslations,
      and(
        eq(catalogTranslations.recordId, catalogRecords.id),
        eq(catalogTranslations.revision, catalogRecords.publishedRevision),
      ),
    )
    .where(
      and(
        eq(catalogRecords.destinationId, trogir.id),
        inArray(catalogTranslations.language, [...LANGUAGES]),
      ),
    );
  const added = await db
    .select({
      id: hostPlaces.id,
      name: hostPlaces.name,
      category: hostPlaces.placeCategory,
      language: hostPlaceTranslations.language,
      title: hostPlaceTranslations.name,
      body: hostPlaceTranslations.note,
    })
    .from(hostPlaces)
    .innerJoin(
      hostPlaceTranslations,
      and(
        eq(hostPlaceTranslations.hostPlaceId, hostPlaces.id),
        eq(hostPlaceTranslations.revision, hostPlaces.publishedRevision),
      ),
    )
    .where(
      and(isNotNull(hostPlaces.name), inArray(hostPlaceTranslations.language, [...LANGUAGES])),
    );

  const rows = [
    ...catalog.map((r) => ({
      ...r,
      kind: r.kind as FixtureRecord['kind'],
      text: catalogEmbeddingText(r),
    })),
    ...added.map((r) => ({
      ...r,
      name: r.name ?? '',
      kind: 'host_added' as const,
      rainyDay: false,
      text: hostPlaceEmbeddingText({ name: r.title, note: r.body }),
    })),
  ];
  const docs = await embedder.embed(
    rows.map((r) => r.text),
    'document',
  );
  const queryTexts = [
    ...new Set(RELEVANCE_CASES.flatMap((c) => [c.query, c.avoid].filter((t) => t !== undefined))),
  ];
  const queries = await embedder.embed(queryTexts, 'query');

  const recorded = {
    model: embedder.model,
    recordedAt: new Date().toISOString(),
    documents: rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      category: r.category,
      rainyDay: r.rainyDay,
      language: r.language,
      title: r.title,
      body: r.body,
      vector: encode(docs.vectors[i] ?? []),
    })),
    queries: Object.fromEntries(queryTexts.map((q, i) => [q, encode(queries.vectors[i] ?? [])])),
  };
  writeFileSync(OUT, `${JSON.stringify(recorded, null, 1)}\n`);
  console.log(
    JSON.stringify({
      documents: rows.length,
      queries: queryTexts.length,
      tokens: docs.tokens + queries.tokens,
    }),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
