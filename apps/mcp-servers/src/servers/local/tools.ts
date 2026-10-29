import {
  aboutMeFit,
  type CatalogScope,
  type GuestIdentity,
  getAboutMe,
  getPlace,
  listHostPicks,
  listTransportNotes,
  searchEvents,
  searchPlaces,
  WeatherDateError,
  WeatherUnavailableError,
  weatherPlaceOf,
  weatherToolDate,
  weatherToolResult,
} from '@fetivi/domain';
import { ClaimMismatchError, GuestToolError, type GuestToolSpec, guestTool } from '../tool';
import {
  getPlaceInput,
  getPlaceOutput,
  getWeatherInput,
  getWeatherOutput,
  listHostPicksInput,
  listHostPicksOutput,
  searchEventsInput,
  searchEventsOutput,
  searchPlacesInput,
  searchPlacesOutput,
  transportNotesInput,
  transportNotesOutput,
} from './schemas';
import { webFallbackTool } from './web-fallback';

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
        "Find places and day trips in the guest's destination: beaches, sights, restaurants, cafés and bars, nature, activities, shops, nightlife, and day trips with travel time. Results are ranked best first, in season on the given day, with distance from the property, when each was last verified and its sources. Use a category when the guest names one. Places with offerIds can be arranged here: use list_offers / check_availability from services. Bookable places only go first among options that fit equally well. Places the guest's host picked carry hostPick; hostAdded places are the host's own tips. Put the guest's wish in query in natural words (any language) and anything they do not want in avoid. For rain or indoor ideas set rainyDay instead of writing it in query. Results match by meaning and rank by fit first. When matchesQuery is false, nothing matched: say so and offer the listed places as alternatives. outOfSeason lists matching places closed for the season on that day. Results show the guest nothing: call show_results with the ids your answer recommends. Unknown opening hours (open: unknown) mean call ahead, never closed. Never tell the guest about the search itself.",
      scope: 'catalog:read',
      inputSchema: searchPlacesInput,
      outputSchema: searchPlacesOutput,
      annotations: readOnly,
    },
    listed,
    // About me is read per call, so a preference saved earlier in the turn already counts.
    async handler(args, identity, { db, now, embedder }) {
      const fit = aboutMeFit(await getAboutMe(db, identity.spaceId));
      return visible(
        await searchPlaces(
          db,
          { ...catalogScope(identity), aboutMe: fit },
          { ...args, limit: args.limit ?? 5 },
          now(),
          embedder,
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
    name: 'list_host_picks',
    config: {
      title: 'Host picks',
      description:
        "The places this guest's host recommends: catalog places the host picked, with the host's note, and places the host added themselves. Use it only when the guest asks what their host recommends, never as a fallback when search_places finds nothing for a specific wish. Pass a category to get only the host's picks of that kind; show the ones you recommend with show_results.",
      scope: 'catalog:read',
      inputSchema: listHostPicksInput,
      outputSchema: listHostPicksOutput,
      annotations: readOnly,
    },
    listed,
    async handler(args, identity, { db, now }) {
      return { results: visible(await listHostPicks(db, catalogScope(identity), now(), args)) };
    },
  }),
  guestTool({
    name: 'search_events',
    config: {
      title: 'Search events',
      description:
        "Events in the destination during the guest's stay (from 3 days before arrival to 3 days after checkout), soonest first, in local time. Results show the guest nothing: call show_results with kind events and the ids your answer recommends.",
      scope: 'catalog:read',
      inputSchema: searchEventsInput,
      outputSchema: searchEventsOutput,
      annotations: readOnly,
    },
    listed,
    async handler(args, identity, { db, now, embedder }) {
      return visible(await searchEvents(db, catalogScope(identity), args, now(), embedder));
    },
  }),
  guestTool({
    name: 'get_weather',
    config: {
      title: 'Weather',
      description:
        "Weather at the guest's accommodation: the forecast for the asked day and the next two (MET Norway), the latest sea temperature and today's UV index from the nearest coastal station, and official DHMZ weather warnings in force. Credit the sources as given. If warnings is null, say you couldn't check warnings; never say there are none.",
      scope: 'catalog:read',
      inputSchema: getWeatherInput,
      outputSchema: getWeatherOutput,
      annotations: { ...readOnly, openWorldHint: true },
    },
    listed,
    async handler(args, identity, { db, now, weather }) {
      const place = visible(await weatherPlaceOf(db, identity.propertyId));
      const at = now();
      let date: string;
      try {
        date = weatherToolDate(place, args.date, at);
      } catch (error) {
        if (!(error instanceof WeatherDateError)) throw error;
        throw new GuestToolError(
          error.reason === 'past'
            ? 'I can only check the weather from today on.'
            : 'Forecasts reach about 8 days ahead; ask again closer to the day.',
        );
      }
      // Warnings in Croatian for Croatian guests; DHMZ publishes only hr and en.
      const language = identity.language === 'hr' ? 'hr' : 'en';
      try {
        return weatherToolResult(await weather.report(place, language, at), place, date, at);
      } catch (error) {
        if (error instanceof WeatherUnavailableError) {
          throw new GuestToolError('The weather services are not answering right now.');
        }
        throw error;
      }
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
    async handler(args, identity, { db, now, embedder }) {
      return {
        results: visible(
          await listTransportNotes(db, catalogScope(identity), args, now(), embedder),
        ),
      };
    },
  }),
  webFallbackTool,
];
