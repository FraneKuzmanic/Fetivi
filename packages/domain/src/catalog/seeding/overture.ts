import type { Egress } from '@fetivi/egress';
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { z } from 'zod';
import type { PlaceCategory } from '../vocabulary';
import { SourceError } from './errors';
import { type Bbox, bboxAround, withinRadius } from './geo';
import type { ImportArea, ImportedRow, ParseResult } from './types';
import {
  OVERTURE_CATEGORY_KEYWORDS,
  OVERTURE_EXCLUDED_KEYWORDS,
  OVERTURE_STAC_ROOT,
  SEEDING_LIMITS,
  SOURCE_LICENCES,
} from './vocabulary';

// Overture Maps Places, read as GeoParquet over HTTPS range requests: the STAC catalog names the
// files, and only the row groups whose bbox statistics touch the destination are read.

type Fetch = Egress['fetch'];

/**
 * A fetch that refuses a ranged request answered with anything but 206, so hyparquet never falls
 * back to downloading a whole 700 MB file.
 */
export function rangeOnlyFetch(fetch: Fetch): Fetch {
  return async (url, init) => {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new SourceError('unavailable');
    }
    const ranged = new Headers(init?.headers).has('Range');
    if (ranged && response.status !== 206) {
      await response.body?.cancel();
      throw new SourceError('unavailable');
    }
    return response;
  };
}

/** A fetch that names Fetivi in every request's User-Agent, ranged ones included. */
export function withUserAgent(fetch: Fetch, userAgent: string): Fetch {
  return (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', userAgent);
    return fetch(url, { ...init, headers });
  };
}

async function getJson(fetch: Fetch, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SourceError('unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceError('unavailable');
  }
  try {
    return await response.json();
  } catch {
    throw new SourceError('unexpected-response');
  }
}

function parseWith<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new SourceError('unexpected-response');
  return parsed.data;
}

const stacRoot = z.object({ latest: z.string().regex(/^[\w.-]+$/) });
const stacCollection = z.object({
  links: z.array(z.object({ rel: z.string(), href: z.string() })),
});
const stacItem = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  properties: z.record(z.string(), z.unknown()).optional(),
  assets: z.object({
    aws: z.object({ href: z.string(), 'file:size': z.number().optional() }),
  }),
});

export interface OvertureFile {
  url: string;
  byteLength: number | undefined;
}

const intersects = (a: Bbox, [minLng, minLat, maxLng, maxLat]: readonly number[]) =>
  (minLng ?? Infinity) <= a.maxLng &&
  (maxLng ?? -Infinity) >= a.minLng &&
  (minLat ?? Infinity) <= a.maxLat &&
  (maxLat ?? -Infinity) >= a.minLat;

/** The latest release's place files whose bbox touches the area. */
export async function findOvertureFiles(
  area: ImportArea,
  deps: { fetch: Fetch },
): Promise<{ release: string; files: OvertureFile[] }> {
  const { latest } = parseWith(stacRoot, await getJson(deps.fetch, OVERTURE_STAC_ROOT));
  const collectionUrl = new URL(`${latest}/places/place/collection.json`, OVERTURE_STAC_ROOT);
  const collection = parseWith(stacCollection, await getJson(deps.fetch, collectionUrl.href));
  const box = bboxAround(area.centre, area.radiusM);
  const files: OvertureFile[] = [];
  for (const link of collection.links.filter((l) => l.rel === 'item')) {
    const itemUrl = new URL(link.href, collectionUrl).href;
    const item = parseWith(stacItem, await getJson(deps.fetch, itemUrl));
    if (!intersects(box, item.bbox)) continue;
    const size = item.properties?.['file:size'];
    files.push({
      url: item.assets.aws.href,
      byteLength: typeof size === 'number' ? size : item.assets.aws['file:size'],
    });
  }
  return { release: latest, files };
}

/** The slice of parquet metadata `rowGroupsInBbox` reads (hyparquet's `FileMetaData`). */
export interface RowGroupMetadata {
  row_groups: {
    num_rows: bigint | number;
    columns: {
      meta_data?: {
        path_in_schema: string[];
        statistics?: { min_value?: unknown; max_value?: unknown };
      };
    }[];
  }[];
}

export interface RowGroupRange {
  index: number;
  rowStart: number;
  rowEnd: number;
}

/** Row groups whose bbox column statistics touch `bbox`; a group without statistics is kept. */
export function rowGroupsInBbox(metadata: RowGroupMetadata, bbox: Bbox): RowGroupRange[] {
  const out: RowGroupRange[] = [];
  let rowStart = 0;
  metadata.row_groups.forEach((group, index) => {
    const rowEnd = rowStart + Number(group.num_rows);
    const stat = (field: string, which: 'min_value' | 'max_value'): number | null => {
      const column = group.columns.find(
        (c) => c.meta_data?.path_in_schema.join('.') === `bbox.${field}`,
      );
      const value = column?.meta_data?.statistics?.[which];
      return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : null;
    };
    const xmin = stat('xmin', 'min_value');
    const xmax = stat('xmax', 'max_value');
    const ymin = stat('ymin', 'min_value');
    const ymax = stat('ymax', 'max_value');
    const noStats = xmin === null || xmax === null || ymin === null || ymax === null;
    if (
      noStats ||
      (xmin <= bbox.maxLng && xmax >= bbox.minLng && ymin <= bbox.maxLat && ymax >= bbox.minLat)
    ) {
      out.push({ index, rowStart, rowEnd });
    }
    rowStart = rowEnd;
  });
  if (out.length > SEEDING_LIMITS.overtureRowGroups) throw new SourceError('too-large');
  return out;
}

