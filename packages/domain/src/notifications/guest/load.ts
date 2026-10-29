import { and, asc, eq, sql } from 'drizzle-orm';
import { findConversation } from '../../conversations/store';
import type { Executor } from '../../db/client';
import { calendarEvents, calendarFeeds } from '../../db/schema/calendar';
import { handoffMessages } from '../../db/schema/handoff';
import { offers, offerTranslations } from '../../db/schema/offers';
import { orderEvents, orderProposals, orders } from '../../db/schema/orders';
import { properties, units } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import { stays } from '../../db/schema/stays';
import { cancellationTermsAt, lateChargePercent, orderStart } from '../../orders/refunds';
import type { GuestLanguage } from '../../property/vocabulary';
import { endOfCivilDay, toLocalDateTime } from '../../time';
import type { GuestNoticeFacts } from './compose';
import { type GuestNotifyJobData, guestNotificationKey } from './enqueue';
import { isEmailSuppressed } from './suppressions';
import { type GuestNotificationKind, isOrderGuestKind } from './vocabulary';

/** Everything a guest notification needs to be delivered. Never the PIN, codes or Wi-Fi. */
export interface GuestNotice {
  key: string;
  kind: GuestNotificationKind;
  spaceId: string;
  language: GuestLanguage;
  /** Null before the guest's first chat turn: the inbox channel is skipped. */
  conversationId: string | null;
  /** False once the Stay has ended: push is skipped. */
  spaceOpen: boolean;
  /** The address to email, or null: none given, not verified, or suppressed. */
  email: string | null;
  orderId: string | null;
  facts: GuestNoticeFacts;
}

const NO_FACTS: GuestNoticeFacts = {
  offerTitle: null,
  date: null,
  startTime: null,
  checkoutTime: null,
  reviewPlatform: null,
  safety: null,
  tip: null,
  freeCancellationEnded: false,
};

interface Base {
  spaceId: string;
  email: string | null;
  orderId: string | null;
  facts: GuestNoticeFacts;
}

/**
 * Gathers the facts for one notification at send time, or null when it should not be sent: an
 * unknown row, a reminder whose Order moved on, a Stay notice for a closed or possibly cancelled
 * Stay, a host reply not delivered to the inbox.
 */
export async function loadGuestNotice(
  db: Executor,
  data: GuestNotifyJobData,
  now: Date,
): Promise<GuestNotice | null> {
  const base = await loadBase(db, data, now);
  if (!base) return null;
  const [space] = await db
    .select({
      language: spaces.language,
      email: spaces.email,
      emailVerifiedAt: spaces.emailVerifiedAt,
      tipsEmailOptInAt: spaces.tipsEmailOptInAt,
      closedAt: spaces.closedAt,
    })
    .from(spaces)
    .where(eq(spaces.id, base.spaceId));
  if (!space) return null;
  // Order kinds email the Order's own address; updates go only to a verified space email, and
  // daily tips only with their separate opt-in as well.
  const verified = space.emailVerifiedAt ? space.email : null;
  let email =
    data.kind === 'daily_tip'
      ? space.tipsEmailOptInAt
        ? verified
        : null
      : (base.email ?? verified);
  if (email && (await isEmailSuppressed(db, email))) email = null;
  const conversation = await findConversation(db, base.spaceId);
  return {
    key: guestNotificationKey({ ...data, spaceId: base.spaceId }),
    kind: data.kind,
    spaceId: base.spaceId,
    language: space.language,
    conversationId: conversation?.id ?? null,
    spaceOpen: space.closedAt > now,
    email,
    orderId: base.orderId,
    facts: base.facts,
  };
}

