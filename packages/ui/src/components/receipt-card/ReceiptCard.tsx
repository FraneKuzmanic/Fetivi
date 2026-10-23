import type { PaymentMode, PriceUnit } from '@fetivi/domain/offer-vocabulary';
import type { OrderStatus, PaymentStatus } from '@fetivi/domain/order-vocabulary';
import type { OrderSummaryPayload } from '../../payloads';

export interface ReceiptLabels {
  when: string;
  /** The quantity's heading, named by its unit. */
  quantity: (unit: PriceUnit) => string;
  total: string;
  status: string;
  payment: string;
  reference: string;
  dateTime: (date: string, startsAtLocal: string | null) => string;
  price: (priceMinor: number | null, currency: string) => string;
  orderStatus: (status: OrderStatus) => string;
  paymentStatus: (status: PaymentStatus, mode: PaymentMode) => string;
  /** The Pay now button of a pay-online Order the guest can still pay. */
  pay: string;
  /** The line under it: the time the checkout closes. */
  payBy: (iso: string) => string;
  /** While the secure payment page opens. */
  paying: string;
}

type Tone = 'good' | 'wait' | 'off';

export const ORDER_TONE: Record<OrderStatus, Tone> = {
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
  // Nothing paid through Fetivi: the guest still pays the provider.
  none: 'wait',
  authorized: 'wait',
  captured: 'good',
  voided: 'off',
  refund_pending: 'wait',
  refunded: 'off',
  failed: 'off',
};

/** A status as text with a small marker: the colour only repeats what the words say. */
export const Status = ({ tone, text }: { tone: Tone; text: string }) => (
  <span className="fv-status">
    <span className="fv-status-dot" data-tone={tone} aria-hidden="true" />
    {text}
  </span>
);

/** The refund's amount is shown with its status once one is decided, a failed one too. */
const REFUND_SHOWN: readonly PaymentStatus[] = ['refund_pending', 'refunded', 'failed'];

/** One Order, read-only: in chat after the guest's tap, and in My trip. */
export function ReceiptCard({
  order,
  labels,
  onPay,
  paying = false,
  notice,
}: {
  order: OrderSummaryPayload;
  labels: ReceiptLabels;
  /** Shows Pay now while `order.payBy` is set; the URL comes from the server on tap. */
  onPay?: (orderId: string) => void;
  paying?: boolean;
  /** A short line under the facts, such as why the payment window closed. */
  notice?: string | null;
}) {
  return (
    <article className="fv-receipt">
      <h3 className="fv-receipt-title">{order.offerTitle}</h3>
      <dl className="fv-receipt-facts">
        <div>
          <dt>{labels.status}</dt>
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
            {order.refundMinor !== null && REFUND_SHOWN.includes(order.paymentStatus) && (
              <> · {labels.price(order.refundMinor, order.currency)}</>
            )}
          </dd>
        </div>
        <div>
          <dt>{labels.when}</dt>
          <dd>{labels.dateTime(order.date, order.startsAtLocal)}</dd>
        </div>
        <div>
          <dt>{labels.quantity(order.priceUnit)}</dt>
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
      {order.payBy && onPay && (
        <div className="fv-receipt-pay">
          <button
            type="button"
            className="fv-confirm-yes"
            disabled={paying}
            onClick={() => onPay(order.id)}
          >
            {labels.pay}
          </button>
          <p className="fv-confirm-note">{paying ? labels.paying : labels.payBy(order.payBy)}</p>
        </div>
      )}
      {notice && (
        <p role="status" className="fv-confirm-note">
          {notice}
        </p>
      )}
    </article>
  );
}
