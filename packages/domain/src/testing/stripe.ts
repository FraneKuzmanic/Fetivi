// Test-only Stripe: an in-memory PaymentGateway that behaves like Stripe where Fetivi relies on
// it (idempotency keys replay the stored response, even with a stale `expires_at`; the same key
// with other parameters is an error; a new key needs `expires_at` ~30 minutes ahead), queues the
// webhook events Stripe would send, and lets a test pay, expire, lapse and break calls. No test
// reaches the network.
import { randomBytes } from 'node:crypto';
import type {
  CheckoutParams,
  CheckoutSessionView,
  PaymentGateway,
  PaymentGatewayErrorCode,
  PaymentIntentView,
  RefundView,
} from '../payments/gateway';
import { PaymentGatewayError } from '../payments/gateway';
import type { ProviderCardStatus } from '../payments/vocabulary';

export type FakeStripeOp =
  | 'create_session'
  | 'retrieve_session'
  | 'expire_session'
  | 'capture'
  | 'cancel'
  | 'retrieve_intent'
  | 'refund'
  | 'create_account'
  | 'account_link'
  | 'account_status';

/** A webhook event as Stripe would send it (only the fields Fetivi reads). */
export interface FakeStripeEvent {
  id: string;
  type: string;
  account: string;
  data: { object: Record<string, unknown> };
}

export interface FakeSession {
  id: string;
  account: string;
  status: 'open' | 'complete' | 'expired';
  url: string;
  clientReferenceId: string;
  expiresAt: Date;
  paymentIntentId: string | null;
  paymentMethodTypes: string[];
  metadata: Record<string, string>;
  amountMinor: number;
}

export interface FakeIntent {
  id: string;
  account: string;
  status: 'requires_capture' | 'succeeded' | 'canceled';
  amountMinor: number;
  applicationFeeAmount: number | null;
  metadata: Record<string, string>;
}

export interface FakeRefund {
  id: string;
  account: string;
  paymentIntentId: string;
  status: RefundView['status'];
  refundApplicationFee: true;
}

export interface FakeCall {
  op: FakeStripeOp;
  account: string | null;
  idempotencyKey: string | null;
  params: unknown;
}

export interface CaptureCall {
  intentId: string;
  account: string;
  attemptId: string | undefined;
  applicationFeeAmount: number;
}

export interface FakeStripeOptions {
  /** The fake's clock; defaults to the wall clock. */
  now?: () => Date;
  /** The created sessions' `payment_method_types` (default card and Link). */
  methods?: string[];
  /** The status a created refund gets (default `succeeded`). */
  refundStatus?: RefundView['status'];
  /** The secret `constructEvent` accepts as `fake:<secret>` (default `whsec_fake`). */
  webhookSecret?: string;
}

export interface FakeStripeControls {
  /** The guest completes the Checkout: an authorized intent; returns its id. */
  pay(sessionId: string): string;
  /** Open sessions past `expires_at` expire. */
  expireDue(now: Date): void;
  /** The authorization lapses (Stripe cancels the intent). */
  lapse(intentId: string): void;
  /** Pending webhook events, oldest first. */
  readonly events: FakeStripeEvent[];
  /** Removes and returns the pending events. */
  takeEvents(): FakeStripeEvent[];
  /**
   * The next call of `op` fails with `code`. `response-lost` performs the call and then throws
   * `unavailable`, like a crash after Stripe answered.
   */
  failNext(op: FakeStripeOp, code: PaymentGatewayErrorCode | 'response-lost'): void;
  /** Runs inside every capture call, before the capture is applied. */
  onCapture(hook: (call: CaptureCall) => void | Promise<void>): void;
  setCardStatus(accountId: string, status: ProviderCardStatus): void;
  /** Every call the gateway received, in order. */
  readonly calls: FakeCall[];
  state(): {
    sessions: FakeSession[];
    intents: FakeIntent[];
    refunds: FakeRefund[];
    accounts: { id: string; cardStatus: ProviderCardStatus; metadata: Record<string, string> }[];
  };
  /** The `stripe-signature` value `constructEvent` accepts. */
  signature(): string;
}

/** Stripe's minimum lead for a new session's `expires_at`, as observed in S2 (29 min passes). */
const MIN_LEAD_MS = 29 * 60 * 1000;

