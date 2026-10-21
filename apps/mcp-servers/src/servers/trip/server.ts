import type { GuestIdentity } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGuestTools, type ToolDeps } from '../tool';
import { SERVER_VERSION } from '../version';
import { tripTools } from './tools';

/**
 * The `trip` server for one guest: About me now, the day plan with ticket 27. update_about_me is
 * listed only while the token has about_me:write (before arrival and in stay). Special-category
 * needs are readable here but never writable: only the guest app's own tap stores them.
 */
export function buildTripServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'fetivi-trip', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerGuestTools(server, identity, deps, tripTools);
  return server;
}
