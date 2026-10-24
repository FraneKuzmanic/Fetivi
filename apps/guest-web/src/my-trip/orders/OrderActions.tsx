import { UNRESOLVED_ORDER_STATUSES } from '@fetivi/domain/order-vocabulary';
import { CancelOrderCard, RespondOrderCard } from '@fetivi/ui';
import type { ElicitationPayload, OrderSummaryPayload } from '@fetivi/ui/payloads';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api';
import { cancelOrderLabels, respondOrderLabels } from '../../chat/render/labels';
import { useSpace } from '../../space';
import {
  type ActionReply,
  answerOrder,
  type OrderAnswer,
  startCancel,
  startRespond,
} from './orders-api';

/** What the receipt says once an action is over and the list is read again. */
export type ActionNoticeKey = 'trip.actionFailed';

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'card'; card: ElicitationPayload; sending: boolean };

const isUnresolved = (order: OrderSummaryPayload) =>
  (UNRESOLVED_ORDER_STATUSES as readonly string[]).includes(order.status);

/**
 * After checkout the chat is closed, so an unresolved Order is cancelled, or a Provider's new
 * terms answered, here: the server calls the tool directly, without a model. The same cards as in
 * chat are shown inline under the receipt. Before checkout every action stays in chat, so this
 * renders nothing then.
 */
export function OrderActions({
  order,
  onDone,
}: {
  order: OrderSummaryPayload;
  /** Reads the list again; the notice goes on this Order's receipt. */
  onDone: (notice?: ActionNoticeKey) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { state } = useSpace();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [offline, setOffline] = useState(false);
  const self = useRef<HTMLDivElement>(null);

  if (state.status !== 'ready' || !state.space.closed || !isUnresolved(order)) return null;

  // Focus goes back to the receipt: the card is gone, and the list item stays across the reload.
  const finish = async (notice?: ActionNoticeKey) => {
    const item = self.current?.closest('li');
    setView({ kind: 'idle' });
    await onDone(notice);
    item?.focus();
  };

  const run = async (call: () => Promise<ActionReply>, restoreCard: ElicitationPayload | null) => {
    setOffline(false);
    try {
      const reply = await call();
      // A refund that changed since the card was shown comes back as a new card.
      if ('card' in reply) setView({ kind: 'card', card: reply.card, sending: false });
      else await finish();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        await finish('trip.actionFailed');
        return;
      }
      setOffline(true);
      setView(restoreCard ? { kind: 'card', card: restoreCard, sending: false } : { kind: 'idle' });
    }
  };

  const open = (start: (id: string) => Promise<ActionReply>) => {
    setView({ kind: 'loading' });
    void run(() => start(order.id), null);
  };

  const answer = (
    card: ElicitationPayload,
    reply: Omit<OrderAnswer, 'toolName' | 'requestState'>,
  ) => {
    setView({ kind: 'card', card, sending: true });
    void run(
      () =>
        answerOrder(order.id, {
          toolName: card.toolName as OrderAnswer['toolName'],
          requestState: card.requestState,
          ...reply,
        }),
      card,
    );
  };

  const card = view.kind === 'card' ? view : null;
  return (
    <div className="trip-actions" ref={self}>
      {card === null ? (
        <div className="trip-action-buttons">
          {order.respondBy && (
            <button
              type="button"
              className="button"
              disabled={view.kind === 'loading'}
              onClick={() => open(startRespond)}
            >
              {t('trip.answerTerms')}
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={view.kind === 'loading'}
            onClick={() => open(startCancel)}
          >
            {t('trip.cancel')}
          </button>
        </div>
      ) : card.card.cancelOrder ? (
        <CancelOrderCard
          draft={card.card.cancelOrder}
          state={card.sending ? 'sending' : 'open'}
          onConfirm={() => answer(card.card, { action: 'accept', content: {} })}
          onKeep={() => answer(card.card, { action: 'cancel' })}
          labels={cancelOrderLabels(t, i18n.language)}
        />
      ) : card.card.respondOrder ? (
        <RespondOrderCard
          draft={card.card.respondOrder}
          state={card.sending ? 'sending' : 'open'}
          onAnswer={(choice) =>
            answer(card.card, { action: 'accept', content: { answer: choice } })
          }
          onNotNow={() => answer(card.card, { action: 'cancel' })}
          labels={respondOrderLabels(t, i18n.language)}
        />
      ) : null}
      <p className="status" role="status">
        {offline ? t('error.network') : ''}
      </p>
    </div>
  );
}
