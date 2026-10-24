import type { PlaceCategory } from '../vocabulary';
import type { LatLng } from './geo';
import type { SeedingSource } from './vocabulary';

/** The destination area an import is bounded by. */
export interface ImportArea {
  centre: LatLng;
  radiusM: number;
}

/** One place as one open-data source lists it, ready to upsert into place_open_data_sources. */
export interface ImportedRow {
  source: SeedingSource;
  externalId: string;
  name: string;
  location: LatLng;
  placeCategory: PlaceCategory;
  licence: string;
  sourceUrl: string | null;
  data: Record<string, unknown>;
}

/** A parser's kept rows, and how many it skipped (unnamed, unmapped, out of the area, over cap). */
export interface ParseResult {
  rows: ImportedRow[];
  skipped: number;
}
