import { readFileSync } from 'node:fs';
import { parseBathingWater } from './bathing-water';
import { parseOverpass } from './osm';
import { parseOvertureRows } from './overture';
import type { ImportArea, ParseResult } from './types';
import type { SeedingSource } from './vocabulary';

/** The area the recorded extracts were fetched for: the `TROGIR` fixture centre, 3 km. */
export const TROGIR_AREA: ImportArea = { centre: { lat: 43.5167, lng: 16.2516 }, radiusM: 3000 };

const FILES: Record<SeedingSource, string> = {
  osm: 'overpass-trogir.json',
  bathing_water: 'bathing-water-trogir.json',
  overture: 'overture-trogir.json',
};

/** One recorded source response, as JSON. */
export function readRecorded(source: SeedingSource): unknown {
  return JSON.parse(readFileSync(new URL(`./recorded/${FILES[source]}`, import.meta.url), 'utf8'));
}

/** Each source's recorded extract, parsed for an area (the recording's by default). */
export function parseRecorded(source: SeedingSource, area: ImportArea = TROGIR_AREA): ParseResult {
  const json = readRecorded(source);
  if (source === 'osm') return parseOverpass(json, area);
  if (source === 'bathing_water') return parseBathingWater(json, area);
  return parseOvertureRows(json as unknown[], area);
}
