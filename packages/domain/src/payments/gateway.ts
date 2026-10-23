import type { Egress } from '@fetivi/egress';
import Stripe from 'stripe';
import {
  NON_CARD_METHODS,
  type ProviderCardStatus,
  type SessionStatus,
  STRIPE_API_VERSION,
} from './vocabulary';

// The narrow Stripe surface Fetivi uses: Checkout Sessions with manual capture on a Provider's
// connected account (direct charges), capture with the application fee, void, refund, and
// Accounts v2 onboarding. Every write carries the connected account and an idempotency key.
// Calls go through the egress `fetch`; the SDK's own retries reuse the idempotency key.

export interface WriteOptions {
  stripeAccount: string;
  idempotencyKey: string;
}

export interface ReadOptions {
  stripeAccount: string;
}

export interface CheckoutParams {
  clientReferenceId: string;
  expiresAt: Date;
  amountMinor: number;
  currency: string;
  productName: string;
  locale: string;
  successUrl: string;
  cancelUrl: string;
  metadata: { fetivi_attempt_id: string; fetivi_order_id: string };
}

export interface CheckoutSessionView {
  id: string;
  url: string | null;
  status: SessionStatus;
  paymentIntentId: string | null;
  paymentMethodTypes: string[];
  clientReferenceId: string | null;
}

export interface PaymentIntentView {
  id: string;
  /** Stripe's raw intent status. */
  status: string;
  amountCapturable: number;
}

export type RefundView = {
  id: string;
  status: 'pending' | 'succeeded' | 'failed' | 'requires_action' | 'canceled';
};

export interface PaymentGateway {
  createCheckoutSession(p: CheckoutParams, o: WriteOptions): Promise<CheckoutSessionView>;
  retrieveCheckoutSession(id: string, o: ReadOptions): Promise<CheckoutSessionView>;
  expireCheckoutSession(id: string, o: WriteOptions): Promise<CheckoutSessionView>;
  capturePaymentIntent(
    id: string,
    p: { applicationFeeAmount: number },
    o: WriteOptions,
  ): Promise<PaymentIntentView>;
  cancelPaymentIntent(id: string, o: WriteOptions): Promise<PaymentIntentView>;
  retrievePaymentIntent(id: string, o: ReadOptions): Promise<PaymentIntentView>;
  createRefund(p: { paymentIntentId: string }, o: WriteOptions): Promise<RefundView>;
  createConnectedAccount(
    p: { providerId: string; email: string; displayName: string },
    o: { idempotencyKey: string },
  ): Promise<{ id: string }>;
  createAccountLink(p: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }>;
  retrieveCardPaymentsStatus(accountId: string): Promise<ProviderCardStatus>;
  /** The verified event; throws on a bad signature. */
  constructEvent(rawBody: string, signature: string, secret: string): unknown;
}

export type PaymentGatewayErrorCode =
  | 'session-not-open'
  | 'intent-already-captured'
  | 'intent-canceled'
  | 'idempotency-mismatch'
  | 'expires-at-invalid'
  | 'card-declined'
  | 'unavailable'
  | 'rejected';

export class PaymentGatewayError extends Error {
  override name = 'PaymentGatewayError';
  constructor(
    readonly code: PaymentGatewayErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

function sessionView(s: Stripe.Checkout.Session): CheckoutSessionView {
  const intent = s.payment_intent;
  return {
    id: s.id,
    url: s.url ?? null,
    status: (s.status ?? 'open') as SessionStatus,
    paymentIntentId: typeof intent === 'string' ? intent : (intent?.id ?? null),
    paymentMethodTypes: [...(s.payment_method_types ?? [])],
    clientReferenceId: s.client_reference_id ?? null,
  };
}

function intentView(i: Stripe.PaymentIntent): PaymentIntentView {
  return { id: i.id, status: i.status, amountCapturable: i.amount_capturable };
}

/** Stripe's card capability status → the stored Provider status; anything unknown is restricted. */
export function cardStatusOf(status: string | undefined): ProviderCardStatus {
  switch (status) {
    case 'active':
    case 'pending':
    case 'restricted':
    case 'unsupported':
      return status;
    case 'rejected':
      return 'unsupported';
    default:
      return 'restricted';
  }
}

/** Maps a Stripe SDK error to a gateway error code; never keeps the raw body. */
export function gatewayErrorOf(error: unknown): PaymentGatewayError {
  if (error instanceof PaymentGatewayError) return error;
  if (!(error instanceof Stripe.errors.StripeError)) {
    return new PaymentGatewayError('unavailable', error instanceof Error ? error.name : undefined);
  }
  const code = error.code;
  const message = error.message ?? '';
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError ||
    (error.statusCode !== undefined && (error.statusCode >= 500 || error.statusCode === 429))
  ) {
    return new PaymentGatewayError('unavailable', code);
  }
  if (error instanceof Stripe.errors.StripeIdempotencyError || error.type === 'idempotency_error') {
    return new PaymentGatewayError('idempotency-mismatch', code);
  }
  if (error instanceof Stripe.errors.StripeCardError) {
    return new PaymentGatewayError('card-declined', error.decline_code ?? code);
  }
  if (code === 'checkout_session_not_open' || /is not open/i.test(message)) {
    return new PaymentGatewayError('session-not-open', code);
  }
  if (code === 'payment_intent_unexpected_state') {
    const status = error.payment_intent?.status;
    if (status === 'succeeded') return new PaymentGatewayError('intent-already-captured', code);
    if (status === 'canceled') return new PaymentGatewayError('intent-canceled', code);
    if (/succeeded/i.test(message)) return new PaymentGatewayError('intent-already-captured', code);
    if (/canceled/i.test(message)) return new PaymentGatewayError('intent-canceled', code);
  }
  if (error.param === 'expires_at') return new PaymentGatewayError('expires-at-invalid', code);
  return new PaymentGatewayError('rejected', code);
}

async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw gatewayErrorOf(error);
  }
}

