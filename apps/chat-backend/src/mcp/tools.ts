import { GUEST_CONFIRMS_META_KEY, MCP_SERVERS, type McpServerName } from '@fetivi/domain';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { type JSONSchema7, jsonSchema, type ToolSet, tool } from 'ai';
import type { TurnTools } from '../tools/registry';
import type { TurnClients } from './clients';

export interface ListedTool {
  server: McpServerName;
  tool: Tool;
}

export interface ToolCatalog {
  list(clients: TurnClients, server: McpServerName, scopes: string): Promise<Tool[]>;
}

/** MCP tool definitions per server and scope string; tools only change on deploy. */
export function createToolCatalog(): ToolCatalog {
  const cache = new Map<string, Promise<Tool[]>>();
  return {
    list(clients, server, scopes) {
      const key = `${server}|${scopes}`;
      let tools = cache.get(key);
      if (!tools) {
        // listTools() without a cursor walks every page; the server's own order is kept.
        tools = clients.timed(async () => (await (await clients.get(server)).listTools()).tools);
        cache.set(key, tools);
        // A failed listing is not remembered, so the next turn tries again.
        tools.catch(() => cache.delete(key));
      }
      return tools;
    },
  };
}

/** Every server's tools for this turn, in MCP_SERVERS order then each server's own order. */
export async function listTurnTools(
  catalog: ToolCatalog,
  clients: TurnClients,
  scopesByServer: Record<McpServerName, string>,
): Promise<ListedTool[]> {
  const lists = await Promise.all(
    MCP_SERVERS.map((server) => catalog.list(clients, server, scopesByServer[server])),
  );
  return MCP_SERVERS.flatMap((server, i) => (lists[i] ?? []).map((t) => ({ server, tool: t })));
}

/** A tool the server marks for the guest's confirmation: the model pauses on it. */
export const guestConfirms = (t: Tool) => t._meta?.[GUEST_CONFIRMS_META_KEY] === true;

/** The paused tools of this turn by name, each with the server that runs its halves. */
export function pausedTools(listed: ListedTool[]): Map<string, ListedTool> {
  return new Map(listed.filter((l) => guestConfirms(l.tool)).map((l) => [l.tool.name, l]));
}

export const textOf = (content: CallToolResult['content']) =>
  content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');

/**
 * Hand conversion into AI SDK tools (not @ai-sdk/mcp). A tool the server marks as guest-confirmed
 * gets no `execute`, so the step stops on it and the turn loop runs its halves (src/loop). A tool
 * error from the server becomes a thrown error, which the model sees as a tool error.
 */
export function toAiTools(
  listed: ListedTool[],
  opts: { tools: TurnTools; onCall?: (name: string) => void },
): ToolSet {
  const tools: ToolSet = {};
  for (const l of listed) {
    const t = l.tool;
    if (t.name in tools) throw new Error(`Two servers expose the tool ${t.name}`);
    const definition = {
      description: t.description ?? t.title ?? t.name,
      inputSchema: jsonSchema(t.inputSchema as JSONSchema7),
    };
    if (guestConfirms(t)) {
      tools[t.name] = tool(definition);
      continue;
    }
    tools[t.name] = tool({
      ...definition,
      execute: async (input: unknown) => {
        opts.onCall?.(t.name);
        return opts.tools.call(l, input);
      },
    });
  }
  return tools;
}
