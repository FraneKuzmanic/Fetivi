import type { PaymentMode } from '@fetivi/domain/offer-vocabulary';
import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';
import type { OrderSummaryPayload } from '../../payloads';

export interface ReceiptLabels {
  when: string;
  quantity: string;
  total: string;
  booking: string;
  payment: string;
  reference: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
  price: (priceMinor: number | null, currency: string) => string;
  orderStatus: (status: OrderStatus) => string;
  paymentStatus: (status: PaymentStatus, mode: PaymentMode) => string;
}

type Tone = 'good' | 'wait' | 'off';

const ORDER_TONE: Record<OrderStatus, Tone> = {
  awaiting_confirmation: 'wait',
  confirming: 'wait',
  pending_provider: 'wait',
  confirmed: 'good',
  completed: 'good',
  declined: 'off',
  expired: 'off',
  failed: 'off',
  cancelled: 'off',
};

const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  none: 'good',
  authorized: 'wait',
  captured: 'good',
  voided: 'off',
  refund_pending: 'wait',
  refunded: 'off',
  failed: 'off',
};

/** A status as text with a small marker: the colour only repeats what the words say. */
const Status = ({ tone, text }: { tone: Tone; text: string }) => (
  <span className="fv-status">
    <span className="fv-status-dot" data-tone={tone} aria-hidden="true" />
    {text}
  </span>
);

/** One Order, read-only: in chat after the guest's tap, and in My trip. */
export function ReceiptCard({
  order,
  labels,
}: {
  order: OrderSummaryPayload;
  labels: ReceiptLabels;
}) {
  return (
    <article className="fv-receipt">
      <h3 className="fv-receipt-title">{order.offerTitle}</h3>
      <dl className="fv-receipt-facts">
        <div>
          <dt>{labels.booking}</dt>
          <dd>
            <Status tone={ORDER_TONE[order.status]} text={labels.orderStatus(order.status)} />
          </dd>
        </div>
        <div>
          <dt>{labels.payment}</dt>
          <dd>
            <Status
              tone={PAYMENT_TONE[order.paymentStatus]}
              text={labels.paymentStatus(order.paymentStatus, order.paymentMode)}
            />
          </dd>
        </div>
        <div>
          <dt>{labels.when}</dt>
          <dd>{labels.dateTime(order.date, order.startsAtLocal)}</dd>
        </div>
        <div>
          <dt>{labels.quantity}</dt>
          <dd>{order.quantity}</dd>
        </div>
        <div>
          <dt>{labels.total}</dt>
          <dd>{labels.price(order.priceMinor, order.currency)}</dd>
        </div>
        <div>
          <dt>{labels.reference}</dt>
          <dd>{order.id.slice(0, 8).toUpperCase()}</dd>
        </div>
      </dl>
    </article>
  );
}
