import type { EventCardPayload } from '../../payloads';
import { MapList, type MapListLabels } from '../map-list/MapList';
import { distanceText } from '../place-carousel/format';

/** `places` names the list (e.g. "Events"); it labels the section and the full-screen map. */
export type EventListLabels = MapListLabels;

/** A local 'YYYY-MM-DDTHH:mm' as a Date whose UTC fields are those numbers: shown as written. */
const wallClock = (local: string) => new Date(`${local}:00Z`);

/**
 * When an event is on, in the guest's language and the destination's wall-clock time: day and
 * start time for an event within one day, the date range for one that runs over several.
 */
export function eventWhen(startsAt: string, endsAt: string, locale: string): string {
  const start = wallClock(startsAt);
  const end = wallClock(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  if (startsAt.slice(0, 10) === endsAt.slice(0, 10)) {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(start);
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatRange(start, end);
}

/**
 * Events from one search as a numbered list (when · where · how far), with the map above it when
 * any event has a location. The list is the accessible content, as for places.
 */
export function EventList({
  events,
  labels,
  locale,
}: {
  events: readonly EventCardPayload[];
  labels: EventListLabels;
  locale: string;
}) {
  return (
    <section className="fv-events" aria-label={labels.places}>
      <MapList
        places={events}
        labels={labels}
        metaOf={(event) =>
          [
            eventWhen(event.startsAt, event.endsAt, locale),
            event.venueName ?? event.address ?? null,
            distanceText(event, labels),
          ]
            .filter(Boolean)
            .join(' · ') || null
        }
      />
    </section>
  );
}
