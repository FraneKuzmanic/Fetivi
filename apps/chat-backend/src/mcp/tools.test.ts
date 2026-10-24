import { GUEST_CONFIRMS_META_KEY, type McpServerName } from '@fetivi/domain';
import type { Client, Tool } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import { mcpTurnTools } from '../tools/registry';
import type { TurnClients } from './clients';
import { createToolCatalog, listTurnTools, pausedTools, toAiTools } from './tools';

const def = (name: string): Tool => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
});

/** Fake clients: each server lists `tools[server]` and answers callTool with `call`. */
function fakeClients(
  tools: Partial<Record<McpServerName, Tool[]>>,
  call: (name: string, args: unknown) => unknown = () => ({ content: [] }),
) {
  const listTools = vi.fn(async (server: McpServerName) => ({ tools: tools[server] ?? [] }));
  const callTool = vi.fn(async ({ name, arguments: args }: { name: string; arguments: unknown }) =>
    call(name, args),
  );
  const clients: TurnClients = {
    get: async (server) => ({ listTools: () => listTools(server), callTool }) as unknown as Client,
    mcpMs: 0,
    timed: (run) => run(),
    call: async (server, _method, _target, run) => run(await clients.get(server), {}),
    close: async () => {},
  };
  return {
    clients,
    tools: mcpTurnTools(clients, createToolCatalog(), scopes),
    listTools,
    callTool,
  };
}

const scopes = { stay: 'unit:read', local: 'catalog:read', services: '', trip: 'plan:read' };
const execOptions = { toolCallId: 'c1', messages: [] } as never;

describe('listTurnTools', () => {
  it('orders tools by server, then by each server’s own list', async () => {
    const { clients } = fakeClients({
      trip: [def('t1')],
      local: [def('l2'), def('l1')],
      stay: [def('s1')],
    });
    const listed = await listTurnTools(createToolCatalog(), clients, scopes);
    expect(listed.map((l) => `${l.server}:${l.tool.name}`)).toEqual([
      'stay:s1',
      'local:l2',
      'local:l1',
      'trip:t1',
    ]);
  });

  it('caches per server and scope string', async () => {
    const { clients, listTools } = fakeClients({ local: [def('l1')] });
    const catalog = createToolCatalog();
    await listTurnTools(catalog, clients, scopes);
    await listTurnTools(catalog, clients, scopes);
    expect(listTools).toHaveBeenCalledTimes(4);
    await listTurnTools(catalog, clients, { ...scopes, local: 'catalog:read web_fallback:search' });
    expect(listTools).toHaveBeenCalledTimes(5);
    expect(listTools).toHaveBeenLastCalledWith('local');
  });
});

describe('toAiTools', () => {
  it('refuses two servers exposing the same name', () => {
    const { tools: turnTools } = fakeClients({});
    expect(() =>
      toAiTools(
        [
          { server: 'stay', tool: def('dup') },
          { server: 'local', tool: def('dup') },
        ],
        { tools: turnTools },
      ),
    ).toThrow('dup');
  });

  it('calls the tool on its own server and returns the structured content', async () => {
    const { tools: turnTools, callTool } = fakeClients({}, (_name, args) => ({
      structuredContent: { echoed: args },
      content: [{ type: 'text', text: '{}' }],
    }));
    const names: string[] = [];
    const tools = toAiTools([{ server: 'local', tool: def('find') }], {
      tools: turnTools,
      onCall: (n) => names.push(n),
    });
    expect(tools.find?.description).toBe('find tool');
    const out = await tools.find?.execute?.({ q: 'x' }, execOptions);
    expect(out).toEqual({ echoed: { q: 'x' } });
    expect(callTool).toHaveBeenCalledWith({ name: 'find', arguments: { q: 'x' }, _meta: {} });
    expect(names).toEqual(['find']);
  });

  it('returns the text when there is no structured content', async () => {
    const { tools: turnTools } = fakeClients({}, () => ({
      content: [{ type: 'text', text: 'plain' }],
    }));
    const tools = toAiTools([{ server: 'local', tool: def('t') }], { tools: turnTools });
    expect(await tools.t?.execute?.({}, execOptions)).toBe('plain');
  });

  it('throws the server’s text on a tool error', async () => {
    const { tools: turnTools } = fakeClients({}, () => ({
      isError: true,
      content: [{ type: 'text', text: 'not permitted' }],
    }));
    const tools = toAiTools([{ server: 'local', tool: def('t') }], { tools: turnTools });
    await expect(tools.t?.execute?.({}, execOptions)).rejects.toThrow('not permitted');
  });

  it('leaves a tool the server marks guest-confirmed without execute', () => {
    const { tools: turnTools } = fakeClients({});
    const listed = [
      {
        server: 'services' as const,
        tool: { ...def('order'), _meta: { [GUEST_CONFIRMS_META_KEY]: true } },
      },
      { server: 'services' as const, tool: { ...def('write'), _meta: { other: true } } },
      { server: 'local' as const, tool: def('read') },
    ];
    const tools = toAiTools(listed, { tools: turnTools });
    expect(tools.order).toBeDefined();
    expect('execute' in (tools.order ?? {})).toBe(false);
    expect(tools.write?.execute).toBeTypeOf('function');
    expect(tools.read?.execute).toBeTypeOf('function');
    expect([...pausedTools(listed)].map(([name, l]) => [name, l.server])).toEqual([
      ['order', 'services'],
    ]);
  });
});
