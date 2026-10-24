import { and, asc, eq, gt, inArray, lte, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../db/client';
import { conversations, messages } from '../db/schema/conversations';
import { offers, providers } from '../db/schema/offers';
import { orderProposals, orders } from '../db/schema/orders';
import { type KeptMessage, keptConversations, orderLedger } from '../db/schema/retention';
import { spaces } from '../db/schema/spaces';
import { isFinalOrderStatus, type PaymentStatus } from '../orders/vocabulary';
import { SPACE_READ_ONLY_MS } from '../spaces/vocabulary';
import { LEDGER_KEEP_YEARS, RETENTION_BATCH, SETTLED_PAYMENT_STATUSES } from './vocabulary';

export interface RetentionCounts {
  /** Spaces deleted. */
  deleted: number;
  /** Conversations copied to kept_conversations. */
  kept: number;
  /** Due Spaces left for a later run: an Order or payment is not settled yet. */
  held: number;
  /** order_ledger rows written. */
  ledger: number;
  /** order_ledger rows past their 11 years, deleted. */
  purged: number;
}

type SpaceOutcome = 'gone' | 'held' | { kept: boolean; ledger: number };

const isSettledPayment = (status: PaymentStatus): boolean =>
  (SETTLED_PAYMENT_STATUSES as readonly PaymentStatus[]).includes(status);

/**
 * The daily retention run (PRD §6.5, architecture §4.3): every Space whose read-only period has
 * ended is deleted with everything that cascades from it — conversation, About me, plan, saved
 * places, handoff messages, notifications, tokens and the Orders with their personal data. Each
 * Order first leaves an order_ledger row, and an opted-in conversation a kept copy. A Space with
 * an Order or payment that may still change is held for a later run.
 */
export async function runRetention(db: Db, now: Date): Promise<RetentionCounts> {
  const counts: RetentionCounts = { deleted: 0, kept: 0, held: 0, ledger: 0, purged: 0 };
  // readOnlyEndsAt(closedAt) <= now
  const cutoff = new Date(now.getTime() - SPACE_READ_ONLY_MS);
  let after: { closedAt: Date; id: string } | null = null;
  for (;;) {
    const page: { id: string; closedAt: Date }[] = await db
      .select({ id: spaces.id, closedAt: spaces.closedAt })
      .from(spaces)
      .where(
        and(
          lte(spaces.closedAt, cutoff),
          after
            ? or(
                gt(spaces.closedAt, after.closedAt),
                and(eq(spaces.closedAt, after.closedAt), gt(spaces.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(spaces.closedAt), asc(spaces.id))
      .limit(RETENTION_BATCH);
    if (page.length === 0) break;
    for (const { id } of page) {
      const outcome = await retainSpace(db, id, now);
      if (outcome === 'gone') continue;
      if (outcome === 'held') {
        counts.held++;
        continue;
      }
      counts.deleted++;
      counts.ledger += outcome.ledger;
      if (outcome.kept) counts.kept++;
    }
    after = page[page.length - 1] ?? null;
  }
  const purged = await db
    .delete(orderLedger)
    .where(lte(orderLedger.keepUntil, now))
    .returning({ orderId: orderLedger.orderId });
  counts.purged = purged.length;
  return counts;
}

/** One Space in its own transaction: ledger rows, the kept copy if opted in, then the delete. */
function retainSpace(db: Db, spaceId: string, now: Date): Promise<SpaceOutcome> {
  return db.transaction(async (tx): Promise<SpaceOutcome> => {
    const [space] = await tx.select().from(spaces).where(eq(spaces.id, spaceId)).for('update');
    // Another run took it.
    if (!space) return 'gone';

    const rows = await tx
      .select({
        order: orders,
        proposal: orderProposals,
        offerTitle: offers.title,
        providerId: offers.providerId,
        hostId: offers.hostId,
        providerName: providers.name,
      })
      .from(orders)
      .innerJoin(offers, eq(offers.id, orders.offerId))
      .leftJoin(orderProposals, eq(orderProposals.id, orders.currentProposalId))
      .leftJoin(providers, eq(providers.id, offers.providerId))
      .where(eq(orders.spaceId, spaceId));
    if (
      rows.some(
        (r) => !isFinalOrderStatus(r.order.status) || !isSettledPayment(r.order.paymentStatus),
      )
    ) {
      return 'held';
    }

    let ledger = 0;
    if (rows.length > 0) {
      const keepUntil = DateTime.fromJSDate(space.closedAt)
        .plus({ years: LEDGER_KEEP_YEARS })
        .toJSDate();
      const written = await tx
        .insert(orderLedger)
        .values(
          rows.map((r) => ({
            orderId: r.order.id,
            offerId: r.order.offerId,
            offerTitle: r.offerTitle,
            providerId: r.providerId,
            providerName: r.providerName,
            hostId: r.hostId,
            date: r.order.date,
            startsAt: r.proposal?.startsAt ?? null,
            quantity: r.order.quantity,
            priceMinor: r.proposal?.priceMinor ?? null,
            currency: r.order.currency,
            paymentMode: r.order.paymentMode,
            commissionBp: r.order.commissionBp,
            status: r.order.status,
            paymentStatus: r.order.paymentStatus,
            guestEmail: r.order.guestEmail,
            orderCreatedAt: r.order.createdAt,
            recordedAt: now,
            keepUntil,
          })),
        )
        .onConflictDoNothing({ target: orderLedger.orderId })
        .returning({ orderId: orderLedger.orderId });
      ledger = written.length;
    }

    let kept = false;
    if (space.evaluationOptInAt !== null) {
      const [conversation] = await tx
        .select({ id: conversations.id, createdAt: conversations.createdAt })
        .from(conversations)
        .where(eq(conversations.spaceId, spaceId));
      if (conversation) {
        const chat = await tx
          .select({ role: messages.role, parts: messages.parts, createdAt: messages.createdAt })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversation.id),
              eq(messages.kind, 'chat'),
              inArray(messages.role, ['user', 'assistant']),
            ),
          )
          .orderBy(asc(messages.seq));
        const copied = await tx
          .insert(keptConversations)
          .values({
            conversationId: conversation.id,
            language: space.language,
            startedAt: conversation.createdAt,
            messages: chat.map(
              (m): KeptMessage => ({
                role: m.role as KeptMessage['role'],
                parts: m.parts,
                createdAt: m.createdAt.toISOString(),
              }),
            ),
            keptAt: now,
          })
          .onConflictDoNothing({ target: keptConversations.conversationId })
          .returning({ id: keptConversations.conversationId });
        kept = copied.length > 0;
      }
    }

    await tx.delete(spaces).where(eq(spaces.id, spaceId));
    return { kept, ledger };
  });
}
