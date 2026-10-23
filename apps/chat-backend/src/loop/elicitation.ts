import {
  CANCEL_DRAFT_META_KEY,
  type CancelOrderDraft,
  CONFIRM_KEY,
  type CreateOrderDraft,
  HANDOFF_LIMITS,
  HOST_MESSAGE_DRAFT_META_KEY,
  HOST_MESSAGE_KEY,
  type HostMessageDraft,
  ORDER_DRAFT_META_KEY,
  type OrderSummary,
} from '@fetivi/domain';
import {
  type CancelOrderDraftPayload,
  type ElicitationPayload,
  elicitationPayload,
  type HostMessageDraftPayload,
  type OrderDraft,
  type OrderSummaryPayload,
} from '@fetivi/ui/payloads';
import {
  type CallToolResult,
  type Client,
  isInputRequiredResult,
} from '@modelcontextprotocol/client';
import { z } from 'zod';
import type { TurnClients } from '../mcp/clients';
import { type FirstPartyListed, textOf } from '../mcp/tools';

// The two halves of a guest-confirmed tool (architecture §4.3, spike S1), here over MCP; V0 runs
// them in process (src/tools/inprocess.ts) with the same outcomes. The backend keeps nothing
// between them: `requestState` travels in the stored message and goes back byte for byte.
// Never log `requestState` or the guest's answer.

// A drift between the cards' schemas and the domain's types fails typecheck, not a card.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _cardsMatch: [
  Same<OrderDraft, CreateOrderDraft & { pendingId: string }>,
  Same<OrderSummaryPayload, OrderSummary>,
  Same<HostMessageDraftPayload, HostMessageDraft & { pendingId: string }>,
  Same<CancelOrderDraftPayload, CancelOrderDraft & { pendingId: string }>,
] = [true, true, true, true];
void _cardsMatch;

/**
 * The guest's answer to a card, as the browser sends it. Form mode: email, name and phone, or the
 * host message's text (up to its own limit).
 * `decline` is MCP's explicit "no"; the card's Not now sends `cancel`, which the server treats
 * the same way.
 */
export const guestAnswer = z.strictObject({
  toolCallId: z.string().min(1).max(100),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .record(z.string().max(20), z.string().max(HANDOFF_LIMITS.messageChars))
    .refine((c) => Object.keys(c).length <= 5, 'Too many fields')
    .refine(
      (c) => Object.entries(c).every(([k, v]) => k === HOST_MESSAGE_KEY || v.length <= 254),
      'Too long',
    )
    .optional(),
});
export type GuestAnswer = z.infer<typeof guestAnswer>;

/** What one half gave: a card to show, the tool's output, or an error the model explains. */
export type Outcome =
  | { kind: 'ask'; payload: ElicitationPayload }
  | { kind: 'output'; output: unknown }
  | { kind: 'error'; errorText: string };

export interface PausedCall {
  /** The listed definition and its server. */
  listed: FirstPartyListed;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** A paused call with the guest's answer and the stored `requestState`. */
export type AnsweredCall = PausedCall & {
  requestState: string;
  answer: Omit<GuestAnswer, 'toolCallId'>;
};

/** A paused call with this turn's MCP clients. */
export type McpPausedCall = PausedCall & { clients: TurnClients };

export const NOT_SHOWN = 'The confirmation could not be shown; nothing was booked.';
export const EXPIRED = 'The confirmation expired; nothing was booked.';
/** JSON-RPC invalid params: the SDK's answer to an expired or altered `requestState`. */
const INVALID_PARAMS = -32602;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Maps a `tools/call` answer to an outcome. Exported for tests. */
export function toOutcome(
  call: Pick<PausedCall, 'toolCallId' | 'toolName'>,
  result: unknown,
): Outcome {
  if (isInputRequiredResult(result)) {
    const request = result.inputRequests?.[CONFIRM_KEY];
    const params: Record<string, unknown> = isRecord(request?.params) ? request.params : {};
    const meta = isRecord(params._meta) ? params._meta : {};
    const parsed = elicitationPayload.safeParse({
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      key: CONFIRM_KEY,
      message: params.message,
      requestedSchema: params.requestedSchema,
      requestState: result.requestState,
      draft: meta[ORDER_DRAFT_META_KEY] ?? null,
      hostMessage: meta[HOST_MESSAGE_DRAFT_META_KEY] ?? null,
      cancelOrder: meta[CANCEL_DRAFT_META_KEY] ?? null,
    });
    return parsed.success
      ? { kind: 'ask', payload: parsed.data }
      : { kind: 'error', errorText: NOT_SHOWN };
  }
  const tool = result as CallToolResult;
  if (tool.isError) return { kind: 'error', errorText: textOf(tool.content ?? []) || 'tool error' };
  return { kind: 'output', output: tool.structuredContent ?? textOf(tool.content ?? []) };
}

async function run(
  call: McpPausedCall,
  params: Parameters<Client['callTool']>[0],
): Promise<Outcome> {
  // The client checks a result against the listed output schema and would refuse an
  // input_required one (it has no structured content), so the halves pass the definition
  // without it. The server validates its own output.
  const { outputSchema: _, ...definition } = call.listed.tool;
  try {
    const result = await call.clients.timed(async () =>
      (await call.clients.get(call.listed.server)).callTool(params, {
        allowInputRequired: true,
        toolDefinition: definition,
      }),
    );
    return toOutcome(call, result);
  } catch (error) {
    if (isRecord(error) && error.code === INVALID_PARAMS)
      return { kind: 'error', errorText: EXPIRED };
    throw error;
  }
}

/** The first half: the server stores a pending record and asks for the guest's confirmation. */
export function firstHalf(call: McpPausedCall): Promise<Outcome> {
  return run(call, { name: call.toolName, arguments: call.input as Record<string, unknown> });
}

/** The second half: the guest's answer with the stored `requestState`, untouched. */
export function answer(call: AnsweredCall & { clients: TurnClients }): Promise<Outcome> {
  const response = {
    action: call.answer.action,
    ...(call.answer.action === 'accept' ? { content: call.answer.content ?? {} } : {}),
  };
  return run(call, {
    name: call.toolName,
    arguments: call.input as Record<string, unknown>,
    inputResponses: { [CONFIRM_KEY]: response },
    requestState: call.requestState,
  } as Parameters<Client['callTool']>[0]);
}
