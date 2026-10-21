import { type ContactFields, type CreateOrderDraft, PENDING_TTL_SECONDS } from '@fetivi/domain';
import {
  CLIENT_CAPABILITIES_META_KEY,
  createRequestStateCodec,
  type McpServer,
  type RequestStateCodec,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

// The confirmation card of create_order (architecture §4.3). Everything shown comes from the
// stored draft, never from model text. Form mode never asks for secrets: email, name and phone only.

/** The key of the one input request create_order sends. */
export const CONFIRM_KEY = 'confirm';

/** Where ticket 17's card reads the structured draft: the elicitation request's `_meta`. */
export const ORDER_DRAFT_META_KEY = 'app.fetivi/order-draft';

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
  const paid = draft.paymentMode === 'direct' ? ', paid directly to the provider' : '';
  return `Book ${draft.offerTitle} on ${when} for ${draft.quantity}${price}${paid}? Cancellation policy: ${draft.cancellationPolicy}`;
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

/**
 * Seals `{ pendingId }` (signed, not encrypted: nothing else goes in) for one space's
 * create_order. A value minted for another space or tool fails `verify` at the SDK seam.
 */
export function createOrderStateCodec(
  secret: string,
  spaceId: string,
): RequestStateCodec<{ pendingId: string }> {
  return createRequestStateCodec<{ pendingId: string }>({
    key: secret,
    ttlSeconds: PENDING_TTL_SECONDS,
    // The server is built per request for one identity, so closing over it is safe.
    bind: () => `create_order\0${spaceId}`,
  });
}
