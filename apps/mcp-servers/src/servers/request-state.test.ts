import type { ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { confirmStateCodec, stateCodec } from './request-state';

const SECRET = 'unit-test-request-state-secret-0123456789';

describe('confirmStateCodec', () => {
  const ctx = {} as ServerContext;
  const codec = (tool: string, spaceId: string) => confirmStateCodec(tool, SECRET, spaceId);

  it('round-trips the pending id', async () => {
    const state = await codec('create_order', 'space-a').mint({ pendingId: 'p-1' }, ctx);
    expect(await codec('create_order', 'space-a').verify(state, ctx)).toEqual({ pendingId: 'p-1' });
  });

  it('rejects a value minted for another space or tool, or tampered with', async () => {
    const state = await codec('create_order', 'space-a').mint({ pendingId: 'p-1' }, ctx);
    await expect(codec('create_order', 'space-b').verify(state, ctx)).rejects.toThrow();
    await expect(codec('send_host_message', 'space-a').verify(state, ctx)).rejects.toThrow();
    const flipped = `${state.slice(0, -2)}${state.at(-2) === 'A' ? 'B' : 'A'}${state.at(-1)}`;
    await expect(codec('create_order', 'space-a').verify(flipped, ctx)).rejects.toThrow();
  });

  it('matches the codec used without a request context', async () => {
    const state = await stateCodec('send_host_message', SECRET, 'space-a').mint({
      pendingId: 'p-2',
    });
    expect(await codec('send_host_message', 'space-a').verify(state, ctx)).toEqual({
      pendingId: 'p-2',
    });
  });
});
