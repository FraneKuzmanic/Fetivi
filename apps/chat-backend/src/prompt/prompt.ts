import {
  type AboutMe,
  type Budget,
  type CivilDate,
  type GuestLanguage,
  type GuestProjection,
  type Interest,
  isAboutMeEmpty,
  type Need,
  type Pace,
  type PartyShape,
  type StayPhase,
} from '@fetivi/domain';
import type { SystemModelMessage } from 'ai';
import { DateTime } from 'luxon';
import { INSTRUCTIONS } from './instructions';

/** The conversation's frozen top-level system text: instructions then the projection. */
export function buildSystemText(projection: GuestProjection): string {
  return `${INSTRUCTIONS}\n\n<unit_record>\n${JSON.stringify(projection)}\n</unit_record>`;
}

/**
 * The streamText `instructions`: one system block with the cache breakpoint after it, so tools
 * and system are read from the cache on every later turn.
 */
export function systemInstructions(systemText: string): SystemModelMessage[] {
  return [
    {
      role: 'system',
      content: systemText,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
  ];
}

const LANGUAGE_NAMES_EN: Record<GuestLanguage, string> = {
  en: 'English',
  hr: 'Croatian',
  de: 'German',
  it: 'Italian',
  pl: 'Polish',
  hu: 'Hungarian',
  fr: 'French',
};

/** JSON with object keys sorted: the stored projection is jsonb, which does not keep key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

/** Top-level sections whose content differs, as one note; null when nothing changed. */
export function projectionChangeNote(
  before: GuestProjection,
  after: GuestProjection,
): string | null {
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof GuestProjection)[]) {
    if (canonical(before[key]) !== canonical(after[key])) changed[key] = after[key];
  }
  if (Object.keys(changed).length === 0) return null;
  const lines = [
    'The unit record changed. These sections replace the earlier ones:',
    '<unit_record_update>',
    JSON.stringify(changed),
    '</unit_record_update>',
  ];
  if ('language' in changed) {
    const name = LANGUAGE_NAMES_EN[after.language];
    lines.push(`The guest switched the language to ${name}; answer in ${name} from now on.`);
  }
  return lines.join('\n');
}

const PHASE_WORDS: Record<StayPhase, string> = {
  upcoming: 'have not arrived yet',
  in_stay: 'are staying now',
  ended: 'have checked out',
};

const DAY_FORMAT = 'cccc d LLLL yyyy';

/**
 * The situation note's text; appended only when it differs from the last one. The time is
 * rounded down to 15 minutes, so a note is added at most every quarter hour.
 */
export function situationNote(input: {
  now: Date;
  timezone: string;
  checkIn: CivilDate;
  checkout: CivilDate;
  phase: StayPhase;
}): string {
  const local = DateTime.fromJSDate(input.now, { zone: input.timezone }).setLocale('en-GB');
  const rounded = local.set({
    minute: Math.floor(local.minute / 15) * 15,
    second: 0,
    millisecond: 0,
  });
  const day = (d: CivilDate) => DateTime.fromISO(d).setLocale('en-GB').toFormat(DAY_FORMAT);
  return (
    `Situation: it is ${rounded.toFormat(`${DAY_FORMAT}, HH:mm`)} in ${input.timezone}. ` +
    `The stay runs from ${day(input.checkIn)} to ${day(input.checkout)}; ` +
    `the guests ${PHASE_WORDS[input.phase]}.`
  );
}

/** English phrases for the About me codes: the note is for the model, which answers in the guest's language. */
export const ABOUT_ME_EN: {
  party: Record<PartyShape, string>;
  interests: Record<Interest, string>;
  pace: Record<Pace, string>;
  budget: Record<Budget, string>;
  needs: Record<Need, string>;
} = {
  party: {
    solo: 'one person travelling alone',
    couple: 'a couple',
    family: 'a family with children',
    friends: 'a group of friends',
    group: 'a group',
  },
  interests: {
    beaches: 'beaches and swimming',
    sights: 'history and sights',
    food: 'food and wine',
    nature: 'nature and walks',
    day_trips: 'boat and day trips',
    active: 'sport and activities',
    nightlife: 'nightlife',
    shopping: 'markets and shopping',
    slow: 'slow, relaxed days',
  },
  pace: { easy: 'take it easy', mixed: 'a bit of both', full: 'pack the days' },
  budget: { simple: 'keep it simple', mid: 'mid-range', treat: 'happy to treat themselves' },
  needs: {
    gluten_free: 'gluten-free (coeliac)',
    food_allergy: 'a food allergy',
    halal: 'halal food',
    kosher: 'kosher food',
    step_free: 'step-free access or a wheelchair',
    limited_mobility: 'limited mobility',
  },
};

/**
 * The About me note's text, appended when it differs from the last one. Null while nothing was ever
 * saved (`previous` null and About me empty); an emptied About me says so once.
 */
export function aboutMeNote(aboutMe: AboutMe, previous: string | null): string | null {
  if (isAboutMeEmpty(aboutMe)) {
    return previous === null
      ? null
      : "About me is now empty: the guests removed what they had shared. Don't rely on earlier preferences.";
  }
  const en = ABOUT_ME_EN;
  const parts: string[] = [];
  if (aboutMe.party) parts.push(`travelling as ${en.party[aboutMe.party]}`);
  if (aboutMe.interests.length) {
    parts.push(`they enjoy ${aboutMe.interests.map((i) => en.interests[i]).join(', ')}`);
  }
  if (aboutMe.pace) parts.push(`pace: ${en.pace[aboutMe.pace]}`);
  if (aboutMe.budget) parts.push(`budget: ${en.budget[aboutMe.budget]}`);
  const head =
    "About me (what the guests chose to share; use it to tailor suggestions, don't recite it):";
  const body = parts.length ? ` ${parts.join('; ')}.` : '';
  const needs = aboutMe.needs.length
    ? ` Needs they added themselves: ${aboutMe.needs.map((n) => en.needs[n]).join(', ')}.`
    : '';
  return `${head}${body}${needs}`;
}
