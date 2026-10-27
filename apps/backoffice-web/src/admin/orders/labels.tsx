import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';

export type Tone = 'ok' | 'wait' | 'fail' | 'neutral';

export const ORDER_STATUS: Record<OrderStatus, [string, Tone]> = {
  awaiting_confirmation: ['Awaiting confirmation', 'wait'],
  confirming: ['Confirming', 'wait'],
  pending_provider: ['Waiting for the Provider', 'wait'],
  confirmed: ['Confirmed', 'ok'],
  declined: ['Declined', 'neutral'],
  expired: ['Expired', 'neutral'],
  failed: ['Failed', 'fail'],
  cancelled: ['Cancelled', 'neutral'],
  completed: ['Completed', 'ok'],
};

export const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  none: ['No payment', 'neutral'],
  authorized: ['Card held', 'wait'],
  captured: ['Paid', 'ok'],
  voided: ['Hold released', 'neutral'],
  refund_pending: ['Refund pending', 'wait'],
  refunded: ['Refunded', 'neutral'],
  failed: ['Refund failed', 'fail'],
};

export const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);

export const Chip = ({ text, tone }: { text: string; tone: Tone }) => (
  <span className={`chip ${tone}`}>{text}</span>
);
