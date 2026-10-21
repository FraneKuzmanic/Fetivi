import {
  aboutMeFit,
  type CatalogScope,
  type GuestIdentity,
  getAboutMe,
  getPlace,
  listTransportNotes,
  searchEvents,
  searchPlaces,
} from '@fetivi/domain';
import { ClaimMismatchError, type GuestToolSpec, guestTool } from '../tool';
import {
  getPlaceInput,
  getPlaceOutput,
  searchEventsInput,
  searchEventsOutput,
  searchPlacesInput,
  searchPlacesOutput,
  transportNotesInput,
  transportNotesOutput,
} from './schemas';

// search_places bumps a recommendation counter, but the guest-visible result does not change.
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** A null from the domain is "not visible to this guest", whatever the reason. */
function visible<T>(value: T | null): T {
  if (value === null) throw new ClaimMismatchError('not visible');
  return value;
}

/** The catalog tools exist only for a token with catalog:read and a destination. */
const listed = (identity: GuestIdentity) =>
  identity.destinationId !== null && identity.scopes.includes('catalog:read');

function catalogScope(identity: GuestIdentity): CatalogScope {
  // `listed` guarantees a destination before any handler runs.
  if (identity.destinationId === null) throw new ClaimMismatchError('no destination');
  return {
    destinationId: identity.destinationId,
    propertyId: identity.propertyId,
    stayId: identity.stayId,
    language: identity.language,
    aboutMe: null,
  };
}

/** The `local` server's tools, in `tools/list` order. */
export const localTools: readonly GuestToolSpec[] = [
  guestTool({
    name: 'search_places',
    config: {
      title: 'Search places',
      description:
        "Find checked places and day trips in the guest's destination: beaches, sights, restaurants, cafés and bars, nature, activities, shops, nightlife, and day trips with travel time. Results are ranked best first, in season on the given day, with distance from the property, when each was last verified and its sources. Use a category when the guest names one. Places with offerIds can be arranged here: use list_offers / check_availability from services. Bookable places only go first among options that fit equally well.",
      scope: 'catalog:read',
      inputSchema: searchPlacesInput,
      outputSchema: searchPlacesOutput,
      annotations: readOnly,
    },
    listed,
    // About me is read per call, so a preference saved earlier in the turn already counts.
    async handler(args, identity, { db, now }) {
      const fit = aboutMeFit(await getAboutMe(db, identity.spaceId));
      return visible(
        await searchPlaces(
          db,
          { ...catalogScope(identity), aboutMe: fit },
          { ...args, limit: args.limit ?? 5 },
          now(),
        ),
      );
    },
  }),
  guestTool({
    name: 'get_place',
    config: {
      title: 'Place details',
      description:
        'Full details of one place or day trip from search_places: description, seasons, opening hours, photos with credits and sources.',
      scope: 'catalog:read',
      inputSchema: getPlaceInput,
      outputSchema: getPlaceOutput,
      annotations: readOnly,
    },
    listed,
    async handler({ placeId }, identity, { db, now }) {
      return { place: visible(await getPlace(db, catalogScope(identity), placeId, now())) };
    },
  }),
  guestTool({
    name: 'search_events',
    config: {
      title: 'Search events',
      description:
        "Events in the destination during the guest's stay (from 3 days before arrival to 3 days after checkout), soonest first, in local time.",
      scope: 'catalog:read',
      inputSchema: searchEventsInput,
      outputSchema: searchEventsOutput,
      annotations: readOnly,
    },
    listed,
    async handler(args, identity, { db, now }) {
      return visible(await searchEvents(db, catalogScope(identity), args, now()));
    },
  }),
  guestTool({
    name: 'get_transport_notes',
    config: {
      title: 'Transport notes',
      description:
        'Curated notes on ferries, catamarans, buses, boat taxis, taxis and trains, each with official links. They are text to quote and link, not timetables to compute with.',
      scope: 'catalog:read',
      inputSchema: transportNotesInput,
      outputSchema: transportNotesOutput,
      annotations: readOnly,
    },
    listed,
    async handler(args, identity, { db, now }) {
      return {
        results: visible(await listTransportNotes(db, catalogScope(identity), args, now())),
      };
    },
  }),
];
