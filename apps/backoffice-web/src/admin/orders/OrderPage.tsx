import type {
  OrderStatus,
  OrderTrigger,
  PaymentStatus,
  Proposer,
} from '@fetivi/domain/order-vocabulary';
import { ArrowUDownLeft, CalendarX, Check, ClockClockwise, X } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type AdminOrder, adminOrders } from '../../api';
import { NumberField, TextArea, TextField, TimeField } from '../../forms/fields';
import { useAction } from '../../useAction';
import { centsFromEuros } from '../providers/money';

type Tone = 'ok' | 'wait' | 'fail' | 'neutral';

const ORDER_STATUS: Record<OrderStatus, [string, Tone]> = {
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

const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  none: ['No payment', 'neutral'],
  authorized: ['Authorized', 'wait'],
  captured: ['Captured', 'ok'],
  voided: ['Voided', 'neutral'],
  refund_pending: ['Refund pending', 'wait'],
  refunded: ['Refunded', 'neutral'],
  failed: ['Refund failed', 'fail'],
};

const TRIGGERS: Record<OrderTrigger, string> = {
  guest: 'Guest',
  adapter: 'Provider system',
  provider_link: 'Provider link',
  card_timer: 'Card timer',
  hold_timer: 'Hold timer',
  window_timer: 'Response window',
  completion_timer: 'Completion timer',
  admin: 'Admin',
  payment_webhook: 'Stripe webhook',
  payment_job: 'Payment job',
  reconciliation: 'Reconciliation',
};

const PROPOSERS: Record<Proposer, string> = {
  offer: 'the Offer',
  provider_time: 'the Provider (new time)',
  provider_price: 'the Provider (price)',
  admin: 'an admin',
};

const NOTE_MAX = 500;

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** A civil 'YYYY-MM-DD' in the same style, without shifting it through a time zone. */
const day = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });

const Chip = ({ text, tone }: { text: string; tone: Tone }) => (
  <span className={`chip ${tone}`}>{text}</span>
);

function rulesText(o: AdminOrder): string {
  const free =
    o.freeCancelHoursBefore === 0
      ? 'Free until the start'
      : `Free until ${o.freeCancelHoursBefore} h before the start`;
  return `${free}, then ${o.refundPercentAfter} % back.`;
}

/**
 * One Order for the admin (35): status, payment, policy and history, a cancel with an optional
 * refund override, and a refund of a released Order whose money is still captured.
 */
