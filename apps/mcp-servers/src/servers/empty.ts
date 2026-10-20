import type { McpServerName } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { SERVER_VERSION } from './version';

/** A server with no tools yet; the tools capability makes `tools/list` answer `[]`. */
export function buildEmptyServer(name: McpServerName): McpServer {
  return new McpServer(
    { name: `fetivi-${name}`, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
}
