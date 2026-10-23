import { BookmarkSimple, HouseLine, Star } from '@phosphor-icons/react';
import { useId } from 'react';
import type { PlaceCardPayload } from '../../payloads';
import { CategoryIllustration } from './CategoryIllustration';
import { distanceText, lastCheckedNote } from './format';

/** Every visible string of a place card and the views around it; the app translates them. */
export interface PlaceLabels {
  places: string;
  viewCards: string;
  viewMap: string;
  expandMap: string;
  closeMap: string;
  mapUnavailable: string;
  photoOf: (title: string) => string;
  photoCredit: (credit: string) => string;
  km: (distance: number) => string;
  minutes: (minutes: number) => string;
  /** "Last checked May 2027 · call ahead", given the ISO `verifiedAt`. */
  lastChecked: (verifiedAt: string) => string;
  unverified: string;
  hostPick: string;
  hostAdded: string;
  save: string;
  saved: string;
}

/** One place: a photo with its credit or a category illustration, three short lines, one action. */
export function PlaceCard({
  place,
  saved,
  onToggleSave,
  labels,
}: {
  place: PlaceCardPayload;
  saved: boolean;
  /** Without it the card has no Save button. */
  onToggleSave?: (id: string, next: boolean) => void;
  labels: PlaceLabels;
}) {
  const titleId = useId();
  const distance = distanceText(place, labels);
  const note = lastCheckedNote(place);
  const { image } = place;
  const credit = image?.attribution
    ? [labels.photoCredit(image.attribution), image.licence].filter(Boolean).join(' · ')
    : null;
  return (
    <li className="fv-card">
      <article aria-labelledby={titleId}>
        <div className="fv-card-media">
          {image ? (
            <img src={image.url} alt={labels.photoOf(place.title)} loading="lazy" />
          ) : (
            <CategoryIllustration category={place.category} />
          )}
          {(place.hostPick || place.hostAdded) && (
            <span className="fv-badge">
              {place.hostAdded ? (
                <HouseLine aria-hidden="true" weight="fill" />
              ) : (
                <Star aria-hidden="true" weight="fill" />
              )}
              {place.hostAdded ? labels.hostAdded : labels.hostPick}
            </span>
          )}
        </div>
        {credit && (
          <p className="fv-credit">
            {image?.sourcePageUrl ? (
              <a href={image.sourcePageUrl} target="_blank" rel="noopener noreferrer">
                {credit}
              </a>
            ) : (
              credit
            )}
          </p>
        )}
        <div className="fv-card-body">
          <h3 id={titleId} className="fv-card-title">
            {place.title}
          </h3>
          <p className="fv-card-summary">{place.summary}</p>
          {/* A host-added place's summary is already the host's note. */}
          {place.hostPick?.note && !place.hostAdded && (
            <p className="fv-card-host-note">
              <q>{place.hostPick.note}</q>
            </p>
          )}
          {distance && <p className="fv-card-meta">{distance}</p>}
          {note && (
            <p className="fv-card-note">
              {note.kind === 'stale' ? labels.lastChecked(note.verifiedAt) : labels.unverified}
            </p>
          )}
          {onToggleSave && !place.hostAdded && (
            <button
              type="button"
              className="fv-save"
              aria-pressed={saved}
              onClick={() => onToggleSave(place.id, !saved)}
            >
              <BookmarkSimple aria-hidden="true" weight={saved ? 'fill' : 'regular'} />
              {saved ? labels.saved : labels.save}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}
