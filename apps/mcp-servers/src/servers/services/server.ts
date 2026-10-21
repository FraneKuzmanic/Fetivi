import { CONFIRM_KEY, type GuestIdentity } from '@fetivi/domain';
import { inputResponse, McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import {
  GuestToolError,
  registerGuestConfirmTool,
  registerGuestTools,
  type ToolDeps,
} from '../tool';
import { SERVER_VERSION } from '../version';
import { answerCreateOrder, NO_ELICITATION, orderCodec, prepareCreateOrder } from './create-order';
import { clientCanElicitForm } from './elicitation';
import type { createOrderInput } from './schemas';
import { createOrderSpec, servicesTools } from './tools';

/**
 * The `services` server for one guest: Offers, availability, the guest's Orders and create_order
 * (architecture §4.4). Each tool is listed only while the token carries its scope, so after
 * checkout only list_my_orders remains. Visible Offers: the destination's Provider Offers plus
 * the host's own, or only the host's own outside a destination.
 */
export function buildServicesServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const codec = orderCodec(deps.requestStateSecret, identity.spaceId);
  const server = new McpServer(
    { name: 'fetivi-services', version: SERVER_VERSION },
    // A tampered, expired or other space's requestState dies here with -32602.
    { capabilities: { tools: {} }, requestState: { verify: (state) => codec.verify(state) } },
  );
  registerGuestTools(server, identity, deps, servicesTools);

  if (createOrderSpec.listed(identity)) {
    registerGuestConfirmTool(
      server,
      identity,
      createOrderSpec.name,
      createOrderSpec.config,
      async (args, _identity, request) => {
        const state = request.mcpReq.requestState<{ pendingId: string }>();
        if (state) {
          const view = inputResponse(request.mcpReq.inputResponses, CONFIRM_KEY);
          const answer =
            view.kind === 'elicit' ? { action: view.action, content: view.content } : {};
          return answerCreateOrder(deps, identity, codec, state.pendingId, answer);
        }
        // Before anything is stored: a client that cannot show the card never leaves a record (S5).
        if (!clientCanElicitForm(request, server)) throw new GuestToolError(NO_ELICITATION);
        return prepareCreateOrder(deps, identity, codec, args as z.infer<typeof createOrderInput>);
      },
    );
  }

  return server;
}
