import type { CivilDate, GuestLanguage, GuestProjection, StayPhase } from '@fetivi/domain';
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
