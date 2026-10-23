import { describe, expect, it } from 'vitest';
import { rankPlaces } from '../catalog/ranking';
import type { EventSummary, PlaceSummary } from '../catalog/search';
import { pickDailyTip, type TipInput } from './pick';

const TOMORROW = '2027-07-11';

const place = (id: string, over: Partial<PlaceSummary> = {}): PlaceSummary => ({
  id,
  kind: 'place',
  category: 'sight',
  title: `Place ${id}`,
  summary: '',
  location: null,
  distanceKm: 1.2,
  travelMinutes: null,
  address: null,
  phone: null,
  websiteUrl: null,
  image: null,
  open: null,
  verifiedAt: null,
  staleness: { status: 'fresh', staleAt: null },
  sources: [],
  offerIds: [],
  hostPick: null,
  hostAdded: false,
  ...over,
});

const event = (id: string, startsAt: string, endsAt: string): EventSummary => ({
  id,
  title: `Event ${id}`,
  summary: '',
  startsAt,
  endsAt,
  venueName: 'Kamerlengo Fortress',
  location: null,
  distanceKm: 0.4,
  websiteUrl: null,
  verifiedAt: null,
  staleness: { status: 'fresh', staleAt: null },
  sources: [],
});

const input = (over: Partial<TipInput> = {}): TipInput => ({
  tomorrow: TOMORROW,
  fullDay: true,
  tomorrowSky: 'clear',
  weather: 'ok',
  planned: [],
  rainyPlaces: [place('museum')],
  events: [event('concert', '2027-07-11T20:00', '2027-07-11T22:00')],
  places: [place('beach')],
  ...over,
});

describe('pickDailyTip', () => {
  it('picks the best rainy-day place when rain is forecast', () => {
    const tip = pickDailyTip(input({ tomorrowSky: 'heavy_rain' }));
    expect(tip).toEqual({
      rule: 'rain',
      date: TOMORROW,
      recordId: 'museum',
      kind: 'place',
      title: 'Place museum',
      startsAt: null,
      venueName: null,
      distanceKm: 1.2,
    });
  });

  it('treats light rain as no rain', () => {
    expect(pickDailyTip(input({ tomorrowSky: 'light_rain' }))?.rule).toBe('event');
  });

  it('falls through when every rainy-day place is already planned', () => {
    const tip = pickDailyTip(input({ tomorrowSky: 'rain', planned: [{ placeId: 'museum' }] }));
    expect(tip?.rule).toBe('event');
  });

  it('skips a planned rainy-day place for the next one', () => {
    const tip = pickDailyTip(
      input({
        tomorrowSky: 'rain',
        planned: [{ placeId: 'museum' }],
        rainyPlaces: [place('museum'), place('gallery')],
      }),
    );
    expect(tip?.recordId).toBe('gallery');
  });

  it('never uses the rain rule without a forecast', () => {
    expect(pickDailyTip(input({ tomorrowSky: null, weather: 'unavailable' }))?.rule).toBe('event');
  });

  it('prefers a matching event over an empty day', () => {
    const tip = pickDailyTip(input());
    expect(tip).toMatchObject({
      rule: 'event',
      recordId: 'concert',
      kind: 'event',
      startsAt: '2027-07-11T20:00',
      venueName: 'Kamerlengo Fortress',
    });
  });

  it('takes an event that spans tomorrow but not one that ends before it', () => {
    const festival = event('festival', '2027-07-01T20:00', '2027-08-31T23:00');
    expect(pickDailyTip(input({ events: [festival] }))?.recordId).toBe('festival');
    const earlier = event('earlier', '2027-07-09T20:00', '2027-07-10T22:00');
    expect(pickDailyTip(input({ events: [earlier] }))?.rule).toBe('gap');
  });

  it('suggests a place for a full, empty day', () => {
    const tip = pickDailyTip(input({ events: [] }));
    expect(tip).toMatchObject({ rule: 'gap', recordId: 'beach', kind: 'place' });
  });

  it('gives no gap tip when something is planned or tomorrow is checkout day', () => {
    expect(pickDailyTip(input({ events: [], planned: [{ placeId: null }] }))).toBeNull();
    expect(pickDailyTip(input({ events: [], fullDay: false }))).toBeNull();
  });

  it('gives nothing when no rule has a candidate', () => {
    expect(pickDailyTip(input({ events: [], places: [] }))).toBeNull();
  });

  it('keeps the ranking: a bookable place with a worse fit does not win', () => {
    const better = place('better', { category: 'sight' });
    const bookable = place('bookable', { category: 'beach', offerIds: ['offer-1'] });
    const ranked = rankPlaces(
      [
        {
          summary: bookable,
          id: bookable.id,
          category: 'beach',
          textScore: null,
          staleness: 'fresh',
          distanceM: 1000,
          bookable: true,
        },
        {
          summary: better,
          id: better.id,
          category: 'sight',
          textScore: null,
          staleness: 'fresh',
          distanceM: 1000,
          bookable: false,
        },
      ],
      { categoryWeights: { sight: 1 } },
    ).map((c) => c.summary);
    expect(pickDailyTip(input({ events: [], places: ranked }))?.recordId).toBe('better');
  });
});
