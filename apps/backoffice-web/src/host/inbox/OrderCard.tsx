import { OFFER_LIMITS } from '@fetivi/domain/offer-vocabulary';
import { type FormEvent, useId, useState } from 'react';
import { centsFromEuros } from '../../admin/providers/money';
import { type HostOrderActionBody, type HostOrderView, host, type OrderAction } from '../../api';
import { DateField, NumberField, TimeField } from '../../forms/fields';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';
import { inboxChanged } from './inbox-events';

// One Order on the host's own service (38): the Provider link's view and one-tap answers, in the
// back office. Each answer is bound to the proposal the card shows; a changed Order refreshes.

const day = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** 'YYYY-MM-DD' → "Sun 25 Oct"; a civil date never shifts a day. */
export const orderDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

// A per-group price is flat and its quantity is the party size (machine.ts), so both read as people.
const QUANTITY: Record<HostOrderView['priceUnit'], (n: number) => string> = {
  person: people,
  group: people,
  item: (n) => `${n} ×`,
  litre: (n) => `${n} l`,
  kilogram: (n) => `${n} kg`,
  hour: (n) => (n === 1 ? '1 hour' : `${n} hours`),
  day: (n) => (n === 1 ? '1 day' : `${n} days`),
};

export function orderChip(order: HostOrderView): { label: string; tone: string } {
  if (order.status === 'pending_provider') return { label: 'Waiting for you', tone: 'wait' };
  if (order.status === 'awaiting_confirmation')
    return { label: 'Waiting for the guest', tone: 'neutral' };
  if (order.status === 'declined') return { label: 'Declined', tone: 'fail' };
  if (order.status === 'confirmed') {
    if (order.acknowledgedAt) return { label: 'Acknowledged', tone: 'ok' };
    // An allotment Order waits for Got it; an accepted request asks nothing more.
    return order.actions.includes('acknowledge')
      ? { label: 'New order', tone: 'wait' }
      : { label: 'Confirmed', tone: 'ok' };
  }
  if (order.status === 'cancelled') return { label: 'Cancelled', tone: 'fail' };
  if (order.final) return { label: 'Closed', tone: 'neutral' };
  return { label: 'In progress', tone: 'neutral' };
}

const APPLIED: Record<OrderAction, string> = {
  acknowledge: 'Thanks, your acknowledgement is recorded.',
  cannot_fulfil: 'The order is cancelled. The guest has been told.',
  accept: 'Accepted. The guest has been told.',
  decline: 'Declined. The guest has been told.',
  suggest_time: 'Your suggestion was sent to the guest.',
  accept_with_price: 'Your price was sent to the guest.',
};

const OUTCOME = {
  unchanged: 'This was already recorded.',
  stale: 'This order changed — refreshed.',
  rejected: 'This order changed — refreshed.',
} as const;

const CANNOT_FULFIL =
  'It will be cancelled, the guest is told, and anything they paid is refunded in full.';

type Form = 'suggest_time' | 'accept_with_price' | null;

export function OrderCard({
  order,
  onChanged,
}: {
  order: HostOrderView;
  /** Reloads the inbox after an answer. */
  onChanged: () => Promise<void>;
}) {
  const id = useId();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [form, setForm] = useState<Form>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(order.date);
  const [time, setTime] = useState<string | null>(order.startTime);
  const [price, setPrice] = useState<number | null>(null);
  const can = (action: OrderAction) => order.actions.includes(action);
  const chip = orderChip(order);

  const answer = (action: OrderAction, terms: Partial<HostOrderActionBody> = {}) =>
    run(async () => {
      const result = await host.orderAction(order.orderId, {
        action,
        proposalId: order.proposalId,
        ...terms,
      });
      setOutcome(result.outcome === 'applied' ? APPLIED[action] : OUTCOME[result.outcome]);
      setForm(null);
      await onChanged();
      inboxChanged();
    });

  const submitTerms = (event: FormEvent) => {
    event.preventDefault();
    const priceMinor = centsFromEuros(price);
    if (form === 'accept_with_price') {
      void answer('accept_with_price', { priceMinor: priceMinor ?? 0 });
      return;
    }
    void answer('suggest_time', {
      date: date ?? '',
      ...(time ? { time } : {}),
      ...(priceMinor !== null ? { priceMinor } : {}),
    });
  };

  const facts = [
    orderDay(order.date),
    order.startTime,
    QUANTITY[order.priceUnit](order.quantity),
    order.priceMinor !== null ? money(order.priceMinor, order.currency) : 'Price to name',
  ].filter(Boolean);

  return (
    <li className="order-card" aria-labelledby={`${id}-title`}>
      <div className="order-card-head">
        <strong id={`${id}-title`}>{order.offerTitle}</strong>
        <span className={`chip ${chip.tone}`}>{chip.label}</span>
      </div>
      <p className="order-card-facts">{facts.join(' · ')}</p>
      {order.guest.name || order.guest.phone ? (
        <p className="muted order-card-guest">
          {order.guest.name}
          {order.guest.name && order.guest.phone ? ' · ' : null}
          {order.guest.phone ? <a href={`tel:${order.guest.phone}`}>{order.guest.phone}</a> : null}
        </p>
      ) : null}
      {order.respondBy ? (
        <p className="order-card-due">
          Answer by {orderDay(order.respondBy.slice(0, 10))}, {order.respondBy.slice(11, 16)}
        </p>
      ) : null}

      {outcome ? (
        <output className="saved" aria-live="polite">
          {outcome}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      {form ? (
        <form className="order-card-form" onSubmit={submitTerms}>
          <p className="muted">
            {form === 'suggest_time'
              ? 'The guest gets your suggestion and can accept or decline it.'
              : 'Enter the total price for this order. The guest can accept or decline it.'}
          </p>
          <div className="field-row">
            {form === 'suggest_time' ? (
              <>
                <DateField
                  label="Date"
                  value={date}
                  min={order.stayFrom}
                  max={order.stayTo}
                  required
                  onChange={setDate}
                />
                <TimeField label="Time (optional)" value={time} onChange={setTime} />
              </>
            ) : null}
            {form === 'accept_with_price' || order.needsPrice ? (
              <NumberField
                label="Total price (€)"
                value={price}
                min={0.01}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                required
                onChange={setPrice}
              />
            ) : null}
          </div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Send to the guest
            </button>
            <button type="button" disabled={busy} onClick={() => setForm(null)}>
              Back
            </button>
          </div>
        </form>
      ) : order.actions.length > 0 ? (
        <div className="actions">
          {can('accept') ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void answer('accept')}
            >
              Accept
            </button>
          ) : null}
          {can('accept_with_price') ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setForm('accept_with_price')}
            >
              Accept with price
            </button>
          ) : null}
          {can('suggest_time') ? (
            <button type="button" disabled={busy} onClick={() => setForm('suggest_time')}>
              Suggest another time
            </button>
          ) : null}
          {can('decline') ? (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void answer('decline')}
            >
              Decline
            </button>
          ) : null}
          {can('acknowledge') ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void answer('acknowledge')}
            >
              Got it
            </button>
          ) : null}
          {can('cannot_fulfil') ? (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm({
                    title: "Can't fulfil this order?",
                    body: CANNOT_FULFIL,
                    action: "Can't fulfil",
                    danger: true,
                  })
                )
                  void answer('cannot_fulfil');
              }}
            >
              Can't fulfil
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
