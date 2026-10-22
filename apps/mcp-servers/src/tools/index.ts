// The guest tools as plain specs, for V0: the chat backend calls them in process with the same
// definitions and checks the MCP servers use. Imports no server boot or HTTP code.
import type { GuestIdentity, McpServerName } from '@fetivi/domain';
import { localTools } from '../servers/local/tools';
import { servicesTools } from '../servers/services/tools';
import { stayTools } from '../servers/stay/tools';
import type { GuestToolSpec } from '../servers/tool';
import { tripTools } from '../servers/trip/tools';

export {
  CONFIRM_TOOLS,
  type ConfirmAnswer,
  type ConfirmTool,
  confirmTool,
} from '../servers/confirm';
export { type StateCodec, stateCodec } from '../servers/request-state';
export { createOrderSpec } from '../servers/services/tools';
export { type GuestToolSpec, runGuestTool, type ToolDeps } from '../servers/tool';
export { toolDefinition } from './definition';
export { stayTools };

/** Every server's specs in `tools/list` order; `stay` also has the unit record resource. */
export const GUEST_TOOLS: Record<McpServerName, readonly GuestToolSpec[]> = {
  stay: stayTools,
  local: localTools,
  services: servicesTools,
  trip: tripTools,
};

/** The specs a server lists for this caller. */
export function listedTools(server: McpServerName, identity: GuestIdentity): GuestToolSpec[] {
  return GUEST_TOOLS[server].filter((spec) => spec.listed(identity));
}
