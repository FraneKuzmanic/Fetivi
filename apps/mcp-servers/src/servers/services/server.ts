import type { GuestIdentity } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TOOLS, registerConfirmTool } from '../confirm';
import { registerGuestTools, type ToolDeps } from '../tool';
import { SERVER_VERSION } from '../version';
import { servicesTools } from './tools';

/**
 * The `services` server for one guest: Offers, availability, the guest's Orders and create_order
 * (architecture §4.4). Each tool is listed only while the token carries its scope, so after
 * checkout only list_my_orders remains. Visible Offers: the destination's Provider Offers plus
 * the host's own, or only the host's own outside a destination.
 */
export function buildServicesServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const createOrder = CONFIRM_TOOLS.create_order;
  const codec = createOrder.codec(deps.requestStateSecret, identity.spaceId);
  const server = new McpServer(
    { name: 'fetivi-services', version: SERVER_VERSION },
    // A tampered, expired or other space's requestState dies here with -32602.
    { capabilities: { tools: {} }, requestState: { verify: (state) => codec.verify(state) } },
  );
  registerGuestTools(server, identity, deps, servicesTools);
  if (createOrder.spec.listed(identity)) {
    registerConfirmTool(server, identity, deps, createOrder, codec);
  }
  return server;
}