export function OrderPage() {
  const { id = '' } = useParams();
  const { busy, error, run } = useAction();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [override, setOverride] = useState<number | null>(null);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const [refund, setRefund] = useState<number | null>(null);
  const [refundNote, setRefundNote] = useState<string | null>(null);
  const [answerNote, setAnswerNote] = useState<string | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState<number | null>(null);

  const load = useCallback(async () => setOrder(await adminOrders.get(id)), [id]);

  useEffect(() => {
    setOrder(null);
    void run(load);
  }, [run, load]);

  function cancel(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const refundMinor = order.paidAmountMinor === null ? undefined : centsFromEuros(override);
    const what =
      order.paidAmountMinor === null
        ? 'Cancel this Order?'
        : `Cancel this Order and refund ${money(refundMinor ?? order.paidAmountMinor, order.currency)}?`;
    if (!window.confirm(`${what} The guest and the Provider are told.`)) return;
    void run(async () => {
      setOrder(
        await adminOrders.cancel(order.id, {
          refundMinor: refundMinor ?? undefined,
          note: cancelNote ?? undefined,
        }),
      );
    });
  }

  function refundNow(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const refundMinor = centsFromEuros(refund);
    if (refundMinor === null) return;
    if (!window.confirm(`Refund ${money(refundMinor, order.currency)} to the guest?`)) return;
    void run(async () => {
      setOrder(await adminOrders.refund(order.id, { refundMinor, note: refundNote ?? undefined }));
    });
  }

  /** Records the Provider's phoned answer on the proposal the page shows. */
  function answer(kind: 'accept' | 'decline' | 'propose') {
    if (!order || !answerNote?.trim()) return;
    const body = { proposalId: order.proposalId, note: answerNote };
    const what = {
      accept: 'Record that the Provider accepted? The Order is confirmed and the guest is told.',
      decline: 'Record that the Provider declined? The guest is told.',
      propose: 'Send these new terms to the guest? They accept or decline them in chat.',
    }[kind];
    if (!window.confirm(what)) return;
    void run(async () => {
      const next =
        kind === 'propose'
          ? await adminOrders.propose(order.id, {
              ...body,
              date: newDate ?? order.date,
              time: newTime ?? undefined,
              priceMinor: centsFromEuros(newPrice) ?? undefined,
            })
          : await adminOrders[kind](order.id, body);
      setOrder(next);
      setAnswerNote(null);
    });
  }

  if (!order) {
    return (
      <>
        <nav className="crumbs" aria-label="Breadcrumb">
          <Link to="/admin/orders">Orders</Link>
        </nav>
        {error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </>
    );
  }

  const [statusText, statusTone] = ORDER_STATUS[order.status];
  const [paymentText, paymentTone] = PAYMENT_STATUS[order.paymentStatus];
  const paidEuros = order.paidAmountMinor === null ? 0 : order.paidAmountMinor / 100;
  const facts: [string, string][] = [
    ['Provider', order.providerName ?? 'Host Offer'],
    ['When', order.startsAt ? time(order.startsAt) : day(order.date)],
    ['Quantity', String(order.quantity)],
    ['Terms', `Version ${order.version}, from ${PROPOSERS[order.proposer]}`],
    [
      'Total',
      order.priceMinor === null ? 'Set by the Provider' : money(order.priceMinor, order.currency),
    ],
    ['Payment', order.paymentMode === 'online' ? 'Paid online' : 'Paid to the Provider directly'],
    ['Refund rules', rulesText(order)],
    ['Policy text', order.cancellationPolicy],
  ];
  if (order.policyRefundMinor !== null) {
    facts.push(['Policy refund now', money(order.policyRefundMinor, order.currency)]);
  }
  if (order.refundAmountMinor !== null) {
    facts.push(['Refund decided', money(order.refundAmountMinor, order.currency)]);
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/orders">Orders</Link>
        <span aria-hidden="true">/</span>
        <span className="mono-text">{order.id.slice(0, 8)}</span>
      </nav>
      <div className="page-head">
        <h1>{order.offerTitle}</h1>
        <div className="record-chips">
          <Chip text={statusText} tone={statusTone} />
          <Chip text={paymentText} tone={paymentTone} />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <section className="panel" aria-labelledby="order-facts">
          <h2 id="order-facts">Order</h2>
          <dl className="order-facts">
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {order.canAnswer ? (
          <form
            className="panel"
            aria-labelledby="order-answer"
            onSubmit={(event) => event.preventDefault()}
          >
            <h2 id="order-answer">Provider's answer</h2>
            <p className="muted">
              {order.windowMissed ? <Chip text="Window missed" tone="fail" /> : null}{' '}
              {order.responseDueAt ? `The answer is due ${time(order.responseDueAt)}. ` : ''}
              Phone the Provider and record what they said.
            </p>
            <div className="fields">
              <TextArea
                label="What the Provider said on the phone"
                hint="Required. Saved on the Order's history."
                value={answerNote}
                maxLength={NOTE_MAX}
                rows={2}
                required
                onChange={setAnswerNote}
              />
              <div className="field-row">
                <TextField
                  label="New date"
                  hint={`Within the stay, ${day(order.stayFrom)} – ${day(order.stayTo)}.`}
                  type="date"
                  value={newDate ?? order.date}
                  min={order.stayFrom}
                  max={order.stayTo}
                  maxLength={10}
                  onChange={setNewDate}
                />
                <TimeField
                  label="New time"
                  hint={`Optional. ${order.zone} time.`}
                  value={newTime}
                  onChange={setNewTime}
                />
                <NumberField
                  label={`New total price (${order.currency})`}
                  hint={order.priceMinor === null ? 'Required: no price yet.' : 'Optional.'}
                  value={newPrice}
                  min={0.01}
                  max={100_000}
                  step="any"
                  onChange={setNewPrice}
                />
              </div>
            </div>
            <div className="section-foot">
              {order.orderKind === 'request' ? null : (
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !answerNote?.trim()}
                  onClick={() => answer('accept')}
                >
                  <Check aria-hidden="true" weight="bold" />
                  Accept
                </button>
              )}
              <button
                type="button"
                disabled={
                  busy || !answerNote?.trim() || (order.priceMinor === null && newPrice === null)
                }
                onClick={() => answer('propose')}
              >
                <ClockClockwise aria-hidden="true" weight="bold" />
                Send new terms
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || !answerNote?.trim()}
                onClick={() => answer('decline')}
              >
                <X aria-hidden="true" weight="bold" />
                Decline
              </button>
            </div>
          </form>
        ) : null}

        {order.canCancel ? (
          <form className="panel" aria-labelledby="order-cancel" onSubmit={cancel}>
            <h2 id="order-cancel">Cancel order</h2>
            <p className="muted">
              {order.paidAmountMinor === null
                ? 'Nothing is captured through Fetivi, so the cancel moves no money.'
                : `A cancel refunds the full ${money(order.paidAmountMinor, order.currency)} with Fetivi's fee, unless you set another amount.`}
            </p>
            <div className="fields">
              {order.paidAmountMinor !== null ? (
                <NumberField
                  label={`Refund instead of the full amount (${order.currency})`}
                  hint={
                    order.policyRefundMinor === null
                      ? undefined
                      : `The policy gives ${money(order.policyRefundMinor, order.currency)} now.`
                  }
                  value={override}
                  min={0}
                  max={paidEuros}
                  step="any"
                  onChange={setOverride}
                />
              ) : null}
              <TextArea
                label="Note"
                hint="Saved on the Order's history."
                value={cancelNote}
                maxLength={NOTE_MAX}
                rows={2}
                onChange={setCancelNote}
              />
            </div>
            <div className="section-foot">
              <button type="submit" className="danger" disabled={busy}>
                <CalendarX aria-hidden="true" weight="bold" />
                Cancel order
              </button>
            </div>
          </form>
        ) : null}

        {order.canRefund ? (
          <form className="panel" aria-labelledby="order-refund" onSubmit={refundNow}>
            <h2 id="order-refund">Refund</h2>
            <p className="muted">
              The money is still captured. One refund per payment, with Fetivi's fee in proportion.
            </p>
            <div className="fields">
              <NumberField
                label={`Amount (${order.currency})`}
                value={refund}
                min={0.01}
                max={paidEuros}
                step="any"
                required
                onChange={setRefund}
              />
              <TextArea
                label="Note"
                hint="Saved on the Order's history."
                value={refundNote}
                maxLength={NOTE_MAX}
                rows={2}
                onChange={setRefundNote}
              />
            </div>
            <div className="section-foot">
              <button type="submit" className="primary" disabled={busy}>
                <ArrowUDownLeft aria-hidden="true" weight="bold" />
                Refund
              </button>
            </div>
          </form>
        ) : null}

        <p className="muted">Further refunds are made in the Provider's Stripe dashboard.</p>

        <section className="panel" aria-labelledby="order-history">
          <h2 id="order-history">History</h2>
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Order</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Cause</th>
                  <th scope="col">Note</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {order.events.map((e) => (
                  <tr key={e.id}>
                    <td>{time(e.at)}</td>
                    <td>
                      {e.from && e.from !== e.to
                        ? `${ORDER_STATUS[e.from][0]} → ${ORDER_STATUS[e.to][0]}`
                        : ORDER_STATUS[e.to][0]}
                    </td>
                    <td>
                      {e.fromPayment && e.fromPayment !== e.toPayment
                        ? `${PAYMENT_STATUS[e.fromPayment][0]} → ${PAYMENT_STATUS[e.toPayment][0]}`
                        : PAYMENT_STATUS[e.toPayment][0]}
                    </td>
                    <td>{TRIGGERS[e.trigger]}</td>
                    <td>{e.note ?? ''}</td>
                    <td>{e.actorEmail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
