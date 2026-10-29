import { OFFER_LIMITS } from '@fetivi/domain/offer-vocabulary';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { centsFromEuros } from '../../admin/providers/money';
import { type HostOrderActionBody, type HostOrderView, host, type OrderAction } from '../../api';
import { DateField, NumberField, TimeField } from '../../forms/fields';
import { i18next, localeOf } from '../../i18n';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';
import { inboxChanged } from './inbox-events';

// One Order on the host's own service (38): the Provider link's view and one-tap answers, in the
// back office. Each answer is bound to the proposal the card shows; a changed Order refreshes.

const t = i18next.getFixedT(null, 'host', 'order');

/** 'YYYY-MM-DD' → "Sun 25 Oct"; a civil date never shifts a day. */
export const orderDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(localeOf(i18next.language), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(localeOf(i18next.language), { style: 'currency', currency }).format(
    minor / 100,
  );

// A per-group price is flat and its quantity is the party size (machine.ts), so both read as people.
const QUANTITY: Record<HostOrderView['priceUnit'], (n: number) => string> = {
  person: (n) => t('people', { count: n }),
  group: (n) => t('people', { count: n }),
  item: (n) => t('items', { count: n }),
  litre: (n) => t('litres', { count: n }),
  kilogram: (n) => t('kilograms', { count: n }),
  hour: (n) => t('hours', { count: n }),
  day: (n) => t('days', { count: n }),
};

export function orderChip(order: HostOrderView): { label: string; tone: string } {
  if (order.status === 'pending_provider') return { label: t('waitingYou'), tone: 'wait' };
  if (order.status === 'awaiting_confirmation')
    return { label: t('waitingGuest'), tone: 'neutral' };
  if (order.status === 'declined') return { label: t('declined'), tone: 'fail' };
  if (order.status === 'confirmed') {
    if (order.acknowledgedAt) return { label: t('acknowledged'), tone: 'ok' };
    // An allotment Order waits for {t('gotIt')}; an accepted request asks nothing more.
    return order.actions.includes('acknowledge')
      ? { label: t('newOrder'), tone: 'wait' }
      : { label: t('confirmed'), tone: 'ok' };
  }
  if (order.status === 'cancelled') return { label: t('cancelled'), tone: 'fail' };
  if (order.final) return { label: t('closed'), tone: 'neutral' };
  return { label: t('inProgress'), tone: 'neutral' };
}

/** In the host's language when a translation into it exists, with the guest's own words below. */
function GuestNote({ note }: { note: NonNullable<HostOrderView['guestNote']> }) {
  const translated = note.translatedTo === i18next.language ? note.translation : null;
  return (
    <p className="order-card-note">
      <span className="muted">{t('guestNote')}: </span>
      {translated ?? note.text}
      {translated ? (
        <span className="muted order-card-note-original">
          {t('original')}: {note.text}
        </span>
      ) : null}
    </p>
  );
}

const applied = (action: OrderAction): string =>
  ({
    acknowledge: t('appliedAcknowledge'),
    cannot_fulfil: t('appliedCannotFulfil'),
    accept: t('appliedAccept'),
    decline: t('appliedDecline'),
    suggest_time: t('appliedSuggestTime'),
    accept_with_price: t('appliedAcceptWithPrice'),
  })[action];

const outcomeText = (outcome: 'unchanged' | 'stale' | 'rejected'): string =>
  outcome === 'unchanged' ? t('unchanged') : t('changed');

type Form = 'suggest_time' | 'accept_with_price' | null;

export function OrderCard({
  order,
  onChanged,
}: {
  order: HostOrderView;
  /** Reloads the inbox after an answer. */
  onChanged: () => Promise<void>;
}) {
  useTranslation(['host', 'common']);
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
      setOutcome(result.outcome === 'applied' ? applied(action) : outcomeText(result.outcome));
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
    order.priceMinor !== null ? money(order.priceMinor, order.currency) : t('priceToName'),
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
      {order.guestNote ? <GuestNote note={order.guestNote} /> : null}
      {order.respondBy ? (
        <p className="order-card-due">
          {t('answerBy', {
            day: orderDay(order.respondBy.slice(0, 10)),
            time: order.respondBy.slice(11, 16),
          })}
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
          <p className="muted">{form === 'suggest_time' ? t('suggestHint') : t('priceHint')}</p>
          <div className="field-row">
            {form === 'suggest_time' ? (
              <>
                <DateField
                  label={t('date')}
                  value={date}
                  min={order.stayFrom}
                  max={order.stayTo}
                  required
                  onChange={setDate}
                />
                <TimeField label={t('timeOptional')} value={time} onChange={setTime} />
              </>
            ) : null}
            {form === 'accept_with_price' || order.needsPrice ? (
              <NumberField
                label={t('totalPrice')}
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
              {t('send')}
            </button>
            <button type="button" disabled={busy} onClick={() => setForm(null)}>
              {i18next.t('common:back')}
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
              {t('accept')}
            </button>
          ) : null}
          {can('accept_with_price') ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => setForm('accept_with_price')}
            >
              {t('acceptWithPrice')}
            </button>
          ) : null}
          {can('suggest_time') ? (
            <button type="button" disabled={busy} onClick={() => setForm('suggest_time')}>
              {t('suggestTime')}
            </button>
          ) : null}
          {can('decline') ? (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() => void answer('decline')}
            >
              {t('decline')}
            </button>
          ) : null}
          {can('acknowledge') ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void answer('acknowledge')}
            >
              {t('gotIt')}
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
                    title: t('cannotFulfilTitle'),
                    body: t('cannotFulfilBody'),
                    action: t('cannotFulfil'),
                    danger: true,
                  })
                )
                  void answer('cannot_fulfil');
              }}
            >
              {t('cannotFulfil')}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
