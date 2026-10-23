import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replaceAboutMe } from '../about-me/store';
import { EMPTY_ABOUT_ME } from '../about-me/vocabulary';
import { catalogRecords } from '../db/schema/catalog';
import { fallbackLog } from '../db/schema/fallback';
import { spaces } from '../db/schema/spaces';
import {
  createTestDatabase,
  recordedBraveFetch,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  type TestDatabase,
  unavailableWebSearch,
} from '../testing';
import { createBraveSearch } from './brave';
import { FallbackQueryError, WebSearchUnavailableError } from './errors';
import { privateValuesOf } from './private-values';
import { normalize } from './query';
import { type WebFallbackScope, webFallbackSearch } from './search';
import { fallbackSitesFor } from './sites';
import { FALLBACK_SITES } from './vocabulary';

const NOW = new Date('2027-07-10T09:00:00Z');
const EMAIL = 'guest.fallback@example.test';

let testDb: TestDatabase;
let guest: SeededGuestUnit;
let destinationId: string;
let scope: WebFallbackScope;

const logRows = () =>
  testDb.db
    .select()
    .from(fallbackLog)
    .where(eq(fallbackLog.propertyId, guest.propertyId))
    .orderBy(fallbackLog.id);

beforeAll(async () => {
  testDb = await createTestDatabase();
  guest = await seedGuestUnit(testDb.db, { now: new Date('2027-07-08T08:00:00Z') });
  destinationId = await seedDestination(testDb.db);
  await testDb.db.update(spaces).set({ email: EMAIL }).where(eq(spaces.id, guest.spaceId));
  await replaceAboutMe(
    testDb.db,
    guest.spaceId,
    { ...EMPTY_ABOUT_ME, needs: ['gluten_free'] },
    NOW,
  );
  const note = (title: string, websiteUrl: string, published: boolean) => ({
    destinationId,
    kind: 'transport_note' as const,
    transportMode: 'ferry' as const,
    title,
    description: `${title} description`,
    websiteUrl,
    publishedRevision: published ? 1 : null,
  });
  await testDb.db
    .insert(catalogRecords)
    .values([
      note('Krka', 'https://www.np-krka.hr/', true),
      note('Facebook page', 'https://www.facebook.com/x', true),
      note('Draft', 'https://draft-venue.hr/', false),
    ]);
  scope = {
    spaceId: guest.spaceId,
    stayId: guest.stayId,
    unitId: guest.unitId,
    propertyId: guest.propertyId,
    destinationId,
  };
});

afterAll(async () => {
  await testDb?.drop();
});

describe('privateValuesOf', () => {
  it("holds the space's private values, normalized", async () => {
    const { secrets, words } = await privateValuesOf(testDb.db, scope);
    for (const value of [
      guest.pin,
      guest.secrets.doorCode,
      guest.secrets.wifiPassword,
      guest.secrets.lockboxCode,
      guest.secrets.buildingDoorCode,
      guest.secrets.hostPhone,
      guest.private.reservationNumber,
      EMAIL,
    ]) {
      expect(secrets).toContain(normalize(value));
    }
    for (const value of [guest.private.bookerName, 'gluten_free', 'gluten free']) {
      expect(words).toContain(normalize(value));
    }
    // The booker's name word by word, too.
    expect(words).toContain('booker');
  });
});

describe('fallbackSitesFor', () => {
  it("adds published venues' own sites, never shared platforms or drafts", async () => {
    const sites = await fallbackSitesFor(testDb.db, destinationId);
    expect(sites).toContainEqual({ host: 'np-krka.hr', kind: 'venue' });
    expect(sites.some((s) => s.host.includes('facebook'))).toBe(false);
    expect(sites.some((s) => s.host === 'draft-venue.hr')).toBe(false);
    expect(sites.slice(0, FALLBACK_SITES.length)).toEqual(FALLBACK_SITES);
  });

  it('is the static list outside a destination', async () => {
    expect(await fallbackSitesFor(testDb.db, null)).toEqual(FALLBACK_SITES);
  });
});

describe('webFallbackSearch', () => {
  it('returns only allowlisted https results and logs one results row', async () => {
    const fetch = recordedBraveFetch();
    const before = (await logRows()).length;
    const { results } = await webFallbackSearch(
      testDb.db,
      scope,
      { keywords: 'Kayak rental', place: 'Trogir' },
      createBraveSearch({ fetch, apiKey: 'test' }),
      NOW,
    );
    expect(fetch.urls).toHaveLength(1);
    const q = new URL(fetch.urls[0] ?? '').searchParams.get('q');
    expect(q).toContain('kayak rental trogir (site:croatia.hr OR');
    expect(q).toContain('site:np-krka.hr');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) {
      const url = new URL(r.url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname).not.toContain('tripadvisor');
    }
    const rows = await logRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({
      destinationId,
      propertyId: guest.propertyId,
      topic: 'kayak rental',
      place: 'trogir',
      outcome: 'results',
      resultCount: results.length,
      createdAt: NOW,
    });
  });

  it('rejects a door code, sends nothing and logs no text', async () => {
    const fetch = recordedBraveFetch();
    const before = (await logRows()).length;
    await expect(
      webFallbackSearch(
        testDb.db,
        scope,
        { keywords: guest.secrets.doorCode, place: 'Trogir' },
        createBraveSearch({ fetch, apiKey: 'test' }),
        NOW,
      ),
    ).rejects.toThrow(FallbackQueryError);
    expect(fetch.urls).toEqual([]);
    const rows = await logRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ outcome: 'rejected', topic: null, place: null });
  });

  it('logs an unavailable search', async () => {
    await expect(
      webFallbackSearch(
        testDb.db,
        scope,
        { keywords: 'ferry times', place: 'Split' },
        unavailableWebSearch(),
        NOW,
      ),
    ).rejects.toThrow(WebSearchUnavailableError);
    expect((await logRows()).at(-1)).toMatchObject({
      outcome: 'unavailable',
      topic: 'ferry times',
      place: 'split',
    });
  });

  it('logs no_results for an empty answer, with a null destination outside one', async () => {
    const fetch = recordedBraveFetch({ body: JSON.stringify({ type: 'search' }) });
    const { results } = await webFallbackSearch(
      testDb.db,
      { ...scope, destinationId: null },
      { keywords: 'diving', place: 'Seget' },
      createBraveSearch({ fetch, apiKey: 'test' }),
      NOW,
    );
    expect(results).toEqual([]);
    expect(new URL(fetch.urls[0] ?? '').searchParams.get('q')).not.toContain('np-krka.hr');
    expect((await logRows()).at(-1)).toMatchObject({
      destinationId: null,
      outcome: 'no_results',
      resultCount: 0,
    });
  });
});
