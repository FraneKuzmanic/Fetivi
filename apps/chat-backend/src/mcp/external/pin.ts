import { createHash } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/client';

export const FERRYHOPPER = 'ferryhopper' as const;

/** The only Ferryhopper tools Fetivi exposes; anything else it lists is never shown or called. */
export const FERRYHOPPER_PINNED_TOOLS = [
  'search_ferry_trips',
  'trip_details',
  'get_ports',
  'get_direct_connections_for_ports',
  'get_disruptions',
] as const;

export interface Pin {
  /** The pinned tools that were listed, in pin order. */
  tools: Tool[];
  /** sha256 of the kept definitions, so a change in Ferryhopper's tools shows in the logs. */
  hash: string;
  byName: Map<string, Tool>;
}

export type Caller = 'model' | 'app';

export type CallCheck =
  | { ok: true; tool: Tool }
  | { ok: false; reason: 'not-pinned' | 'not-read-only' | 'not-visible' };

/** JSON with object keys sorted, so the hash does not depend on the server's key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

export function pinTools(listed: Tool[]): Pin {
  const tools = FERRYHOPPER_PINNED_TOOLS.flatMap((name) => listed.filter((t) => t.name === name));
  const hash = createHash('sha256')
    .update(
      canonical(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
          _meta: t._meta,
        })),
      ),
    )
    .digest('hex');
  return { tools, hash, byName: new Map(tools.map((t) => [t.name, t])) };
}

/** MCP Apps visibility; a tool without one is visible to both the model and the widget. */
function visibility(tool: Tool): unknown[] {
  const ui = tool._meta?.ui as { visibility?: unknown } | undefined;
  return Array.isArray(ui?.visibility) ? ui.visibility : ['model', 'app'];
}

export const modelVisible = (tool: Tool) => visibility(tool).includes('model');

/** Whether `caller` may run `name`: pinned, read-only and visible to that caller. */
export function checkCall(pin: Pin, name: string, caller: Caller): CallCheck {
  const tool = pin.byName.get(name);
  if (!tool) return { ok: false, reason: 'not-pinned' };
  if (tool.annotations?.readOnlyHint !== true) return { ok: false, reason: 'not-read-only' };
  if (!visibility(tool).includes(caller)) return { ok: false, reason: 'not-visible' };
  return { ok: true, tool };
}
