import { type ContactFields, type CreateOrderDraft, ORDER_DRAFT_META_KEY } from '@fetivi/domain';
import {
  CLIENT_CAPABILITIES_META_KEY,
  type McpServer,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { termsSentence } from './terms';

// The confirmation card of create_order (architecture §4.3). Everything shown comes from the
// stored draft, never from model text. Form mode never asks for secrets: email, name and phone only.

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

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

/** An English one-liner from the stored draft; ticket 17's card localises from `_meta`. */
export function confirmationMessage(draft: CreateOrderDraft): string {
  const when = draft.startsAtLocal
    ? `${draft.date} at ${draft.startsAtLocal.slice(11)}`
    : draft.date;
  const price =
    draft.priceMinor === null ? '' : `, ${money(draft.priceMinor, draft.currency)} total`;
  const paid =
    draft.paymentMode === 'direct'
      ? ', paid directly to the provider'
      : ', paid online after you confirm (your card is charged only once the booking is confirmed)';
  // Nothing is paid before the guest confirms, so no refund wording yet.
  const terms = termsSentence(draft.cancellation, draft.paymentMode, false);
  return `Book ${draft.offerTitle} on ${when} for ${draft.quantity}${price}${paid}? ${terms}`.trimEnd();
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
