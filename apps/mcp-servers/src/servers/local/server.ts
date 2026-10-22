import type { GuestIdentity } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGuestTools, type ToolDeps } from '../tool';
import { SERVER_VERSION } from '../version';
import { localTools } from './tools';

/**
 * The `local` server for one guest. The catalog tools and get_weather exist only for a token with
 * catalog:read and a destination (inside a destination, architecture §4.3); outside one the list is
 * empty until web_fallback_search (31).
 */
export function buildLocalServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const server = new McpServer(
    { name: 'fetivi-local', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  registerGuestTools(server, identity, deps, localTools);
  return server;
}
