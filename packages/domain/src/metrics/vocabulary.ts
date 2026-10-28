// Imports nothing, so the pgEnum is built from it.

/** How the chat backend reached the guest tools: over MCP (V1, production) or in process (V0). */
export const TOOL_TRANSPORTS = ['mcp', 'inprocess'] as const;
export type ToolTransport = (typeof TOOL_TRANSPORTS)[number];

/**
 * The Anthropic calls Fetivi makes outside guest chat, each recorded in `model_usage`. Guest chat
 * is read from `turn_metrics` instead and is named 'chat' only in the usage estimate.
 */
export const MODEL_USES = [
  'translation',
  'handoff_translation',
  'drafting',
  'manual_import',
] as const;
export type ModelUse = (typeof MODEL_USES)[number];

/** The uses in the usage estimate, in display order: guest chat first, then MODEL_USES. */
export const USAGE_ESTIMATE_USES = ['chat', ...MODEL_USES] as const;
export type UsageEstimateUse = (typeof USAGE_ESTIMATE_USES)[number];
