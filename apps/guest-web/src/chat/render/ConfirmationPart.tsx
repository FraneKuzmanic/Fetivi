import { ConfirmationCard, type ContactField } from '@fetivi/ui';
import { elicitationPayload } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEmail } from '../../email/EmailProvider';
import { confirmationLabels } from './labels';

// The card's own field order: stored parts are jsonb, which does not keep the schema's key order.
const CARD_FIELDS: readonly ContactField[] = ['email', 'name', 'phone'];

export type CardAnswer = {
  toolName: string;
  toolCallId: string;
  action: 'accept' | 'cancel';
  content?: Record<string, string>;
};

/**
 * An Order confirmation card from its stored part. The payload is checked again; the form holds
 * the server's fields (email, name and phone, plus the note and the wished time when asked).
 * Without a draft nothing can be shown, so nothing renders and the next message cancels the call.
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
  // The email the guest already gave starts the card; it stays required and editable.
  const known = useEmail().state?.email;
  const parsed = useMemo(() => elicitationPayload.safeParse(data), [data]);
  const initialValues = useMemo(() => (known ? { email: known } : undefined), [known]);
  if (!parsed.success || parsed.data.draft === null) return null;
  const { draft, requestedSchema, toolName, toolCallId } = parsed.data;
  const required = requestedSchema.required ?? [];
  const fields = CARD_FIELDS.filter((name) => name in requestedSchema.properties).map((name) => ({
    name,
    required: required.includes(name),
  }));
  const details = {
    note: 'note' in requestedSchema.properties,
    time: 'time' in requestedSchema.properties,
  };
  return (
    <ConfirmationCard
      draft={draft}
      fields={fields}
      state={state}
      onConfirm={(content) => onAnswer({ toolName, toolCallId, action: 'accept', content })}
      onCancel={() => onAnswer({ toolName, toolCallId, action: 'cancel' })}
      labels={confirmationLabels(t, i18n.language)}
      initialValues={initialValues}
      details={details}
    />
  );
}
