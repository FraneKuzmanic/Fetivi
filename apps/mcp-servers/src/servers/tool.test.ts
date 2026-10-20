import { randomUUID } from 'node:crypto';
import type { GuestIdentity } from '@fetivi/domain';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertClaimed, ClaimMismatchError, registerGuestTool } from './tool';

const identity: GuestIdentity = {
  spaceId: randomUUID(),
  stayId: randomUUID(),
  unitId: randomUUID(),
  propertyId: randomUUID(),
  destinationId: null,
  language: 'en',
  scopes: ['unit:read'],
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const echo = {
  description: 'Echoes a word.',
  inputSchema: z.object({ word: z.string() }),
  outputSchema: z.object({ word: z.string(), unit: z.string() }),
  scope: 'unit:read' as const,
  annotations: readOnly,
};

async function connect(build: (server: McpServer) => void) {
  const server = new McpServer({ name: 'test', version: '0' }, { capabilities: { tools: {} } });
  build(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test-client', version: '0' });
  await client.connect(clientSide);
  return client;
}

describe('registerGuestTool', () => {
  it('refuses identity arguments in the input schema, in any case', () => {
    const server = new McpServer({ name: 't', version: '0' });
    for (const key of ['unitId', 'StayId', 'SPACEID', 'destination']) {
      expect(() =>
        registerGuestTool(
          server,
          identity,
          `t-${key}`,
          { ...echo, inputSchema: z.object({ [key]: z.string() }) },
          async () => ({ word: '', unit: '' }),
        ),
      ).toThrow('declares identity arguments');
    }
  });

  it('answers structuredContent and the same JSON as text, with outputSchema listed', async () => {
    const client = await connect((server) => {
      registerGuestTool(server, identity, 'echo', echo, async ({ word }, id) => ({
        word,
        unit: id.unitId,
      }));
    });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.outputSchema).toMatchObject({
      type: 'object',
      properties: { word: { type: 'string' }, unit: { type: 'string' } },
    });
    expect(tools[0]?.annotations).toEqual(readOnly);

    const result = await client.callTool({ name: 'echo', arguments: { word: 'hi' } });
    const out = { word: 'hi', unit: identity.unitId };
    expect(result.structuredContent).toEqual(out);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(out) }]);
    expect(result.isError).toBeFalsy();
  });

  it('answers not permitted when the token lacks the scope', async () => {
    const client = await connect((server) => {
      registerGuestTool(server, { ...identity, scopes: [] }, 'echo', echo, async ({ word }) => ({
        word,
        unit: 'x',
      }));
    });
    const result = await client.callTool({ name: 'echo', arguments: { word: 'hi' } });
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'not permitted' }],
    });
  });

  it('answers not permitted when a passed id does not match the claims', async () => {
    const client = await connect((server) => {
      registerGuestTool(server, identity, 'echo', echo, async ({ word }, id) => {
        assertClaimed(id.unitId, word);
        return { word, unit: id.unitId };
      });
    });
    const denied = await client.callTool({ name: 'echo', arguments: { word: randomUUID() } });
    expect(denied).toMatchObject({ isError: true, content: [{ text: 'not permitted' }] });
    const allowed = await client.callTool({ name: 'echo', arguments: { word: identity.unitId } });
    expect(allowed.isError).toBeFalsy();
  });
});

describe('assertClaimed', () => {
  it('throws on a mismatch or a missing claim', () => {
    expect(() => assertClaimed('a', 'b')).toThrow(ClaimMismatchError);
    expect(() => assertClaimed(null, 'b')).toThrow(ClaimMismatchError);
    expect(() => assertClaimed('a', 'a')).not.toThrow();
  });
});
