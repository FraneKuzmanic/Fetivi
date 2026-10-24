import { describe, expect, it } from 'vitest';
import { bathingWaterUrl, parseBathingWater } from './bathing-water';
import { SourceError } from './errors';
import { readRecorded, TROGIR_AREA } from './testing';

const recorded = readRecorded('bathing_water') as {
  features: { attributes: Record<string, unknown> }[];
};

describe('bathingWaterUrl', () => {
  it('queries a point buffer in metres, Croatian waters only', () => {
    const url = new URL(bathingWaterUrl(TROGIR_AREA));
    expect(url.hostname).toBe('marine.discomap.eea.europa.eu');
    expect(url.searchParams.get('geometry')).toBe('16.2516,43.5167');
    expect(url.searchParams.get('distance')).toBe('3000');
    expect(url.searchParams.get('units')).toBe('esriSRUnit_Meter');
    expect(url.searchParams.get('where')).toBe("countryCode='HR'");
    expect(url.searchParams.get('f')).toBe('json');
  });
});

describe('parseBathingWater', () => {
  const { rows, skipped } = parseBathingWater(recorded, TROGIR_AREA);

  it('keeps every coastal bathing water of the recording', () => {
    expect(rows).toHaveLength(11);
    expect(skipped).toBe(0);
  });

  it('maps Saldun to a beach with its quality and profile link', () => {
    expect(rows.find((r) => r.externalId === 'HRBWC-COAST-HR4-2072')).toEqual({
      source: 'bathing_water',
      externalId: 'HRBWC-COAST-HR4-2072',
      name: 'Saldun',
      location: { lat: 43.51046, lng: 16.25093 },
      placeCategory: 'beach',
      licence: 'CC-BY-4.0',
      sourceUrl: 'https://vrtlac.izor.hr/ords/kakvoca/profil_plaze_url?p_jezik=eng&plok=2072',
      data: { quality: 'Excellent', waterCategory: 'Coastal' },
    });
  });

  it('skips inland waters and drops a profile link that is not https', () => {
    const [first, second] = recorded.features;
    const json = {
      features: [
        { attributes: { ...first?.attributes, bwWaterCategory: 'Lake' } },
        { attributes: { ...second?.attributes, bwProfileLink: 'http://example.test/p' } },
      ],
    };
    const result = parseBathingWater(json, TROGIR_AREA);
    expect(result.skipped).toBe(1);
    expect(result.rows[0]?.sourceUrl).toBeNull();
  });

  it('fails as too large when the service truncated the answer', () => {
    expect(() =>
      parseBathingWater({ ...recorded, exceededTransferLimit: true }, TROGIR_AREA),
    ).toThrow(expect.objectContaining({ failure: 'too-large' }));
  });

  it('fails as unavailable on an ArcGIS error body', () => {
    expect(() => parseBathingWater({ error: { code: 500, message: 'x' } }, TROGIR_AREA)).toThrow(
      expect.objectContaining({ failure: 'unavailable' }),
    );
    expect(() => parseBathingWater({ nope: 1 }, TROGIR_AREA)).toThrow(SourceError);
  });
});
