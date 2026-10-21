import {
  aboutMeFit,
  type CatalogScope,
  type Db,
  type GuestIdentity,
  getAboutMe,
  getPlace,
  listTransportNotes,
  searchEvents,
  searchPlaces,
} from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { ClaimMismatchError, registerGuestTool } from '../tool';
import { SERVER_VERSION } from '../version';
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

/**
 * The `local` server for one guest. The catalog tools exist only for a token with catalog:read and
 * a destination (inside a destination, architecture §4.3); outside one the list is empty until
 * web_fallback_search (31).
 */
export function buildLocalServer(
  identity: GuestIdentity,
  deps: { db: Db; now: () => Date },
): McpServer {
  const server = new McpServer(
    { name: 'fetivi-local', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  const destinationId = identity.destinationId;
  if (destinationId === null || !identity.scopes.includes('catalog:read')) return server;

  const { db, now } = deps;
  const scope: CatalogScope = {
    destinationId,
    propertyId: identity.propertyId,
    stayId: identity.stayId,
    language: identity.language,
    aboutMe: null,
  };

  registerGuestTool(
    server,
    identity,
    'search_places',
    {
      title: 'Search places',
      description:
        "Find checked places and day trips in the guest's destination: beaches, sights, restaurants, cafés and bars, nature, activities, shops, nightlife, and day trips with travel time. Results are ranked best first, in season on the given day, with distance from the property, when each was last verified and its sources. Use a category when the guest names one. Places with offerIds can be arranged here: use list_offers / check_availability from services. Bookable places only go first among options that fit equally well.",
      scope: 'catalog:read',
      inputSchema: searchPlacesInput,
      outputSchema: searchPlacesOutput,
      annotations: readOnly,
    },
    // About me is read per call, so a preference saved earlier in the turn already counts.
    async (args) => {
      const fit = aboutMeFit(await getAboutMe(db, identity.spaceId));
      return visible(
        await searchPlaces(
          db,
          { ...scope, aboutMe: fit },
          { ...args, limit: args.limit ?? 5 },
          now(),
        ),
      );
    },
  );

  registerGuestTool(
    server,
    identity,
    'get_place',
    {
      title: 'Place details',
      description:
        'Full details of one place or day trip from search_places: description, seasons, opening hours, photos with credits and sources.',
      scope: 'catalog:read',
      inputSchema: getPlaceInput,
      outputSchema: getPlaceOutput,
      annotations: readOnly,
    },
    async ({ placeId }) => ({ place: visible(await getPlace(db, scope, placeId, now())) }),
  );

  registerGuestTool(
    server,
    identity,
    'search_events',
    {
      title: 'Search events',
      description:
        "Events in the destination during the guest's stay (from 3 days before arrival to 3 days after checkout), soonest first, in local time.",
      scope: 'catalog:read',
      inputSchema: searchEventsInput,
      outputSchema: searchEventsOutput,
      annotations: readOnly,
    },
    async (args) => visible(await searchEvents(db, scope, args, now())),
  );

  registerGuestTool(
    server,
    identity,
    'get_transport_notes',
    {
      title: 'Transport notes',
      description:
        'Curated notes on ferries, catamarans, buses, boat taxis, taxis and trains, each with official links. They are text to quote and link, not timetables to compute with.',
      scope: 'catalog:read',
      inputSchema: transportNotesInput,
      outputSchema: transportNotesOutput,
      annotations: readOnly,
    },
    async (args) => ({ results: visible(await listTransportNotes(db, scope, args, now())) }),
  );

  return server;
}
