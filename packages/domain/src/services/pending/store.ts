import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../../db/client';
import { type PendingActionRow, pendingActions } from '../../db/schema/pending-actions';
import type { HostMessageDraft } from '../../handoff/send';
import {
  AVAILABILITY_MODES,
  CONTACT_FIELDS,
  PAYMENT_MODES,
  PRICE_UNITS,
} from '../../offers/vocabulary';
import { GUEST_LANGUAGES } from '../../property/vocabulary';
import type { CancelOrderDraft } from './cancel-order';
import type { PendingActionKind, PendingState } from './vocabulary';

/** The stored `create_order` draft: everything the confirmation shows and the Order is made from. */
export const createOrderPayload = z.object({
  offerId: z.uuid(),
  /** Published translation in the space's language. */
  offerTitle: z.string(),
  language: z.enum(GUEST_LANGUAGES),
  date: z.string(),
  slotId: z.uuid().nullable(),
  /** ISO instant; null when the Offer has no start time. */
  startsAt: z.string().nullable(),
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  startsAtLocal: z.string().nullable(),
  quantity: z.number().int(),
  /** The total in cents; null for request-kind Offers. */
  priceMinor: z.number().int().nullable(),
  currency: z.string(),
  priceUnit: z.enum(PRICE_UNITS),
  paymentMode: z.enum(PAYMENT_MODES),
  availabilityMode: z.enum(AVAILABILITY_MODES),
  cancellationPolicy: z.string(),
  contactFields: z.enum(CONTACT_FIELDS),
});
export type CreateOrderDraft = z.infer<typeof createOrderPayload>;

export async function insertPending(
  db: Executor,
  values: {
    kind: PendingActionKind;
    spaceId: string;
    stayId: string;
    /** create_order only. */
    orderId?: string;
    payload: CreateOrderDraft | HostMessageDraft | CancelOrderDraft;
    expiresAt: Date;
    now: Date;
  },
): Promise<PendingActionRow> {
  const { now, ...rest } = values;
  const [row] = await db
    .insert(pendingActions)
    .values({ ...rest, createdAt: now })
    .returning();
  if (!row) throw new Error('no pending row');
  return row;
}

/** The pending row under a row lock; concurrent completions serialise here. */
export async function lockPending(tx: Executor, id: string): Promise<PendingActionRow | undefined> {
  const [row] = await tx
    .select()
    .from(pendingActions)
    .where(eq(pendingActions.id, id))
    .for('update');
  return row;
}

export async function markPending(
  tx: Executor,
  id: string,
  state: Exclude<PendingState, 'pending'>,
  now: Date,
): Promise<void> {
  await tx
    .update(pendingActions)
    .set({ state, resolvedAt: now })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.state, 'pending')));
}

/** The draft we stored: trusted, but checked, so a schema change cannot slip through. */
export function parsePayload(row: PendingActionRow): CreateOrderDraft {
  return createOrderPayload.parse(row.payload);
}
