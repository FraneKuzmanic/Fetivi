import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db, Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { orders } from '../db/schema/orders';
import { planItems } from '../db/schema/plan';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { type GuestOfferScope, getGuestOffer } from '../offers/guest';
import type { OrderStatus } from '../orders/vocabulary';
import { stripMarkup } from '../property/sanitize';
import type { GuestLanguage } from '../property/vocabulary';
import { listSpaceOrders } from '../services/pending/create-order';
import type { CivilDate } from '../time';
import { PLAN_LIMITS, PLAN_TIME, type PlanItemKind } from './vocabulary';

// One living day plan per Space (architecture §4.2 PlanItem). Suggestions are stored rows;
// booked items are read from the Space's Orders at plan time, so the Order machine stays the
// only writer of Order statuses and a cancelled Order leaves the plan by itself.

export type PlanRuleCode =
  | 'date-outside-stay'
  | 'day-full'
  | 'booked-item'
  | 'not-found'
  | 'place-not-visible'
  | 'offer-not-visible'
  | 'invalid-input';

export class PlanRuleError extends Error {
  override name = 'PlanRuleError';
  constructor(readonly code: PlanRuleCode) {
    super(code);
  }
}

export interface PlanItem {
  /** The plan item's id, or the Order's id for a booked item. */
  id: string;
  kind: PlanItemKind;
  date: CivilDate;
  /** 'HH:mm' at the property; null = any time. */
  time: string | null;
  title: string;
  note: string | null;
  placeId: string | null;
  offerId: string | null;
  /** Booked items only. */
  orderId: string | null;
  orderStatus: OrderStatus | null;
}

export interface PlanDay {
  date: CivilDate;
  items: PlanItem[];
}

export interface Plan {
  checkIn: CivilDate;
  checkout: CivilDate;
  /** The property's current civil day. */
  today: CivilDate;
  days: PlanDay[];
}

/** Who is asking: the Space, its guest language and the Offers its token may see. */
export interface PlanContext {
  spaceId: string;
  language: GuestLanguage;
  offerScope: GuestOfferScope;
}

interface PlanFields {
  time?: string | null;
  note?: string | null;
  placeId?: string | null;
  offerId?: string | null;
}

export interface PlanUpdate {
  add?: ({ date: string; title: string } & PlanFields)[];
  update?: ({ itemId: string; date?: string; title?: string } & PlanFields)[];
  remove?: string[];
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKED: OrderStatus[] = ['confirmed', 'completed'];

async function planStay(db: Executor, spaceId: string) {
  const [row] = await db
    .select({ checkIn: stays.checkIn, checkout: stays.checkout, zone: properties.timezone })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(spaces.id, spaceId));
  if (!row) throw new PlanRuleError('not-found');
  return row;
}

type Stay = Awaited<ReturnType<typeof planStay>>;

/** A valid civil date inside the Stay (check-in to checkout inclusive), else a rule error. */
function stayDate(stay: Stay, date: string): CivilDate {
  if (!CIVIL_DATE.test(date) || !DateTime.fromISO(date).isValid) {
    throw new PlanRuleError('invalid-input');
  }
  // ISO civil dates compare correctly as strings.
  if (date < stay.checkIn || date > stay.checkout) throw new PlanRuleError('date-outside-stay');
  return date;
}

function stayDays(stay: Stay): CivilDate[] {
  const start = DateTime.fromISO(stay.checkIn);
  const days: CivilDate[] = [];
  for (let d = start; (d.toISODate() as CivilDate) <= stay.checkout; d = d.plus({ days: 1 })) {
    days.push(d.toISODate() as CivilDate);
  }
  return days;
}

/** Timed items by time, then any-time ones; booked first on a tie, then oldest first. */
function byTime(a: PlanItem & { at: number }, b: PlanItem & { at: number }): number {
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time < b.time ? -1 : 1;
  }
  if (a.kind !== b.kind) return a.kind === 'order' ? -1 : 1;
  return a.at - b.at;
}

/** The Space's plan: every Stay day, or only `options.date`, with suggestions and booked Orders. */
export async function getPlan(
  db: Executor,
  ctx: Pick<PlanContext, 'spaceId' | 'language'>,
  now: Date,
  options: { date?: string } = {},
): Promise<Plan> {
  const stay = await planStay(db, ctx.spaceId);
  const only = options.date === undefined ? undefined : stayDate(stay, options.date);
  const dates = only ? [only] : stayDays(stay);
  const rows = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.spaceId, ctx.spaceId), only ? eq(planItems.date, only) : undefined));
  const booked = (await listSpaceOrders(db, ctx.spaceId, ctx.language)).filter(
    (o) => BOOKED.includes(o.status) && dates.includes(o.date),
  );
  const items: (PlanItem & { at: number })[] = [
    ...rows.map((r) => ({
      id: r.id,
      kind: 'suggestion' as const,
      date: r.date,
      time: r.startTime,
      title: r.title,
      note: r.note,
      placeId: r.placeId,
      offerId: r.offerId,
      orderId: null,
      orderStatus: null,
      at: r.createdAt.getTime(),
    })),
    ...booked.map((o) => ({
      id: o.id,
      kind: 'order' as const,
      date: o.date,
      time: o.startsAtLocal?.slice(11) ?? null,
      title: o.offerTitle,
      note: null,
      placeId: null,
      offerId: o.offerId,
      orderId: o.id,
      orderStatus: o.status,
      at: Date.parse(o.createdAt),
    })),
  ];
  return {
    checkIn: stay.checkIn,
    checkout: stay.checkout,
    today: DateTime.fromJSDate(now, { zone: stay.zone }).toISODate() as CivilDate,
    days: dates.map((date) => ({
      date,
      items: items
        .filter((i) => i.date === date)
        .sort(byTime)
        .map(({ at: _at, ...item }) => item),
    })),
  };
}