export interface StripeGatewayConfig {
  apiKey: string;
  fetch: Egress['fetch'];
}

/** The real gateway over `stripe@23` (an instance client, never the global pattern). */
export function createStripeGateway(config: StripeGatewayConfig): PaymentGateway {
  const stripe = new Stripe(config.apiKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(
      config.fetch as Parameters<typeof Stripe.createFetchHttpClient>[0],
    ),
    maxNetworkRetries: 2,
  });
  return {
    createCheckoutSession: (p, o) =>
      call(async () =>
        sessionView(
          await stripe.checkout.sessions.create(
            {
              mode: 'payment',
              client_reference_id: p.clientReferenceId,
              expires_at: unix(p.expiresAt),
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: p.currency.toLowerCase(),
                    unit_amount: p.amountMinor,
                    product_data: { name: p.productName },
                  },
                },
              ],
              // The fee is set at capture, so a void carries none (S2).
              payment_intent_data: { capture_method: 'manual', metadata: p.metadata },
              metadata: p.metadata,
              // Never `payment_method_types`: the created session's methods are checked instead.
              excluded_payment_method_types: [...NON_CARD_METHODS],
              locale: p.locale as Stripe.Checkout.SessionCreateParams.Locale,
              success_url: p.successUrl,
              cancel_url: p.cancelUrl,
            },
            o,
          ),
        ),
      ),
    retrieveCheckoutSession: (id, o) =>
      call(async () => sessionView(await stripe.checkout.sessions.retrieve(id, {}, o))),
    expireCheckoutSession: (id, o) =>
      call(async () => sessionView(await stripe.checkout.sessions.expire(id, {}, o))),
    capturePaymentIntent: (id, p, o) =>
      call(async () =>
        intentView(
          await stripe.paymentIntents.capture(
            id,
            { application_fee_amount: p.applicationFeeAmount },
            o,
          ),
        ),
      ),
    cancelPaymentIntent: (id, o) =>
      call(async () => intentView(await stripe.paymentIntents.cancel(id, {}, o))),
    retrievePaymentIntent: (id, o) =>
      call(async () => intentView(await stripe.paymentIntents.retrieve(id, {}, o))),
    createRefund: (p, o) =>
      call(async () => {
        const refund = await stripe.refunds.create(
          { payment_intent: p.paymentIntentId, refund_application_fee: true },
          o,
        );
        return { id: refund.id, status: (refund.status ?? 'pending') as RefundView['status'] };
      }),
    createConnectedAccount: (p, o) =>
      call(async () => {
        const account = await stripe.v2.core.accounts.create(
          {
            contact_email: p.email,
            display_name: p.displayName,
            identity: { country: 'hr' },
            dashboard: 'full',
            defaults: {
              responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
            },
            configuration: {
              merchant: { capabilities: { card_payments: { requested: true } } },
            },
            metadata: { fetivi_provider_id: p.providerId },
          },
          { idempotencyKey: o.idempotencyKey },
        );
        return { id: account.id };
      }),
    createAccountLink: (p) =>
      call(async () => {
        const link = await stripe.v2.core.accountLinks.create({
          account: p.accountId,
          use_case: {
            type: 'account_onboarding',
            // `configurations` is gone on 2026-09-30.endive: the link onboards what the account requested.
            account_onboarding: {
              refresh_url: p.refreshUrl,
              return_url: p.returnUrl,
            },
          },
        });
        return { url: link.url, expiresAt: new Date(link.expires_at) };
      }),
    retrieveCardPaymentsStatus: (accountId) =>
      call(async () => {
        const account = await stripe.v2.core.accounts.retrieve(accountId, {
          include: ['configuration.merchant'],
        });
        return cardStatusOf(account.configuration?.merchant?.capabilities?.card_payments?.status);
      }),
    constructEvent: (rawBody, signature, secret) =>
      stripe.webhooks.constructEvent(rawBody, signature, secret),
  };
}
