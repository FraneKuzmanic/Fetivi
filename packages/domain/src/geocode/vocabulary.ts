// Address search for the host's property form. Browser-safe: the web app imports the place type.

/** The public Photon instance (komoot): OSM data, no key, search as you type is allowed. */
export const GEOCODER_HOSTS = ['photon.komoot.io'] as const;

/** One address or place a host can pick; coordinates are WGS84. */
export interface GeoPlace {
  /** One line to show in the suggestions, e.g. "Gospe kraj mora, 21220 Trogir, Hrvatska". */
  label: string;
  /** Street and house number, when the result is an address or a street. */
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  lat: number;
  lng: number;
}

/** An address anywhere, or only a town or village (the City field). */
export const GEOCODE_KINDS = ['address', 'settlement'] as const;
export type GeocodeKind = (typeof GEOCODE_KINDS)[number];

export const GEOCODE_LIMITS = { queryMin: 3, queryMax: 200, results: 5 } as const;