async function loadBase(db: Executor, data: GuestNotifyJobData, now: Date): Promise<Base | null> {
  if (isOrderGuestKind(data.kind) || data.kind === 'order_reminder') {
    return loadOrderBase(db, data, now);
  }
  if (data.kind === 'weather_warning' || data.kind === 'ferry_disruption') {
    return loadSafetyBase(db, data, now);
  }
  if (data.kind === 'daily_tip') return loadTipBase(db, data, now);
  if (data.kind === 'host_reply') {
    if (!data.handoffId) return null;
    const [row] = await db
      .select({
        spaceId: handoffMessages.spaceId,
        deliveredAt: handoffMessages.replyDeliveredAt,
      })
      .from(handoffMessages)
      .where(eq(handoffMessages.id, data.handoffId));
    if (!row?.deliveredAt) return null;
    return { spaceId: row.spaceId, email: null, orderId: null, facts: NO_FACTS };
  }
  return loadStayBase(db, data, now);
}

async function loadOrderBase(
  db: Executor,
  data: GuestNotifyJobData,
  now: Date,
): Promise<Base | null> {
  if (!data.orderId || !data.proposalId) return null;
  const [row] = await db
    .select({
      order: {
        id: orders.id,
        spaceId: orders.spaceId,
        status: orders.status,
        currentProposalId: orders.currentProposalId,
        guestEmail: orders.guestEmail,
        availabilityMode: orders.availabilityMode,
        freeCancelHoursBefore: orders.freeCancelHoursBefore,
        refundPercentAfter: orders.refundPercentAfter,
      },
      proposal: { date: orderProposals.date, startsAt: orderProposals.startsAt },
      sourceTitle: offers.title,
      translatedTitle: offerTranslations.title,
      zone: properties.timezone,
    })
    .from(orders)
    .innerJoin(orderProposals, eq(orderProposals.orderId, orders.id))
    .innerJoin(offers, eq(offers.id, orders.offerId))
    .innerJoin(spaces, eq(spaces.id, orders.spaceId))
    .leftJoin(
      offerTranslations,
      and(
        eq(offerTranslations.offerId, offers.id),
        eq(offerTranslations.revision, offers.publishedRevision),
        eq(offerTranslations.language, spaces.language),
      ),
    )
    .innerJoin(stays, eq(stays.id, orders.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(orders.id, data.orderId), eq(orderProposals.id, data.proposalId)));
  if (!row) return null;
  if (data.kind === 'order_reminder') {
    if (row.order.status !== 'confirmed' || row.order.currentProposalId !== data.proposalId) {
      return null;
    }
    // Property time throughout, as the machine schedules the reminder and the receipts show it.
    const startsAt = row.proposal.startsAt ?? endOfCivilDay(row.proposal.date, row.zone);
    if (startsAt <= now) return null;
  }
  return {
    spaceId: row.order.spaceId,
    email: row.order.guestEmail,
    orderId: row.order.id,
    facts: {
      ...NO_FACTS,
      offerTitle: row.translatedTitle ?? row.sourceTitle,
      date: row.proposal.date,
      startTime: row.proposal.startsAt
        ? toLocalDateTime(row.proposal.startsAt, row.zone).slice(11)
        : null,
      freeCancellationEnded:
        data.kind === 'order_confirmed' &&
        row.order.availabilityMode === 'on_request' &&
        (await acceptedAfterCutoff(db, data.orderId, data.proposalId, row, now)),
    },
  };
}

/**
 * A request is free to cancel until accepted (ADR 0028); accepted after its cutoff, it is not
 * free from that moment, and the guest is told so. Under no late charge it stays free.
 */
async function acceptedAfterCutoff(
  db: Executor,
  orderId: string,
  proposalId: string,
  row: {
    order: { freeCancelHoursBefore: number; refundPercentAfter: number };
    proposal: { date: string; startsAt: Date | null };
    zone: string;
  },
  now: Date,
): Promise<boolean> {
  const late = lateChargePercent(row.order.refundPercentAfter);
  if (late === 0) return false;
  const [confirmed] = await db
    .select({ at: sql<Date | null>`max(${orderEvents.createdAt})`.mapWith(orderEvents.createdAt) })
    .from(orderEvents)
    .where(
      and(
        eq(orderEvents.orderId, orderId),
        eq(orderEvents.proposalId, proposalId),
        eq(orderEvents.toStatus, 'confirmed'),
      ),
    );
  return cancellationTermsAt(
    { freeCancelHoursBefore: row.order.freeCancelHoursBefore, lateChargePercent: late },
    orderStart(row.proposal, row.zone),
    row.zone,
    confirmed?.at ?? now,
  ).freeWindowPassed;
}

