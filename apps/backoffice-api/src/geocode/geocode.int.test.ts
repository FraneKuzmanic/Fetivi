import { type Geocoder, GeocoderError, type GeoPlace } from '@fetivi/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

const PLACE: GeoPlace = {
  label: 'Gospe kraj mora, 21220 Trogir, Hrvatska',
  addressLine: 'Gospe kraj mora',
  city: 'Trogir',
  postalCode: '21220',
  country: 'HR',
  lat: 43.515056,
  lng: 16.2577232,
};

const searches: { query: string; options: Parameters<Geocoder['search']>[1] }[] = [];
let failing = false;

const geocoder: Geocoder = {
  search: async (query, options) => {
    if (failing) throw new GeocoderError('down');
    searches.push({ query, options });
    return [PLACE];
  },
  reverse: async () => PLACE,
};

let t: TestApp;
let bare: TestApp;
let hostCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp({ geocoder });
  bare = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
  await bare?.close();
});

describe('address search', () => {
  it('finds places near a point for a host', async () => {
    const response = await get(
      t.app,
      '/api/geocode?q=Gospe%20kraj%20mora&lat=43.517&lng=16.2514',
      hostCookie,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ places: [PLACE] });
    expect(searches.at(-1)).toEqual({
      query: 'Gospe kraj mora',
      options: { near: { lat: 43.517, lng: 16.2514 }, kind: 'address' },
    });
    await get(t.app, '/api/geocode?q=Okrug&kind=settlement', hostCookie);
    expect(searches.at(-1)?.options?.kind).toBe('settlement');
  });

  it('reads the address at a point', async () => {
    const response = await get(t.app, '/api/geocode/reverse?lat=43.5&lng=16.25', hostCookie);
    expect(response.json()).toEqual({ place: PLACE });
  });

  it('serves an admin too, for the catalog map picker', async () => {
    const search = await get(t.app, '/api/geocode?q=Trogir&kind=settlement', adminCookie);
    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual({ places: [PLACE] });
    const reverse = await get(t.app, '/api/geocode/reverse?lat=43.5&lng=16.25', adminCookie);
    expect(reverse.statusCode).toBe(200);
  });

  it('refuses a too short query, an anonymous caller, and says when the geocoder is down or off', async () => {
    expect((await get(t.app, '/api/geocode?q=ab', hostCookie)).statusCode).toBe(400);
    expect((await get(t.app, '/api/geocode?q=Trogir')).statusCode).toBe(401);
    expect((await get(t.app, '/api/geocode/reverse?lat=43.5&lng=16.25')).statusCode).toBe(401);
    failing = true;
    const down = await get(t.app, '/api/geocode?q=Trogir', hostCookie);
    failing = false;
    expect(down.statusCode).toBe(502);
    expect(down.json()).toEqual({ error: 'geocoder-unavailable' });

    await signUpVerifiedHost(bare, 'other@example.test');
    const other = await loginAs(bare, 'other@example.test');
    expect((await get(bare.app, '/api/geocode?q=Trogir', other)).statusCode).toBe(503);
  });
});
