import { MapTrifold, SquaresFour } from '@phosphor-icons/react';
import { useState } from 'react';
import type { PlaceCardPayload } from '../../payloads';
import { MapList } from '../map-list/MapList';
import { PlaceCard, type PlaceLabels } from './PlaceCard';

/**
 * Places from one search as swipeable cards, with a Map view (map plus list) when any place has a
 * location. The scroller is focusable so arrow keys scroll it; Tab walks the cards' buttons.
 */
export function PlaceCarousel({
  places,
  saved,
  canSave = true,
  onToggleSave,
  labels,
}: {
  places: readonly PlaceCardPayload[];
  saved: ReadonlySet<string>;
  /** False after the Stay: only already saved places keep their button, to remove them. */
  canSave?: boolean;
  onToggleSave?: (id: string, next: boolean) => void;
  labels: PlaceLabels;
}) {
  const [view, setView] = useState<'cards' | 'map'>('cards');
  const hasMap = places.some((p) => p.location !== null);
  const shown = hasMap ? view : 'cards';
  return (
    <section className="fv-places" aria-label={labels.places}>
      {hasMap && (
        <div className="fv-view-switch">
          <button type="button" aria-pressed={shown === 'cards'} onClick={() => setView('cards')}>
            <SquaresFour aria-hidden="true" />
            {labels.viewCards}
          </button>
          <button type="button" aria-pressed={shown === 'map'} onClick={() => setView('map')}>
            <MapTrifold aria-hidden="true" />
            {labels.viewMap}
          </button>
        </div>
      )}
      {shown === 'cards' ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard.
        <ul className="fv-carousel" tabIndex={0} aria-label={labels.places}>
          {places.map((place) => {
            const isSaved = saved.has(place.id);
            return (
              <PlaceCard
                key={place.id}
                place={place}
                saved={isSaved}
                onToggleSave={onToggleSave && (canSave || isSaved) ? onToggleSave : undefined}
                labels={labels}
              />
            );
          })}
        </ul>
      ) : (
        <MapList places={places} labels={labels} />
      )}
    </section>
  );
}
