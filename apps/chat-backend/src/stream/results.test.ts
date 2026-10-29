import { describe, expect, it } from 'vitest';
import { turnResults } from './results';

const place = (id: string, title: string) => ({
  id,
  kind: 'place',
  category: 'restaurant',
  title,
  summary: 'Fish by the sea.',
  location: { lat: 43.5, lng: 16.2 },
  distanceKm: 0.3,
  travelMinutes: null,
  address: 'Obala 1',
  phone: '+385 21 000',
  websiteUrl: null,
  image: {
    url: 'https://img.test/a.jpg',
    source: 'own_photo',
    licence: null,
    attribution: 'Ana',
    sourcePageUrl: null,
  },
  verifiedAt: null,
  staleness: { status: 'never_verified', staleAt: null },
  sources: [{ field: 'phone', url: 'https://src.test' }],
  open: 'open',
});

const event = (id: string, title: string) => ({
  id,
  title,
  summary: 'Concerts.',
  startsAt: '2027-07-10T21:00',
  endsAt: '2027-07-10T23:00',
  venueName: 'Kamerlengo Fortress',
  address: null,
  location: { lat: 43.5, lng: 16.2 },
  distanceKm: 0.4,
  websiteUrl: null,
  verifiedAt: null,
  staleness: { status: 'fresh', staleAt: null },
  sources: [],
});

describe('turnResults', () => {
  it('shows recorded places in the given order, with only the card fields', () => {
    const results = turnResults();
    results.record('search_places', { results: [place('1', 'Konoba A'), place('2', 'Konoba B')] });
    expect(results.show('c1', 'places', ['2', '1'])).toBe(2);
    const part = results.shown('c1');
    expect(part?.name).toBe('place-carousel');
    if (part?.name !== 'place-carousel') return;
    expect(part.payload.places.map((p) => p.title)).toEqual(['Konoba B', 'Konoba A']);
    const card = part.payload.places[0] as Record<string, unknown>;
    expect(card.phone).toBeUndefined();
    expect(card.sources).toBeUndefined();
    expect(card.staleness).toEqual({ status: 'never_verified' });
  });

  it('records host picks as places, keeping the note and the badge', () => {
    const results = turnResults();
    results.record('list_host_picks', {
      results: [{ ...place('p', 'Pick'), hostPick: { note: 'Go early' }, hostAdded: true }],
    });
    results.show('c1', 'places', ['p']);
    const part = results.shown('c1');
    expect(part?.name === 'place-carousel' && part.payload.places[0]).toMatchObject({
      hostPick: { note: 'Go early' },
      hostAdded: true,
    });
  });

  it('records events from search_events as an event list', () => {
    const results = turnResults();
    results.record('search_events', { window: {}, results: [event('e1', 'Klapa night')] });
    expect(results.show('c1', 'events', ['e1'])).toBe(1);
    const part = results.shown('c1');
    expect(part?.name).toBe('event-list');
    if (part?.name !== 'event-list') return;
    expect(part.payload.events.map((e) => e.title)).toEqual(['Klapa night']);
    expect((part.payload.events[0] as Record<string, unknown>).sources).toBeUndefined();
  });

  it('keeps places and events apart', () => {
    const results = turnResults();
    results.record('search_events', { results: [event('e1', 'Klapa night')] });
    expect(() => results.show('c1', 'places', ['e1'])).toThrow(/Unknown places ids: e1/);
  });

  it('ignores other tools, error texts and malformed outputs', () => {
    const results = turnResults();
    results.record('get_place', { results: [place('1', 'Konoba A')] });
    results.record('search_places', 'Search is not available right now.');
    results.record('search_places', { results: 'none' });
    results.record('search_places', { results: [{ title: 'No id' }, null] });
    expect(() => results.show('c1', 'places', ['1'])).toThrow(/Unknown places ids: 1/);
  });

  it('throws for unknown ids, naming them, and keeps nothing for that call', () => {
    const results = turnResults();
    results.record('search_places', { results: [place('1', 'Konoba A')] });
    expect(() => results.show('c1', 'places', ['1', 'x', 'y'])).toThrow(
      'Unknown places ids: x, y. Use only ids that search_places or list_host_picks returned in this turn.',
    );
    expect(results.shown('c1')).toBeUndefined();
  });

  it('throws when a recorded result cannot be a card', () => {
    const results = turnResults();
    const { title: _t, ...untitled } = place('1', 'x');
    results.record('search_places', { results: [untitled] });
    expect(() => results.show('c1', 'places', ['1'])).toThrow('cannot be shown as cards');
    expect(results.shown('c1')).toBeUndefined();
  });

  it('has nothing for an unknown call', () => {
    expect(turnResults().shown('nope')).toBeUndefined();
  });
});
