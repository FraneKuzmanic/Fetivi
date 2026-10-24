import { z } from 'zod';
import { SourceError } from './errors';
import { withinRadius } from './geo';
import type { SourceFetchDeps } from './osm';
import type { ImportArea, ImportedRow, ParseResult } from './types';
import { BATHING_WATER_ENDPOINT, SEEDING_LIMITS, SOURCE_LICENCES } from './vocabulary';

// The EEA bathing-water layer, which carries the Croatian authorities' official list. The
// national WFS is HTTP-only and the data.gov.hr CSVs are old HTTP files; egress allows HTTPS only.

export function bathingWaterUrl(area: ImportArea): string {
  const params = new URLSearchParams({
    geometry: `${area.centre.lng},${area.centre.lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    distance: String(Math.round(area.radiusM)),
    units: 'esriSRUnit_Meter',
    where: "countryCode='HR'",
    outFields:
      'bathingWaterIdentifier,bathingWaterName,bwWaterCategory,qualityStatus,longitude,latitude,bwProfileLink',
    returnGeometry: 'false',
    resultRecordCount: String(SEEDING_LIMITS.rowsPerSource),
    f: 'json',
  });
  return `${BATHING_WATER_ENDPOINT}?${params}`;
}

export async function fetchBathingWater(area: ImportArea, deps: SourceFetchDeps): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(bathingWaterUrl(area), {
      headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(60_000),
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

const bathingWaterResponse = z.object({
  features: z.array(
    z.object({
      attributes: z.object({
        bathingWaterIdentifier: z.string(),
        bathingWaterName: z.string().nullable(),
        bwWaterCategory: z.string().nullable(),
        qualityStatus: z.string().nullable().optional(),
        longitude: z.number().nullable(),
        latitude: z.number().nullable(),
        bwProfileLink: z.string().nullable().optional(),
      }),
    }),
  ),
  exceededTransferLimit: z.boolean().optional(),
});

/** Coastal bathing waters within the area, each a beach. ArcGIS reports errors in a 200 body. */
export function parseBathingWater(json: unknown, area: ImportArea): ParseResult {
  if (typeof json === 'object' && json !== null && 'error' in json) {
    throw new SourceError('unavailable');
  }
  const parsed = bathingWaterResponse.safeParse(json);
  if (!parsed.success) throw new SourceError('unexpected-response');
  if (parsed.data.exceededTransferLimit) throw new SourceError('too-large');
  const rows: ImportedRow[] = [];
  let skipped = 0;
  for (const { attributes: a } of parsed.data.features) {
    const name = (a.bathingWaterName ?? '').trim().slice(0, SEEDING_LIMITS.nameMax);
    if (
      a.bwWaterCategory !== 'Coastal' ||
      name === '' ||
      a.latitude === null ||
      a.longitude === null
    ) {
      skipped++;
      continue;
    }
    const location = { lat: a.latitude, lng: a.longitude };
    if (!withinRadius(location, area.centre, area.radiusM)) {
      skipped++;
      continue;
    }
    const link = a.bwProfileLink ?? null;
    rows.push({
      source: 'bathing_water',
      externalId: a.bathingWaterIdentifier,
      name,
      location,
      placeCategory: 'beach',
      licence: SOURCE_LICENCES.bathing_water,
      sourceUrl: link?.startsWith('https://') ? link : null,
      data: { quality: a.qualityStatus ?? null, waterCategory: a.bwWaterCategory },
    });
  }
  return { rows, skipped };
}
