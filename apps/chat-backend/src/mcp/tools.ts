import { GUEST_CONFIRMS_META_KEY, MCP_SERVERS, type McpServerName } from '@fetivi/domain';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { type JSONSchema7, jsonSchema, type ToolSet, tool } from 'ai';
import type { TurnTools } from '../tools/registry';
import type { TurnClients } from './clients';
import type { FerryhopperListed } from './external/ferryhopper';
import { FERRYHOPPER } from './external/pin';

/** A first-party tool and the server that runs it. */
export interface FirstPartyListed {
  server: McpServerName;
  tool: Tool;
}

/** A tool of this turn: first-party, or Ferryhopper's (external, untrusted). */
export type ListedTool = FirstPartyListed | FerryhopperListed;

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
        tools = clients.call(
          server,
          'tools/list',
          null,
          async (c, _meta) => (await c.listTools({ _meta })).tools,
        );
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
): Promise<FirstPartyListed[]> {
  const lists = await Promise.all(
    MCP_SERVERS.map((server) => catalog.list(clients, server, scopesByServer[server])),
  );
  return MCP_SERVERS.flatMap((server, i) => (lists[i] ?? []).map((t) => ({ server, tool: t })));
}

/** A tool the server marks for the guest's confirmation: the model pauses on it. */
export const guestConfirms = (t: Tool) => t._meta?.[GUEST_CONFIRMS_META_KEY] === true;

const isFirstParty = (l: ListedTool): l is FirstPartyListed => l.server !== FERRYHOPPER;

/** The paused tools of this turn by name, each with the server that runs its halves. */
export function pausedTools(listed: ListedTool[]): Map<string, FirstPartyListed> {
  // Only first-party servers ask for the guest's confirmation.
  return new Map(
    listed
      .filter(isFirstParty)
      .filter((l) => guestConfirms(l.tool))
      .map((l) => [l.tool.name, l]),
  );
}

export const textOf = (content: CallToolResult['content']) =>
  content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');

/** A plain tool's answer: its output, or its tool error thrown as an Error with the text. */
export function outputOf(result: CallToolResult): unknown {
  if (result.isError) throw new Error(textOf(result.content) || 'tool error');
  return result.structuredContent ?? textOf(result.content);
}

/**
 * Hand conversion into AI SDK tools (not @ai-sdk/mcp). A tool the server marks as guest-confirmed
 * gets no `execute`, so the step stops on it and the turn loop runs its halves (src/loop). A tool
 * error from the server becomes a thrown error, which the model sees as a tool error. `onOutput`
 * gets each successful output, so the turn can show search results later (ticket 65).
 */
export function toAiTools(
  listed: ListedTool[],
  opts: {
    tools: TurnTools;
    onCall?: (name: string) => void;
    onOutput?: (name: string, output: unknown) => void;
  },
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
      execute: async (input: unknown, { toolCallId }) => {
        opts.onCall?.(t.name);
        const output = await opts.tools.call(l, input, toolCallId);
        opts.onOutput?.(t.name, output);
        return output;
      },
    });
  }
  return tools;
}
