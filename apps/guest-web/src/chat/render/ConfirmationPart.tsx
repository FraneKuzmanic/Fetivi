import { ConfirmationCard, type ContactField } from '@fetivi/ui';
import { elicitationPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmationLabels } from './labels';

const CONTACT_FIELDS: readonly ContactField[] = ['email', 'name', 'phone'];

export type CardAnswer = {
  toolName: string;
  toolCallId: string;
  action: 'accept' | 'cancel';
  content?: Record<string, string>;
};

/**
 * A booking confirmation card from its stored part. The payload is checked again; the form is the
 * server's (email, name and phone only, in its order). Without a draft nothing can be shown, so
 * nothing renders and the next message cancels the call.
 */
export function ConfirmationPart({
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
  if (!parsed.success || parsed.data.draft === null) return null;
  const { draft, requestedSchema, toolName, toolCallId } = parsed.data;
  const required = requestedSchema.required ?? [];
  const fields = Object.keys(requestedSchema.properties)
    .filter((key): key is ContactField => (CONTACT_FIELDS as readonly string[]).includes(key))
    .map((name) => ({ name, required: required.includes(name) }));
  return (
    <ConfirmationCard
      draft={draft}
      fields={fields}
      state={state}
      onConfirm={(content) => onAnswer({ toolName, toolCallId, action: 'accept', content })}
      onCancel={() => onAnswer({ toolName, toolCallId, action: 'cancel' })}
      labels={confirmationLabels(t, i18n.language)}
    />
  );
}
