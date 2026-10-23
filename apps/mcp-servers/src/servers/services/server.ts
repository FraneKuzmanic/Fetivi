import type { GuestIdentity } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { CONFIRM_TOOLS, registerConfirmTool } from '../confirm';
import type { StateCodec } from '../request-state';
import { registerGuestTools, type ToolDeps } from '../tool';
import { SERVER_VERSION } from '../version';
import { servicesTools } from './tools';

/** The confirm tools of this server, in `tools/list` order after the read tools. */
const CONFIRMS = [CONFIRM_TOOLS.create_order, CONFIRM_TOOLS.cancel_order];

/**
 * The first codec that accepts the state. The SDK's verify hook does not name the called tool,
 * so each codec is tried; each tool's answer half re-checks the pending record's kind, so a state
 * minted for one tool never completes the other.
 */
async function verifyAny(codecs: StateCodec[], state: string): Promise<{ pendingId: string }> {
  let failure: unknown;
  for (const codec of codecs) {
    try {
      return await codec.verify(state);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

/**
 * The `services` server for one guest: Offers, availability, the guest's Orders, create_order and
 * cancel_order (architecture §4.4). Each tool is listed only while the token carries its scope, so
 * after checkout only list_my_orders and cancel_order remain. Visible Offers: the destination's
 * Provider Offers plus the host's own, or only the host's own outside a destination.
 */
export function buildServicesServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const codecs = CONFIRMS.map((tool) => tool.codec(deps.requestStateSecret, identity.spaceId));
  const server = new McpServer(
    { name: 'fetivi-services', version: SERVER_VERSION },
    // A tampered, expired or other space's requestState dies here with -32602.
    { capabilities: { tools: {} }, requestState: { verify: (state) => verifyAny(codecs, state) } },
  );
  registerGuestTools(server, identity, deps, servicesTools);
  CONFIRMS.forEach((tool, i) => {
    const codec = codecs[i];
    if (codec && tool.spec.listed(identity)) {
      registerConfirmTool(server, identity, deps, tool, codec);
    }
  });
  return server;
}
