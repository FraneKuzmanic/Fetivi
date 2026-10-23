import { aboutMeFit } from '../about-me/fit';
import { getAboutMe } from '../about-me/store';
import {
  type CatalogScope,
  type EventSummary,
  type PlaceSummary,
  searchEvents,
  searchPlaces,
} from '../catalog/search';
import type { Db } from '../db/client';
import { getPlan } from '../plan/store';
import type { CivilDate } from '../time';
import { weatherPlaceOf } from '../weather/place';
import type { WeatherSource } from '../weather/source';
import type { SkyCode } from '../weather/vocabulary';
import type { DueTipSpace } from './due';
import { type DailyTipFacts, RAINY_SKIES, type TipRule } from './vocabulary';

// What a daily tip says. `pickDailyTip` is pure: the rule order over inputs gathered beforehand.
// Candidates keep `rankPlaces` order (fit, About me, quality, distance; bookable only breaks
// near-ties): nothing here reads an Offer or a commission.

/** Places and events a rule may pick from; more than one so planned ones can be skipped. */
const CANDIDATES = 10;

export interface TipInput {
  tomorrow: CivilDate;
  /** Tomorrow is a full Stay day (before checkout day). */
  fullDay: boolean;
  /** null: forecast unavailable, or no day for tomorrow. Never read as "no rain". */
  tomorrowSky: SkyCode | null;
  /** For the job's log only: whether the weather source answered. */
  weather: 'ok' | 'unavailable';
  /** Tomorrow's plan items (suggestions and booked Orders). */
  planned: { placeId: string | null }[];
  /** Rainy-day places in season tomorrow, ranked. */
  rainyPlaces: PlaceSummary[];
  /** Events on tomorrow matching About me interests, soonest first. */
  events: EventSummary[];
  /** Places and day trips in season tomorrow, ranked. */
  places: PlaceSummary[];
}

const isRainy = (sky: SkyCode | null) =>
  sky !== null && (RAINY_SKIES as readonly SkyCode[]).includes(sky);

/** The gap rule applies only to a full Stay day with nothing planned yet. */
const gapPossible = (input: Pick<TipInput, 'fullDay' | 'planned'>) =>
  input.fullDay && input.planned.length === 0;

function placeTip(rule: TipRule, date: CivilDate, p: PlaceSummary): DailyTipFacts {
  return {
    rule,
    date,
    recordId: p.id,
    kind: p.kind,
    title: p.title,
    startsAt: null,
    venueName: null,
    distanceKm: p.distanceKm,
  };
}

/** The first rule with a candidate wins: rain, then a matching event, then an empty day. */
export function pickDailyTip(input: TipInput): DailyTipFacts | null {
  const planned = new Set(input.planned.flatMap((p) => (p.placeId ? [p.placeId] : [])));
  const free = <T extends { id: string }>(list: T[]) => list.find((c) => !planned.has(c.id));

  if (isRainy(input.tomorrowSky)) {
    const place = free(input.rainyPlaces);
    if (place) return placeTip('rain', input.tomorrow, place);
  }

  const event = free(
    input.events.filter(
      (e) => e.startsAt.slice(0, 10) <= input.tomorrow && e.endsAt.slice(0, 10) >= input.tomorrow,
    ),
  );
  if (event) {
    return {
      rule: 'event',
      date: input.tomorrow,
      recordId: event.id,
      kind: 'event',
      title: event.title,
      startsAt: event.startsAt,
      venueName: event.venueName,
      distanceKm: event.distanceKm,
    };
  }

  if (gapPossible(input)) {
    const place = free(input.places);
    if (place) return placeTip('gap', input.tomorrow, place);
  }
  return null;
}

/** The forecast sky for `date`; null when it could not be checked or the forecast lacks the day. */
async function skyOn(
  db: Db,
  weather: Pick<WeatherSource, 'report'>,
  space: DueTipSpace,
  date: CivilDate,
  now: Date,
): Promise<Pick<TipInput, 'tomorrowSky' | 'weather'>> {
  try {
    const place = await weatherPlaceOf(db, space.propertyId);
    if (!place) return { tomorrowSky: null, weather: 'unavailable' };
    const report = await weather.report(place, space.language === 'hr' ? 'hr' : 'en', now);
    if (!report.forecast) return { tomorrowSky: null, weather: 'unavailable' };
    const sky = report.forecast.days.find((d) => d.date === date)?.sky ?? null;
    return { tomorrowSky: sky, weather: 'ok' };
  } catch {
    return { tomorrowSky: null, weather: 'unavailable' };
  }
}

/** Reads what the rules need for one due space, running each search only when a rule can use it. */
export async function gatherTipInput(
  db: Db,
  weather: Pick<WeatherSource, 'report'>,
  space: DueTipSpace,
  now: Date,
): Promise<TipInput> {
  const aboutMe = await getAboutMe(db, space.spaceId);
  const scope: CatalogScope = {
    destinationId: space.destinationId,
    propertyId: space.propertyId,
    stayId: space.stayId,
    language: space.language,
    aboutMe: aboutMeFit(aboutMe),
  };
  const [plan, sky] = await Promise.all([
    getPlan(db, { spaceId: space.spaceId, language: space.language }, now, {
      date: space.tomorrow,
    }),
    skyOn(db, weather, space, space.tomorrow, now),
  ]);
  const planned = plan.days.flatMap((d) => d.items.map((i) => ({ placeId: i.placeId })));
  const places = (rainyDay: boolean) =>
    searchPlaces(
      db,
      scope,
      {
        date: space.tomorrow,
        rainyDay,
        countRecommendation: false,
        includeHostAdded: false,
        limit: CANDIDATES,
      },
      now,
    ).then((r) => r?.results ?? []);

  const { tomorrowSky } = sky;
  const rainyPlaces = isRainy(tomorrowSky) ? await places(true) : [];
  const events =
    aboutMe.interests.length > 0
      ? ((
          await searchEvents(
            db,
            scope,
            { from: space.tomorrow, to: space.tomorrow, interests: aboutMe.interests },
            now,
          )
        )?.results ?? [])
      : [];
  return {
    tomorrow: space.tomorrow,
    fullDay: space.fullDay,
    ...sky,
    planned,
    rainyPlaces,
    events,
    places: gapPossible({ fullDay: space.fullDay, planned }) ? await places(false) : [],
  };
}