function cleanText(value: string, max: number): string {
  const text = stripMarkup(value, { singleLine: true });
  if (text.length === 0 || text.length > max) throw new PlanRuleError('invalid-input');
  return text;
}

function cleanNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = stripMarkup(value, { singleLine: true });
  if (text.length > PLAN_LIMITS.noteChars) throw new PlanRuleError('invalid-input');
  return text.length === 0 ? null : text;
}

function cleanTime(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!PLAN_TIME.test(value)) throw new PlanRuleError('invalid-input');
  return value;
}

/** A published place or day trip in the Space's destination (the savePlace rule). */
async function checkPlace(db: Executor, ctx: PlanContext, placeId: string | null | undefined) {
  if (placeId === undefined || placeId === null) return;
  const destinationId = ctx.offerScope.destinationId;
  if (destinationId === null || !UUID.test(placeId)) throw new PlanRuleError('place-not-visible');
  const [record] = await db
    .select({ id: catalogRecords.id })
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.id, placeId),
        eq(catalogRecords.destinationId, destinationId),
        isNotNull(catalogRecords.publishedRevision),
        inArray(catalogRecords.kind, ['place', 'day_trip']),
      ),
    );
  if (!record) throw new PlanRuleError('place-not-visible');
}

async function checkOffer(db: Executor, ctx: PlanContext, offerId: string | null | undefined) {
  if (offerId === undefined || offerId === null) return;
  if (!(await getGuestOffer(db, ctx.offerScope, offerId))) {
    throw new PlanRuleError('offer-not-visible');
  }
}

/** The Space's suggestion row; a booked Order's id is `booked-item`, anything else `not-found`. */
async function ownItem(db: Executor, spaceId: string, itemId: string) {
  if (!UUID.test(itemId)) throw new PlanRuleError('not-found');
  const [row] = await db
    .select()
    .from(planItems)
    .where(and(eq(planItems.id, itemId), eq(planItems.spaceId, spaceId)));
  if (row) return row;
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.id, itemId), eq(orders.spaceId, spaceId)));
  throw new PlanRuleError(order ? 'booked-item' : 'not-found');
}

/**
 * Adds, changes and removes suggestions in one transaction, all or nothing. Returns the plan
 * narrowed to the touched days (old and new dates of moved items).
 */
export async function updatePlan(
  db: Db,
  ctx: PlanContext,
  input: PlanUpdate,
  now: Date,
): Promise<Plan> {
  const add = input.add ?? [];
  const update = input.update ?? [];
  const remove = input.remove ?? [];
  const ops = add.length + update.length + remove.length;
  if (ops < 1 || ops > PLAN_LIMITS.opsPerCall) throw new PlanRuleError('invalid-input');
  return db.transaction(async (tx) => {
    const stay = await planStay(tx, ctx.spaceId);
    const touched = new Set<CivilDate>();

    for (const itemId of remove) {
      const row = await ownItem(tx, ctx.spaceId, itemId);
      await tx.delete(planItems).where(eq(planItems.id, row.id));
      touched.add(row.date);
    }

    for (const change of update) {
      const row = await ownItem(tx, ctx.spaceId, change.itemId);
      const date = change.date === undefined ? row.date : stayDate(stay, change.date);
      await checkPlace(tx, ctx, change.placeId);
      await checkOffer(tx, ctx, change.offerId);
      await tx
        .update(planItems)
        .set({
          date,
          ...(change.time !== undefined && { startTime: cleanTime(change.time) }),
          ...(change.title !== undefined && {
            title: cleanText(change.title, PLAN_LIMITS.titleChars),
          }),
          ...(change.note !== undefined && { note: cleanNote(change.note) }),
          ...(change.placeId !== undefined && { placeId: change.placeId }),
          ...(change.offerId !== undefined && { offerId: change.offerId }),
          updatedAt: now,
        })
        .where(eq(planItems.id, row.id));
      touched.add(row.date).add(date);
    }

    for (const item of add) {
      const date = stayDate(stay, item.date);
      await checkPlace(tx, ctx, item.placeId);
      await checkOffer(tx, ctx, item.offerId);
      await tx.insert(planItems).values({
        spaceId: ctx.spaceId,
        date,
        startTime: cleanTime(item.time),
        title: cleanText(item.title, PLAN_LIMITS.titleChars),
        note: cleanNote(item.note),
        placeId: item.placeId ?? null,
        offerId: item.offerId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      touched.add(date);
    }

    const counts = await tx
      .select({ date: planItems.date, n: sql<number>`count(*)::int` })
      .from(planItems)
      .where(and(eq(planItems.spaceId, ctx.spaceId), inArray(planItems.date, [...touched])))
      .groupBy(planItems.date);
    if (counts.some((c) => c.n > PLAN_LIMITS.suggestionsPerDay)) {
      throw new PlanRuleError('day-full');
    }

    const full = await getPlan(tx, ctx, now);
    return { ...full, days: full.days.filter((d) => touched.has(d.date)) };
  });
}
