import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { type PaymentAttemptRow, paymentAttempts } from '../db/schema/orders';
import {
  type ReconciliationFindingRow,
  type ReconciliationRunRow,
  reconciliationFindings,
  reconciliationRuns,
} from '../db/schema/reconciliation';
import type { OrderDeps, TransitionOutcome } from '../orders/machine';
import {
  authorize,
  recordCaptured,
  recordRefunded,
  recordRefundFailed,
  recordVoided,
  sessionExpired,
} from '../orders/payments';
import { expiredHolds, type HoldOutcome, reconcileHold } from '../orders/reconcile';
import { type PaymentGateway, PaymentGatewayError } from './gateway';
import { checkoutParams, keyed, recordSession } from './jobs';
import {
  type FindingKind,
  RECONCILE_ATTEMPT_LIMIT,
  RECONCILE_ORPHAN_DAYS,
  type ReconcileTrigger,
} from './vocabulary';

// The reconciliation job's work (34): read Stripe for every attempt Fetivi still considers
// unsettled, feed what was missed back through the Order machine with trigger `reconciliation`,
// resolve holds past expiry, and report Stripe sessions no attempt knows. Stripe is only read,
// apart from replaying a create that was already sent (idempotent, never a new session). Every
// disagreement is stored as a reconciliation finding for the admin.

export interface ReconcileDeps extends OrderDeps {
  gateway: PaymentGateway | null;
  /** The guest app's origin: part of a replayed create's parameters. */
  guestOrigin: string;
}

type StripeDeps = OrderDeps & { gateway: PaymentGateway; guestOrigin: string };

export interface ReconcileSummary {
  runId: string;
  checked: number;
  found: number;
  resolved: number;
  needsAttention: number;
  /** A code only: `stripe-not-configured` or `stripe-unavailable`. */
  error: string | null;
}

