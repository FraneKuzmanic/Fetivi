import { describe, expect, it } from 'vitest';
import { bboxAround, haversineM, withinRadius } from './geo';

const TROGIR = { lat: 43.5169, lng: 16.2513 };
const SALDUN = { lat: 43.51046, lng: 16.25093 };

describe('haversineM', () => {
  it('measures Trogir centre to Saldun', () => {
    expect(Math.abs(haversineM(TROGIR, SALDUN) - 715)).toBeLessThanOrEqual(5);
  });

  it('is zero for the same point', () => {
    expect(haversineM(TROGIR, TROGIR)).toBe(0);
  });
});

describe('bboxAround', () => {
  it('contains the points at the radius edge on each axis', () => {
    const r = 3000;
    const box = bboxAround(TROGIR, r);
    const dLat = (r / 6_371_000) * (180 / Math.PI);
    const dLng = dLat / Math.cos((TROGIR.lat * Math.PI) / 180);
    for (const p of [
      { lat: TROGIR.lat + dLat, lng: TROGIR.lng },
      { lat: TROGIR.lat - dLat, lng: TROGIR.lng },
      { lat: TROGIR.lat, lng: TROGIR.lng + dLng },
      { lat: TROGIR.lat, lng: TROGIR.lng - dLng },
    ]) {
      expect(Math.abs(haversineM(p, TROGIR) - r)).toBeLessThan(5);
      expect(p.lat).toBeGreaterThanOrEqual(box.minLat);
      expect(p.lat).toBeLessThanOrEqual(box.maxLat);
      expect(p.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(p.lng).toBeLessThanOrEqual(box.maxLng);
    }
  });
});

describe('withinRadius', () => {
  it('keeps Saldun within 1 km and drops it at 500 m', () => {
    expect(withinRadius(SALDUN, TROGIR, 1000)).toBe(true);
    expect(withinRadius(SALDUN, TROGIR, 500)).toBe(false);
  });
});
