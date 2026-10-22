import { DateTime } from 'luxon';
import { assertStayDates } from '../stays/rules';
import type { CivilDate } from '../time';
import type { ParsedEvent } from './ical';
import type { CalendarEventStatus } from './vocabulary';

// The sync rules of one feed poll, free of the database: what we know plus what the feed says
// now go in, the actions to apply come out. ADR 0005 explains the UID-change pairing (rule 3).

export interface KnownEvent {
  id: string;
  uid: string;
  checkIn: CivilDate;
  checkout: CivilDate;
  summary: string | null;
  status: CalendarEventStatus;
  stayId: string | null;
  vanishedAt: Date | null;
}

/** An active Stay of the feed's unit. */
export interface UnitStay {
  id: string;
  checkIn: CivilDate;
  checkout: CivilDate;
  possiblyCancelled: boolean;
  /** Ids of linked events of the unit's other feeds that have not vanished. */
  presentLinkedEventIds: string[];
}

export type SyncAction =
  | {
      type: 'insert';
      uid: string;
      checkIn: CivilDate;
      checkout: CivilDate;
      summary: string | null;
      status: 'pending' | 'confirmed';
      stayId: string | null;
    }
  | { type: 'update'; id: string; checkIn: CivilDate; checkout: CivilDate; summary: string | null }
  | { type: 'touch'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'vanish'; id: string }
  | { type: 'reappear'; id: string }
  | { type: 'moveStay'; stayId: string; checkIn: CivilDate; checkout: CivilDate }
  | { type: 'flagPossiblyCancelled'; stayId: string }
  | { type: 'clearPossiblyCancelled'; stayId: string };

export interface PlanInput {
  known: readonly KnownEvent[];
  fetched: readonly ParsedEvent[];
  stays: readonly UnitStay[];
  zone: string;
  now: Date;
}

/** Not cancelled and dates a Stay could have (1-90 nights, not ended, at most 730 days ahead). */
function usable(event: ParsedEvent, zone: string, now: Date): boolean {
  if (event.cancelled) return false;
  try {
    assertStayDates(event, zone, now);
    return true;
  } catch {
    return false;
  }
}

const sameDates = (
  a: { checkIn: CivilDate; checkout: CivilDate },
  b: { checkIn: CivilDate; checkout: CivilDate },
) => a.checkIn === b.checkIn && a.checkout === b.checkout;

export function plan(input: PlanInput): SyncAction[] {
  const { known, stays, zone, now } = input;
  const today = DateTime.fromJSDate(now, { zone }).toISODate() as CivilDate;
  const fetched = new Map(
    input.fetched.filter((e) => usable(e, zone, now)).map((e) => [e.uid, e] as const),
  );
  const stayById = new Map(stays.map((s) => [s.id, s] as const));
  const knownUids = new Set(known.map((k) => k.uid));
  const actions: SyncAction[] = [];
  const moved = new Set<string>();
  const move = (stayId: string, dates: { checkIn: CivilDate; checkout: CivilDate }) => {
    if (moved.has(stayId)) return;
    moved.add(stayId);
    actions.push({ type: 'moveStay', stayId, checkIn: dates.checkIn, checkout: dates.checkout });
  };

  // 1. Known and present.
  for (const k of known) {
    const f = fetched.get(k.uid);
    if (!f) continue;
    const changed = !sameDates(k, f) || k.summary !== f.summary;
    actions.push(
      changed
        ? { type: 'update', id: k.id, checkIn: f.checkIn, checkout: f.checkout, summary: f.summary }
        : { type: 'touch', id: k.id },
    );
    if (k.status !== 'confirmed') continue;
    const stay = k.stayId ? stayById.get(k.stayId) : undefined;
    if (k.vanishedAt) {
      actions.push({ type: 'reappear', id: k.id });
      if (stay?.possiblyCancelled)
        actions.push({ type: 'clearPossiblyCancelled', stayId: stay.id });
    }
    if (stay && !sameDates(k, f) && !sameDates(stay, f)) move(stay.id, f);
  }

  // 2. Known and absent (missing, cancelled or unusable).
  const shownStays = new Set(
    known.filter((k) => k.stayId && fetched.has(k.uid)).map((k) => k.stayId as string),
  );
  const justVanished: { event: KnownEvent; stay: UnitStay | undefined; flag: boolean }[] = [];
  for (const k of known) {
    if (fetched.has(k.uid)) continue;
    if (k.status === 'pending') actions.push({ type: 'delete', id: k.id });
    if (k.status !== 'confirmed' || k.vanishedAt) continue;
    const stay = k.stayId ? stayById.get(k.stayId) : undefined;
    // Platforms drop started stays from their exports, so only a Stay still ahead is flagged.
    const flag =
      !!stay &&
      !stay.possiblyCancelled &&
      stay.checkIn >= today &&
      stay.presentLinkedEventIds.length === 0 &&
      !shownStays.has(stay.id);
    justVanished.push({ event: k, stay, flag });
  }

  // 3. A UID change: exactly one booking vanished and exactly one new one appeared.
  const fresh = [...fetched.values()].filter((f) => !knownUids.has(f.uid));
  const pairable = justVanished.filter((v) => v.stay);
  const paired = pairable.length === 1 && fresh.length === 1 ? pairable[0] : undefined;
  const pairedNew = paired ? fresh[0] : undefined;
  for (const v of justVanished) {
    if (v === paired) {
      actions.push({ type: 'delete', id: v.event.id });
      continue;
    }
    actions.push({ type: 'vanish', id: v.event.id });
    if (v.flag && v.stay) actions.push({ type: 'flagPossiblyCancelled', stayId: v.stay.id });
  }
  if (paired?.stay && pairedNew) {
    actions.push({
      type: 'insert',
      uid: pairedNew.uid,
      checkIn: pairedNew.checkIn,
      checkout: pairedNew.checkout,
      summary: pairedNew.summary,
      status: 'confirmed',
      stayId: paired.stay.id,
    });
    if (!sameDates(paired.stay, pairedNew)) move(paired.stay.id, pairedNew);
  }

  // 4. New UIDs: linked when an active Stay has the same dates, else proposed.
  for (const f of fresh) {
    if (f === pairedNew) continue;
    const stay = stays.find((s) => sameDates(s, f));
    actions.push({
      type: 'insert',
      uid: f.uid,
      checkIn: f.checkIn,
      checkout: f.checkout,
      summary: f.summary,
      status: stay ? 'confirmed' : 'pending',
      stayId: stay?.id ?? null,
    });
  }
  return actions;
}
