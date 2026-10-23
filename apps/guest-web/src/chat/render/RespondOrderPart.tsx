import { RespondOrderCard } from '@fetivi/ui';
import { elicitationPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardAnswer } from './ConfirmationPart';
import { respondOrderLabels } from './labels';

/**
 * The new-terms card from its stored part: the Provider's (or the admin's) terms from the stored
 * draft. The payload is checked again; without a respond draft nothing renders. Accept and
 * Decline send the card's one field; Not now sends `cancel` and leaves the Order waiting.
 */
export function RespondOrderPart({
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
  if (!parsed.success || parsed.data.respondOrder === null) return null;
  const { respondOrder, toolName, toolCallId } = parsed.data;
  return (
    <RespondOrderCard
      draft={respondOrder}
      state={state}
      onAnswer={(answer) =>
        onAnswer({ toolName, toolCallId, action: 'accept', content: { answer } })
      }
      onNotNow={() => onAnswer({ toolName, toolCallId, action: 'cancel' })}
      labels={respondOrderLabels(t, i18n.language)}
    />
  );
}

/** Whether a stored card is a new-terms card. */
export const isRespondOrderCard = (data: unknown) =>
  typeof data === 'object' &&
  data !== null &&
  (data as { respondOrder?: unknown }).respondOrder != null;