const OVERTURE_COLUMNS = [
  'id',
  'names',
  'basic_category',
  'taxonomy',
  'confidence',
  'websites',
  'socials',
  'phones',
  'addresses',
  'sources',
  'operating_status',
  'bbox',
];

/** Plain rows of the place files' row groups around the area (BigInts not yet converted). */
export async function readOvertureRows(
  area: ImportArea,
  deps: { fetch: Fetch },
): Promise<Record<string, unknown>[]> {
  const { files } = await findOvertureFiles(area, deps);
  const box = bboxAround(area.centre, area.radiusM);
  const rows: Record<string, unknown>[] = [];
  try {
    for (const { url, byteLength } of files) {
      const ranged = rangeOnlyFetch(deps.fetch);
      const file = await asyncBufferFromUrl({
        url,
        byteLength,
        // hyparquet passes the URL string; a Request never reaches here.
        fetch: (input, init) => ranged(input instanceof Request ? input.url : input, init),
      });
      const metadata = await parquetMetadataAsync(file);
      for (const group of rowGroupsInBbox(metadata, box)) {
        const objects = await parquetReadObjects({
          file,
          metadata,
          columns: OVERTURE_COLUMNS,
          rowStart: group.rowStart,
          rowEnd: group.rowEnd,
          compressors,
        });
        rows.push(...objects);
      }
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError('unavailable');
  }
  return rows;
}

/** A copy safe for jsonb: BigInts become numbers, typed arrays and dates become plain values. */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

const num = (v: unknown): number | null =>
  typeof v === 'number' || typeof v === 'bigint' ? Number(v) : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function overtureCategory(row: Record<string, unknown>): PlaceCategory | null {
  const basic = typeof row.basic_category === 'string' ? row.basic_category : null;
  const primary = obj(row.taxonomy)?.primary;
  // Whole words only, so "bar" never matches "barber".
  const values = [basic, typeof primary === 'string' ? primary : null]
    .filter((v): v is string => !!v)
    .map((v) => `_${v.toLowerCase()}_`);
  const has = (words: string, match: string) => words.includes(`_${match}_`);
  if (values.some((words) => OVERTURE_EXCLUDED_KEYWORDS.some((m) => has(words, m)))) return null;
  for (const words of values) {
    for (const { match, category } of OVERTURE_CATEGORY_KEYWORDS) {
      if (has(words, match)) return category;
    }
  }
  return null;
}

/** Open places of mapped categories within the area, at or above the confidence floor. */
export function parseOvertureRows(rows: readonly unknown[], area: ImportArea): ParseResult {
  const kept: ImportedRow[] = [];
  let skipped = 0;
  for (const raw of rows) {
    const row = obj(raw);
    const bbox = obj(row?.bbox);
    const id = row?.id;
    const xmin = num(bbox?.xmin);
    const xmax = num(bbox?.xmax);
    const ymin = num(bbox?.ymin);
    const ymax = num(bbox?.ymax);
    const name = obj(row?.names)?.primary;
    const confidence = num(row?.confidence);
    const status = row?.operating_status;
    if (
      !row ||
      typeof id !== 'string' ||
      xmin === null ||
      xmax === null ||
      ymin === null ||
      ymax === null ||
      typeof name !== 'string' ||
      name.trim() === '' ||
      confidence === null ||
      confidence < SEEDING_LIMITS.overtureMinConfidence ||
      (status !== null && status !== undefined && status !== 'open') ||
      kept.length >= SEEDING_LIMITS.rowsPerSource
    ) {
      skipped++;
      continue;
    }
    const location = { lat: (ymin + ymax) / 2, lng: (xmin + xmax) / 2 };
    const placeCategory = overtureCategory(row);
    if (!placeCategory || !withinRadius(location, area.centre, area.radiusM)) {
      skipped++;
      continue;
    }
    const sources = Array.isArray(row.sources) ? row.sources : [];
    const licence = obj(sources[0])?.license;
    kept.push({
      source: 'overture',
      externalId: id,
      name: name.trim().slice(0, SEEDING_LIMITS.nameMax),
      location,
      placeCategory,
      licence: typeof licence === 'string' && licence !== '' ? licence : SOURCE_LICENCES.overture,
      sourceUrl: null,
      data: toJsonSafe({
        names: row.names ?? null,
        basic_category: row.basic_category ?? null,
        taxonomy: row.taxonomy ?? null,
        confidence,
        websites: row.websites ?? null,
        socials: row.socials ?? null,
        phones: row.phones ?? null,
        addresses: row.addresses ?? null,
        sources: row.sources ?? null,
      }) as Record<string, unknown>,
    });
  }
  return { rows: kept, skipped };
}
