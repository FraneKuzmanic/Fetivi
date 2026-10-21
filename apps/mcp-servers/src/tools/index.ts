// The guest tools as plain specs, for V0: the chat backend calls them in process with the same
// definitions and checks the MCP servers use. Imports no server boot or HTTP code.
import type { GuestIdentity, McpServerName } from '@fetivi/domain';
import { localTools } from '../servers/local/tools';
import { createOrderSpec, servicesTools } from '../servers/services/tools';
import type { GuestToolSpec } from '../servers/tool';
import { tripTools } from '../servers/trip/tools';

export {
  answerCreateOrder,
  type CreateOrderOutput,
  type OrderAnswer,
  type OrderCodec,
  orderCodec,
  prepareCreateOrder,
} from '../servers/services/create-order';
export {
  ClaimMismatchError,
  GuestToolError,
  type GuestToolSpec,
  guestToolMeta,
  runGuestTool,
  type ToolDeps,
} from '../servers/tool';
export { toolDefinition } from './definition';
export { createOrderSpec };

/** Every server's specs in `tools/list` order; `stay` has a resource and no tools. */
export const GUEST_TOOLS: Record<McpServerName, readonly GuestToolSpec[]> = {
  stay: [],
  local: localTools,
  services: servicesTools,
  trip: tripTools,
};

/** The specs a server lists for this caller. */
export function listedTools(server: McpServerName, identity: GuestIdentity): GuestToolSpec[] {
  return GUEST_TOOLS[server].filter((spec) => spec.listed(identity));
}
