import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentAttempts } from '../db/schema/orders';
import type { OrderDeps, TransitionOutcome } from '../orders/machine';
import {
  authorize,
  recordCaptured,
  recordRefunded,
  recordRefundFailed,
  recordVoided,
  sessionExpired,
} from '../orders/payments';

// Stripe webhook events, the source of payment truth, mapped to the payment transitions. Events
// from connected accounts carry `account`; an event that names no attempt of ours, or another
// account, is ignored (and still answered 200, so Stripe stops retrying it). The transitions
// record the event id on the attempt, so each event is applied once.

type Base = {
  eventId: string;
  account: string | null;
  /** The event's `created`: for a completion, when the guest completed the Checkout. */
  createdAt: Date | null;
};

/** The narrow view of the Stripe events Fetivi acts on. */
export type PaymentEvent = Base &
  (
    | {
        kind: 'completed';
        attemptId: string | null;
        paymentIntentId: string;
        /** Set by a session event; an intent event names no session. */
        sessionId: string | null;
      }
    | { kind: 'session_expired'; attemptId: string | null; sessionId: string | null }
    | { kind: 'captured' | 'voided'; attemptId: string | null; paymentIntentId: string }
    | { kind: 'refunded' | 'refund_failed'; attemptId: null; paymentIntentId: string }
  );

const envelope = z.object({
  id: z.string(),
  type: z.string(),
  account: z.string().nullish(),
  created: z.number().nullish(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const session = z.object({
  id: z.string().nullish(),
  status: z.string().nullish(),
  client_reference_id: z.string().nullish(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullish(),
});

const intent = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.string()).nullish(),
});

const charge = z.object({
  refunded: z.boolean().nullish(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullish(),
});

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : (value?.id ?? null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maps a verified Stripe event to a `PaymentEvent`; anything else is `ignored`. */
export function parseStripeEvent(json: unknown): PaymentEvent | { kind: 'ignored' } {
  const parsed = envelope.safeParse(json);
  if (!parsed.success) return { kind: 'ignored' };
  const { id: eventId, type, data } = parsed.data;
  const created = parsed.data.created;
  const base: Base = {
    eventId,
    account: parsed.data.account ?? null,
    createdAt: typeof created === 'number' ? new Date(created * 1000) : null,
  };
  const object = data.object;
  switch (type) {
    case 'checkout.session.completed': {
      const s = session.safeParse(object);
      if (!s.success) return { kind: 'ignored' };
      const paymentIntentId = idOf(s.data.payment_intent);
      // Manual capture leaves `payment_status` `unpaid`: completion is `status === 'complete'`.
      if (s.data.status !== 'complete' || !paymentIntentId || !s.data.client_reference_id) {
        return { kind: 'ignored' };
      }
      return {
        ...base,
        kind: 'completed',
        attemptId: s.data.client_reference_id,
        paymentIntentId,
        sessionId: s.data.id ?? null,
      };
    }
    case 'checkout.session.expired': {
      const s = session.safeParse(object);
      if (!s.success || !s.data.client_reference_id) return { kind: 'ignored' };
      return {
        ...base,
        kind: 'session_expired',
        attemptId: s.data.client_reference_id,
        sessionId: s.data.id ?? null,
      };
    }
    case 'payment_intent.amount_capturable_updated':
    case 'payment_intent.succeeded':
    case 'payment_intent.canceled': {
      const i = intent.safeParse(object);
      if (!i.success) return { kind: 'ignored' };
      const attemptId = i.data.metadata?.fetivi_attempt_id ?? null;
      const kind =
        type === 'payment_intent.succeeded'
          ? 'captured'
          : type === 'payment_intent.canceled'
            ? 'voided'
            : 'completed';
      if (kind === 'completed') {
        return { ...base, kind, attemptId, paymentIntentId: i.data.id, sessionId: null };
      }
      return { ...base, kind, attemptId, paymentIntentId: i.data.id };
    }
    case 'charge.refunded':
    case 'refund.failed': {
      const c = charge.safeParse(object);
      const paymentIntentId = c.success ? idOf(c.data.payment_intent) : null;
      if (!c.success || !paymentIntentId) return { kind: 'ignored' };
      if (type === 'charge.refunded' && c.data.refunded !== true) return { kind: 'ignored' };
      return {
        ...base,
        kind: type === 'charge.refunded' ? 'refunded' : 'refund_failed',
        attemptId: null,
        paymentIntentId,
      };
    }
    default:
      return { kind: 'ignored' };
  }
}

async function attemptOf(deps: OrderDeps, event: PaymentEvent) {
  if (event.attemptId && UUID.test(event.attemptId)) {
    const [byId] = await deps.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, event.attemptId));
    if (byId) return byId;
  }
  if ('paymentIntentId' in event) {
    const [byIntent] = await deps.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentIntentId, event.paymentIntentId));
    return byIntent;
  }
  return undefined;
}

export type StripeEventOutcome = TransitionOutcome['outcome'] | 'ignored';

/** Applies one parsed event through the machine, with trigger `payment_webhook`. */
export async function applyStripeEvent(
  deps: OrderDeps,
  event: PaymentEvent | { kind: 'ignored' },
): Promise<StripeEventOutcome> {
  if (event.kind === 'ignored') return 'ignored';
  const attempt = await attemptOf(deps, event);
  if (!attempt || event.account !== attempt.stripeAccountId) return 'ignored';
  const input = {
    attemptId: attempt.id,
    eventId: event.eventId,
    trigger: 'payment_webhook',
  } as const;
  switch (event.kind) {
    case 'completed':
      return (
        await authorize(deps, {
          ...input,
          paymentIntentId: event.paymentIntentId,
          sessionId: event.sessionId,
          completedAt: event.createdAt,
        })
      ).outcome;
    case 'session_expired':
      return (await sessionExpired(deps, { ...input, sessionId: event.sessionId })).outcome;
    case 'captured':
      return (await recordCaptured(deps, input)).outcome;
    case 'voided':
      return (await recordVoided(deps, input)).outcome;
    case 'refunded':
      return (await recordRefunded(deps, input)).outcome;
    case 'refund_failed':
      return (await recordRefundFailed(deps, input)).outcome;
  }
}
