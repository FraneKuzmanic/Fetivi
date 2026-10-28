import { describe, expect, it } from 'vitest';
import { circlePolygon } from './circle';

const TROGIR = { lat: 43.517, lng: 16.2514 };

describe('circlePolygon', () => {
  const ring = circlePolygon(TROGIR, 10).geometry.coordinates[0] ?? [];

  it('is a closed ring of 65 points', () => {
    expect(ring).toHaveLength(65);
    expect(ring.at(-1)).toEqual(ring[0]);
  });

  it('puts the north point radius/111.2 degrees above the centre', () => {
    const [lng, lat] = ring[0] ?? [0, 0];
    expect(lng).toBeCloseTo(TROGIR.lng, 6);
    expect(lat - TROGIR.lat).toBeCloseTo(10 / 111.2, 3);
  });

  it('widens the east offset by 1/cos(latitude)', () => {
    const [lng, lat] = ring[16] ?? [0, 0];
    expect(lat).toBeCloseTo(TROGIR.lat, 2);
    expect(lng - TROGIR.lng).toBeCloseTo(10 / 111.2 / Math.cos((TROGIR.lat * Math.PI) / 180), 3);
  });
});