export function fakePaymentGateway(
  options: FakeStripeOptions = {},
): PaymentGateway & FakeStripeControls {
  const now = options.now ?? (() => new Date());
  const secret = options.webhookSecret ?? 'whsec_fake';
  const sessions = new Map<string, FakeSession>();
  const intents = new Map<string, FakeIntent>();
  const refunds = new Map<string, FakeRefund>();
  const accounts = new Map<
    string,
    { id: string; cardStatus: ProviderCardStatus; metadata: Record<string, string> }
  >();
  const idempotency = new Map<string, { op: FakeStripeOp; params: string; result: unknown }>();
  const failures = new Map<FakeStripeOp, PaymentGatewayErrorCode | 'response-lost'>();
  const events: FakeStripeEvent[] = [];
  const calls: FakeCall[] = [];
  let captureHook: ((call: CaptureCall) => void | Promise<void>) | undefined;
  // Unique across fakes, since tests share one database.
  const instance = randomBytes(4).toString('hex');
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${instance}${String(++counter).padStart(6, '0')}`;

  const push = (type: string, account: string, object: Record<string, unknown>) => {
    events.push({ id: nextId('evt'), type, account, data: { object } });
  };
  const sessionObject = (s: FakeSession) => ({
    id: s.id,
    object: 'checkout.session',
    status: s.status,
    client_reference_id: s.clientReferenceId,
    payment_intent: s.paymentIntentId,
    payment_status: 'unpaid',
    metadata: s.metadata,
  });
  const intentObject = (i: FakeIntent) => ({
    id: i.id,
    object: 'payment_intent',
    status: i.status,
    metadata: i.metadata,
  });
  const sessionView = (s: FakeSession): CheckoutSessionView => ({
    id: s.id,
    url: s.status === 'open' ? s.url : null,
    status: s.status,
    paymentIntentId: s.paymentIntentId,
    paymentMethodTypes: [...s.paymentMethodTypes],
    clientReferenceId: s.clientReferenceId,
  });
  const intentView = (i: FakeIntent): PaymentIntentView => ({
    id: i.id,
    status: i.status,
    amountCapturable: i.status === 'requires_capture' ? i.amountMinor : 0,
  });

  /** One gateway call: the scripted failure, idempotency replay, then the call itself. */
  async function run<T>(
    op: FakeStripeOp,
    account: string | null,
    idempotencyKey: string | null,
    params: unknown,
    body: () => T | Promise<T>,
  ): Promise<T> {
    calls.push({ op, account, idempotencyKey, params });
    const failure = failures.get(op);
    if (failure) failures.delete(op);
    if (failure && failure !== 'response-lost') throw new PaymentGatewayError(failure, 'scripted');
    let result: T;
    const scope = idempotencyKey === null ? null : `${account ?? 'platform'}|${idempotencyKey}`;
    const json = JSON.stringify(params);
    const stored = scope === null ? undefined : idempotency.get(scope);
    if (stored) {
      if (stored.op !== op || stored.params !== json) {
        throw new PaymentGatewayError('idempotency-mismatch', idempotencyKey ?? undefined);
      }
      result = stored.result as T;
    } else {
      result = await body();
      if (scope !== null) idempotency.set(scope, { op, params: json, result });
    }
    if (failure === 'response-lost') throw new PaymentGatewayError('unavailable', 'response lost');
    return result;
  }

  const session = (id: string, account: string) => {
    const found = sessions.get(id);
    if (!found || found.account !== account)
      throw new PaymentGatewayError('rejected', 'no session');
    return found;
  };
  const intent = (id: string, account: string) => {
    const found = intents.get(id);
    if (!found || found.account !== account) throw new PaymentGatewayError('rejected', 'no intent');
    return found;
  };

  return {
    createCheckoutSession: (p: CheckoutParams, o) =>
      run('create_session', o.stripeAccount, o.idempotencyKey, p, () => {
        if (p.expiresAt.getTime() - now().getTime() < MIN_LEAD_MS) {
          throw new PaymentGatewayError('expires-at-invalid', 'expires_at too soon');
        }
        const id = nextId('cs_test');
        const s: FakeSession = {
          id,
          account: o.stripeAccount,
          status: 'open',
          url: `https://checkout.stripe.test/c/pay/${id}`,
          clientReferenceId: p.clientReferenceId,
          expiresAt: p.expiresAt,
          paymentIntentId: null,
          paymentMethodTypes: [...(options.methods ?? ['card', 'link'])],
          metadata: { ...p.metadata },
          amountMinor: p.amountMinor,
        };
        sessions.set(id, s);
        return sessionView(s);
      }),
    retrieveCheckoutSession: (id, o) =>
      run('retrieve_session', o.stripeAccount, null, { id }, () =>
        sessionView(session(id, o.stripeAccount)),
      ),
    expireCheckoutSession: (id, o) =>
      run('expire_session', o.stripeAccount, o.idempotencyKey, { id }, () => {
        const s = session(id, o.stripeAccount);
        if (s.status !== 'open') throw new PaymentGatewayError('session-not-open', s.status);
        s.status = 'expired';
        push('checkout.session.expired', s.account, sessionObject(s));
        return sessionView(s);
      }),
    capturePaymentIntent: (id, p, o) =>
      run('capture', o.stripeAccount, o.idempotencyKey, { id, ...p }, async () => {
        const i = intent(id, o.stripeAccount);
        if (i.status === 'succeeded') throw new PaymentGatewayError('intent-already-captured');
        if (i.status === 'canceled') throw new PaymentGatewayError('intent-canceled');
        await captureHook?.({
          intentId: i.id,
          account: i.account,
          attemptId: i.metadata.fetivi_attempt_id,
          applicationFeeAmount: p.applicationFeeAmount,
        });
        i.status = 'succeeded';
        i.applicationFeeAmount = p.applicationFeeAmount;
        push('payment_intent.succeeded', i.account, intentObject(i));
        return intentView(i);
      }),
    cancelPaymentIntent: (id, o) =>
      run('cancel', o.stripeAccount, o.idempotencyKey, { id }, () => {
        const i = intent(id, o.stripeAccount);
        if (i.status === 'succeeded') throw new PaymentGatewayError('intent-already-captured');
        if (i.status === 'canceled') throw new PaymentGatewayError('intent-canceled');
        i.status = 'canceled';
        push('payment_intent.canceled', i.account, intentObject(i));
        return intentView(i);
      }),
    retrievePaymentIntent: (id, o) =>
      run('retrieve_intent', o.stripeAccount, null, { id }, () =>
        intentView(intent(id, o.stripeAccount)),
      ),
    createRefund: (p, o) =>
      run('refund', o.stripeAccount, o.idempotencyKey, p, () => {
        const i = intent(p.paymentIntentId, o.stripeAccount);
        if (i.status !== 'succeeded') throw new PaymentGatewayError('rejected', 'not captured');
        const r: FakeRefund = {
          id: nextId('re'),
          account: i.account,
          paymentIntentId: i.id,
          status: options.refundStatus ?? 'succeeded',
          refundApplicationFee: true,
        };
        refunds.set(r.id, r);
        if (r.status === 'succeeded') {
          push('charge.refunded', i.account, {
            id: nextId('ch'),
            object: 'charge',
            payment_intent: i.id,
            refunded: true,
          });
        } else if (r.status === 'failed') {
          push('refund.failed', i.account, {
            id: r.id,
            object: 'refund',
            payment_intent: i.id,
            status: 'failed',
          });
        }
        return { id: r.id, status: r.status };
      }),
    createConnectedAccount: (p, o) =>
      run('create_account', null, o.idempotencyKey, p, () => {
        const id = nextId('acct');
        accounts.set(id, {
          id,
          cardStatus: 'pending',
          metadata: { fetivi_provider_id: p.providerId },
        });
        return { id };
      }),
    createAccountLink: (p) =>
      run('account_link', null, null, p, () => {
        if (!accounts.has(p.accountId)) throw new PaymentGatewayError('rejected', 'no account');
        return {
          url: `https://connect.stripe.test/setup/${p.accountId}/${nextId('link')}`,
          expiresAt: new Date(now().getTime() + 5 * 60 * 1000),
        };
      }),
    retrieveCardPaymentsStatus: (accountId) =>
      run('account_status', null, null, { accountId }, () => {
        const account = accounts.get(accountId);
        if (!account) throw new PaymentGatewayError('rejected', 'no account');
        return account.cardStatus;
      }),
    constructEvent(rawBody, signature, expected) {
      if (expected !== secret || signature !== `fake:${secret}`) {
        throw new Error('bad signature');
      }
      return JSON.parse(rawBody);
    },

    pay(sessionId) {
      const s = sessions.get(sessionId);
      if (s?.status !== 'open') throw new Error(`session ${sessionId} is not open`);
      const i: FakeIntent = {
        id: nextId('pi'),
        account: s.account,
        status: 'requires_capture',
        amountMinor: s.amountMinor,
        applicationFeeAmount: null,
        metadata: { ...s.metadata },
      };
      intents.set(i.id, i);
      s.status = 'complete';
      s.paymentIntentId = i.id;
      push('checkout.session.completed', s.account, sessionObject(s));
      push('payment_intent.amount_capturable_updated', s.account, intentObject(i));
      return i.id;
    },
    expireDue(at) {
      for (const s of sessions.values()) {
        if (s.status === 'open' && s.expiresAt <= at) {
          s.status = 'expired';
          push('checkout.session.expired', s.account, sessionObject(s));
        }
      }
    },
    lapse(intentId) {
      const i = intents.get(intentId);
      if (i?.status !== 'requires_capture') return;
      i.status = 'canceled';
      push('payment_intent.canceled', i.account, intentObject(i));
    },
    events,
    takeEvents: () => events.splice(0, events.length),
    failNext(op, code) {
      failures.set(op, code);
    },
    onCapture(hook) {
      captureHook = hook;
    },
    setCardStatus(accountId, status) {
      const account = accounts.get(accountId);
      if (account) account.cardStatus = status;
      else accounts.set(accountId, { id: accountId, cardStatus: status, metadata: {} });
    },
    calls,
    state: () => ({
      sessions: [...sessions.values()].map((s) => ({ ...s })),
      intents: [...intents.values()].map((i) => ({ ...i })),
      refunds: [...refunds.values()].map((r) => ({ ...r })),
      accounts: [...accounts.values()].map((a) => ({ ...a })),
    }),
    signature: () => `fake:${secret}`,
  };
}