/**
 * Safety goes to every open Space, a possibly cancelled Stay included. A warning that has expired
 * by send time is dropped; a ferry notice is still sent when its Order has moved on, since it is
 * about the line, not the Order.
 */
async function loadSafetyBase(
  db: Executor,
  data: GuestNotifyJobData,
  now: Date,
): Promise<Base | null> {
  const { spaceId, safety } = data;
  if (!spaceId || !safety) return null;
  if (safety.source === 'DHMZ' && Date.parse(safety.expires) <= now.getTime()) return null;
  const [row] = await db
    .select({ closedAt: spaces.closedAt })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!row || row.closedAt <= now) return null;
  const item = safety.source === 'DHMZ' ? safety.advisory : safety.affected;
  return {
    spaceId,
    email: null,
    orderId: safety.source === 'Jadrolinija' ? safety.affected.orderId : null,
    facts: {
      ...NO_FACTS,
      offerTitle: item?.title ?? null,
      date: item?.date ?? null,
      startTime: item?.startTime ?? null,
      safety,
    },
  };
}

/** A daily tip goes only to an open space of a Stay not possibly cancelled; its facts travel in the job. */
async function loadTipBase(
  db: Executor,
  data: GuestNotifyJobData,
  now: Date,
): Promise<Base | null> {
  const { spaceId, tip } = data;
  if (!spaceId || !tip) return null;
  const [row] = await db
    .select({ closedAt: spaces.closedAt, possiblyCancelled: stays.possiblyCancelled })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .where(eq(spaces.id, spaceId));
  if (!row || row.closedAt <= now || row.possiblyCancelled) return null;
  // An event starting tomorrow shows its time; one already running shows the day only.
  const startTime = tip.startsAt?.slice(0, 10) === tip.date ? tip.startsAt.slice(11) : null;
  return {
    spaceId,
    email: null,
    orderId: null,
    facts: { ...NO_FACTS, offerTitle: tip.title, date: tip.date, startTime, tip },
  };
}

async function loadStayBase(
  db: Executor,
  data: GuestNotifyJobData,
  now: Date,
): Promise<Base | null> {
  if (!data.spaceId) return null;
  const [row] = await db
    .select({
      stayId: stays.id,
      closedAt: spaces.closedAt,
      possiblyCancelled: stays.possiblyCancelled,
      // The unit's own checkout time, else the property's (a null unit field inherits).
      checkoutTime: sql<string | null>`coalesce(${units.checkoutTime}, ${properties.checkoutTime})`,
    })
    .from(spaces)
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(spaces.id, data.spaceId));
  if (!row || row.closedAt <= now || row.possiblyCancelled) return null;
  if (data.kind !== 'checkout_reminder') {
    return { spaceId: data.spaceId, email: null, orderId: null, facts: NO_FACTS };
  }
  // The platform of the calendar feed whose event proposed this Stay; none when registered by hand.
  const [feed] = await db
    .select({ source: calendarFeeds.source })
    .from(calendarEvents)
    .innerJoin(calendarFeeds, eq(calendarFeeds.id, calendarEvents.feedId))
    .where(eq(calendarEvents.stayId, row.stayId))
    .orderBy(asc(calendarEvents.createdAt))
    .limit(1);
  return {
    spaceId: data.spaceId,
    email: null,
    orderId: null,
    facts: {
      ...NO_FACTS,
      checkoutTime: row.checkoutTime?.slice(0, 5) ?? null,
      reviewPlatform: feed?.source ?? null,
    },
  };
}
