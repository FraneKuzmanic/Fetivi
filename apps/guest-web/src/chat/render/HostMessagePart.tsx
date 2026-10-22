import { HostDraftCard } from '@fetivi/ui';
import { elicitationPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CardAnswer } from './ConfirmationPart';
import { hostDraftLabels } from './labels';

/**
 * The host message card from its stored part: the stored draft, which the guest may edit. The
 * payload is checked again; without a host message draft nothing renders.
 */
export function HostMessagePart({
  data,
  state,
  onAnswer,
}: {
  data: unknown;
  state: 'open' | 'sending';
  onAnswer: (answer: CardAnswer) => void;
}) {
  const { t } = useTranslation();
  const parsed = useMemo(() => elicitationPayload.safeParse(data), [data]);
  if (!parsed.success || parsed.data.hostMessage === null) return null;
  const { hostMessage, toolName, toolCallId } = parsed.data;
  return (
    <HostDraftCard
      draft={hostMessage}
      state={state}
      onSend={(text) =>
        onAnswer({ toolName, toolCallId, action: 'accept', content: { message: text } })
      }
      onCancel={() => onAnswer({ toolName, toolCallId, action: 'cancel' })}
      labels={hostDraftLabels(t)}
    />
  );
}

/** Whether a stored card is a host message card (otherwise it is an Order confirmation). */
export const isHostMessageCard = (data: unknown) =>
  typeof data === 'object' &&
  data !== null &&
  (data as { hostMessage?: unknown }).hostMessage != null;
