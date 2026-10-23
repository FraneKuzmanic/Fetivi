import { CancelOrderCard } from '@fetivi/ui';
import { elicitationPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardAnswer } from './ConfirmationPart';
import { cancelOrderLabels } from './labels';

/**
 * The cancel card from its stored part: the policy and the refund from the stored draft. The
 * payload is checked again; without a cancel draft nothing renders. The tap sends no fields.
 */
export function CancelOrderPart({
  data,
  state,
  onAnswer,
}: {
  data: unknown;
  state: 'open' | 'sending';
  onAnswer: (answer: CardAnswer) => void;
}) {
  const { t, i18n } = useTranslation();
  const parsed = useMemo(() => elicitationPayload.safeParse(data), [data]);
  if (!parsed.success || parsed.data.cancelOrder === null) return null;
  const { cancelOrder, toolName, toolCallId } = parsed.data;
  return (
    <CancelOrderCard
      draft={cancelOrder}
      state={state}
      onConfirm={() => onAnswer({ toolName, toolCallId, action: 'accept', content: {} })}
      onKeep={() => onAnswer({ toolName, toolCallId, action: 'cancel' })}
      labels={cancelOrderLabels(t, i18n.language)}
    />
  );
}

/** Whether a stored card is a cancel card. */
export const isCancelOrderCard = (data: unknown) =>
  typeof data === 'object' &&
  data !== null &&
  (data as { cancelOrder?: unknown }).cancelOrder != null;
