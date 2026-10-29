import {
  type ContactFields,
  type CreateOrderDraft,
  GUEST_NOTE_MAX,
  ORDER_DRAFT_META_KEY,
  type OrderWarning,
} from '@fetivi/domain';
import {
  CLIENT_CAPABILITIES_META_KEY,
  type McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { termsSentence } from './terms';

// The confirmation card of create_order (architecture §4.3). Everything shown comes from the
// stored draft, never from model text. Form mode never asks for secrets: email, name, phone, the
// guest's note and wished time only.

/** The guest's answer: email always, plus the contact fields the Offer configures. */
export function contactSchemaFor(fields: ContactFields) {
  const email = z.email().max(254).describe('Email');
  const name = z.string().trim().min(1).max(100).describe('Name');
  // A refine, not .regex: the form-mode wire schema has no `pattern`, so the rule runs on re-entry.
  const phone = z
    .string()
    .trim()
    .min(6)
    .max(20)
    .refine((v) => /^\+?[0-9 ()-]+$/.test(v), 'A phone number')
    .describe('Phone');
  switch (fields) {
    case 'name':
      return z.object({ email, name });
    case 'phone':
      return z.object({ email, phone });
    case 'name_and_phone':
      return z.object({ email, name, phone });
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The whole card answer: the contact fields, the guest's note for every Offer, and the wished
 * time for an Offer whose start has no time. Both details are optional and prefilled from the
 * draft; a field the guest cleared is absent, so the Order gets none.
 */
export function orderFormFor(draft: CreateOrderDraft) {
  const note = z
    .string()
    .trim()
    .max(GUEST_NOTE_MAX)
    .optional()
    .describe('Details')
    .meta(draft.note ? { default: draft.note } : {});
  const contact = contactSchemaFor(draft.contactFields);
  if (draft.startsAt !== null) return contact.extend({ note });
  // A refine, not .regex, for the same reason as the phone rule.
  const time = z
    .string()
    .trim()
    .optional()
    .refine((v) => v === undefined || v === '' || HHMM.test(v), 'A time')
    .describe('Time')
    .meta(draft.requestedTime ? { default: draft.requestedTime } : {});
  return contact.extend({ note, time });
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

/** An English one-liner from the stored draft; ticket 17's card localises from `_meta`. */
export function confirmationMessage(draft: CreateOrderDraft): string {
  const time = draft.startsAtLocal?.slice(11) ?? draft.requestedTime;
  const when = time ? `${draft.date} at ${time}` : draft.date;
  const price =
    draft.priceMinor === null ? '' : `, ${money(draft.priceMinor, draft.currency)} total`;
  const paid =
    draft.paymentMode === 'direct'
      ? ', paid directly to the provider'
      : ', paid online after you confirm (your card is charged only once the booking is confirmed)';
  // Nothing is paid before the guest confirms, so no refund wording yet.
  const terms = termsSentence(draft.cancellation, draft.paymentMode, false);
  const note = draft.note ? ` Note: "${draft.note}".` : '';
  const warnings = draft.warnings.map((w) => ` ${warningSentence(w)}`).join('');
  return `Book ${draft.offerTitle} on ${when} for ${draft.quantity}${price}${paid}? ${terms}${note}${warnings}`.trimEnd();
}

function warningSentence(warning: OrderWarning): string {
  if (warning.kind === 'checkout_day') {
    return warning.checkoutTime
      ? `Heads-up: it is your checkout day (checkout ${warning.checkoutTime}).`
      : 'Heads-up: it is your checkout day.';
  }
  return `DHMZ ${warning.level} warning: ${warning.event}.`;
}

export function orderDraftMeta(pendingId: string, draft: CreateOrderDraft) {
  return { [ORDER_DRAFT_META_KEY]: { pendingId, ...draft } };
}

/**
 * Whether this request's client can answer a form elicitation: the 2026-07-28 envelope first,
 * then the initialize-declared capabilities. On the stateless legacy path there are none, so the
 * answer is false there: the shim cannot push `elicitation/create` (S1, S5).
 */
export function clientCanElicitForm(ctx: ServerContext, server: McpServer): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const declared =
    (envelope?.[CLIENT_CAPABILITIES_META_KEY] as
      | { elicitation?: Record<string, unknown> }
      | undefined) ?? server.server.getClientCapabilities();
  const elicitation = declared?.elicitation;
  if (!elicitation) return false;
  // An empty object is form mode (the 2025-06-18 shape); otherwise `form` must be declared.
  return Object.keys(elicitation).length === 0 || 'form' in elicitation;
}
