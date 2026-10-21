import { describe, expect, it } from 'vitest';
import { choiceCard, componentPart, followUpChips, type PlaceCardPayload, placeCarousel } from '.';

const PLACE: PlaceCardPayload = {
  id: 'a1b2',
  kind: 'place',
  category: 'restaurant',
  title: 'Konoba Fetivi',
  summary: 'Grilled fish by the harbour.',
  location: { lat: 43.51, lng: 16.25 },
  distanceKm: 0.4,
  travelMinutes: null,
  image: null,
  verifiedAt: '2026-05-01T00:00:00.000Z',
  staleness: { status: 'fresh' },
};

describe('follow-up-chips', () => {
  it('takes one to four short replies', () => {
    expect(followUpChips.safeParse({ replies: ['Show me on a map'] }).success).toBe(true);
    expect(followUpChips.safeParse({ replies: ['a', 'b', 'c', 'd'] }).success).toBe(true);
  });

  it('refuses none, five, a long one or an extra key', () => {
    for (const bad of [
      { replies: [] },
      { replies: ['a', 'b', 'c', 'd', 'e'] },
      { replies: ['x'.repeat(61)] },
      { replies: ['  '] },
      { replies: ['a'], extra: true },
    ]) {
      expect(followUpChips.safeParse(bad).success).toBe(false);
    }
  });
});

describe('choice-card', () => {
  it('defaults to a single choice', () => {
    const parsed = choiceCard.parse({ question: 'Lunch or dinner?', options: ['Lunch', 'Dinner'] });
    expect(parsed.multiple).toBe(false);
  });

  it('refuses one option, seven options and duplicates', () => {
    const q = 'Which?';
    for (const options of [['a'], ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['a', 'a']]) {
      expect(choiceCard.safeParse({ question: q, options }).success).toBe(false);
    }
  });
});

describe('place-carousel', () => {
  it('takes places, with an optional host pick, and keeps extra fields harmless', () => {
    expect(placeCarousel.safeParse({ places: [PLACE] }).success).toBe(true);
    expect(
      placeCarousel.safeParse({ places: [{ ...PLACE, hostPick: { note: null }, phone: '1' }] })
        .success,
    ).toBe(true);
  });

  it('refuses no places, a place without a title and an unknown staleness', () => {
    const { title: _title, ...untitled } = PLACE;
    for (const bad of [
      { places: [] },
      { places: [untitled] },
      { places: [{ ...PLACE, staleness: { status: 'old' } }] },
    ]) {
      expect(placeCarousel.safeParse(bad).success).toBe(false);
    }
  });
});

describe('componentPart', () => {
  it('validates the payload for its name', () => {
    expect(
      componentPart.safeParse({ name: 'follow-up-chips', payload: { replies: ['Yes'] } }).success,
    ).toBe(true);
    expect(
      componentPart.safeParse({ name: 'place-carousel', payload: { replies: ['Yes'] } }).success,
    ).toBe(false);
  });

  it('refuses an unknown name', () => {
    expect(componentPart.safeParse({ name: 'weather', payload: {} }).success).toBe(false);
  });
});
