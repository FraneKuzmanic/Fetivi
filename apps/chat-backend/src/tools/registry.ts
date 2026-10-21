import {
  type GuestProjection,
  MCP_SERVERS,
  type McpServerName,
  type SpaceContext,
  scopesFor,
  type ToolTransport,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import type { CallToolResult } from '@modelcontextprotocol/client';
import {
  type AnsweredCall,
  answer,
  firstHalf,
  type Outcome,
  type PausedCall,
} from '../loop/elicitation';
import { openTurnClients, type TurnClients } from '../mcp/clients';
import { type ListedTool, listTurnTools, outputOf, type ToolCatalog } from '../mcp/tools';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';

/** One turn's (or one request's) guest tools, whichever transport runs them. */
export interface TurnTools {
  readonly transport: ToolTransport;
  /** Every server's tools, in MCP_SERVERS order then each server's own order. */
  list(): Promise<ListedTool[]>;
  /** A tool that is not paused; a tool error is thrown as an Error with its text. */
  call(listed: ListedTool, input: unknown): Promise<unknown>;
  /** A paused tool's first half. */
  firstHalf(call: PausedCall): Promise<Outcome>;
  /** A paused tool's second half, with the stored requestState. */
  answer(call: AnsweredCall): Promise<Outcome>;
  /** The unit record as the stay server shows it now. Never cached: it is how changes are seen. */
  readProjection(): Promise<GuestProjection>;
  /** Ms during which at least one tool-transport call was in flight. */
  readonly ms: number;
  close(): Promise<void>;
}

/** How the chat reaches the guest tools: chosen once at boot by TOOL_TRANSPORT. */
export interface ToolBinding {
  readonly transport: ToolTransport;
  open(ctx: SpaceContext, now: Date): Promise<TurnTools>;
}

/** The production path (V1): the first-party MCP servers, one token per server per turn. */
export function mcpBinding(deps: {
  tokens: TokenConfig;
  mcpFetch: Egress['fetch'];
  catalog: ToolCatalog;
}): ToolBinding {
  return {
    transport: 'mcp',
    async open(ctx, now) {
      const clients = openTurnClients({
        tokens: await mintServerTokens(deps.tokens, ctx, now),
        baseUrl: deps.tokens.mcpBaseUrl,
        fetch: deps.mcpFetch,
      });
      const scopes = Object.fromEntries(
        MCP_SERVERS.map((s) => [s, scopesFor(s, ctx).join(' ')]),
      ) as Record<McpServerName, string>;
      return mcpTurnTools(clients, deps.catalog, scopes);
    },
  };
}

/** One turn's tools over open MCP clients. Exported for tests. */
export function mcpTurnTools(
  clients: TurnClients,
  catalog: ToolCatalog,
  scopes: Record<McpServerName, string>,
): TurnTools {
  return {
    transport: 'mcp',
    list: () => listTurnTools(catalog, clients, scopes),
    async call({ server, tool }, input) {
      const result = (await clients.timed(async () =>
        (
          await clients.get(server)
        ).callTool({
          name: tool.name,
          arguments: input as Record<string, unknown>,
        }),
      )) as CallToolResult;
      return outputOf(result);
    },
    firstHalf: (call) => firstHalf({ ...call, clients }),
    answer: (call) => answer({ ...call, clients }),
    async readProjection() {
      const result = await clients.timed(async () =>
        (await clients.get('stay')).readResource({ uri: UNIT_RESOURCE_URI }),
      );
      const content = result.contents[0];
      if (!content || !('text' in content) || typeof content.text !== 'string') {
        throw new Error('unit record without text');
      }
      return JSON.parse(content.text) as GuestProjection;
    },
    get ms() {
      return clients.mcpMs;
    },
    close: () => clients.close(),
  };
}
