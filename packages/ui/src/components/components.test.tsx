import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FollowUpChips } from './chips/FollowUpChips';
import { ChoiceCard } from './choice-card/ChoiceCard';
import { radioMove } from './choice-card/radio';
import { LABELS, place } from './fixtures';
import { MapList } from './map-list/MapList';
import { boundsOf } from './map-list/map';
import { distanceText, lastCheckedNote } from './place-carousel/format';
import { PlaceCarousel } from './place-carousel/PlaceCarousel';

const noop = () => {};
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('FollowUpChips', () => {
  it('renders one button per reply in a labelled group', () => {
    const html = renderToString(
      <FollowUpChips
        replies={['Show me on a map', 'Cheaper']}
        label="Suggested replies"
        onSelect={noop}
      />,
    );
    expect(html).toContain('<fieldset aria-label="Suggested replies"');
    expect(count(html, '<button')).toBe(2);
    expect(html).toContain('>Show me on a map</button>');
  });
});

describe('ChoiceCard', () => {
  const card = (multiple: boolean, active = true) =>
    renderToString(
      <ChoiceCard
        question="Lunch or dinner?"
        options={['Lunch', 'Dinner', 'Both']}
        multiple={multiple}
        active={active}
        onAnswer={noop}
        onSomethingElse={noop}
        labels={{ send: 'Send', somethingElse: 'Something else' }}
      />,
    );

  it('is a radio group with one tab stop when single', () => {
    const html = card(false);
    expect(html).toContain('role="radiogroup"');
    expect(count(html, 'role="radio"')).toBe(3);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(html).toContain('Something else');
  });

  it('is toggle buttons with a disabled Send when multiple', () => {
    const html = card(true);
    expect(count(html, 'aria-pressed="false"')).toBe(3);
    expect(html).toMatch(/<button type="button" class="fv-choice-send" disabled="">Send<\/button>/);
  });

  it('is read-only text when no longer active', () => {
    const html = card(false, false);
    expect(html).toContain('Lunch or dinner?');
    expect(html).toContain('<li>Dinner</li>');
    expect(html).not.toContain('<button');
  });
});

describe('PlaceCarousel', () => {
  const render = (places = [place()], saved = new Set<string>(), canSave = true) =>
    renderToString(
      <PlaceCarousel
        places={places}
        saved={saved}
        canSave={canSave}
        onToggleSave={noop}
        labels={LABELS}
      />,
    );

  it('shows a photo with its linked credit, or the category illustration', () => {
    const photo = render([
      place({
        image: {
          url: 'https://img.test/a.jpg',
          attribution: 'Ana',
          licence: 'CC BY-SA 4.0',
          sourcePageUrl: 'https://commons.test/a',
        },
      }),
    ]);
    expect(photo).toContain('alt="Photo of Konoba Mala"');
    expect(photo).toContain('href="https://commons.test/a"');
    expect(photo).toContain('Photo: Ana · CC BY-SA 4.0');
    expect(photo).not.toContain('fv-illustration');

    const drawn = render();
    expect(drawn).toContain('class="fv-illustration" aria-hidden="true"><svg');
    expect(drawn).not.toContain('<img');
  });

  it('shows distance, and last checked only past the budget', () => {
    expect(render()).toContain('0.4 km away');
    expect(render()).not.toContain('call ahead');
    expect(render()).not.toContain('Call ahead');
    expect(
      render([place({ staleness: { status: 'stale' }, verifiedAt: '2026-03-02T00:00:00Z' })]),
    ).toContain('Last checked 2026-03 · call ahead');
    expect(render([place({ staleness: { status: 'never_verified' } })])).toContain(
      'Call ahead to check',
    );
  });

  it("shows the host's pick badge only when set", () => {
    expect(render()).not.toContain('Your host&#x27;s pick');
    expect(render([place({ hostPick: null })])).not.toContain('fv-badge');
    expect(render([place({ hostPick: { note: null } })])).toContain('Your host&#x27;s pick');
    expect(render([place({ hostPick: { note: null } })])).not.toContain('fv-card-host-note');
  });

  it("shows the host's note in quotes", () => {
    expect(render([place({ hostPick: { note: 'Ask for Ivo.' } })])).toContain(
      '<p class="fv-card-host-note"><q>Ask for Ivo.</q></p>',
    );
  });

  it('marks a host-added place with its own badge and no Save', () => {
    const html = render([
      place({
        summary: 'My cousin runs it.',
        hostPick: { note: 'My cousin runs it.' },
        hostAdded: true,
      }),
    ]);
    expect(html).toContain('Added by your host');
    expect(html).not.toContain('Your host&#x27;s pick');
    expect(html.split('My cousin runs it.')).toHaveLength(2);
    expect(html).not.toContain('fv-card-host-note');
    expect(html).not.toContain('fv-save');
  });

  it('has a Save toggle, kept after the Stay only for saved places', () => {
    expect(render()).toContain('aria-pressed="false"><svg');
    expect(render([place()], new Set(['p1']))).toContain('>Saved</button>');
    expect(render([place()], new Set(), false)).not.toContain('fv-save');
    expect(render([place()], new Set(['p1']), false)).toContain('fv-save');
  });

  it('offers the map view only when a place has a location', () => {
    expect(render()).toContain('>Map</button>');
    expect(render([place({ location: null })])).not.toContain('>Map</button>');
    expect(render()).toContain('class="fv-carousel" tabindex="0" aria-label="Places"');
  });
});

