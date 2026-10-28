import { BookmarkSimple, HouseLine, Star } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
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
  /** The toggle that shows a clamped description in full, and folds it again. */
  more: string;
  less: string;
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
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const hostNoteRef = useRef<HTMLParagraphElement>(null);
  // `summary` is the cut first paragraph of the note; a host-added card shows the host's note whole.
  const summary = place.hostAdded ? (place.hostPick?.note ?? place.summary) : place.summary;
  const hostNote = place.hostAdded ? null : (place.hostPick?.note ?? null);

  // Measured only while folded: the More toggle shows when either text is cut by its line clamp.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the texts are what the clamp measures.
  useLayoutEffect(() => {
    if (expanded) return;
    const measure = () =>
      setClamped(
        [summaryRef.current, hostNoteRef.current].some(
          (el) => el !== null && el.scrollHeight > el.clientHeight + 1,
        ),
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    for (const el of [summaryRef.current, hostNoteRef.current]) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, summary, hostNote]);

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
          <div id={textId} className="fv-card-text" data-expanded={expanded}>
            <p ref={summaryRef} className="fv-card-summary">
              {summary}
            </p>
            {/* A host-added place's summary is already the host's note. */}
            {hostNote && (
              <p ref={hostNoteRef} className="fv-card-host-note">
                <q>{hostNote}</q>
              </p>
            )}
          </div>
          {(clamped || expanded) && (
            <button
              type="button"
              className="fv-more"
              aria-expanded={expanded}
              aria-controls={textId}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? labels.less : labels.more}
            </button>
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
