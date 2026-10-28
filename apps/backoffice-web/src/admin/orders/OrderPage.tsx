import type { OrderTrigger, Proposer } from '@fetivi/domain/order-vocabulary';
import { ArrowUDownLeft, CalendarX, Check, ClockClockwise, X } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { type AdminOrder, adminOrders } from '../../api';
import { formatDate, formatMoment } from '../../forms/datetime';
import { DateField, NumberField, TextArea, TimeField } from '../../forms/fields';
import { i18next } from '../../i18n';
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { centsFromEuros } from '../providers/money';
import { Chip, money, ORDER_STATUS_TONE, PAYMENT_STATUS_TONE } from './labels';

const NOTE_MAX = 500;

const time = formatMoment;
const day = formatDate;

function rulesText(o: AdminOrder): string {
  return o.freeCancelHoursBefore === 0
    ? i18next.t('admin:order.freeUntilStart', { percent: o.refundPercentAfter })
    : i18next.t('admin:order.freeUntilHours', {
        hours: o.freeCancelHoursBefore,
        percent: o.refundPercentAfter,
      });
}

/**
 * One Order for the admin (35): status, payment, policy and history, a cancel with an optional
 * refund override, and a refund of a released Order whose money is still captured.
 */
export function OrderPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { id = '' } = useParams();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
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

  async function cancel(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const refundMinor = order.paidAmountMinor === null ? undefined : centsFromEuros(override);
    const amount =
      order.paidAmountMinor === null
        ? null
        : money(refundMinor ?? order.paidAmountMinor, order.currency);
    const isHost = order.providerName === null;
    const yes = await confirm({
      title: t('order.cancelTitle'),
      body: amount
        ? t(isHost ? 'order.cancelRefundHost' : 'order.cancelRefundProvider', { amount })
        : t(isHost ? 'order.cancelBodyHost' : 'order.cancelBodyProvider'),
      action: amount ? t('order.cancelAndRefund', { amount }) : t('order.cancelOrder'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      setOrder(
        await adminOrders.cancel(order.id, {
          refundMinor: refundMinor ?? undefined,
          note: cancelNote ?? undefined,
        }),
      );
    });
  }

  async function refundNow(event: FormEvent) {
    event.preventDefault();
    if (!order) return;
    const refundMinor = centsFromEuros(refund);
    if (refundMinor === null) return;
    const amount = money(refundMinor, order.currency);
    const yes = await confirm({
      title: t('order.refundTitle', { amount }),
      body: t('order.refundBody'),
      action: t('order.refundAmount', { amount }),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      setOrder(await adminOrders.refund(order.id, { refundMinor, note: refundNote ?? undefined }));
    });
  }

  /** Records the Provider's phoned answer on the proposal the page shows. */
  async function answer(kind: 'accept' | 'decline' | 'propose') {
    if (!order || !answerNote?.trim()) return;
    const body = { proposalId: order.proposalId, note: answerNote };
    const ask = {
      accept: {
        title: t('order.acceptTitle'),
        body: t('order.acceptBody'),
        action: t('order.confirmOrder'),
      },
      decline: {
        title: t('order.declineTitle'),
        body: t('order.declineBody'),
        action: t('order.declineOrder'),
        danger: true,
      },
      propose: {
        title: t('order.proposeTitle'),
        body: t('order.proposeBody'),
        action: t('order.sendTerms'),
      },
    }[kind];
    if (!(await confirm(ask))) return;
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

  usePageTitle(order?.offerTitle);

  if (!order) {
    return (
      <>
        <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
          <Link to="/admin/orders">{t('orders.title')}</Link>
        </nav>
        {error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>}
      </>
    );
  }

  const statusLabel = labels.orderStatus[order.status];
  const statusTone = ORDER_STATUS_TONE[order.status];
  const paymentText = labels.paymentStatus[order.paymentStatus];
  const paymentTone = PAYMENT_STATUS_TONE[order.paymentStatus];
  const paidEuros = order.paidAmountMinor === null ? 0 : order.paidAmountMinor / 100;
  // A host's own Offer (38) has no Provider: the host is paid and is merchant of record.
  const isHost = order.providerName === null;
  const statusText =
    order.status === 'pending_provider'
      ? t(isHost ? 'order.waitingHost' : 'order.waitingProvider')
      : statusLabel;
  const facts: [string, string][] = [
    order.providerName === null
      ? [t('order.host'), t('order.ownService', { email: order.hostEmail ?? t('order.host') })]
      : [t('order.provider'), order.providerName],
    [t('order.when'), order.startsAt ? time(order.startsAt) : day(order.date)],
    [t('order.quantity'), String(order.quantity)],
    [
      t('order.terms'),
      order.version === 1 && order.proposer === 'offer'
        ? t('order.asOffered')
        : t('order.changedBy', {
            who: t(`order.proposers.${order.proposer as Proposer}`),
            version: order.version,
          }),
    ],
    [
      t('order.total'),
      order.priceMinor === null
        ? t('order.setByProvider')
        : money(order.priceMinor, order.currency),
    ],
    [
      t('order.payment'),
      order.paymentMode === 'online'
        ? t('order.paidOnline')
        : t(isHost ? 'order.paidHost' : 'order.paidProvider'),
    ],
    [t('order.refundRules'), rulesText(order)],
    [t('order.policyText'), order.cancellationPolicy],
  ];
  if (order.policyRefundMinor !== null) {
    facts.push([t('order.policyRefund'), money(order.policyRefundMinor, order.currency)]);
  }
  if (order.refundAmountMinor !== null) {
    facts.push([t('order.refundDecided'), money(order.refundAmountMinor, order.currency)]);
  }

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/orders">{t('orders.title')}</Link>
      </nav>
      <div className="page-head">
        <div className="record-chips">
          <Chip text={statusText} tone={statusTone} />
          <Chip text={paymentText} tone={paymentTone} />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <section className="panel" aria-labelledby="order-facts">
          <h2 id="order-facts">{t('order.order')}</h2>
          <dl className="order-facts">
            {facts.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            {t(isHost ? 'order.laterRefundHost' : 'order.laterRefundProvider')}
          </p>
        </section>

        {order.canAnswer ? (
          <form
            className="panel"
            aria-labelledby="order-answer"
            onSubmit={(event) => event.preventDefault()}
          >
            <h2 id="order-answer">{t('order.answer')}</h2>
            <p className="muted">
              {order.windowMissed ? <Chip text={t('order.overdue')} tone="fail" /> : null}{' '}
              {order.responseDueAt
                ? `${t('order.dueAt', { when: time(order.responseDueAt) })} `
                : ''}
              {t('order.phone')}
            </p>
            <div className="fields">
              <TextArea
                label={t('order.said')}
                hint={t('order.saidHint')}
                value={answerNote}
                maxLength={NOTE_MAX}
                rows={2}
                required
                onChange={setAnswerNote}
              />
              <div className="field-row">
                <DateField
                  label={t('order.newDate')}
                  hint={t('order.withinStay', { from: day(order.stayFrom), to: day(order.stayTo) })}
                  value={newDate ?? order.date}
                  min={order.stayFrom}
                  max={order.stayTo}
                  onChange={setNewDate}
                />
                <TimeField
                  label={t('order.newTime')}
                  hint={t('order.timeHint', { zone: order.zone })}
                  value={newTime}
                  onChange={setNewTime}
                />
                <NumberField
                  label={t('order.newPrice', { currency: order.currency })}
                  hint={order.priceMinor === null ? t('order.priceRequired') : t('order.optional')}
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
                  {t('order.accept')}
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
                {t('order.sendTerms')}
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy || !answerNote?.trim()}
                onClick={() => answer('decline')}
              >
                <X aria-hidden="true" weight="bold" />
                {t('order.decline')}
              </button>
            </div>
          </form>
        ) : null}

        {order.canCancel ? (
          <form className="panel" aria-labelledby="order-cancel" onSubmit={cancel}>
            <h2 id="order-cancel">{t('order.cancelOrder')}</h2>
            <p className="muted">
              {order.paidAmountMinor === null
                ? t('order.nothingCaptured')
                : t('order.refundsFull', { amount: money(order.paidAmountMinor, order.currency) })}
            </p>
            <div className="fields">
              {order.paidAmountMinor !== null ? (
                <NumberField
                  label={t('order.refundInstead', { currency: order.currency })}
                  hint={
                    order.policyRefundMinor === null
                      ? undefined
                      : t('order.policyGives', {
                          amount: money(order.policyRefundMinor, order.currency),
                        })
                  }
                  value={override}
                  min={0}
                  max={paidEuros}
                  step="any"
                  onChange={setOverride}
                />
              ) : null}
              <TextArea
                label={t('order.note')}
                hint={t('order.noteHint')}
                value={cancelNote}
                maxLength={NOTE_MAX}
                rows={2}
                onChange={setCancelNote}
              />
            </div>
            <div className="section-foot">
              <button type="submit" className="danger" disabled={busy}>
                <CalendarX aria-hidden="true" weight="bold" />
                {t('order.cancelOrder')}
              </button>
            </div>
          </form>
        ) : null}

        {order.canRefund ? (
          <form className="panel" aria-labelledby="order-refund" onSubmit={refundNow}>
            <h2 id="order-refund">{t('order.refund')}</h2>
            <p className="muted">
              {t('order.guestPaid', { amount: money(order.paidAmountMinor ?? 0, order.currency) })}
            </p>
            <div className="fields">
              <NumberField
                label={t('order.amount', { currency: order.currency })}
                value={refund}
                min={0.01}
                max={paidEuros}
                step="any"
                required
                onChange={setRefund}
              />
              <TextArea
                label={t('order.note')}
                hint={t('order.noteHint')}
                value={refundNote}
                maxLength={NOTE_MAX}
                rows={2}
                onChange={setRefundNote}
              />
            </div>
            <div className="section-foot">
              <button type="submit" className="primary" disabled={busy}>
                <ArrowUDownLeft aria-hidden="true" weight="bold" />
                {t('order.refund')}
              </button>
            </div>
          </form>
        ) : null}

        <section className="panel" aria-labelledby="order-history">
          <h2 id="order-history">{t('order.history')}</h2>
          <div className="table-scroll">
            <table className="events-table">
              <thead>
                <tr>
                  <th scope="col">{t('order.time')}</th>
                  <th scope="col">{t('order.order')}</th>
                  <th scope="col">{t('order.payment')}</th>
                  <th scope="col">{t('order.cause')}</th>
                  <th scope="col">{t('order.note')}</th>
                  <th scope="col">{t('order.by')}</th>
                </tr>
              </thead>
              <tbody>
                {order.events.map((e) => (
                  <tr key={e.id}>
                    <td>{time(e.at)}</td>
                    <td>
                      {e.from && e.from !== e.to
                        ? `${labels.orderStatus[e.from]} → ${labels.orderStatus[e.to]}`
                        : labels.orderStatus[e.to]}
                    </td>
                    <td>
                      {e.fromPayment && e.fromPayment !== e.toPayment
                        ? `${labels.paymentStatus[e.fromPayment]} → ${labels.paymentStatus[e.toPayment]}`
                        : labels.paymentStatus[e.toPayment]}
                    </td>
                    <td>{t(`order.triggers.${e.trigger as OrderTrigger}`)}</td>
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
