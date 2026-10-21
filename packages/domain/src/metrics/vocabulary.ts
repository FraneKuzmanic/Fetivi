// Imports nothing, so the pgEnum is built from it.

/** How the chat backend reached the guest tools: over MCP (V1, production) or in process (V0). */
export const TOOL_TRANSPORTS = ['mcp', 'inprocess'] as const;
export type ToolTransport = (typeof TOOL_TRANSPORTS)[number];
