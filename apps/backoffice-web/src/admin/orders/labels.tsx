import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';
import { i18next, localeOf } from '../../i18n';

export type Tone = 'ok' | 'wait' | 'fail' | 'neutral';

// The words are in the `labels` namespace (orderStatus, paymentStatus); the tones live here.

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  awaiting_confirmation: 'wait',
  confirming: 'wait',
  pending_provider: 'wait',
  confirmed: 'ok',
  declined: 'neutral',
  expired: 'neutral',
  failed: 'fail',
  cancelled: 'neutral',
  completed: 'ok',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  none: 'neutral',
  authorized: 'wait',
  captured: 'ok',
  voided: 'neutral',
  refund_pending: 'wait',
  refunded: 'neutral',
  failed: 'fail',
};

/** An amount in the interface language's number format, e.g. "€45.00" or "45,00 €". */
export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(localeOf(i18next.language), { style: 'currency', currency }).format(
    minor / 100,
  );

export const Chip = ({ text, tone }: { text: string; tone: Tone }) => (
  <span className={`chip ${tone}`}>{text}</span>
);
