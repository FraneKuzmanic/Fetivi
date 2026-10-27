import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { createPhotonGeocoder, GeocoderError, placeOf } from './photon';

// Shapes recorded from photon.komoot.io on 2026-10-27.
const STREET = {
  geometry: { coordinates: [16.2577232, 43.515056] as [number, number] },
  properties: {
    osm_key: 'highway',
    type: 'street',
    name: 'Gospe kraj mora',
    locality: 'Balan',
    district: 'Trogir',
    city: 'Trogir',
    country: 'Hrvatska',
    postcode: '21220',
    countrycode: 'HR',
  },
};

const CHURCH = {
  geometry: { coordinates: [16.2582896, 43.5160546] as [number, number] },
  properties: {
    osm_key: 'amenity',
    type: 'house',
    name: 'Crkva Gospe kraj mora',
    street: 'Gospe kraj mora',
    city: 'Trogir',
    country: 'Hrvatska',
    postcode: '21220',
    countrycode: 'HR',
  },
};

const TOWN = {
  geometry: { coordinates: [16.2514, 43.517] as [number, number] },
  properties: {
    osm_key: 'place',
    type: 'city',
    name: 'Trogir',
    country: 'Hrvatska',
    countrycode: 'hr',
  },
};

describe('placeOf', () => {
  it('reads a street', () => {
    expect(placeOf(STREET)).toEqual({
      label: 'Gospe kraj mora, 21220 Trogir, Hrvatska',
      addressLine: 'Gospe kraj mora',
      city: 'Trogir',
      postalCode: '21220',
      country: 'HR',
      lat: 43.515056,
      lng: 16.2577232,
    });
  });

  it('leads with the name of a building or business', () => {
    expect(placeOf(CHURCH).label).toBe(
      'Crkva Gospe kraj mora, Gospe kraj mora, 21220 Trogir, Hrvatska',
    );
    expect(placeOf(CHURCH).addressLine).toBe('Gospe kraj mora');
  });

  it('reads a town as the city with no street', () => {
    expect(placeOf(TOWN)).toMatchObject({
      label: 'Trogir, Hrvatska',
      addressLine: null,
      city: 'Trogir',
      country: 'HR',
    });
  });
});

describe('createPhotonGeocoder', () => {
  const ok = (features: unknown[]) =>
    new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200 });

  it('searches near a point with an identifying agent, and caches the answer', async () => {
    const urls: string[] = [];
    const geocoder = createPhotonGeocoder({
      userAgent: 'Fetivi/test',
      fetch: (async (url: string, init: RequestInit) => {
        urls.push(url);
        expect((init.headers as Record<string, string>)['user-agent']).toBe('Fetivi/test');
        return ok([STREET]);
      }) as Egress['fetch'],
    });
    const near = { lat: 43.517, lng: 16.2514 };
    const first = await geocoder.search('  Gospe kraj   mora ', { near });
    await geocoder.search('gospe kraj mora', { near });
    await geocoder.search('Okrug', { kind: 'settlement' });
    expect(first[0]?.city).toBe('Trogir');
    expect(urls).toEqual([
      'https://photon.komoot.io/api/?q=Gospe+kraj+mora&limit=5&lat=43.5170&lon=16.2514',
      'https://photon.komoot.io/api/?q=Okrug&limit=5&layer=city&layer=locality',
    ]);
  });

  it('turns a failed answer into a GeocoderError', async () => {
    const geocoder = createPhotonGeocoder({
      userAgent: 'Fetivi/test',
      fetch: (async () => new Response('busy', { status: 503 })) as Egress['fetch'],
    });
    await expect(geocoder.reverse(43.5, 16.2)).rejects.toBeInstanceOf(GeocoderError);
  });
});
