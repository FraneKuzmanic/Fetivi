import {
  CONFIRM_KEY,
  type CreateOrderDraft,
  type McpServerName,
  ORDER_DRAFT_META_KEY,
} from '@fetivi/domain';
import { type ElicitationPayload, elicitationPayload, type OrderDraft } from '@fetivi/ui/payloads';
import {
  type CallToolResult,
  type Client,
  isInputRequiredResult,
  type Tool,
} from '@modelcontextprotocol/client';
import { z } from 'zod';
import type { TurnClients } from '../mcp/clients';
import { textOf } from '../mcp/tools';

// The two MCP halves of a guest-confirmed tool (architecture §4.3, spike S1). The backend keeps
// nothing between them: `requestState` travels in the stored message and goes back byte for byte.
// Never log `requestState` or the guest's answer.

// A drift between the card's draft schema and the stored draft fails typecheck, not a card.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _draftMatches: Same<OrderDraft, CreateOrderDraft & { pendingId: string }> = true;
void _draftMatches;

/** The guest's answer to a card, as the browser sends it. Form mode: email, name and phone only. */
export const guestAnswer = z.strictObject({
  toolCallId: z.string().min(1).max(100),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z
    .record(z.string().max(20), z.string().max(254))
    .refine((c) => Object.keys(c).length <= 5, 'Too many fields')
    .optional(),
});
export type GuestAnswer = z.infer<typeof guestAnswer>;

/** What one half gave: a card to show, the tool's output, or an error the model explains. */
export type Outcome =
  | { kind: 'ask'; payload: ElicitationPayload }
  | { kind: 'output'; output: unknown }
  | { kind: 'error'; errorText: string };

export interface PausedCall {
  clients: TurnClients;
  server: McpServerName;
  /** The listed definition; its output schema is left out of the halves (see `run`). */
  definition: Tool;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

const NOT_SHOWN = 'The confirmation could not be shown; nothing was booked.';
const EXPIRED = 'The confirmation expired; nothing was booked.';
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
    });
    return parsed.success
      ? { kind: 'ask', payload: parsed.data }
      : { kind: 'error', errorText: NOT_SHOWN };
  }
  const tool = result as CallToolResult;
  if (tool.isError) return { kind: 'error', errorText: textOf(tool.content ?? []) || 'tool error' };
  return { kind: 'output', output: tool.structuredContent ?? textOf(tool.content ?? []) };
}

async function run(call: PausedCall, params: Parameters<Client['callTool']>[0]): Promise<Outcome> {
  // The client checks a result against the listed output schema and would refuse an
  // input_required one (it has no structured content), so the halves pass the definition
  // without it. The server validates its own output.
  const { outputSchema: _, ...definition } = call.definition;
  try {
    const result = await call.clients.timed(async () =>
      (await call.clients.get(call.server)).callTool(params, {
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
export function firstHalf(call: PausedCall): Promise<Outcome> {
  return run(call, { name: call.toolName, arguments: call.input as Record<string, unknown> });
}

/** The second half: the guest's answer with the stored `requestState`, untouched. */
export function answer(
  call: PausedCall & { requestState: string; answer: Omit<GuestAnswer, 'toolCallId'> },
): Promise<Outcome> {
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
