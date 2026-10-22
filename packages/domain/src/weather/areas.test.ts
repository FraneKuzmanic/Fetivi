import { describe, expect, it } from 'vitest';
import {
  haversineKm,
  nearest,
  normaliseStation,
  SEA_STATIONS,
  UV_STATIONS,
  warningAreasAt,
} from './areas';

const TROGIR = { lat: 43.5167, lng: 16.2511 };
const ZAGREB = { lat: 45.815, lng: 15.982 };

describe('weather areas', () => {
  it('puts Trogir in Splitsko-dalmatinska and Middle Dalmatia', () => {
    expect(warningAreasAt(TROGIR)).toEqual(['HR027', 'HR805']);
  });

  it('knows no warning area inland, so warnings are unknown there', () => {
    expect(warningAreasAt(ZAGREB)).toBeNull();
  });

  it('finds Split as the nearest sea station to Trogir', () => {
    expect(nearest(SEA_STATIONS, TROGIR, 60)?.name).toBe('Split');
  });

  it('finds no sea station within the cap inland', () => {
    expect(nearest(SEA_STATIONS, ZAGREB, 60)).toBeNull();
  });

  it('includes the extra UV stations', () => {
    expect(UV_STATIONS.map((s) => s.name)).toContain('Hvar');
  });

  it('matches station names without diacritics', () => {
    expect(normaliseStation('Mali Losinj')).toBe(normaliseStation('Mali Lošinj'));
    expect(normaliseStation('  Šibenik ')).toBe('sibenik');
  });

  it('measures distance on the sphere', () => {
    // Trogir to Split is about 15 km.
    expect(haversineKm(TROGIR, { lat: 43.51, lng: 16.44 })).toBeCloseTo(15.3, 0);
  });
});