export interface Finding {
  kind: FindingKind;
  subject: string;
  orderId: string | null;
  attemptId?: string | null;
  holdId?: string | null;
  stripeRef?: string | null;
  /** Ids and statuses only, never contact data. */
  detail: string;
  action?: string | null;
  status: 'resolved' | 'needs_attention';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_BATCH = 200;
const ORPHAN_LIST_LIMIT = 1000;

const isUnavailable = (error: unknown) =>
  error instanceof PaymentGatewayError && error.code === 'unavailable';

/** A Stripe rejection or a machine error, as a code a human can act on. */
const codeOf = (error: unknown) =>
  error instanceof PaymentGatewayError
    ? `${error.code}${error.detail ? ` (${error.detail})` : ''}`
    : error instanceof Error
      ? error.message
      : 'unknown';

// --- Findings store ---

/**
 * Stores one finding. A resolved one is a plain insert; one needing attention updates the open
 * finding of the same kind and subject, so a problem seen every run stays one row.
 */
export async function recordFinding(
  db: Executor,
  runId: string,
  finding: Finding,
  now: Date,
): Promise<void> {
  const row = {
    runId,
    kind: finding.kind,
    subject: finding.subject,
    orderId: finding.orderId,
    attemptId: finding.attemptId ?? null,
    holdId: finding.holdId ?? null,
    stripeRef: finding.stripeRef ?? null,
    detail: finding.detail,
    action: finding.action ?? null,
    status: finding.status,
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: finding.status === 'resolved' ? now : null,
  };
  if (finding.status === 'resolved') {
    await db.insert(reconciliationFindings).values(row);
    return;
  }
  await db
    .insert(reconciliationFindings)
    .values(row)
    .onConflictDoUpdate({
      target: [reconciliationFindings.kind, reconciliationFindings.subject],
      targetWhere: sql`status = 'needs_attention'`,
      set: { runId, lastSeenAt: now, detail: finding.detail, action: finding.action ?? null },
    });
}

/** Findings for the admin, last seen first. `resolved` includes the ones the admin dismissed. */
export function listFindings(
  db: Executor,
  input: { status: 'needs_attention' | 'resolved'; limit: number },
): Promise<ReconciliationFindingRow[]> {
  return db
    .select()
    .from(reconciliationFindings)
    .where(
      input.status === 'needs_attention'
        ? eq(reconciliationFindings.status, 'needs_attention')
        : inArray(reconciliationFindings.status, ['resolved', 'dismissed']),
    )
    .orderBy(desc(reconciliationFindings.lastSeenAt), desc(reconciliationFindings.id))
    .limit(input.limit);
}

/** The latest runs, newest first. */
export function latestRuns(db: Executor, limit: number): Promise<ReconciliationRunRow[]> {
  return db
    .select()
    .from(reconciliationRuns)
    .orderBy(desc(reconciliationRuns.startedAt))
    .limit(limit);
}

/** The admin marks a finding that needs attention as resolved; false when there is none open. */
export async function dismissFinding(
  db: Executor,
  id: string,
  accountId: string,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(reconciliationFindings)
    .set({ status: 'dismissed', resolvedAt: now, resolvedBy: accountId })
    .where(
      and(eq(reconciliationFindings.id, id), eq(reconciliationFindings.status, 'needs_attention')),
    )
    .returning({ id: reconciliationFindings.id });
  return updated.length > 0;
}

// --- Attempts ---

/**
 * Attempts Stripe may have moved on from: an open session, a create sent whose response was
 * lost and whose session would have closed by now, an uncaptured authorization, a pending
 * refund. Oldest `updated_at` first.
 */
export function unsettledAttempts(
  db: Executor,
  now: Date,
  limit: number,
): Promise<PaymentAttemptRow[]> {
  return db
    .select()
    .from(paymentAttempts)
    .where(
      or(
        eq(paymentAttempts.sessionStatus, 'open'),
        and(
          isNull(paymentAttempts.sessionStatus),
          isNotNull(paymentAttempts.createSentAt),
          lte(paymentAttempts.expiresAt, now),
        ),
        eq(paymentAttempts.intentStatus, 'requires_capture'),
        eq(paymentAttempts.refundStatus, 'pending'),
      ),
    )
    .orderBy(asc(paymentAttempts.updatedAt))
    .limit(limit);
}

async function reread(deps: OrderDeps, id: string) {
  const [attempt] = await deps.db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return attempt;
}

/**
 * One attempt against Stripe. Reads run outside any transaction; only the machine writes. A
 * connection failure throws `unavailable`; any other failure is the caller's `check_failed`.
 */
export async function reconcileAttempt(
  deps: StripeDeps,
  start: PaymentAttemptRow,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const read = { stripeAccount: start.stripeAccountId };
  const base = { subject: `attempt:${start.id}`, orderId: start.orderId, attemptId: start.id };
  const input = { attemptId: start.id, trigger: 'reconciliation' } as const;
  const feed = async (
    kind: FindingKind,
    stripeRef: string,
    detail: string,
    label: string,
    run: () => Promise<TransitionOutcome>,
  ) => {
    const { outcome } = await run();
    const refused = outcome === 'rejected';
    findings.push({
      ...base,
      kind: refused ? 'check_failed' : kind,
      stripeRef,
      detail: refused ? `${kind}: ${detail}` : detail,
      action: `${label}: ${outcome}`,
      status: refused ? 'needs_attention' : 'resolved',
    });
  };

  let attempt = start;
  let sessionId = attempt.sessionId;
  if (!sessionId && attempt.createSentAt) {
    // Only a create whose session would have closed by now is replayed: a live one is the open
    // job's, and a past `expires_at` means Stripe replays or rejects, never creates.
    if (attempt.expiresAt > deps.now()) return findings;
    try {
      const session = await deps.gateway.createCheckoutSession(
        checkoutParams(attempt, deps.guestOrigin),
        keyed(attempt, 'create_session'),
      );
      await recordSession(deps, attempt, session, false);
      sessionId = session.id;
    } catch (error) {
      // Stripe never accepted the create: there is no session.
      if (error instanceof PaymentGatewayError && error.code === 'expires-at-invalid') {
        return findings;
      }
      throw error;
    }
    attempt = (await reread(deps, attempt.id)) ?? attempt;
  }

  if (sessionId && (attempt.sessionStatus === null || attempt.sessionStatus === 'open')) {
    const session = await deps.gateway.retrieveCheckoutSession(sessionId, read);
    const id = session.id;
    if (session.status === 'complete' && session.paymentIntentId) {
      const paymentIntentId = session.paymentIntentId;
      await feed(
        'session_completed',
        id,
        `session=complete intent=${paymentIntentId}`,
        'authorize',
        () => authorize(deps, { ...input, paymentIntentId, sessionId: id }),
      );
    } else if (session.status === 'expired') {
      await feed('session_expired', id, 'session=expired', 'session expired', () =>
        sessionExpired(deps, { ...input, sessionId: id }),
      );
    }
    attempt = (await reread(deps, attempt.id)) ?? attempt;
  }

  if (attempt.paymentIntentId && attempt.intentStatus === 'requires_capture') {
    const intent = await deps.gateway.retrievePaymentIntent(attempt.paymentIntentId, read);
    if (intent.status === 'canceled') {
      await feed('intent_canceled', intent.id, 'intent=canceled', 'void', () =>
        recordVoided(deps, input),
      );
    } else if (intent.status === 'succeeded') {
      await feed('intent_captured', intent.id, 'intent=succeeded', 'capture', () =>
        recordCaptured(deps, input),
      );
    }
    attempt = (await reread(deps, attempt.id)) ?? attempt;
  }

  // Without a refund id the create's response was lost: the refund job is still retrying it.
  if (attempt.refundStatus === 'pending' && attempt.refundId) {
    const refund = await deps.gateway.retrieveRefund(attempt.refundId, read);
    if (refund.status === 'succeeded') {
      await feed('refund_succeeded', refund.id, 'refund=succeeded', 'refunded', () =>
        recordRefunded(deps, input),
      );
    } else if (refund.status === 'failed' || refund.status === 'canceled') {
      await feed('refund_failed', refund.id, `refund=${refund.status}`, 'refund failed', () =>
        recordRefundFailed(deps, input),
      );
    }
  }
  return findings;
}

// --- Holds ---

const HOLD_ACTIONS: Partial<Record<HoldOutcome, string>> = {
  expired: 'expire: applied',
  failed: 'fail: applied',
  released: 'release: applied',
};

// --- Orphans ---

/**
 * Sessions on the connected accounts of recent attempts that carry a Fetivi attempt id no
 * attempt row has (after a restore). Report only: the admin acts in Stripe's dashboard. Sessions
 * with no Fetivi id are the Provider's own.
 */
async function findOrphans(
  deps: StripeDeps,
  record: (finding: Finding) => Promise<void>,
): Promise<number> {
  const since = new Date(deps.now().getTime() - RECONCILE_ORPHAN_DAYS * DAY_MS);
  // `expires_at` is set from the machine's clock at create, so it dates the attempt.
  const accounts = await deps.db
    .selectDistinct({ account: paymentAttempts.stripeAccountId })
    .from(paymentAttempts)
    .where(gte(paymentAttempts.expiresAt, since));
  let checked = 0;
  for (const { account } of accounts) {
    const sessions = await deps.gateway.listCheckoutSessions({
      stripeAccount: account,
      createdAfter: since,
      limit: ORPHAN_LIST_LIMIT,
    });
    checked += sessions.length;
    const candidates = sessions.flatMap((session) => {
      const attemptId = session.metadataAttemptId ?? session.clientReferenceId ?? '';
      return session.status !== 'expired' && UUID.test(attemptId) ? [{ session, attemptId }] : [];
    });
    if (candidates.length === 0) continue;
    const rows = await deps.db
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(
        inArray(
          paymentAttempts.id,
          candidates.map((c) => c.attemptId),
        ),
      );
    const known = new Set(rows.map((r) => r.id));
    for (const { session, attemptId } of candidates) {
      if (known.has(attemptId)) continue;
      await record({
        kind: 'orphan_session',
        subject: `session:${account}:${session.id}`,
        orderId: null,
        stripeRef: session.id,
        detail: `status=${session.status} intent=${session.paymentIntentId ?? 'none'}`,
        status: 'needs_attention',
      });
    }
  }
  return checked;
}

// --- Run ---

/**
 * One reconciliation run: attempts against Stripe, then holds past expiry, then orphans. Without
 * a gateway, or once Stripe is unavailable, the Stripe part stops and the holds are still
 * checked; the run records why. A failure on one subject is a `check_failed` finding and the run
 * carries on.
 */
export async function runReconciliation(
  deps: ReconcileDeps,
  input: { trigger: ReconcileTrigger; requestedBy?: string },
): Promise<ReconcileSummary> {
  const [run] = await deps.db
    .insert(reconciliationRuns)
    .values({ trigger: input.trigger, requestedBy: input.requestedBy, startedAt: deps.now() })
    .returning({ id: reconciliationRuns.id });
  if (!run) throw new Error('no run');
  const tally = { checked: 0, found: 0, resolved: 0, needsAttention: 0 };
  const record = async (finding: Finding) => {
    await recordFinding(deps.db, run.id, finding, deps.now());
    tally.found++;
    if (finding.status === 'resolved') tally.resolved++;
    else tally.needsAttention++;
  };
  const failed = (subject: string, orderId: string | null, error: unknown, extra = {}) =>
    record({
      kind: 'check_failed',
      subject,
      orderId,
      detail: codeOf(error),
      status: 'needs_attention',
      ...extra,
    });

  const { gateway } = deps;
  let error: string | null = gateway ? null : 'stripe-not-configured';
  if (gateway) {
    const stripe = { ...deps, gateway };
    try {
      for (const attempt of await unsettledAttempts(deps.db, deps.now(), RECONCILE_ATTEMPT_LIMIT)) {
        tally.checked++;
        try {
          for (const finding of await reconcileAttempt(stripe, attempt)) await record(finding);
        } catch (e) {
          if (isUnavailable(e)) throw e;
          await failed(`attempt:${attempt.id}`, attempt.orderId, e, { attemptId: attempt.id });
        }
      }
    } catch (e) {
      if (!isUnavailable(e)) throw e;
      error = 'stripe-unavailable';
    }
  }

  for (const hold of await expiredHolds(deps.db, deps.now(), HOLD_BATCH)) {
    tally.checked++;
    const subject = `hold:${hold.id}`;
    const base = { subject, orderId: hold.orderId, holdId: hold.id };
    try {
      const { outcome } = await reconcileHold(deps, hold.id);
      const action = HOLD_ACTIONS[outcome];
      if (action) {
        await record({
          ...base,
          kind: 'hold_expired',
          detail: `hold expired ${hold.expiresAt.toISOString()}`,
          action,
          status: 'resolved',
        });
      } else if (outcome === 'reported') {
        await record({
          ...base,
          kind: 'hold_on_confirmed',
          detail: `hold held past ${hold.expiresAt.toISOString()}`,
          status: 'needs_attention',
        });
      }
    } catch (e) {
      await failed(subject, hold.orderId, e, { holdId: hold.id });
    }
  }

  if (gateway && !error) {
    try {
      tally.checked += await findOrphans({ ...deps, gateway }, record);
    } catch (e) {
      if (isUnavailable(e)) error = 'stripe-unavailable';
      else await failed('orphans', null, e);
    }
  }

  await deps.db
    .update(reconciliationRuns)
    .set({
      finishedAt: deps.now(),
      checked: tally.checked,
      found: tally.found,
      resolved: tally.resolved,
      error,
    })
    .where(eq(reconciliationRuns.id, run.id));
  return { runId: run.id, ...tally, error };
}
