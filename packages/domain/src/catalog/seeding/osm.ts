import type { Egress } from '@fetivi/egress';
import { z } from 'zod';
import type { PlaceCategory } from '../vocabulary';
import { SourceError } from './errors';
import { withinRadius } from './geo';
import type { ImportArea, ImportedRow, ParseResult } from './types';
import {
  OSM_CATEGORY_RULES,
  OVERPASS_ENDPOINT,
  SEEDING_LIMITS,
  SOURCE_LICENCES,
} from './vocabulary';

// OpenStreetMap through the public Overpass API: one query per import, never retried here
// (usage policy). Overloaded answers (429/502/504) are a source failure, not a crash.

export interface SourceFetchDeps {
  fetch: Egress['fetch'];
  userAgent: string;
}

/** One `nwr(around:…)[key~"^(v1|v2)$"]` line per tag key in the category rules. */
export function overpassQuery(area: ImportArea): string {
  const valuesByKey = new Map<string, string[]>();
  for (const rule of OSM_CATEGORY_RULES) {
    valuesByKey.set(rule.key, [...(valuesByKey.get(rule.key) ?? []), ...rule.values]);
  }
  const around = `around:${Math.round(area.radiusM)},${area.centre.lat},${area.centre.lng}`;
  const lines = [...valuesByKey].map(
    ([key, values]) => `  nwr(${around})["${key}"~"^(${values.join('|')})$"];`,
  );
  return `[out:json][timeout:60];\n(\n${lines.join('\n')}\n);\nout center tags;`;
}

export async function fetchOverpass(area: ImportArea, deps: SourceFetchDeps): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': deps.userAgent,
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(overpassQuery(area))}`,
      signal: AbortSignal.timeout(90_000),
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

const overpassResponse = z.object({
  elements: z.array(
    z.object({
      type: z.enum(['node', 'way', 'relation']),
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

function osmCategory(tags: Record<string, string>): PlaceCategory | null {
  for (const rule of OSM_CATEGORY_RULES) {
    const value = tags[rule.key];
    if (value !== undefined && rule.values.includes(value)) return rule.category;
  }
  return null;
}

/** Named, categorised elements within the area; the rest are counted as skipped. */
export function parseOverpass(json: unknown, area: ImportArea): ParseResult {
  const parsed = overpassResponse.safeParse(json);
  if (!parsed.success) throw new SourceError('unexpected-response');
  const rows: ImportedRow[] = [];
  let skipped = 0;
  for (const el of parsed.data.elements) {
    const tags = el.tags ?? {};
    const point =
      el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : el.center;
    const name = (tags.name ?? tags['name:hr'] ?? '').trim().slice(0, SEEDING_LIMITS.nameMax);
    const placeCategory = osmCategory(tags);
    if (!point || name === '' || !placeCategory || rows.length >= SEEDING_LIMITS.rowsPerSource) {
      skipped++;
      continue;
    }
    const location = { lat: point.lat, lng: point.lon };
    if (!withinRadius(location, area.centre, area.radiusM)) {
      skipped++;
      continue;
    }
    rows.push({
      source: 'osm',
      externalId: `${el.type}/${el.id}`,
      name,
      location,
      placeCategory,
      licence: SOURCE_LICENCES.osm,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      data: { tags },
    });
  }
  return { rows, skipped };
}
