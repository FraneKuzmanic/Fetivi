import { CONFIRM_KEY, type GuestIdentity } from '@fetivi/domain';
import {
  type InputRequiredResult,
  inputResponse,
  type McpServer,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { type StateCodec, stateCodec } from './request-state';
import { answerCancelOrder, NO_CANCEL_ELICITATION, prepareCancelOrder } from './services/cancel';
import { answerCreateOrder, NO_ELICITATION, prepareCreateOrder } from './services/create-order';
import { clientCanElicitForm } from './services/elicitation';
import type { cancelOrderInput, createOrderInput } from './services/schemas';
import { cancelOrderSpec, createOrderSpec } from './services/tools';
import {
  answerSendHostMessage,
  NO_HOST_ELICITATION,
  prepareSendHostMessage,
} from './stay/host-message';
import type { sendHostMessageInput } from './stay/schemas';
import { sendHostMessageSpec } from './stay/tools';
import {
  GuestToolError,
  type GuestToolSpec,
  registerGuestConfirmTool,
  type ToolDeps,
} from './tool';

// The guest-confirmed tools by name (architecture §4.3), so the MCP servers and V0 run the same
// halves without naming each tool: the first stores a pending record and answers the card, the
// second completes exactly that record on the guest's tap.

/** The guest's answer to the card; `action` is absent when the answer was missing. */
export interface ConfirmAnswer {
  action?: 'accept' | 'decline' | 'cancel';
  content?: unknown;
}

export interface ConfirmTool {
  spec: GuestToolSpec;
  /** The `requestState` codec, bound to `<tool>\0<spaceId>`. */
  codec(secret: string, spaceId: string): StateCodec;
  prepare(
    deps: ToolDeps,
    identity: GuestIdentity,
    codec: StateCodec,
    args: unknown,
  ): Promise<InputRequiredResult>;
  answer(
    deps: ToolDeps,
    identity: GuestIdentity,
    codec: StateCodec,
    pendingId: string,
    answer: ConfirmAnswer,
  ): Promise<unknown>;
  /** The refusal when the client cannot show a form card. */
  noElicitation: string;
}

export const CONFIRM_TOOLS = {
  create_order: {
    spec: createOrderSpec,
    codec: (secret, spaceId) => stateCodec('create_order', secret, spaceId),
    prepare: (deps, identity, codec, args) =>
      prepareCreateOrder(deps, identity, codec, args as z.infer<typeof createOrderInput>),
    answer: answerCreateOrder,
    noElicitation: NO_ELICITATION,
  },
  cancel_order: {
    spec: cancelOrderSpec,
    codec: (secret, spaceId) => stateCodec('cancel_order', secret, spaceId),
    prepare: (deps, identity, codec, args) =>
      prepareCancelOrder(deps, identity, codec, args as z.infer<typeof cancelOrderInput>),
    answer: answerCancelOrder,
    noElicitation: NO_CANCEL_ELICITATION,
  },
  send_host_message: {
    spec: sendHostMessageSpec,
    codec: (secret, spaceId) => stateCodec('send_host_message', secret, spaceId),
    prepare: (deps, identity, codec, args) =>
      prepareSendHostMessage(deps, identity, codec, args as z.infer<typeof sendHostMessageInput>),
    answer: answerSendHostMessage,
    noElicitation: NO_HOST_ELICITATION,
  },
} satisfies Record<string, ConfirmTool>;

export type ConfirmToolName = keyof typeof CONFIRM_TOOLS;

/** The confirm tool of this name, if it is one. */
export function confirmTool(name: string): ConfirmTool | undefined {
  return Object.hasOwn(CONFIRM_TOOLS, name) ? CONFIRM_TOOLS[name as ConfirmToolName] : undefined;
}

/**
 * Registers a confirm tool on a server built for one identity. Each McpServer has one
 * `requestState.verify`, so `codec` must be the one the server verifies with.
 */
export function registerConfirmTool(
  server: McpServer,
  identity: GuestIdentity,
  deps: ToolDeps,
  tool: ConfirmTool,
  codec: StateCodec,
): void {
  registerGuestConfirmTool(
    server,
    identity,
    tool.spec.name,
    tool.spec.config,
    async (args, _identity, request) => {
      const state = request.mcpReq.requestState<{ pendingId: string }>();
      if (state) {
        const view = inputResponse(request.mcpReq.inputResponses, CONFIRM_KEY);
        const answer = view.kind === 'elicit' ? { action: view.action, content: view.content } : {};
        return (await tool.answer(deps, identity, codec, state.pendingId, answer)) as Record<
          string,
          unknown
        >;
      }
      // Before anything is stored: a client that cannot show the card never leaves a record (S5).
      if (!clientCanElicitForm(request, server)) throw new GuestToolError(tool.noElicitation);
      return tool.prepare(deps, identity, codec, args);
    },
  );
}