describe('MapList', () => {
  it('lists every place, with the map hidden from screen readers', () => {
    const html = renderToString(
      <MapList
        places={[place(), place({ id: 'p2', title: 'Konoba Velika', location: null })]}
        labels={LABELS}
      />,
    );
    expect(html.indexOf('<ol')).toBeLessThan(html.indexOf('class="fv-map"'));
    expect(html).toContain('Konoba Velika');
    expect(html).toContain('class="fv-map" aria-hidden="true"');
    expect(html).toContain('Expand map');
  });
});

describe('format', () => {
  const km = (n: number) => `${n} km`;
  const minutes = (n: number) => `${n} min`;
  it('rounds distance and prefers travel time for day trips', () => {
    expect(distanceText(place({ distanceKm: 0.43 }), { km, minutes })).toBe('0.4 km');
    expect(distanceText(place({ distanceKm: 0.03 }), { km, minutes })).toBe('0.1 km');
    expect(distanceText(place({ distanceKm: 3.27 }), { km, minutes })).toBe('3.3 km');
    expect(distanceText(place({ distanceKm: 12.6 }), { km, minutes })).toBe('13 km');
    expect(distanceText(place({ distanceKm: null }), { km, minutes })).toBeNull();
    expect(
      distanceText(place({ kind: 'day_trip', distanceKm: 30, travelMinutes: 45 }), {
        km,
        minutes,
      }),
    ).toBe('45 min');
  });

  it('notes last checked for stale and unverified places only', () => {
    const at = '2026-03-02T00:00:00Z';
    expect(lastCheckedNote(place({ staleness: { status: 'fresh' }, verifiedAt: at }))).toBeNull();
    expect(lastCheckedNote(place({ staleness: { status: 'stale' }, verifiedAt: at }))).toEqual({
      kind: 'stale',
      verifiedAt: at,
    });
    expect(lastCheckedNote(place({ staleness: { status: 'never_verified' } }))).toEqual({
      kind: 'unverified',
    });
  });

  it('never notes a host-added place: the host vouches for it', () => {
    expect(
      lastCheckedNote(place({ staleness: { status: 'never_verified' }, hostAdded: true })),
    ).toBeNull();
    expect(
      lastCheckedNote(place({ staleness: { status: 'never_verified' }, hostAdded: false })),
    ).toEqual({ kind: 'unverified' });
  });

  it('bounds the located places', () => {
    expect(boundsOf([place({ location: null })])).toBeNull();
    expect(
      boundsOf([
        place({ location: { lat: 43.5, lng: 16.2 } }),
        place({ location: { lat: 43.6, lng: 16.1 } }),
      ]),
    ).toEqual([
      [16.1, 43.5],
      [16.2, 43.6],
    ]);
  });

  it('moves within a radio group', () => {
    expect(radioMove('ArrowRight', 2, 3)).toBe(0);
    expect(radioMove('ArrowLeft', 0, 3)).toBe(2);
    expect(radioMove('Enter', 0, 3)).toBeNull();
  });
});
