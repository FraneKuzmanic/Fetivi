# Recorded seeding extracts

Real responses from the three open-data sources catalog seeding imports, fetched once on **2026-10-24 at 09:35–09:36 UTC** for Trogir: the `TROGIR` fixture centre (43.5167, 16.2516), radius **3 000 m** (`TROGIR_AREA` in `../testing.ts`). The parser, dedupe, import and job tests run on these files and never reach the network.

| File | Source | What it holds |
| --- | --- | --- |
| `overpass-trogir.json` | OpenStreetMap, Overpass API (`POST https://overpass-api.de/api/interpreter`, the query `overpassQuery(TROGIR_AREA)` builds) | 242 elements (OSM base 2026-10-24T09:34:51Z). The parser keeps 187 and skips 55 (unnamed, or outside the radius). Includes the Šaldun beach as both a node and a way. |
| `bathing-water-trogir.json` | EEA bathing-water layer, `BATHING_WATER_ENDPOINT` with the parameters of `bathingWaterUrl(TROGIR_AREA)` | 11 coastal bathing waters, all "Excellent" for the 2025 season (e.g. Saldun `HRBWC-COAST-HR4-2072`, Tri sestrice, Brigi). |
| `overture-trogir.json` | Overture Maps Places, release `2026-10-21.0`, read with `readOvertureRows(TROGIR_AREA, …)` (24 HTTPS range requests, about 4 MB) | A trimmed extract: 334 rows. The parser keeps 123 and skips 211. |

`overpass-trogir.json` and `bathing-water-trogir.json` are as served, then formatted with Biome. `overture-trogir.json` is `JSON.stringify(rows.map(toJsonSafe))` of the rows read (8 551 rows in the touched row groups, 1 260 within 3 km), trimmed to: the 300 rows nearest the centre (all within 295 m, the old town), every other `basic_category = 'beach'` row within 3 km (14), and the first 20 rows beyond 3 km (so radius skipping is exercised). No row is edited.

## Re-recording

The one-off script lives untracked in `.scratch/build/record-seeding-41.ts`. Its core, run from `packages/domain` with `node --import tsx <script> osm bathing overture`:

```ts
const area = { centre: { lat: 43.5167, lng: 16.2516 }, radiusM: 3000 };
const UA = 'Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)';
// OSM: one query; if overpass-api.de answers 429/502, wait and retry by hand.
await fetch(OVERPASS_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
  body: `data=${encodeURIComponent(overpassQuery(area))}`,
}); // → overpass-trogir.json
await fetch(bathingWaterUrl(area), { headers: { 'User-Agent': UA } }); // → bathing-water-trogir.json
const rows = await readOvertureRows(area, { fetch });
JSON.stringify(rows.map(toJsonSafe)); // → trim as above → overture-trogir.json
```

Then run `pnpm biome format --write packages/domain/src/catalog/seeding/recorded`, update the date and counts above, and the expected values in `osm.test.ts`, `bathing-water.test.ts`, `overture.test.ts` and `dedupe.test.ts`.

## Licences

- OpenStreetMap: ODbL 1.0, "© OpenStreetMap contributors". Share-alike, which is why these fields stay in `place_open_data_sources` and never reach curated columns.
- EEA bathing waters: CC BY 4.0, "EEA; bathing waters data and coordinates: member states authorities".
- Overture Maps Places: per row, in `sources[].license` (CDLA-Permissive-2.0, Apache-2.0 for Foursquare's rows, CC0-1.0); "© Overture Maps Foundation". Overture Places contains no OSM data.
