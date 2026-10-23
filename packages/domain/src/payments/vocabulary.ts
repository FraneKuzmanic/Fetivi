// Every controlled list of pay-online payments (ticket 33). Imports nothing, like the other
// vocabulary files, so the pgEnums are built from it.

/** The Stripe API version every call is pinned to (what spike S2 ran). */
export const STRIPE_API_VERSION = '2026-09-30.endive';

/** Stripe's minimum Checkout Session lifetime; also the inventory hold of a pay-online Order. */
export const CHECKOUT_HOLD_MINUTES = 30;

/**
 * When a create was never sent and the stored `expires_at` is less than this far ahead, the
 * attempt is restamped instead (S2: 29 minutes ahead is accepted, 25 is rejected).
 */
export const CHECKOUT_MIN_LEAD_SECONDS = 29 * 60 + 30;

/** The attempt's mirror of the Checkout Session status, in Stripe's spelling. */
export const SESSION_STATUSES = ['open', 'complete', 'expired'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** The attempt's mirror of the payment intent status, in Stripe's spelling. */
export const INTENT_STATUSES = ['requires_capture', 'succeeded', 'canceled'] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/** The attempt's mirror of the refund status, in Stripe's spelling. */
export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** The operations of the order-payment job. */
export const PAYMENT_OPERATIONS = [
  'open',
  'confirm',
  'capture',
  'void',
  'expire_session',
  'refund',
] as const;
export type PaymentOperation = (typeof PAYMENT_OPERATIONS)[number];

/** The `<operation>` part of a Stripe idempotency key. */
export const STRIPE_KEY_OPERATIONS = [
  'create_session',
  'capture',
  'cancel',
  'expire_session',
  'refund',
] as const;
export type StripeKeyOperation = (typeof STRIPE_KEY_OPERATIONS)[number];

/** The methods a created session may offer. Link cannot be excluded (S2). */
export const CARD_METHODS = ['card', 'link'] as const;

/**
 * Sent as `excluded_payment_method_types`; never `payment_method_types`. S2's observed methods
 * first, then the redirect and manual-capture methods Stripe offers in the EU. The post-create
 * check of the session's methods is the guarantee; this list only keeps the page clean.
 */
export const NON_CARD_METHODS = [
  'klarna',
  'revolut_pay',
  'satispay',
  'paypal',
  'amazon_pay',
  'mobilepay',
  'twint',
  'billie',
  'alma',
  'affirm',
  'afterpay_clearpay',
  'sepa_debit',
  'bancontact',
  'eps',
  'ideal',
  'p24',
  'blik',
  'multibanco',
  'mb_way',
  'swish',
  'pay_by_bank',
  'cashapp',
  'wechat_pay',
  'alipay',
  'kakao_pay',
  'naver_pay',
  'samsung_pay',
  'payco',
  'kr_card',
  'zip',
  'crypto',
] as const;

/** Guest language → Checkout `locale`. Every guest language is a Checkout locale. */
export const PAYMENT_LOCALES = {
  en: 'en',
  hr: 'hr',
  de: 'de',
  it: 'it',
  pl: 'pl',
  hu: 'hu',
  fr: 'fr',
} as const;

/**
 * A Provider's stored Accounts v2 `configuration.merchant.capabilities.card_payments.status`;
 * null on the Provider means never onboarded.
 */
export const PROVIDER_CARD_STATUSES = ['active', 'pending', 'restricted', 'unsupported'] as const;
export type ProviderCardStatus = (typeof PROVIDER_CARD_STATUSES)[number];
