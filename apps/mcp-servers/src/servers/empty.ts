import type { McpServerName } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';

export const SERVER_VERSION = '0.1.0';

/** A server with no tools yet; the tools capability makes `tools/list` answer `[]`. */
export function buildEmptyServer(name: McpServerName): McpServer {
  return new McpServer(
    { name: `fetivi-${name}`, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
}
